// Explicitly approved native QA only: record one labelled synthetic crossing, then exercise the real host's session-navigation bridge. No generation, pairing, capability grants or notification sends.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const [mode, origin, session, directory, output, startSession] = process.argv.slice(2);
if (!['--record', '--verify'].includes(mode) || !origin || !session || !directory || !output) throw new Error('Usage: node tests/review/installed-alerts.mjs <--record|--verify> <host origin> <target session> <target directory> <artifact directory>');
const catalog = await (await fetch(new URL('/api/guests', origin))).json();
const installed = catalog.guests.find(guest => guest.id === 'context-churn-monitor');
assert.equal(installed?.version, '0.3.0'); assert.equal(installed.enabled, true);
const response = await fetch(new URL(`/api/session/${encodeURIComponent(session)}`, origin));
assert.equal(response.status, 200);
const record = await response.json(), info = record.data ?? record;
assert.equal(info.id, session); assert.equal(info.location.directory, directory);
mkdirSync(output, { recursive: true });
const artifact = join(output, 'installed-alert-history.json');

if (mode === '--record') {
  const root = join(homedir(), '.config/opencode/plugins/context-churn-monitor/dist');
  const load = path => import(pathToFileURL(join(root, path)).href);
  const { Store } = await load('storage/store.js');
  const { AlertHistory } = await load('storage/alerts.js');
  const { AlertPipeline } = await load('alerts/pipeline.js');
  const history = await AlertHistory.open();
  const source = await Store.open(join(output, 'native-qa-source.sqlite'), {}, false, { directory, settings: () => ({ ...history.settings(), liveGrowth: 80, minContextWindow: 32000 }) });
  try {
    const pipeline = new AlertPipeline(history, source, directory);
    const turnId = `TEST-${randomUUID()}`, at = Date.now();
    // Use the installed reducer and transactional outbox, not direct insertion into global history. The QA source stays separate from real conversation accounting.
    const events = [{ type: 'turn', turnId }, { type: 'step', stepId: turnId, model: 'fixture/native-history-test', capacity: 128000 }, { type: 'observe', tokens: 0, capacity: 128000, model: 'fixture/native-history-test', method: 'fixture', quality: 'reported' }, { type: 'observe', tokens: 115200, capacity: 128000, model: 'fixture/native-history-test', method: 'fixture', quality: 'reported' }, { type: 'complete' }];
    source.ingest(session, events.map((event, i) => ({ ...event, id: `${turnId}:${i}`, at: at + i })));
    const pending = source.pendingAlerts();
    assert.equal(pending.length, 1); assert.equal(pending[0].value, 90); assert.equal(pending[0].threshold, 80);
    const id = pending[0].id;
    const title = 'TEST: Native alert history (synthetic crossing)';
    source.updateAlert(id, { title });
    await pipeline.reconcile(); // Recovery must reach shared history without invoking any sender.
    const saved = history.list().find(item => item.id === id);
    assert.equal(saved?.title, title); assert.equal(saved.sessionId, session); assert.equal(source.pendingAlerts().length, 0);
    const evidence = { version: installed.version, id, title, session, directory, synthetic: true, notificationSent: false, navigationVerified: false };
    writeFileSync(artifact, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  } finally { source.close(); history.close(); }
} else {
  assert.ok(startSession && startSession !== session, '--verify requires a different existing start-session ID as its final argument');
  const evidence = JSON.parse(readFileSync(artifact, 'utf8'));
  assert.equal(evidence.session, session);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(() => {
      addEventListener('message', event => {
        const message = event.data;
        if (message?.type === 'ready' || message?.type === 'session') window.__monitorQaSession = message.payload?.session?.id;
        if (['open-session', 'result'].includes(message?.type)) {
          window.__monitorQaMessages = [...(window.__monitorQaMessages ?? []), { type: message.type, id: message.id, session: message.type === 'open-session' ? message.payload?.sessionId : undefined, ok: message.ok, code: message.code, error: message.error }].slice(-50);
        }
      });
    });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    // Start on another real session so leaving an already-correct selection unchanged cannot satisfy the check.
    await page.goto(new URL(`/?session=${encodeURIComponent(startSession)}`, origin).href);
    await page.locator('[data-context-surface="plugin:context-churn-monitor"]').click();
    const frame = page.frameLocator('iframe[title="Context Churn Monitor"]:visible').last();
    await frame.getByRole('heading', { name: 'Notification history — all projects', exact: true }).waitFor();
    await frame.locator(`[data-alert="${evidence.id}"]`).waitFor();
    assert.equal(await frame.locator('body').evaluate(() => window.__monitorQaSession), startSession);
    await frame.locator(`[data-alert="${evidence.id}"] input`).check();
    await page.screenshot({ path: join(output, 'installed-alert-history-before.png'), fullPage: true });
    await frame.getByRole('button', { name: 'Go to the session', exact: true }).click();
    // Native SPA navigation can replace guest iframes without reaching another document's load lifecycle. Verify the actual route, not that unrelated lifecycle.
    try {
      // The host unmounts guest frames while loading a large cross-project conversation; allow that native load to settle.
      await page.waitForFunction(target => new URL(location.href).searchParams.get('session') === target, session, { timeout: 120000 });
    } catch (error) {
      const diagnostic = { url: page.url(), error: String(error), parentMessages: await page.evaluate(() => window.__monitorQaMessages), frames: await Promise.all(page.frames().filter(child => child !== page.mainFrame()).map(child => child.evaluate(() => ({ session: window.__monitorQaSession, messages: window.__monitorQaMessages, navigationError: document.querySelector('#alerts-error')?.textContent })))) };
      writeFileSync(join(output, 'installed-navigation-failure.json'), JSON.stringify(diagnostic, null, 2));
      await page.screenshot({ path: join(output, 'installed-navigation-failure.png'), fullPage: true });
      console.log(JSON.stringify(diagnostic, null, 2));
      throw error;
    }
    // The source panel is destroyed during a cross-project switch. Check the replacement guest frames, not a .last() locator that can retarget a different loading frame.
    let sdkSessionVerified = false;
    for (let attempt = 0; attempt < 150 && !sdkSessionVerified; attempt++) {
      for (const child of page.frames().filter(child => child !== page.mainFrame())) {
        if (await child.evaluate(target => window.__monitorQaSession === target, session).catch(() => false)) { sdkSessionVerified = true; break; }
      }
      if (!sdkSessionVerified) await delay(200);
    }
    assert.equal(sdkSessionVerified, true, 'A replacement native guest must receive the target session from the SDK');
    const screenshot = join(output, 'installed-alert-history.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    Object.assign(evidence, { navigationVerified: true, sdkSessionVerified, startSession, finalUrl: page.url(), screenshot, errors });
    writeFileSync(artifact, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
    // Preserve successful navigation evidence even if the surrounding host has an independent page error. Such errors still fail console-health verification.
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}
