// Historical independent-review reproduction for cb04f97: asserts the FORMER defects, not a current passing suite. Maintained regressions live in tests/alert-history.test.ts and tests/ui/report.test.ts.
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';
const pkg = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = process.env.CONTEXT_MONITOR_TEST_TMP;
assert.ok(artifacts, 'Set CONTEXT_MONITOR_TEST_TMP to an approved existing artifact directory');
process.env.TEMP = artifacts;
process.env.TMP = artifacts;
const require = createRequire(join(pkg, 'package.json'));
const { Store } = await import(pathToFileURL(join(pkg, 'src/storage/store.ts')).href);
const { AlertHistory } = await import(pathToFileURL(join(pkg, 'src/storage/alerts.ts')).href);
const { Monitor } = await import(pathToFileURL(join(pkg, 'src/core/monitor.ts')).href);
const { AlertPipeline } = await import(pathToFileURL(join(pkg, 'src/alerts/pipeline.ts')).href);
const root = mkdtempSync(join(artifacts, 'independent-review-'));
const history = await AlertHistory.open(join(root, 'alerts.sqlite'));
const source = await Store.open(join(root, 'source.sqlite'), { minSamples: 1, liveGrowth: 1000 }, false, { directory: '/fixture', settings: () => ({ ...history.settings(), liveGrowth: 1000 }) });
const results = {};
let id = 0;
const ingest = value => source.ingest('s', [{ ...value, id: 'e-' + ++id, at: id }]);
try {
  ingest({ type: 'turn', turnId: 'first' });
  ingest({ type: 'step', stepId: 'request', model: 'large', capacity: 128000 });
  ingest({ type: 'observe', tokens: 0, capacity: 128000, model: 'large', method: 'fixture', quality: 'reported' });
  ingest({ type: 'observe', tokens: 64000, capacity: 128000, model: 'large', method: 'fixture', quality: 'reported' });
  assert.equal(source.snapshot('s').alerts.length, 0);
  ingest({ type: 'turn', turnId: 'second' });
  results.implicitCompletion = { snapshotAlerts: source.snapshot('s').alerts, pending: source.pendingAlerts() };
  assert.equal(results.implicitCompletion.snapshotAlerts.length, 1);
  assert.equal(results.implicitCompletion.pending.length, 0);
} finally { source.close(); history.close(); }

const mixed = new Monitor();
const accept = event => mixed.accept({ ...event, id: 'm-' + ++id, at: id });
accept({ type: 'turn', turnId: 'mixed' });
accept({ type: 'step', stepId: 'large', model: 'large', capacity: 128000 });
for (const tokens of [0, 120000]) accept({ type: 'observe', tokens, capacity: 128000, model: 'large', method: 'fixture', quality: 'reported' });
accept({ type: 'complete' });
accept({ type: 'step', stepId: 'small', model: 'small', capacity: 8000 });
accept({ type: 'complete' });
results.priorLiveSurvivesMixedContinuation = { alerts: mixed.state.alerts.length, eligibleSamples: mixed.state.alerting.ema.growthSamples, eligibleTurns: mixed.state.alerting.count };
assert.deepEqual(results.priorLiveSurvivesMixedContinuation, { alerts: 1, eligibleSamples: 0, eligibleTurns: 0 });

const concurrentHistory = await AlertHistory.open(join(root, 'concurrent-global.sqlite'));
const concurrentSource = await Store.open(join(root, 'concurrent-source.sqlite'), {}, false, { directory: '/fixture', settings: () => concurrentHistory.settings() });
try {
  const model = 'm'.repeat(2000);
  const events = [{ type: 'turn', turnId: 'both' }, { type: 'step', stepId: 'both-step', model, capacity: 128000 }, ...[0, 120000].map(tokens => ({ type: 'observe', tokens, capacity: 128000, model, method: 'fixture', quality: 'reported' })), ...[1, 2].map(i => ({ type: 'compact', checkpointId: 'c-' + i, trigger: 'auto', beforeKnown: true })), { type: 'complete' }];
  concurrentSource.ingest('s', events.map((event, i) => ({ ...event, id: 'both-' + i, at: 100 + i })));
  assert.equal(concurrentSource.pendingAlerts().length, 2);
  results.localModelBound = { sourceModelLength: concurrentSource.pendingAlerts()[0].model.length };
  const sent = [];
  const publisher = new AlertPipeline(concurrentHistory, concurrentSource, '/fixture', async event => {
    sent.push({ id: event.id, metric: event.metric, retainedWhenSent: concurrentHistory.list().some(item => item.id === event.id) });
    if (sent.length === 1) concurrentHistory.insert(Array.from({ length: 100 }, (_, i) => ({ id: 'newer-' + i, at: 1000 + i, sessionId: 'other', directory: '/other', metric: 'growth', value: 90, threshold: 80, kind: 'live', delivery: 'recorded' })));
    return { delivery: 'host-accepted' };
  });
  await publisher.publishPending();
  results.evictedWhileSending = { sent, finalHistoryCount: concurrentHistory.list().length };
  assert.equal(sent.length, 2);
  assert.equal(sent[1].retainedWhenSent, false);
  assert.equal(concurrentHistory.list().length, 100);
} finally { concurrentSource.close(); concurrentHistory.close(); }

const { build } = require('esbuild');
const { chromium } = require('playwright');
const bundle = await build({ stdin: { contents: "import { AlertsPanel } from './src/gui/alerts.ts'; window.AlertsPanel = AlertsPanel;", resolveDir: pkg, loader: 'ts' }, write: false, bundle: true, format: 'iife', target: 'es2022' });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.setContent('<div id="app"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(async () => {
    window.rows = [{ id: 'a', at: Date.now(), directory: '/project', sessionId: 'missing-session', title: 'Target', metric: 'growth', value: 90, threshold: 80, kind: 'live', delivery: 'recorded' }];
    window.settings = { liveGrowth: 80, liveCompactions: 2, growthThreshold: 40, compactionThreshold: .3, minContextWindow: 32000 };
    window.panel = new window.AlertsPanel(document.querySelector('#app'), { openSession: () => new Promise((resolve, reject) => { window.rejectNavigation = reject; window.resolveNavigation = resolve; }) }, async path => path === '/notification-settings' ? window.settings : { items: window.rows });
    await window.panel.refresh();
  });
  await page.getByLabel('Select Target', { exact: true }).check();
  await page.getByRole('button', { name: 'Go to the session', exact: true }).click();
  await page.evaluate(async () => { window.rows = []; await window.panel.refresh(true); window.rejectNavigation(new Error('Session was deleted')); await new Promise(resolve => queueMicrotask(resolve)); });
  results.navigationErrorAfterEviction = { error: await page.locator('#alerts-error').textContent(), goDisabled: await page.getByRole('button', { name: 'Go to the session', exact: true }).isDisabled() };
  assert.equal(results.navigationErrorAfterEviction.error, '');
  assert.equal(results.navigationErrorAfterEviction.goDisabled, true);
  results.browserErrors = browserErrors;
  assert.deepEqual(browserErrors, []);
} finally { await browser.close(); }
writeFileSync(join(artifacts, 'independent-review-probes.json'), JSON.stringify({ root, results }, null, 2));
console.log(JSON.stringify({ root, results }, null, 2));
