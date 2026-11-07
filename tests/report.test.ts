import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type RequestListener, type Server } from 'node:http';
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

test('replay exports every activity and complete paged text with escaped HTML and one measurement notice', async () => {
  const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'replay-export-'));
  const store = await Store.open(join(root, 'state.sqlite'));
  try {
    store.ingest('s', [{ id: 'u', at: 1, type: 'turn', turnId: 'u' }]);
    for (let i = 0; i < 205; i++) {
      store.activities.update('s', { id: `a${i}`, turnId: 'u', turnNumber: 1, kind: 'text', label: 'Response', title: `Answer ${i}`, status: 'completed', at: i });
      store.activities.write('s', `a${i}`, 'output', i === 204 ? '</pre><script>bad()</script>' + 'long '.repeat(10000) : `body ${i}`);
    }
    const json = JSON.parse(readFileSync(await exportReport(store, 's', root, 'json'), 'utf8'));
    assert.equal(json.activities?.length, 205);
    assert.equal(json.activities[204].bodies.output, '</pre><script>bad()</script>' + 'long '.repeat(10000));
    const html = readFileSync(await exportReport(store, 's', root, 'html'), 'utf8');
    assert.equal((html.match(/data-activity=/g) ?? []).length, 205);
    assert.ok(!html.includes('<script>bad()'));
    assert.ok(html.includes('&lt;script&gt;bad()'));
    assert.equal((html.match(/Growth is measured at model-request boundaries/g) ?? []).length, 1);
  } finally { store.close(); }
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

async function listener(handler: RequestListener, port = 0): Promise<Server> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}

async function closeListener(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('a persisted bridge follows repeated backend restarts while other processes occupy the old ports', async t => {
  const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'pair-restart-'));
  const path = join(root, 'backend.json'), pairings = join(root, 'pairings.json');
  const store = await Store.open(':memory:');
  store.ingest('retained-session', [{ id: 'u', type: 'turn', turnId: 'u', at: 1 }]);
  let backend: Backend | undefined = await Backend.start(store, { directory: root, descriptorPath: path });
  const blockers: Server[] = []; let staleRequests = 0;
  t.after(async () => { await backend?.close(); for (const server of blockers) await closeListener(server); store.close(); });
  await new Bridge(pairings).pair(root, path);
  for (let restart = 0; restart < 2; restart++) {
    const old = backend!.descriptor;
    await backend!.close(); backend = undefined;
    blockers.push(await listener((_request, response) => { staleRequests++; response.writeHead(503).end('{}'); }, Number(new URL(old.url).port)));
    backend = await Backend.start(store, { directory: root, descriptorPath: path });
    assert.notEqual(backend.descriptor.url, old.url, 'The backend must bind a free port while the old port is occupied');
    const restored = new Bridge(pairings);
    assert.deepEqual(await restored.request(root, '/sessions', 'GET'), ['retained-session']);
    assert.equal(staleRequests, 0, 'The saved descriptor path must be read before contacting an obsolete listener');
  }
});

test('Windows project case and separator variants share a persisted pairing', { skip: process.platform !== 'win32' }, async t => {
  const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'pair-path-'));
  const path = join(root, 'backend.json'), pairings = join(root, 'pairings.json');
  const store = await Store.open(':memory:');
  const backend = await Backend.start(store, { directory: root, descriptorPath: path });
  t.after(async () => { await backend.close(); store.close(); });
  await new Bridge(pairings).pair(root.toUpperCase(), path);
  assert.deepEqual(await new Bridge(pairings).request(root.toLowerCase().replaceAll('\\', '/') + '/', '/sessions', 'GET'), []);
});

test('descriptor replacements are validated instead of silently using a cached healthy listener', async t => {
  const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'pair-replacement-'));
  const path = join(root, 'backend.json');
  const store = await Store.open(':memory:');
  const backend = await Backend.start(store, { directory: root, descriptorPath: path });
  t.after(async () => { await backend.close(); store.close(); });
  const bridge = new Bridge(join(root, 'pairings.json'));
  await bridge.pair(root, path);
  for (const invalid of [
    { text: JSON.stringify({ ...backend.descriptor, directory: join(root, 'another-project') }), error: /directory|project/i },
    { text: JSON.stringify({ ...backend.descriptor, url: 'https://example.invalid' }), error: /loopback/i },
    { text: '{unfinished', error: /descriptor/i },
    { text: ' '.repeat(16385), error: /descriptor/i },
    { text: JSON.stringify({ ...backend.descriptor, instance: 'different-instance' }), error: /instance|identity/i },
  ]) {
    writeFileSync(path, invalid.text);
    await assert.rejects(bridge.request(root, '/sessions', 'GET'), invalid.error);
  }
  writeFileSync(path, JSON.stringify(backend.descriptor));
  renameSync(path, join(root, 'descriptor-away.json'));
  await assert.rejects(bridge.request(root, '/sessions', 'GET'), /descriptor/i);
});

test('legacy pairings work while healthy and explain how to repair a stale listener', async t => {
  const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'pair-legacy-'));
  const pairings = join(root, 'pairings.json');
  const store = await Store.open(':memory:');
  let backend: Backend | undefined = await Backend.start(store, { directory: root });
  t.after(async () => { await backend?.close(); store.close(); });
  writeFileSync(pairings, JSON.stringify({ [root]: backend.descriptor }));
  const bridge = new Bridge(pairings);
  assert.deepEqual(await bridge.request(root, '/sessions', 'GET'), []);
  await backend.close(); backend = undefined;
  await assert.rejects(bridge.request(root, '/sessions', 'GET'), /pair.*again|re-pair/i);
});

test('an old port reused by a different listener cannot receive a forwarded POST', async t => {
  const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'pair-identity-'));
  const path = join(root, 'backend.json');
  const store = await Store.open(':memory:');
  const backend = await Backend.start(store, { directory: root, descriptorPath: path });
  const bridge = new Bridge(join(root, 'pairings.json'));
  await bridge.pair(root, path);
  const old = backend.descriptor;
  await backend.close(); store.close();
  let posts = 0;
  const impostor = await listener((request, response) => {
    if (request.method === 'POST') posts++;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ instance: 'unrelated-listener', directory: root }));
  }, Number(new URL(old.url).port));
  t.after(() => closeListener(impostor));
  await assert.rejects(bridge.request(root, '/settings?session=s', 'POST', { span: 7 }), /identity|instance/i);
  assert.equal(posts, 0);
});

test('a dropped POST response is never replayed even when a replacement descriptor becomes available', async t => {
  const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'pair-no-replay-'));
  const path = join(root, 'backend.json');
  const store = await Store.open(':memory:');
  store.ingest('replacement-session', [{ id: 'u', type: 'turn', turnId: 'u', at: 1 }]);
  let replacementPosts = 0, firstPosts = 0;
  const replacement = await Backend.start(store, { directory: root, extra: async () => { replacementPosts++; return {}; } });
  const descriptor = { version: 1, url: '', token: 'a'.repeat(64), instance: 'initial-instance', directory: root };
  const first = await listener((request, response) => {
    if (request.url === '/health') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ instance: descriptor.instance, directory: root })); return; }
    if (request.method === 'POST') { firstPosts++; writeFileSync(path, JSON.stringify(replacement.descriptor)); request.socket.destroy(); return; }
    response.setHeader('Content-Type', 'application/json'); response.end('[]');
  });
  t.after(async () => { await closeListener(first); await replacement.close(); store.close(); });
  descriptor.url = `http://127.0.0.1:${(first.address() as { port: number }).port}`;
  writeFileSync(path, JSON.stringify(descriptor));
  const bridge = new Bridge(join(root, 'pairings.json'));
  await bridge.pair(root, path);
  await assert.rejects(bridge.request(root, '/side-effect?session=s', 'POST', { action: 'once' }), /not retried|outcome.*unknown/i);
  assert.equal(firstPosts, 1);
  assert.equal(replacementPosts, 0);
  assert.deepEqual(await bridge.request(root, '/sessions', 'GET'), ['replacement-session']);
});
