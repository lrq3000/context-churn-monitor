// Run against an already-approved installed host, never a fixture. This performs no generation or pairing; it preserves a screenshot and reports a pairing blocker if the selected project is not connected.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { assertRenderedBody } from './body-check.mjs';

const [origin, session, output] = process.argv.slice(2);
if (!origin || !session || !output) throw new Error('Usage: node tests/review/installed-replay.mjs <OpenChamber origin> <session ID> <artifact directory>');
const catalog = await (await fetch(new URL('/api/guests', origin))).json();
const installed = catalog.guests.find(guest => guest.id === 'context-churn-monitor');
assert.equal(installed?.version, '0.2.0', 'The actual host must discover the refreshed package');
assert.equal(installed.enabled, true);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => {
    addEventListener('message', event => {
      const message = event.data;
      if (message?.type === 'ready' || message?.type === 'session') window.__monitorQaSession = message.payload?.session?.id;
    });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL(`/?session=${encodeURIComponent(session)}`, origin).href);
  await page.locator('[data-context-surface="plugin:context-churn-monitor"]').click();
  const frame = page.frameLocator('iframe[title="Context Churn Monitor"]:visible').last();
  await frame.getByRole('heading', { name: 'Activity replay', exact: true }).waitFor();
  assert.equal(await frame.locator('body').evaluate(() => window.__monitorQaSession), session, 'Native frame must receive the requested session identity');
  assert.equal(await frame.getByLabel('Analysis model').inputValue(), 'small');
  assert.equal(await frame.locator('#analysis-consent').count(), 0);
  assert.ok(await frame.getByRole('button', { name: 'Run analysis (1 model invocation)', exact: true }).isDisabled());
  // Wait for either the live data or an actionable connection error, rather than mistaking the static shell for a working integration.
  await frame.locator('#rows:not(:empty), #error:not(:empty)').first().waitFor();
  const connectionError = await frame.locator('#error').innerText();
  const count = await frame.locator('details[data-activity]').count();
  if (count) {
    const row = frame.locator('details[data-activity]').first();
    const id = await row.getAttribute('data-activity');
    const response = page.waitForResponse(result => {
      if (!result.url().endsWith('/api/guests/context-churn-monitor/service/request')) return false;
      const request = result.request().postDataJSON();
      return request.path === '/activity' && request.query?.session === session && request.query?.id === id && request.query?.channel;
    });
    await row.locator('> summary').click();
    const result = await response;
    assert.equal(result.status(), 200, 'Native service bridge request must succeed');
    await assertRenderedBody(row, await result.json());
  }
  await page.screenshot({ path: join(output, 'installed-replay.png'), fullPage: true });
  console.log(JSON.stringify({ version: installed.version, title: await page.title(), activities: count, connectionError, errors, screenshot: join(output, 'installed-replay.png') }, null, 2));
  assert.equal(connectionError, '', 'Installed host requires a valid pairing for this project');
  assert.ok(count > 0, 'Live replay should contain newly captured activity');
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
