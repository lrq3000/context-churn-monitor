import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/storage/store.js';

test('atomic event deduplication survives reopening and keeps every step paginated', async () => {
  const path = join(mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'context-monitor-')), 'state.sqlite');
  let store = await Store.open(path);
  store.ingest('session', [{ id: 'a', at: 1, type: 'turn', turnId: 'u' }]);
  for (let i = 0; i < 105; i++) store.ingest('session', [{ id: `s${i}`, at: i + 2, type: 'step', stepId: `s${i}` }]);
  store.ingest('session', [{ id: 'c', at: 110, type: 'compact', checkpointId: 'c', trigger: 'auto', beforeKnown: false }]);
  store.close(); store = await Store.open(path);
  store.ingest('session', [{ id: 'c', at: 110, type: 'compact', checkpointId: 'c', trigger: 'auto', beforeKnown: false }]);
  assert.equal(store.snapshot('session')?.turn?.compactions, 1);
  const first = store.steps('session', { limit: 100 });
  const last = store.steps('session', { limit: 100, offset: first.next! });
  assert.equal(first.items.length, 100);
  assert.equal(last.items.length, 5);
  assert.equal(last.items[4].id, 's104');
  assert.equal(store.steps('session', { scope: 'current' }).items[0].turnNumber, 1);
  assert.equal(store.steps('other').items.length, 0);
  store.close();
});

test('two store handles do not overwrite each other and scoped settings survive', async () => {
  const path = join(mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'context-monitor-')), 'state.sqlite');
  const a = await Store.open(path), b = await Store.open(path);
  a.ingest('s', [{ id: 'a', at: 1, type: 'turn', turnId: 'u' }]);
  b.ingest('s', [{ id: 'b', at: 2, type: 'step', stepId: 'b' }]);
  a.ingest('s', [{ id: 'c', at: 3, type: 'step', stepId: 'c' }]);
  b.setSettings('s', { warnings: false });
  assert.equal(a.snapshot('s')?.turn?.steps, 2);
  assert.equal(a.settings('s').warnings, false);
  assert.throws(() => a.setSettings('s', { span: 0 }), /span/);
  a.close(); b.close();
});
