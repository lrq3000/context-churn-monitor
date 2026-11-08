// Approved installed automatic-connection QA. Read-only: no pairing, settings changes, message sends, notification or model invocation.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const [origin, session, output] = process.argv.slice(2);
if (!origin || !session || !output) throw new Error('Usage: node tests/review/installed-connection.mjs <OpenChamber origin> <session ID> <artifact directory>');
const catalog = await (await fetch(new URL('/api/guests', origin))).json();
const installed = catalog.guests.find(guest => guest.id === 'context-churn-monitor');
assert.equal(installed?.version, '0.3.1'); assert.equal(installed.enabled, true);
const response = await fetch(new URL(`/api/session/${encodeURIComponent(session)}`, origin));
assert.equal(response.status, 200);
const record = await response.json(), info = record.data ?? record, directory = info.location.directory;
assert.equal(info.id, session);
const pairingPath = join(homedir(), '.local/share/context-churn-monitor/gui-pairings.json');
const pairingBefore = readFileSync(pairingPath), key = value => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
assert.ok(!Object.keys(JSON.parse(pairingBefore)).some(path => key(path) === key(directory)), 'The target must really be unpaired; do not pair it to make this test pass');
mkdirSync(output, { recursive: true });

async function reportFrame(page) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    for (const frame of page.frames().filter(frame => frame !== page.mainFrame())) {
      if (await frame.locator('#report').isVisible().catch(() => false)) return frame;
    }
    await delay(200);
  }
  throw new Error('Native report panel did not mount');
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => addEventListener('message', event => {
    const message = event.data;
    if (message?.type === 'ready' || message?.type === 'session') window.__monitorQaSession = message.payload?.session?.id;
  }));
  const matching = path => result => {
    if (!result.url().endsWith('/api/guests/context-churn-monitor/service/request')) return false;
    const request = result.request().postDataJSON();
    return request.path === path && request.query?.session === session && typeof request.query?.directory === 'string' && key(request.query.directory) === key(directory);
  };
  const snapshotResponse = page.waitForResponse(matching('/snapshot'), { timeout: 120000 });
  const activityResponse = page.waitForResponse(matching('/activities'), { timeout: 120000 });
  // Attach rejection handlers immediately while native startup is pending, then await the original promises below.
  snapshotResponse.catch(() => {}); activityResponse.catch(() => {});
  await page.goto(new URL(`/?session=${encodeURIComponent(session)}`, origin).href, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-context-surface="plugin:context-churn-monitor"]').click({ timeout: 60000 });
  const frame = await reportFrame(page);
  const unwrap = async result => {
    assert.equal(result.status(), 200);
    const wire = await result.json(); assert.equal(wire.status, 200, 'The real GUI service must successfully reach the project backend');
    return JSON.parse(wire.body);
  };
  const snapshot = await unwrap(await snapshotResponse), activities = await unwrap(await activityResponse);
  assert.ok(snapshot.state?.turn, 'Native metrics require a genuinely captured turn, not merely a static panel');
  assert.ok(activities.items.length > 0, 'The backend must supply captured activity');
  await frame.locator('details[data-activity]').first().waitFor();
  assert.equal(await frame.locator('#error').innerText(), '');
  assert.equal(await frame.locator('body').evaluate(() => window.__monitorQaSession), session);
  const metricValues = await frame.locator('#metrics strong').allTextContents();
  assert.ok(metricValues.some(value => value !== '—'), 'The report must render real metric values');
  assert.deepEqual(readFileSync(pairingPath), pairingBefore);
  const screenshot = join(output, 'installed-automatic-connection.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  const evidence = { version: installed.version, session, directory, manuallyPaired: false, pairingSha256: createHash('sha256').update(pairingBefore).digest('hex'), turn: snapshot.state.turn.number, steps: snapshot.state.turn.steps, activityCount: activities.items.length, renderedActivities: await frame.locator('details[data-activity]').count(), metricValues, screenshot, pageErrors };
  writeFileSync(join(output, 'installed-automatic-connection.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  // Preserve/report host errors independently; the connection assertions above, not unrelated host workers, define this QA target.
} finally { await browser.close(); }
