import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../../src/storage/store.js';
import { Backend } from '../../src/reports/backend.js';
import { body, respond } from '../../src/reports/http.js';
import { OPENCHAMBER_SDK_CHANNEL, OPENCHAMBER_SDK_API_VERSION } from '@openchamber/sdk';
import { parseGuestMessage } from '@openchamber/sdk/schemas';
import { assertRenderedBody } from '../review/body-check.mjs';
import { AlertHistory } from '../../src/storage/alerts.js';
import { GlobalAlertService } from '../../src/gui/alert-service.js';
import { Bridge } from '../../src/gui/bridge.js';

/** This fixture replaces only the external OpenChamber host; the SDK, browser DOM, backend and SQLite are real. */
test('replay filters, expands, preserves state and exports without invoking a model', { timeout: 60000 }, async t => {
  const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'ui-'));
  const history = await AlertHistory.open(join(root, 'alerts.sqlite'));
  const globals = new GlobalAlertService(history);
  history.insert([
    { id: 'global-one', at: Date.now() - 2000, directory: '/project-one', sessionId: 'session-one', title: '<script>window.injected=true</script>', metric: 'growth', value: 85, threshold: 80, kind: 'live', model: 'fixture/large', capacity: 128000, delivery: 'unconfirmed' },
    { id: 'global-other', at: Date.now() - 1000, directory: '/another-project', sessionId: 'session-other', title: 'Thread from another project', metric: 'compactions', value: 2, threshold: 2, kind: 'live', model: 'fixture/large', capacity: 64000, delivery: 'host-accepted' },
  ]);
  const store = await Store.open(join(root, 'state.sqlite'));
  const backend = await Backend.start(store, { directory: '/project', descriptorPath: join(root, 'backend.json'), registry: history.backends });
  const pairings = join(root, 'pairings.json'), bridge = new Bridge(pairings, history.backends);
  store.ingest('s', [{ type: 'observe', id: 'initial', at: 0, tokens: 0, capacity: 1000, model: 'test', method: 'test', quality: 'reported' }]);
  for (let i = 1; i <= 3; i++) store.ingest('s', [
    { type: 'turn', id: `u${i}`, at: i, turnId: `u${i}` },
    { type: 'step', id: `s${i}`, at: i, stepId: `s${i}`, model: 'test' },
    { type: 'observe', id: `o${i}`, at: i, tokens: i === 1 ? 30 : i === 2 ? 300 : 310, capacity: 1000, model: 'test', method: 'test', quality: 'reported' },
    { type: 'evidence', id: `e${i}`, at: i, evidence: { tool: 'read', label: `Read ${i}`, excerpt: '<script>throw new Error("injection")</script>' } },
    { type: 'complete', id: `c${i}`, at: i },
  ]);
  for (let i = 1; i <= 3; i++) {
    store.activities.update('s', { id: `activity${i}`, turnId: `u${i}`, turnNumber: i, messageId: `s${i}`, kind: 'tool', tool: 'read', label: 'Read file', title: `src/file${i}.ts`, status: i === 2 ? 'failed' : 'completed', at: i });
    store.activities.write('s', `activity${i}`, 'output', '<script>throw new Error("injection")</script>');
  }
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<html><head><title>Context Monitor QA</title></head><body style="margin:0"><iframe title="Report" src="/panel" style="border:0;width:100%;height:900px"></iframe><script>
      window.calls=[];window.opens=[];addEventListener('message',async e=>{
        const m=e.data;if(!m.channel)return;
        const answer=(type,payload)=>e.source.postMessage({channel:m.channel,v:m.v,type,id:m.id,ok:true,payload},'*');
        if(m.type==='hello'){
          answer('ready',{directory:'/project',session:{id:'s',title:'Fixture',busy:false},surface:'panel',connection:{connected:false,account:null},settings:{},item:null,theme:{mode:'light',tokens:{background:'#ffffff',foreground:'#1f2937',elevated:'#ffffff',elevatedForeground:'#1f2937',muted:'#64748b',mutedSurface:'#f1f5f9',subtle:'#f8fafc',border:'#dbe2ea',hover:'#e2e8f0',active:'#dbeafe',primary:'#2563eb',primaryForeground:'#ffffff',primaryText:'#1f2937',successText:'#15754a',warningText:'#925f13',errorText:'#b91c1c',infoText:'#245fae',font:'system-ui',mono:'monospace',radius:'6px'}}});return;
        }
        window.calls.push(m.type);
        if(m.type==='service-request'){
          const r=await fetch('/proxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(m)});
          answer('result',{status:r.status,body:await r.text()});
        }else if(m.type==='open-session'){
          window.opens.push(m.payload.sessionId);
          if(window.deferOpen){window.rejectOpen=()=>e.source.postMessage({channel:m.channel,v:m.v,type:'result',id:m.id,ok:false,code:'NOT_FOUND',error:'Session was deleted'},'*');return;}
          if(window.failOpen)e.source.postMessage({channel:m.channel,v:m.v,type:'result',id:m.id,ok:false,code:'NOT_GRANTED',error:'Session access permission is unavailable'},'*');
          else answer('result',{});
        }else if(m.type==='generate'){
          e.source.postMessage({channel:m.channel,v:m.v,type:'result',id:m.id,ok:false,code:'MODEL_FAILED',error:'Fixture provider disconnected'},'*');
        }else answer('result',{});
      });</script></body></html>`);
    } else if (req.url === '/panel') { res.setHeader('Content-Type', 'text/html'); res.end(readFileSync('openchamber/panel/index.html')); }
    else if (req.url === '/app.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(readFileSync('openchamber/panel/app.js')); }
    else if (req.url === '/proxy') {
      // Validate the real wire envelope: native OpenChamber accepts and returns text bodies, not already-decoded JSON objects.
      const message = parseGuestMessage(await body(req));
      if (message?.type !== 'service-request') return respond(res, 400, { error: 'Invalid SDK service request' });
      const input = message.payload; requests.push(input.path);
      try {
        const result = await globals.handle(new URL(input.path, 'http://fixture.invalid'), input.method, input.body ? JSON.parse(input.body) : undefined);
        if (result !== undefined) return respond(res, 200, result);
      } catch (error) { return respond(res, 400, { error: String(error) }); }
      const url = new URL(input.path, 'http://fixture.invalid');
      for (const [k, v] of Object.entries(input.query ?? {})) if (k !== 'directory') url.searchParams.set(k, String(v));
      try { respond(res, 200, await bridge.request(String(input.query?.directory ?? ''), url.pathname + url.search, input.method, input.body ? JSON.parse(input.body) : undefined)); }
      catch (error) { respond(res, 400, { error: String(error) }); }
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 1100 } });
    page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}/`);
    const frame = page.frameLocator('iframe');
    await frame.getByRole('heading', { name: 'Context Churn Monitor' }).waitFor({ timeout: 5000 });
    try { await frame.locator('details[data-activity]').first().waitFor(); }
    catch (error) { throw new Error(`${await frame.locator('#error').textContent()}\n${error}`); }
    assert.equal(await frame.locator('details[data-activity]').count(), 3);
    await t.test('an unpaired project renders actual metrics and activity through registered discovery', async () => {
      assert.match(await frame.locator('#metrics .metric').filter({ hasText: 'Current turn growth' }).innerText(), /1\.00 pp/);
      assert.equal(await frame.locator('#error').innerText(), '');
      assert.equal(existsSync(pairings), false);
      await frame.locator('#pairing > summary').click();
      assert.match(await frame.locator('#pairing .pair-note').innerText(), /automatically/i);
      await frame.locator('#pairing > summary').click();
    });
    await frame.getByLabel('Search activities').fill('file2');
    await page.waitForFunction(() => document.querySelector('iframe')!.contentDocument?.querySelectorAll('details[data-activity]').length === 1);
    assert.equal(await frame.locator('details[data-activity]').first().getAttribute('data-activity'), 'activity2');
    await frame.getByText('src/file2.ts', { exact: true }).click();
    await frame.locator('.activity-body').filter({ hasText: '<script>throw new Error' }).waitFor();
    assert.ok(await frame.locator('details[data-activity][open]').textContent());
    await frame.getByLabel('Search activities').fill('');
    await frame.getByLabel('Scope').selectOption('current');
    await page.waitForFunction(() => (document.querySelector('iframe')!.contentDocument?.querySelectorAll('details[data-activity]').length) === 1);
    await frame.getByRole('button', { name: 'Export JSON' }).click();
    await frame.locator('#notice').filter({ hasText: '.json' }).waitFor();
    await frame.getByText('src/file3.ts', { exact: true }).click();
    await frame.locator('details[data-activity][open] .activity-body').filter({ hasText: '<script>throw new Error' }).waitFor();
    const samples = [
      { kind: 'thinking', label: 'Thinking', title: 'Check whether the saved listener is stale', text: 'Compare the saved address with the live descriptor before reconnecting.' },
      { kind: 'skill', label: 'Load skill', title: 'systematic-debugging', text: 'Loaded the systematic debugging workflow.' },
      { kind: 'tool', label: 'Shell command', title: 'node --test tests/report.test.ts', text: 'Expected updated descriptor; received ECONNREFUSED.', status: 'failed' },
      { kind: 'tool', label: 'Patch', title: 'src/gui/bridge.ts · retain descriptor path', text: '− this.pairs[directory] = descriptor;\n+ this.pairs[key] = { ...descriptor, descriptorPath };' },
      { kind: 'compaction', label: 'Compacting context', title: 'Automatic · checkpoint applied', text: 'Retained summary of the reconnection work.' },
      { kind: 'text', label: 'Response', title: 'Reconnection repair verified', text: 'The repair follows backend port changes automatically.' },
    ];
    for (const [i, sample] of samples.entries()) {
      store.activities.update('s', { id: `sample${i}`, turnId: 'u3', turnNumber: 3, messageId: 's3', kind: sample.kind as any, label: sample.label, title: sample.title, status: sample.status === 'failed' ? 'failed' : 'completed', at: 1000 + i * 4000, ended: 3000 + i * 4000 });
      store.activities.write('s', `sample${i}`, 'output', sample.text);
    }
    await page.waitForFunction(() => document.querySelector('iframe')!.contentDocument?.querySelectorAll('details[data-activity]').length === 7);
    assert.equal(await frame.locator('[data-activity="activity3"]').getAttribute('open'), '', 'Polling must preserve the expanded activity');
    await frame.getByLabel('Activity type').selectOption('thinking');
    await page.waitForFunction(() => document.querySelector('iframe')!.contentDocument?.querySelectorAll('details[data-activity]').length === 1);
    assert.equal(await frame.locator('details[data-activity]').count(), 1);
    await frame.getByLabel('Activity type').selectOption('all');
    await frame.locator('[data-activity="sample5"]').waitFor();
    await frame.getByRole('button', { name: 'Expand all', exact: true }).click();
    await frame.locator('[data-activity="sample0"] .activity-body').filter({ hasText: 'Compare the saved address' }).waitFor();
    assert.equal(await frame.locator('details[data-activity][open]').count(), 7);
    await frame.getByRole('button', { name: 'Collapse all', exact: true }).click();
    await page.evaluate(() => { const iframe = document.querySelector('iframe')!; iframe.style.height = `${iframe.contentDocument!.body.scrollHeight + 30}px`; });
    await page.screenshot({ path: join(root, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { const iframe = document.querySelector('iframe')!; iframe.style.height = `${iframe.contentDocument!.body.scrollHeight + 30}px`; });
    await page.screenshot({ path: join(root, 'mobile.png'), fullPage: true });
    assert.equal(await frame.locator('body').evaluate(e => e.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(errors, []);
    console.log(`Replay UI screenshots: ${root}`);
    assert.ok(!requests.some(path => path.startsWith('/analysis/run')));
    assert.ok(!(await page.evaluate(() => (window as any).calls)).includes('generate'));
    assert.equal(await frame.getByLabel('Analysis model').inputValue(), 'small');
    assert.equal(await frame.getByLabel('I authorize one model request').count(), 0);
    await frame.getByRole('button', { name: 'Prepare analysis' }).click();
    await frame.locator('#analysis-preview').filter({ hasText: 'Frozen turns' }).waitFor();
    assert.ok(!(await page.evaluate(() => (window as any).calls)).includes('generate'), 'Preparing evidence must not call a model');
    assert.equal(await frame.getByRole('button', { name: 'Run analysis (1 model invocation)', exact: true }).isDisabled(), false);
    await frame.getByRole('button', { name: 'Run analysis (1 model invocation)', exact: true }).dblclick();
    try { await frame.locator('#analysis-result').filter({ hasText: 'uncertain' }).waitFor(); }
    catch (error) { throw new Error(JSON.stringify({ text: await frame.locator('#analysis-result').textContent(), calls: await page.evaluate(() => (window as any).calls), requests, errors }) + '\n' + error); }
    assert.equal((await page.evaluate(() => (window as any).calls)).filter((c: string) => c === 'generate').length, 1);
    assert.equal(await frame.getByRole('button', { name: 'Run analysis (1 model invocation)', exact: true }).isDisabled(), true, 'An uncertain result requires a new preview and consent');
    await frame.getByRole('button', { name: 'View steps' }).click();
    await page.waitForFunction(() => (window as any).calls.includes('open-surface'));
    await page.evaluate(({ channel, v }) => document.querySelector('iframe')!.contentWindow!.postMessage({ channel, v, type: 'session', payload: { session: null } }, '*'), { channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION });
    await frame.locator('#quality').filter({ hasText: 'Select a monitored conversation' }).waitFor();
    assert.equal(await frame.locator('details[data-activity]').count(), 0, 'Clearing the session must clear the preceding conversation evidence');

    await t.test('Refresh retains a working Load more handler for an expanded completed activity', async () => {
      store.activities.write('s', 'activity1', 'output', 'a'.repeat(20000));
      await page.reload();
      const row = frame.locator('[data-activity="activity1"]');
      await row.locator('> summary').click();
      await page.waitForFunction(() => document.querySelector('iframe')!.contentDocument?.querySelector('[data-activity="activity1"] pre')?.textContent?.length === 16000);
      await row.evaluate(element => (window as any).oldReplayRow = element);
      await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
      await page.waitForFunction(() => !(document.querySelector('iframe')!.contentWindow as any).oldReplayRow.isConnected);
      await row.getByRole('button', { name: /Load more/ }).click();
      await page.waitForFunction(() => document.querySelector('iframe')!.contentDocument?.querySelector('[data-activity="activity1"] pre')?.textContent?.length === 20000);
    });

    // The wire boundary is delayed to reproduce deterministic completion order; all view state and SDK handling remain real.
    const deferredExport = () => {
      let release!: (value: { status: number; body: string }) => void;
      let captured!: () => void;
      const started = new Promise<void>(resolve => captured = resolve);
      const result = new Promise<{ status: number; body: string }>(resolve => release = resolve);
      return { started, release, handler: async (route: any) => {
        const message = route.request().postDataJSON();
        if (message.payload?.path !== '/export') return route.continue();
        captured(); await route.fulfill({ ...(await result), contentType: 'application/json' });
      } };
    };
    const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    for (const status of [200, 500]) await t.test(`session changes discard old export ${status === 200 ? 'paths' : 'errors'}`, async () => {
      await page.reload(); await frame.locator('[data-activity="activity1"]').waitFor();
      const deferred = deferredExport();
      await page.route('**/proxy', deferred.handler);
      try {
        await frame.getByRole('button', { name: 'Export JSON' }).click(); await deferred.started;
        await page.evaluate(({ channel, v }) => document.querySelector('iframe')!.contentWindow!.postMessage({ channel, v, type: 'session', payload: { session: null } }, '*'), { channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION });
        await frame.locator('#quality').filter({ hasText: 'Select a monitored conversation' }).waitFor();
        const response = page.waitForResponse(r => r.url().endsWith('/proxy') && r.request().postDataJSON().payload?.path === '/export');
        deferred.release({ status, body: JSON.stringify(status === 200 ? { path: '/session-s.json' } : { error: 'Old session export failure' }) });
        await response; await settle();
        assert.equal(await frame.locator('#action-error').textContent(), '');
        assert.equal(await frame.locator('#notice').textContent(), '');
      } finally { await page.unroute('**/proxy', deferred.handler); }
    });
    await t.test('an older action success cannot erase a newer action error', async () => {
      await page.reload(); await frame.locator('[data-activity="activity1"]').waitFor();
      const deferred = deferredExport();
      const handler = async (route: any) => {
        const message = route.request().postDataJSON();
        if (message.payload?.path === '/export' && JSON.parse(message.payload.body).format === 'html') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'New export failed' }) });
        return deferred.handler(route);
      };
      await page.route('**/proxy', handler);
      try {
        await frame.getByRole('button', { name: 'Export JSON' }).click(); await deferred.started;
        await frame.getByRole('button', { name: 'Export HTML' }).click();
        await frame.locator('#action-error').filter({ hasText: 'New export failed' }).waitFor();
        const response = page.waitForResponse(r => r.url().endsWith('/proxy') && r.request().postDataJSON().payload?.path === '/export');
        deferred.release({ status: 200, body: JSON.stringify({ path: '/older.json' }) });
        await response; await settle();
        assert.equal(await frame.locator('#action-error').textContent(), 'New export failed');
        await frame.getByRole('button', { name: 'Refresh', exact: true }).click(); await settle();
        assert.equal(await frame.locator('#action-error').textContent(), 'New export failed', 'Refreshing does not acknowledge action failures');
      } finally { await page.unroute('**/proxy', handler); }
    });
    await t.test('installed QA rejects a loaded marker when the body request failed', async () => {
      await page.reload(); await frame.locator('[data-activity="activity1"]').waitFor();
      const handler = async (route: any) => {
        const request = route.request().postDataJSON().payload;
        if (request?.path === '/activity' && request.query?.channel) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Body unavailable' }) });
        return route.continue();
      };
      await page.route('**/proxy', handler);
      try {
        const row = frame.locator('[data-activity="activity1"]');
        await row.locator('> summary').click();
        await row.getByRole('button', { name: /Retry loading/ }).waitFor();
        await assert.rejects(assertRenderedBody(row, { status: 500, body: JSON.stringify({ error: 'Body unavailable' }) }), /body|retriev/i);
      } finally { await page.unroute('**/proxy', handler); }
    });
    await t.test('global controls and cross-project history remain usable without a session or pairing', async () => {
      await page.reload(); await frame.getByRole('heading', { name: 'Notification history — all projects', exact: true }).waitFor();
      await frame.locator('#alert-settings > summary').click();
      assert.equal(await frame.getByLabel('Minimum model context window (tokens)').inputValue(), '32000');
      await frame.getByLabel('Current-turn growth threshold (pp)').fill('95');
      await frame.getByLabel('Minimum model context window (tokens)').fill('64000');
      await frame.getByRole('button', { name: 'Save global alert settings', exact: true }).click();
      await frame.locator('#alerts-feedback').filter({ hasText: 'Saved' }).waitFor();
      assert.equal(history.settings().liveGrowth, 95); assert.equal(history.settings().minContextWindow, 64000);
      await page.evaluate(({ channel, v }) => { const target = document.querySelector('iframe')!.contentWindow!; target.postMessage({ channel, v, type: 'session', payload: { session: null } }, '*'); target.postMessage({ channel, v, type: 'directory', payload: { directory: null } }, '*'); }, { channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION });
      await frame.locator('#quality').filter({ hasText: 'Select a monitored conversation' }).waitFor();
      await frame.getByRole('button', { name: 'Refresh notifications', exact: true }).click();
      await frame.locator('[data-alert="global-other"]').waitFor();
      assert.equal(await frame.locator('[data-alert]').count(), 2);
      assert.ok((await frame.locator('[data-alert="global-one"]').textContent())?.includes('<script>window.injected=true</script>'));
      assert.equal(await frame.locator('#global-alerts script').count(), 0);
      assert.equal(await frame.getByRole('button', { name: 'Go to the session', exact: true }).isDisabled(), true);
    });
    await t.test('selecting a global row does not navigate until Go to the session and errors stay visible', async () => {
      await frame.getByLabel('Select Thread from another project', { exact: true }).check();
      assert.deepEqual(await page.evaluate(() => (window as any).opens), []);
      await frame.getByRole('button', { name: 'Refresh notifications', exact: true }).click();
      assert.equal(await frame.getByRole('button', { name: 'Go to the session', exact: true }).isEnabled(), true);
      await page.evaluate(() => (window as any).failOpen = true);
      await frame.getByRole('button', { name: 'Go to the session', exact: true }).click();
      await frame.locator('#alerts-error').filter({ hasText: 'permission' }).waitFor();
      await frame.getByRole('button', { name: 'Refresh notifications', exact: true }).click();
      assert.match(await frame.locator('#alerts-error').innerText(), /permission/);
      await page.evaluate(() => (window as any).failOpen = false);
      await frame.getByRole('button', { name: 'Go to the session', exact: true }).click();
      await page.waitForFunction(() => (window as any).opens.length === 2);
      assert.deepEqual(await page.evaluate(() => (window as any).opens), ['session-other', 'session-other']);
    });
    await t.test('a missing-session error survives eviction while navigation is pending', async () => {
      await page.evaluate(() => (window as any).deferOpen = true);
      await frame.getByRole('button', { name: 'Go to the session', exact: true }).click();
      await page.waitForFunction(() => typeof (window as any).rejectOpen === 'function');
      history.insert(Array.from({ length: 100 }, (_, i) => ({ id: `eviction-race-${i}`, at: Date.now() + i, directory: '/new-project', sessionId: `race-session-${i}`, metric: 'growth' as const, value: 90, threshold: 80, kind: 'live' as const, delivery: 'recorded' as const })));
      await frame.getByRole('button', { name: 'Refresh notifications', exact: true }).click();
      await frame.locator('[data-alert="eviction-race-99"]').waitFor();
      assert.equal(await frame.getByRole('button', { name: 'Go to the session', exact: true }).isDisabled(), true);
      await page.evaluate(() => { (window as any).rejectOpen(); (window as any).deferOpen = false; });
      await frame.locator('#alerts-error').filter({ hasText: 'Session was deleted' }).waitFor();
      assert.match(await frame.locator('#alerts-error').innerText(), /session-other/);
    });
    await t.test('evicting the selected notification clears navigation and keeps exactly 100 bounded rows', async () => {
      history.insert(Array.from({ length: 100 }, (_, i) => ({ id: `new-global-${i}`, at: Date.now() + i, directory: '/new-project', sessionId: `new-session-${i}`, title: `Recent thread ${i}`, metric: 'growth' as const, value: 90, threshold: 80, kind: 'live' as const, capacity: 128000, delivery: 'recorded' as const })));
      await frame.getByRole('button', { name: 'Refresh notifications', exact: true }).click();
      await frame.locator('[data-alert="new-global-99"]').waitFor();
      assert.equal(await frame.locator('[data-alert]').count(), 100);
      assert.equal(await frame.getByRole('button', { name: 'Go to the session', exact: true }).isDisabled(), true);
      await page.setViewportSize({ width: 720, height: 1100 });
      await page.evaluate(() => { const iframe = document.querySelector('iframe')!; iframe.style.height = `${iframe.contentDocument!.body.scrollHeight + 30}px`; });
      await page.screenshot({ path: join(root, 'alerts-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { const iframe = document.querySelector('iframe')!; iframe.style.height = `${iframe.contentDocument!.body.scrollHeight + 30}px`; });
      await page.screenshot({ path: join(root, 'alerts-mobile.png'), fullPage: true });
      assert.equal(await frame.locator('body').evaluate(element => element.scrollWidth <= window.innerWidth), true);
      assert.deepEqual(errors, []);
    });
    await t.test('global settings stay disabled until their first successful load', async () => {
      let release!: () => void;
      let handled!: () => void;
      const gate = new Promise<void>(resolve => release = resolve);
      const settled = new Promise<void>(resolve => handled = resolve);
      const handler = async (route: any) => {
        const request = route.request().postDataJSON().payload;
        if (request?.path === '/notification-settings' && request.method === 'GET') {
          try {
            await gate;
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(history.settings()) });
          } finally { handled(); }
          return;
        }
        return route.continue();
      };
      await page.route('**/proxy', handler);
      try {
        await page.reload();
        await frame.getByRole('heading', { name: 'Notification history — all projects', exact: true }).waitFor();
        await frame.locator('#alert-settings > summary').click();
        assert.equal(await frame.getByLabel('Minimum model context window (tokens)').isDisabled(), true, 'A pending initial read must not accept an edit that its response would overwrite');
        assert.equal(await frame.getByRole('button', { name: 'Save global alert settings', exact: true }).isDisabled(), true);
        release();
        await frame.locator('[data-alert-setting="minContextWindow"]:not([disabled])').waitFor();
        assert.equal(await frame.getByLabel('Minimum model context window (tokens)').inputValue(), '64000');
      } finally {
        // Settle the deferred handler before removing it, including on an assertion failure.
        release(); await settled; await page.unroute('**/proxy', handler);
      }
    });
  } finally { await browser.close(); await new Promise<void>(r => server.close(() => r())); await backend.close(); store.close(); history.close(); }
});
