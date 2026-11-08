import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/storage/store.js';
import { AlertHistory, alertSource, type ThresholdEvent } from '../src/storage/alerts.js';
import { AlertPipeline } from '../src/alerts/pipeline.js';
import { spawn } from 'node:child_process';

const settings = () => ({ liveGrowth: 80, liveCompactions: 2, growthThreshold: 40, compactionThreshold: 0.3, minContextWindow: 32000 });
function crossing(store: Store, session = 'session', turnId = 'turn', at = 1, model = 'fixture/large') {
  store.ingest(session, [
    { type: 'turn', id: `${turnId}-u`, at, turnId },
    { type: 'step', id: `${turnId}-s`, at: at + 1, stepId: `${turnId}-request`, model, capacity: 128000 },
    { type: 'observe', id: `${turnId}-a`, at: at + 2, tokens: 0, capacity: 128000, model, method: 'fixture', quality: 'reported' },
    { type: 'observe', id: `${turnId}-b`, at: at + 3, tokens: 120000, capacity: 128000, model, method: 'fixture', quality: 'reported' },
    { type: 'complete', id: `${turnId}-c`, at: at + 4 },
  ]);
}

test('a committed threshold crossing survives reopening before global history transfer', async () => {
  const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'alert-history-'));
  const path = join(root, 'source.sqlite');
  const source = await Store.open(path, {}, false, { directory: '/project', settings } as any);
  crossing(source); source.close();
  const reopened = await Store.open(path);
  try {
    const pending = (reopened as any).pendingAlerts?.() ?? [];
    assert.equal(pending.length, 1, 'The alert must be committed beside monitoring state, not only held by the notifier');
    assert.equal(pending[0].sessionId, 'session');
    assert.equal(pending[0].threshold, 80);
    assert.equal(pending[0].capacity, 128000);
  } finally { reopened.close(); }
});

const temporary = () => mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'alert-history-'));
const record = (at: number, directory = '/project'): ThresholdEvent => ({ id: `event-${at}`, at, directory, sessionId: `session-${at}`, metric: 'growth', value: 90, threshold: 80, kind: 'live', model: 'fixture/large', capacity: 128000, delivery: 'recorded' });

test('recovery deduplicates a crash after global commit but before source acknowledgement without sending', async () => {
  const root = temporary(), path = join(root, 'source.sqlite');
  const history = await AlertHistory.open(join(root, 'global.sqlite'));
  const source = await Store.open(path, {}, false, { directory: '/project', settings: () => history.settings() });
  let sends = 0;
  const pipeline = new AlertPipeline(history, source, '/project', async () => { sends++; return { delivery: 'host-accepted' }; });
  try {
    crossing(source);
    const pending = source.pendingAlerts();
    history.insert(pending); // Crash boundary: the local record is deliberately still unacknowledged.
    const recovered = await pipeline.reconcile();
    assert.equal(recovered.recovered, 1);
    assert.equal(history.list().length, 1);
    assert.equal(source.pendingAlerts().length, 0);
    assert.equal((await pipeline.reconcile()).recovered, 0);
    assert.equal(sends, 0, 'History repair never replays notification delivery');
  } finally { source.close(); history.close(); }
});

test('global settings propagate across handles and override old per-session alert numbers only', async () => {
  const root = temporary(), path = join(root, 'global.sqlite');
  const first = await AlertHistory.open(path), second = await AlertHistory.open(path);
  const source = await Store.open(join(root, 'source.sqlite'), {}, false, { directory: '/project', settings: () => second.settings() });
  try {
    source.setSettings('session', { liveGrowth: 1, span: 9, warnings: false });
    first.setSettings({ ...first.settings(), liveGrowth: 95, minContextWindow: 64000 });
    assert.equal(source.settings('session').liveGrowth, 95);
    assert.equal(source.settings('session').minContextWindow, 64000);
    assert.equal(source.settings('session').span, 9);
    assert.equal(source.settings('session').warnings, false);
    assert.throws(() => first.setSettings({ ...first.settings(), minContextWindow: -1 }));
    assert.throws(() => first.setSettings({ unexpected: true } as any));
    assert.equal(second.settings().liveGrowth, 95);
  } finally { source.close(); first.close(); second.close(); }
});

test('shared history is physically bounded and late enrichment cannot resurrect old events or downgrade accepted delivery', async () => {
  const root = temporary(), path = join(root, 'global.sqlite');
  const first = await AlertHistory.open(path), second = await AlertHistory.open(path);
  try {
    first.insert(Array.from({ length: 150 }, (_, i) => record(i, i % 2 ? '/second-project' : '/first-project')));
    assert.deepEqual(second.list(1000).map(event => event.at), Array.from({ length: 100 }, (_, i) => 149 - i));
    first.update('event-149', { delivery: 'host-accepted', title: 'x'.repeat(1000) });
    second.insert([record(149)]);
    assert.equal(first.list()[0].delivery, 'host-accepted');
    assert.equal(first.list()[0].title!.length, 200);
    second.update('event-0', { title: 'Late title', delivery: 'host-accepted' });
    assert.equal(first.list().length, 100);
    assert.ok(!first.list().some(event => event.id === 'event-0'));
    const sqlite = await import('node:sqlite');
    const db = new sqlite.DatabaseSync(path, { readOnly: true });
    try { assert.equal((db.prepare('SELECT count(*) AS n FROM threshold_events').get() as any).n, 100); } finally { db.close(); }
  } finally { first.close(); second.close(); }
});

test('independent process writers retain exactly the global latest 100 events', async () => {
  const root = temporary(), path = join(root, 'global.sqlite');
  const history = await AlertHistory.open(path);
  try {
    const module = new URL('../src/storage/alerts.ts', import.meta.url).href;
    await Promise.all([0, 1].map(worker => new Promise<void>((resolve, reject) => {
      const code = `import { AlertHistory } from ${JSON.stringify(module)}; const h=await AlertHistory.open(${JSON.stringify(path)}); for(let i=0;i<200;i++){const at=i*2+${worker};h.insert([{id:'event-'+at,at,sessionId:'s',directory:'/project-${worker}',metric:'growth',value:90,threshold:80,kind:'live',delivery:'recorded'}]);}h.close();`;
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      let error = ''; child.stderr.on('data', part => error = (error + part).slice(-10000));
      child.once('error', reject); child.once('exit', status => status === 0 ? resolve() : reject(new Error(error)));
    })));
    assert.deepEqual(history.list().map(event => event.at), Array.from({ length: 100 }, (_, i) => 399 - i));
  } finally { history.close(); }
});

test('source recovery queues are bounded and uncertain delivery is never retried', async () => {
  const root = temporary(), history = await AlertHistory.open(join(root, 'global.sqlite'));
  const source = await Store.open(join(root, 'source.sqlite'), { span: 1, minSamples: 1000, cooldownTurns: 1, rearmTurns: 1 }, false, { directory: '/project', settings: () => history.settings() });
  let sends = 0;
  const pipeline = new AlertPipeline(history, source, '/project', async () => { sends++; throw new Error('Response lost'); });
  try {
    crossing(source); await pipeline.publishPending();
    assert.equal(history.list()[0].delivery, 'unconfirmed');
    await pipeline.reconcile(); await pipeline.publishPending();
    assert.equal(sends, 1);
    for (let i = 1; i <= 105; i++) {
      // A known low eligible turn rearms the same existing metric; no synthetic history insertion bypasses production capture.
      source.ingest('session', [{ type: 'turn', id: `low-${i}`, at: i * 20, turnId: `low-${i}` }, { type: 'step', id: `low-s-${i}`, at: i * 20 + 1, stepId: `low-s-${i}`, capacity: 128000, model: 'fixture/large' }, { type: 'observe', id: `low-o-${i}`, at: i * 20 + 2, tokens: 120000, capacity: 128000, model: 'fixture/large', method: 'fixture', quality: 'reported' }, { type: 'complete', id: `low-c-${i}`, at: i * 20 + 3 }]);
      crossing(source, 'session', `high-${i}`, i * 20 + 4);
    }
    assert.equal(source.pendingAlerts(1000).length, 100);
    assert.equal((source.db.prepare('SELECT count(*) AS n FROM alert_outbox').get() as any).n, 100);
    const recovered = await pipeline.reconcile();
    assert.equal(recovered.recovered, 100); assert.equal(history.list().length, 100);
    assert.equal(sends, 1);
  } finally { source.close(); history.close(); }
});

test('unavailable registered stores produce an explicit bounded recovery limitation', async () => {
  const root = temporary(), history = await AlertHistory.open(join(root, 'global.sqlite'));
  try {
    for (let i = 0; i < 25; i++) history.registerSource(alertSource(join(root, `missing-${i}.sqlite`), `/project-${i}`));
    const result = await AlertPipeline.reconcile(history);
    assert.equal(result.recovered, 0); assert.equal(result.limitations.length, 20); assert.equal(result.omittedLimitations, 5);
  } finally { history.close(); }
});

test('a history refresh racing runtime publication cannot swallow a newly committed notification', async () => {
  const root = temporary(), history = await AlertHistory.open(join(root, 'global.sqlite'));
  const source = await Store.open(join(root, 'source.sqlite'), {}, false, { directory: '/project', settings: () => history.settings() });
  let sends = 0;
  const pipeline = new AlertPipeline(history, source, '/project', async () => { sends++; return { delivery: 'host-accepted' }; });
  try {
    crossing(source);
    await pipeline.reconcile(); // GUI history wins the transfer/ack race, but is not the notification sender.
    assert.equal(sends, 0);
    await pipeline.publishPending(); await pipeline.publishPending();
    assert.equal(sends, 1, 'History acknowledgement is not a delivery claim');
    assert.equal(history.list()[0].delivery, 'host-accepted');
  } finally { source.close(); history.close(); }
});

test('implicit completion durably captures an EMA crossing for restart recovery', async () => {
  const root = temporary(), path = join(root, 'source.sqlite');
  const history = await AlertHistory.open(join(root, 'global.sqlite'));
  const source = await Store.open(path, { minSamples: 1 }, false, { directory: '/project', settings: () => ({ ...history.settings(), liveGrowth: 1000 }) });
  new AlertPipeline(history, source, '/project');
  source.ingest('session', [
    { type: 'turn', id: 'first-u', at: 1, turnId: 'first' },
    { type: 'step', id: 'first-s', at: 2, stepId: 'first-s', model: 'large', capacity: 128000 },
    { type: 'observe', id: 'first-o1', at: 3, tokens: 0, capacity: 128000, model: 'large', method: 'fixture', quality: 'reported' },
    { type: 'observe', id: 'first-o2', at: 4, tokens: 64000, capacity: 128000, model: 'large', method: 'fixture', quality: 'reported' },
    { type: 'turn', id: 'second-u', at: 5, turnId: 'second' },
  ]);
  source.close();
  const reopened = await Store.open(path);
  try {
    const pending = reopened.pendingAlerts();
    assert.equal(pending.length, 1, 'Closing the prior turn and accepting the new one share a durable alert transaction');
    assert.equal(pending[0].kind, 'ema'); assert.equal(pending[0].value, 50); assert.equal(pending[0].threshold, 40);
    await AlertPipeline.reconcile(history);
    assert.equal(history.list()[0].id, pending[0].id);
    assert.equal(reopened.pendingAlerts().length, 0);
  } finally { reopened.close(); history.close(); }
});

test('publication rechecks retention after an earlier notification send yields', async () => {
  const root = temporary(), history = await AlertHistory.open(join(root, 'global.sqlite'));
  const source = await Store.open(join(root, 'source.sqlite'), {}, false, { directory: '/project', settings: () => history.settings() });
  crossing(source);
  source.ingest('session', [1, 2].map(i => ({ type: 'compact' as const, id: `checkpoint-${i}`, checkpointId: `checkpoint-${i}`, at: 10 + i, trigger: 'auto' as const, beforeKnown: true })));
  let sends = 0;
  const pipeline = new AlertPipeline(history, source, '/project', async () => {
    sends++;
    history.insert(Array.from({ length: 100 }, (_, i) => record(1000 + i)));
    return { delivery: 'host-accepted' };
  });
  try {
    assert.equal(source.pendingAlerts().length, 2);
    await pipeline.publishPending();
    assert.equal(sends, 1, 'The second event was evicted while the first send was awaiting completion');
    assert.equal(history.list().length, 100);
    assert.equal(source.unclaimedAlerts().length, 0);
  } finally { source.close(); history.close(); }
});

test('local recovery records bound model labels without changing navigation identity', async () => {
  const root = temporary(), source = await Store.open(join(root, 'source.sqlite'), {}, false, { directory: '/project', settings });
  try {
    crossing(source, 'session', 'long-model', 1, 'm'.repeat(2000));
    const event = source.pendingAlerts()[0];
    assert.equal(event.model?.length, 500);
    assert.equal(event.sessionId, 'session'); assert.equal(event.directory, '/project');
  } finally { source.close(); }
});
