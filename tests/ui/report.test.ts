import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../../src/storage/store.js';
import { Backend } from '../../src/reports/backend.js';
import { body, respond } from '../../src/reports/http.js';
import { OPENCHAMBER_SDK_CHANNEL, OPENCHAMBER_SDK_API_VERSION } from '@openchamber/sdk';
import { parseGuestMessage } from '@openchamber/sdk/schemas';

/** This fixture replaces only the external OpenChamber host; the SDK, browser DOM, backend and SQLite are real. */
test('report filters, sorts, expands evidence and exports without invoking a model', { timeout: 30000 }, async () => {
  const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'ui-'));
  const store = await Store.open(join(root, 'state.sqlite'));
  const backend = await Backend.start(store, { directory: '/project', descriptorPath: join(root, 'backend.json') });
  store.ingest('s', [{ type: 'observe', id: 'initial', at: 0, tokens: 0, capacity: 1000, model: 'test', method: 'test', quality: 'reported' }]);
  for (let i = 1; i <= 3; i++) store.ingest('s', [
    { type: 'turn', id: `u${i}`, at: i, turnId: `u${i}` },
    { type: 'step', id: `s${i}`, at: i, stepId: `s${i}`, model: 'test' },
    { type: 'observe', id: `o${i}`, at: i, tokens: i === 1 ? 30 : i === 2 ? 300 : 310, capacity: 1000, model: 'test', method: 'test', quality: 'reported' },
    { type: 'evidence', id: `e${i}`, at: i, evidence: { tool: 'read', label: `Read ${i}`, excerpt: '<script>throw new Error("injection")</script>' } },
    { type: 'complete', id: `c${i}`, at: i },
  ]);
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<html><head><title>Context Monitor QA</title></head><body style="margin:0"><iframe title="Report" src="/panel" style="border:0;width:100%;height:900px"></iframe><script>
      window.calls=[];addEventListener('message',async e=>{
        const m=e.data;if(!m.channel)return;
        const answer=(type,payload)=>e.source.postMessage({channel:m.channel,v:m.v,type,id:m.id,ok:true,payload},'*');
        if(m.type==='hello'){
          answer('ready',{directory:'/project',session:{id:'s',title:'Fixture',busy:false},surface:'panel',connection:{connected:false,account:null},settings:{},item:null,theme:{mode:'light',tokens:{background:'#ffffff',foreground:'#1f2937',elevated:'#ffffff',elevatedForeground:'#1f2937',muted:'#64748b',mutedSurface:'#f1f5f9',subtle:'#f8fafc',border:'#dbe2ea',hover:'#e2e8f0',active:'#dbeafe',primary:'#2563eb',primaryForeground:'#ffffff',primaryText:'#1f2937',successText:'#15754a',warningText:'#925f13',errorText:'#b91c1c',infoText:'#245fae',font:'system-ui',mono:'monospace',radius:'6px'}}});return;
        }
        window.calls.push(m.type);
        if(m.type==='service-request'){
          const r=await fetch('/proxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(m)});
          answer('result',{status:r.status,body:await r.text()});
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
      const url = new URL(input.path, backend.descriptor.url);
      for (const [k, v] of Object.entries(input.query ?? {})) if (k !== 'directory') url.searchParams.set(k, String(v));
      const r = await fetch(url, { method: input.method, headers: { Authorization: `Bearer ${backend.descriptor.token}`, 'X-Context-Monitor-Instance': backend.descriptor.instance }, body: input.body });
      respond(res, r.status, await r.json());
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}/`);
    const frame = page.frameLocator('iframe');
    await frame.getByRole('heading', { name: 'Context Churn Monitor' }).waitFor({ timeout: 5000 });
    try { await frame.locator('tr[data-step]').first().waitFor(); }
    catch (error) { throw new Error(`${await frame.locator('#error').textContent()}\n${error}`); }
    assert.equal(await frame.locator('tr[data-step]').count(), 3);
    await frame.getByLabel('Sort steps').selectOption('growth');
    await page.waitForFunction(() => document.querySelector('iframe')!.contentDocument?.querySelector('tr[data-step]')?.getAttribute('data-step') === 's2');
    assert.equal(await frame.locator('tr[data-step]').first().getAttribute('data-step'), 's2');
    await frame.getByText('Read 2', { exact: true }).click();
    assert.ok(await frame.locator('details[open]').textContent());
    await frame.getByLabel('Scope').selectOption('current');
    await page.waitForFunction(() => (document.querySelector('iframe')!.contentDocument?.querySelectorAll('tr[data-step]').length) === 1);
    await frame.getByRole('button', { name: 'Export JSON' }).click();
    await frame.locator('#notice').filter({ hasText: '.json' }).waitFor();
    await page.screenshot({ path: join(root, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(root, 'mobile.png'), fullPage: true });
    assert.equal(await frame.locator('body').evaluate(e => e.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(errors, []);
    assert.ok(!requests.some(path => path.startsWith('/analysis/run')));
    assert.ok(!(await page.evaluate(() => (window as any).calls)).includes('generate'));
    await frame.getByLabel('Analysis model').selectOption('small');
    await frame.getByRole('button', { name: 'Prepare analysis' }).click();
    await frame.locator('#analysis-preview').filter({ hasText: 'Frozen turns' }).waitFor();
    assert.ok(!(await page.evaluate(() => (window as any).calls)).includes('generate'), 'Preparing evidence must not call a model');
    assert.equal(await frame.getByRole('button', { name: 'Run analysis' }).isDisabled(), true);
    await frame.getByLabel('I authorize one model request').check();
    await frame.getByRole('button', { name: 'Run analysis' }).click();
    try { await frame.locator('#analysis-result').filter({ hasText: 'uncertain' }).waitFor(); }
    catch (error) { throw new Error(JSON.stringify({ text: await frame.locator('#analysis-result').textContent(), calls: await page.evaluate(() => (window as any).calls), requests, errors }) + '\n' + error); }
    assert.equal((await page.evaluate(() => (window as any).calls)).filter((c: string) => c === 'generate').length, 1);
    assert.equal(await frame.getByRole('button', { name: 'Run analysis' }).isDisabled(), true, 'An uncertain result requires a new preview and consent');
    await frame.getByRole('button', { name: 'View steps' }).click();
    await page.waitForFunction(() => (window as any).calls.includes('open-surface'));
    await page.evaluate(({ channel, v }) => document.querySelector('iframe')!.contentWindow!.postMessage({ channel, v, type: 'session', payload: { session: null } }, '*'), { channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION });
    await frame.locator('#quality').filter({ hasText: 'Select a monitored conversation' }).waitFor();
    assert.equal(await frame.locator('tr[data-step]').count(), 0, 'Clearing the session must clear the preceding conversation evidence');
  } finally { await browser.close(); await new Promise<void>(r => server.close(() => r())); await backend.close(); store.close(); }
});
