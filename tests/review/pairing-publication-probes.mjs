// Historical independent-review probes for 0e63c87. These assert FORMER defects, not current passing behavior.
// Run from plugins/context-churn-monitor with node --import tsx <this file>; all writes stay in the approved artifact subtree.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';

const temporary = process.env.CONTEXT_MONITOR_TEST_TMP;
assert.equal(temporary?.replaceAll('\\', '/'), 'C:/Users/33632/AppData/Local/Temp/opencode/context-churn-monitor');
const root = mkdtempSync(join(temporary, 'pairing-20261108', 'senior-review-'));
const load = path => import(pathToFileURL(resolve(path)).href);
const { Store } = await load('src/storage/store.ts');
const { AlertHistory } = await load('src/storage/alerts.ts');
const { Backend } = await load('src/reports/backend.ts');
const { Bridge } = await load('src/gui/bridge.ts');
const evidence = { revision: '0e63c87', artifactRoot: root, probes: {} };
const cases = [];
async function fixture(name) {
  const directory = join(root, name); mkdirSync(directory);
  const history = await AlertHistory.open(join(directory, 'alerts.sqlite'));
  const stores = [], backends = [];
  cases.push(async () => {
    for (const backend of backends) if (backend) await backend.close();
    for (const store of stores) store.close();
    history.close();
  });
  const store = async session => {
    const value = await Store.open(':memory:'); stores.push(value);
    value.ingest(session, [{ type: 'turn', id: 'turn', turnId: session, at: 1 }]);
    return value;
  };
  const backend = async (value, descriptorPath, registry = history.backends) => {
    const valueBackend = await Backend.start(value, { directory, descriptorPath, registry });
    backends.push(valueBackend); return valueBackend;
  };
  const close = async value => { await value.close(); backends[backends.indexOf(value)] = null; };
  return { directory, history, store, backend, close, bridge: new Bridge(join(directory, 'pairings.json'), history.backends) };
}

try {
  {
    const f = await fixture('same-descriptor');
    const path = join(f.directory, 'shared.backend.json');
    const a = await f.backend(await f.store('first-owner'), path);
    const b = await f.backend(await f.store('second-owner'), path);
    const health = async d => (await fetch(d.url + '/health', { headers: { Authorization: `Bearer ${d.token}`, 'X-Context-Monitor-Instance': d.instance } })).status;
    const statuses = [await health(a.descriptor), await health(b.descriptor)];
    const selectedSessions = await f.bridge.request(f.directory, '/sessions', 'GET');
    await f.close(b);
    let afterSecondStopped;
    try { afterSecondStopped = await f.bridge.request(f.directory, '/sessions', 'GET'); }
    catch (error) { afterSecondStopped = error.message; }
    evidence.probes.sameDescriptor = { health: statuses, registryRows: f.history.backends.paths(f.directory).length, selectedSessions, afterSecondStopped, firstStillHealthy: await health(a.descriptor) };
    assert.deepEqual(statuses, [200, 200]);
    assert.deepEqual(selectedSessions, ['second-owner']);
  }
  {
    const f = await fixture('distinct-descriptors');
    await f.backend(await f.store('first'), join(f.directory, 'first.json'));
    await f.backend(await f.store('second'), join(f.directory, 'second.json'));
    let rejection;
    try { await f.bridge.request(f.directory, '/sessions', 'GET'); }
    catch (error) { rejection = error.message; }
    assert.match(rejection, /Multiple healthy/);
    evidence.probes.distinctDescriptors = { rejection };
  }
  {
    const f = await fixture('relative-custom-root');
    const store = await f.store('retained');
    const originalPath = relative(process.cwd(), join(f.directory, 'previous.backend.json'));
    const previous = await Backend.start(store, { directory: f.directory, descriptorPath: originalPath });
    await previous.close();
    const registeredPath = relative(process.cwd(), join(f.directory, 'registered.backend.json'));
    let rejection;
    try { await f.backend(store, registeredPath); }
    catch (error) { rejection = error.message; }
    assert.match(rejection, /absolute/);
    evidence.probes.relativeRoot = { oldPublicationSucceeded: true, registeredPublicationError: rejection };
  }
  {
    const f = await fixture('failed-publication-existing-owner');
    const path = join(f.directory, 'shared.backend.json');
    const store = await f.store('original-owner');
    const original = await f.backend(store, path);
    f.history.setSettings({ ...f.history.settings(), liveGrowth: 95 });
    f.history.insert([{ id: 'fixture-event', at: 1, sessionId: 'original-owner', directory: f.directory, metric: 'growth', value: 96, threshold: 95, kind: 'live', delivery: 'recorded' }]);
    const before = JSON.stringify({ settings: f.history.settings(), events: f.history.list() });
    let publicationError;
    try { await f.backend(store, path, { register() { throw new Error('isolated registry publication failure'); } }); }
    catch (error) { publicationError = error.message; }
    const failedDescriptor = JSON.parse(readFileSync(path, 'utf8'));
    let newlyPublishedListenerAlive = true;
    try { await fetch(failedDescriptor.url + '/health', { signal: AbortSignal.timeout(1000) }); }
    catch { newlyPublishedListenerAlive = false; }
    let discoveryError;
    try { await f.bridge.request(f.directory, '/sessions', 'GET'); }
    catch (error) { discoveryError = error.message; }
    const originalHealthy = (await fetch(original.descriptor.url + '/health', { headers: { Authorization: `Bearer ${original.descriptor.token}`, 'X-Context-Monitor-Instance': original.descriptor.instance } })).status;
    const historyAndSettingsUnchanged = before === JSON.stringify({ settings: f.history.settings(), events: f.history.list() });
    evidence.probes.failedPublication = { publicationError, existingDescriptorOverwritten: failedDescriptor.instance !== original.descriptor.instance, newlyPublishedListenerAlive, discoveryError, originalHealthy, historyAndSettingsUnchanged };
    assert.equal(newlyPublishedListenerAlive, false); assert.equal(historyAndSettingsUnchanged, true);
  }
  {
    const f = await fixture('stale-health-credentials');
    const b = await f.backend(await f.store('retained'), join(f.directory, 'backend.json'));
    const d = b.descriptor; await f.close(b);
    const captured = [];
    const listener = createServer((req, res) => {
      captured.push({ method: req.method, path: req.url, retiredBearerTransmitted: req.headers.authorization === `Bearer ${d.token}`, instanceTransmitted: req.headers['x-context-monitor-instance'] === d.instance });
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ instance: 'unrelated', directory: f.directory }));
    });
    await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(Number(new URL(d.url).port), '127.0.0.1', resolve); });
    let rejection;
    try { await f.bridge.request(f.directory, '/settings?session=retained', 'POST', { span: 7 }); }
    catch (error) { rejection = error.message; }
    finally { await new Promise(resolve => listener.close(resolve)); }
    assert.equal(captured.length, 1); assert.equal(captured[0].method, 'GET');
    evidence.probes.staleHealth = { captured, rejection, postForwarded: captured.some(request => request.method === 'POST') };
  }
} finally {
  for (const close of cases.reverse()) await close();
  writeFileSync(join(root, 'results.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
