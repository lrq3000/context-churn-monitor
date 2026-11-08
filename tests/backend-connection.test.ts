import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type RequestListener } from 'node:http';
import { Store } from '../src/storage/store.js';
import { AlertHistory } from '../src/storage/alerts.js';
import { Backend } from '../src/reports/backend.js';
import { Bridge } from '../src/gui/bridge.js';

const temporary = () => mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'backend-connect-'));
async function fixture(t: TestContext) {
  const root = temporary(), path = join(root, 'custom-data-root', 'backend.json'), pairings = join(root, 'pairings.json');
  const history = await AlertHistory.open(join(root, 'global.sqlite')), store = await Store.open(':memory:');
  store.ingest('current', [{ type: 'turn', turnId: 'user-turn', id: 'u', at: 1 }]);
  let backend = await Backend.start(store, { directory: root, descriptorPath: path, registry: (history as any).backends } as any);
  t.after(async () => { await backend.close(); store.close(); history.close(); });
  return { root, path, pairings, history, store, get backend() { return backend; }, replace(value: Backend) { backend = value; }, bridge: new Bridge(pairings, (history as any).backends) };
}

test('a fresh project connects to its registered custom-root backend without creating a manual pairing', async t => {
  const f = await fixture(t);
  const snapshot = await f.bridge.request(f.root, '/snapshot?session=current', 'GET');
  assert.equal(snapshot.state.turn.id, 'user-turn');
  assert.deepEqual(await f.bridge.request(f.root, '/sessions', 'GET'), ['current']);
  assert.equal(existsSync(f.pairings), false, 'Automatic resolution is not a silently persisted manual override');
  assert.deepEqual((f.history as any).backends.paths(f.root), [f.path]);
  await assert.rejects(f.bridge.request(join(f.root, 'another-project'), '/sessions', 'GET'), /no.*backend|unavailable/i);
});

test('registered paths persist across handles and normalize Windows project aliases', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t), second = await AlertHistory.open(join(f.root, 'global.sqlite'));
  t.after(() => second.close());
  const alias = f.root.toUpperCase().replaceAll('\\', '/') + '/';
  assert.deepEqual(await new Bridge(f.pairings, (second as any).backends).request(alias, '/sessions', 'GET'), ['current']);
  assert.equal(existsSync(f.pairings), false);
});

async function listener(handler: RequestListener, port = 0) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}

test('automatic connection rereads a restarted descriptor instead of contacting the occupied old port', async t => {
  const f = await fixture(t), old = f.backend.descriptor;
  await f.backend.close();
  let staleRequests = 0;
  const stale = await listener((_req, res) => { staleRequests++; res.writeHead(503).end('{}'); }, Number(new URL(old.url).port));
  t.after(() => new Promise<void>(resolve => stale.close(() => resolve())));
  f.replace(await Backend.start(f.store, { directory: f.root, descriptorPath: f.path, registry: (f.history as any).backends } as any));
  assert.notEqual(f.backend.descriptor.url, old.url);
  const publicationChecks = staleRequests;
  assert.deepEqual(await f.bridge.request(f.root, '/sessions', 'GET'), ['current']);
  assert.equal(staleRequests, publicationChecks, 'GUI discovery must not contact the old port after the new descriptor has been published');
});

test('multiple live registered backends require manual selection and a broken explicit selection never falls back', async t => {
  const f = await fixture(t), otherStore = await Store.open(':memory:'), otherPath = join(f.root, 'other-data', 'backend.json');
  otherStore.ingest('chosen', [{ type: 'turn', turnId: 'other', id: 'other', at: 1 }]);
  const other = await Backend.start(otherStore, { directory: f.root, descriptorPath: otherPath, registry: (f.history as any).backends } as any);
  t.after(async () => { await other.close(); otherStore.close(); });
  await assert.rejects(f.bridge.request(f.root, '/sessions', 'GET'), /multiple|ambiguous/i);
  await f.bridge.pair(f.root, otherPath);
  assert.deepEqual(await f.bridge.request(f.root, '/sessions', 'GET'), ['chosen']);
  writeFileSync(otherPath, '{malformed');
  await assert.rejects(f.bridge.request(f.root, '/sessions', 'GET'), /descriptor/i);
});

test('registered but invalid descriptors do not bypass exact-directory, loopback or instance validation', async t => {
  const f = await fixture(t);
  for (const descriptor of [
    { ...f.backend.descriptor, directory: join(f.root, 'wrong') },
    { ...f.backend.descriptor, url: 'https://example.invalid' },
    { ...f.backend.descriptor, instance: 'wrong-instance' },
  ]) {
    writeFileSync(f.path, JSON.stringify(descriptor));
    await assert.rejects(f.bridge.request(f.root, '/sessions', 'GET'), /no.*backend|unavailable/i);
  }
  writeFileSync(f.path, JSON.stringify(f.backend.descriptor));
  assert.deepEqual(await f.bridge.request(f.root, '/sessions', 'GET'), ['current']);
});

test('discovery refuses an oversized candidate set without scanning descriptor files', async t => {
  const f = await fixture(t), registry = (f.history as any).backends;
  for (let i = 0; i < 20; i++) registry.register(f.root, join(f.root, `missing-${i}.json`));
  assert.equal(registry.paths(f.root).length, 9, 'The indexed result itself is bounded');
  await assert.rejects(f.bridge.request(f.root, '/sessions', 'GET'), /too many|manual/i);
});

test('a failed registry publication closes the newly bound backend listener', async t => {
  const root = temporary(), path = join(root, 'backend.json'), store = await Store.open(':memory:');
  t.after(() => store.close());
  let unexpected: Backend | undefined;
  try {
    await assert.rejects(async () => { unexpected = await Backend.start(store, { directory: root, descriptorPath: path, registry: { register() { throw new Error('Registry unavailable'); } } } as any); }, /Registry unavailable/);
    const descriptor = JSON.parse(readFileSync(path, 'utf8'));
    await assert.rejects(fetch(descriptor.url + '/health', { signal: AbortSignal.timeout(1000) }));
  } finally { await unexpected?.close(); }
});

test('automatic discovery never replays a dropped POST against a replacement backend', async t => {
  const f = await fixture(t), replacement = f.backend.descriptor;
  let posts = 0;
  const descriptor = { ...replacement, token: 'a'.repeat(64), instance: 'first-instance', url: '' };
  const first = await listener((req, res) => {
    if (req.url === '/health') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ instance: descriptor.instance, directory: f.root })); return; }
    if (req.method === 'POST') { posts++; writeFileSync(f.path, JSON.stringify(replacement)); req.socket.destroy(); return; }
    res.end('[]');
  });
  t.after(() => new Promise<void>(resolve => first.close(() => resolve())));
  descriptor.url = `http://127.0.0.1:${(first.address() as any).port}`;
  writeFileSync(f.path, JSON.stringify(descriptor));
  await assert.rejects(f.bridge.request(f.root, '/settings?session=current', 'POST', { span: 9 }), /not retried|outcome.*unknown/i);
  assert.equal(posts, 1);
  assert.equal(f.store.settings('current').span, 5, 'The replacement backend must not receive a retry');
  assert.deepEqual(await f.bridge.request(f.root, '/sessions', 'GET'), ['current']);
});

test('a live publisher cannot be displaced by another backend using the same descriptor path', async t => {
  const f = await fixture(t), before = readFileSync(f.path), otherStore = await Store.open(':memory:');
  t.after(() => otherStore.close());
  let unexpected: Backend | undefined;
  try {
    await assert.rejects(async () => { unexpected = await Backend.start(otherStore, { directory: f.root, descriptorPath: f.path, registry: f.history.backends }); }, /already.*active|owned|in use/i);
    assert.deepEqual(readFileSync(f.path), before);
    assert.deepEqual(await f.bridge.request(f.root, '/sessions', 'GET'), ['current']);
  } finally { await unexpected?.close(); }
});

test('concurrent same-path publishers sharing the registry admit exactly one owner', async t => {
  const root = temporary(), path = join(root, 'shared.backend.json'), history = await AlertHistory.open(join(root, 'global.sqlite'));
  const stores = await Promise.all([Store.open(':memory:'), Store.open(':memory:')]);
  for (const [i, store] of stores.entries()) store.ingest(i === 0 ? 'first' : 'second', [{ type: 'turn', turnId: 'u', id: 'u', at: 1 }]);
  const results = await Promise.allSettled(stores.map(store => Backend.start(store, { directory: root, descriptorPath: path, registry: history.backends })));
  t.after(async () => { for (const result of results) if (result.status === 'fulfilled') await result.value.close(); for (const store of stores) store.close(); history.close(); });
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const winner = results[0].status === 'fulfilled' ? 'first' : 'second';
  assert.deepEqual(await new Bridge(join(root, 'pairings.json'), history.backends).request(root, '/sessions', 'GET'), [winner]);
});

test('failed replacement publication restores the previous descriptor and rolls back registry changes', async t => {
  const root = temporary(), path = join(root, 'backend.json'), history = await AlertHistory.open(join(root, 'global.sqlite')), store = await Store.open(':memory:');
  t.after(() => { store.close(); history.close(); });
  const old = await Backend.start(store, { directory: root, descriptorPath: path, registry: history.backends });
  await old.close();
  const before = readFileSync(path), pathsBefore = history.backends.paths(root);
  const register = history.backends.register.bind(history.backends);
  let failedUrl = '';
  history.backends.register = (directory, descriptorPath) => { failedUrl = JSON.parse(readFileSync(path, 'utf8')).url; register(directory, descriptorPath); throw new Error('Registry commit failed'); };
  let unexpected: Backend | undefined;
  try {
    await assert.rejects(async () => { unexpected = await Backend.start(store, { directory: root, descriptorPath: path, registry: history.backends }); }, /Registry commit failed/);
    assert.deepEqual(readFileSync(path), before, 'The failed publisher must not strand the previous registration at its closed listener');
    assert.deepEqual(history.backends.paths(root), pathsBefore);
    assert.ok(failedUrl);
    await assert.rejects(fetch(failedUrl + '/health', { signal: AbortSignal.timeout(1000) }));
  } finally { await unexpected?.close(); }
});

test('relative custom data roots retain publication semantics and register the absolute descriptor path', async t => {
  const root = temporary(), path = relative(process.cwd(), join(root, 'relative-data', 'backend.json'));
  const history = await AlertHistory.open(join(root, 'global.sqlite')), store = await Store.open(':memory:');
  t.after(() => { store.close(); history.close(); });
  const backend = await Backend.start(store, { directory: root, descriptorPath: path, registry: history.backends });
  t.after(() => backend.close());
  assert.equal(existsSync(path), true);
  assert.deepEqual(history.backends.paths(root), [resolve(path)]);
  assert.deepEqual(await new Bridge(join(root, 'pairings.json'), history.backends).request(root, '/sessions', 'GET'), []);
});
