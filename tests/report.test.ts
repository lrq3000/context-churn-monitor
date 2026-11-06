import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/store.js';
import { Backend } from '../src/reports/backend.js';
import { Bridge } from '../src/gui/bridge.js';
import { exportReport } from '../src/reports/html.js';
import { parseManifestJson } from '@openchamber/sdk/schemas';

test('the independently installable extension retains the package version required by the host', () => {
  // The host reads package JSON and requires a version; parsing the inner manifest alone also accepts an unwrapped object that the installer rejects.
  const result = parseManifestJson(readFileSync('openchamber/package.json', 'utf8'));
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(result.version, 'The host catalog rejects packages without a parsed version');
  assert.equal(result.manifest.contributes.panel.id, 'context-churn-monitor');
});

test('HTML export escapes tool output and includes all pages beyond the analysis lookback', async () => {
  const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'report-'));
  const store = await Store.open(join(root, 'state.sqlite'));
  for (let i = 0; i < 105; i++) store.ingest('s', [{ id: `u${i}`, at: i, type: 'turn', turnId: `u${i}` }, { id: `s${i}`, at: i, type: 'step', stepId: `s${i}` }]);
  store.ingest('s', [{ id: 'evil', at: 106, type: 'evidence', evidence: { tool: 'read', label: '<img src=x onerror=alert(1)>', excerpt: '</script><script>alert(1)</script>' } }]);
  const html = await exportReport(store, 's', root, 'html');
  const text = readFileSync(html, 'utf8');
  assert.equal((text.match(/data-step=/g) ?? []).length, 105);
  assert.ok(!text.includes('<img src=x'));
  assert.ok(text.includes('&lt;/script&gt;'));
  const json = JSON.parse(readFileSync(await exportReport(store, 's', root, 'json'), 'utf8'));
  assert.equal(json.steps.length, 105);
  store.close();
});

test('large exports leave the event loop and monitoring writer available', async () => {
  const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'export-concurrency-'));
  const store = await Store.open(join(root, 'state.sqlite'));
  store.ingest('s', [{ id: 'u', type: 'turn', turnId: 'u', at: 1 }]);
  const insert = store.db.prepare('INSERT INTO steps VALUES (?,?,?,?,?,?)');
  store.atomic(() => {
    for (let i = 1; i <= 200000; i++) insert.run('s', `s${i}`, 1, i, 0, JSON.stringify({ id: `s${i}`, turnId: 'u', turnNumber: 1, number: i, at: i, growth: 0, compactions: 0, quality: 'partial', gaps: [], evidence: [] }));
  });
  let writes = 0, error: unknown;
  const timer = setInterval(() => {
    try { store.set('concurrent-writer', ++writes); } catch (failure) { error = failure; }
  }, 10);
  try {
    const path = await exportReport(store, 's', root, 'json');
    assert.ok(writes > 0, 'Export must yield to the monitoring event loop before it completes');
    assert.equal(error, undefined, 'Export must not reserve the SQLite writer');
    const json = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(json.steps.length, 200000);
    assert.equal(json.steps[199999].id, 's200000');
  } finally { clearInterval(timer); store.close(); }
});

test('a read-only export snapshot remains consistent while another connection ingests a step', async () => {
  const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'export-snapshot-'));
  const path = join(root, 'state.sqlite'); const writer = await Store.open(path);
  writer.ingest('s', [{ id: 'u', type: 'turn', turnId: 'u', at: 1 }, { id: 'a', type: 'step', stepId: 'a', at: 2 }]);
  const reader = await Store.open(path, {}, true);
  try {
    reader.readSnapshot(() => {
      assert.equal(reader.snapshot('s')!.turn!.steps, 1);
      writer.ingest('s', [{ id: 'b', type: 'step', stepId: 'b', at: 3 }]);
      assert.deepEqual(reader.stepBatch('s').map(step => step.id), ['a']);
      assert.throws(() => reader.set('must-not-write', true), /readonly|read.only/i);
    });
    assert.deepEqual(reader.stepBatch('s', [1, 1]).map(step => step.id), ['b']);
  } finally { reader.close(); writer.close(); }
});

test('explicit backend pairing rejects remote origins and mismatched directories', async () => {
  const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'pair-'));
  const store = await Store.open(':memory:');
  const path = join(root, 'backend.json');
  const backend = await Backend.start(store, { directory: '/project', descriptorPath: path });
  const bridge = new Bridge(join(root, 'pairings.json'));
  try {
    await assert.rejects(bridge.pair('/wrong', path), /directory/i);
    await bridge.pair('/project', path);
    assert.deepEqual(await bridge.request('/project', '/sessions', 'GET'), []);
    const remote = join(root, 'remote.json');
    writeFileSync(remote, JSON.stringify({ ...backend.descriptor, url: 'https://example.com' }));
    await assert.rejects(bridge.pair('/project', remote), /loopback/i);
  } finally { await backend.close(); store.close(); }
});
