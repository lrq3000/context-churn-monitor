import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { AlertHistory, alertSource } from '../src/storage/alerts.js';
import { Store } from '../src/storage/store.js';
import { Backend } from '../src/reports/backend.js';
import { authorized, body, respond } from '../src/reports/http.js';
import { serviceHostCallSchema } from '@openchamber/sdk/schemas';

test('authenticated global alert routes need no project, session or backend pairing', async () => {
  const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'alert-service-'));
  const history = await AlertHistory.open(join(root, 'alerts.sqlite'));
  const store = await Store.open(join(root, 'state.sqlite'), { warnings: false });
  store.ingest('current', [{ type: 'turn', id: 'u', turnId: 'actual-turn', at: 1 }]);
  store.ingest('marked', [
    { type: 'turn', id: 't', turnId: 't', at: 10 },
    { type: 'step', id: 's', stepId: 's', model: 'fixture', capacity: 64000, at: 11 },
    { type: 'compact', id: 'c1', checkpointId: 'c1', trigger: 'auto', beforeKnown: true, at: 12 },
    { type: 'compact', id: 'c2', checkpointId: 'c2', trigger: 'auto', beforeKnown: true, at: 13 },
  ]);
  history.registerSource(alertSource(store.path, root));
  const marks: any[] = [];
  const callback = createHttpServer(async (request, response) => {
    if (!authorized(request, 'fixture-only')) return respond(response, 401, { error: 'Authentication required' });
    const parsed = serviceHostCallSchema.safeParse(await body(request));
    if (request.url !== '/service/call' || !parsed.success || parsed.data.method !== 'marks.set') return respond(response, 400, { error: 'Invalid callback' });
    marks.push(parsed.data.input);
    respond(response, 200, { result: { saved: true } });
  });
  await new Promise<void>(resolve => callback.listen(0, '127.0.0.1', resolve));
  const backend = await Backend.start(store, { directory: root, descriptorPath: join(root, 'custom-data', 'backend.json'), registry: history.backends });
  const listener = createServer(); await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as any).port; await new Promise<void>(resolve => listener.close(() => resolve()));
  const entry = process.env.CONTEXT_MONITOR_SERVICE_ENTRY;
  const child = spawn(process.execPath, entry ? [entry] : ['--import', 'tsx', 'src/gui/service.ts'], { env: { ...process.env, OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: 'fixture-only', OPENCHAMBER_HOST_CALLBACK_URL: `http://127.0.0.1:${(callback.address() as any).port}`, CONTEXT_MONITOR_ALERTS_PATH: join(root, 'alerts.sqlite') }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let errors = ''; child.stderr.on('data', chunk => errors = (errors + chunk).slice(-10000));
  const origin = `http://127.0.0.1:${port}`, headers = { Authorization: 'Bearer fixture-only', 'Content-Type': 'application/json' };
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(origin + '/health')).status === 401) { ready = true; break; } } catch {} await delay(100); }
    assert.ok(ready, errors);
    for (let i = 0; i < 50 && !marks.length; i++) await delay(100);
    assert.deepEqual(marks[0], { target: { sessionId: 'marked' }, mark: { icon: 'pulse', tone: 'warning', text: 'Turn 1: compactions live 2 ≥ 2' } }, 'Startup restores the native mark with no open panel');
    assert.equal((await fetch(origin + '/notifications')).status, 401);
    const initial = await fetch(origin + '/notification-settings', { headers });
    assert.equal(initial.status, 200, await initial.clone().text());
    assert.equal((await initial.json() as any).minContextWindow, 32000);
    const changed = await fetch(origin + '/notification-settings', { method: 'POST', headers, body: JSON.stringify({ ...history.settings(), minContextWindow: 64000, liveGrowth: 95 }) });
    assert.equal(changed.status, 200);
    assert.equal(history.settings().minContextWindow, 64000);
    const response = await fetch(origin + '/notifications', { headers });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json() as any).items, []);
    assert.equal((await fetch(origin + '/notification-settings', { method: 'POST', headers, body: JSON.stringify({ minContextWindow: -1 }) })).status, 400);
    assert.equal(history.settings().minContextWindow, 64000);
    const snapshot = await fetch(origin + '/snapshot?' + new URLSearchParams({ directory: root, session: 'current' }), { headers });
    assert.equal(snapshot.status, 200, await snapshot.clone().text());
    assert.equal((await snapshot.json() as any).state.turn.id, 'actual-turn', 'The actual child service must use automatic registry discovery, not a fixture-only route');
    store.ingest('marked', [{ type: 'turn', id: 'new', turnId: 'new', at: 20 }]);
    for (let i = 0; i < 70 && marks.length < 2; i++) await delay(100);
    assert.deepEqual(marks[1], { target: { sessionId: 'marked' }, mark: null }, 'The persistent service clears the preceding turn on its next poll');
  } finally { child.kill(); child.stderr.destroy(); await backend.close(); await new Promise<void>(resolve => callback.close(() => resolve())); store.close(); history.close(); }
});
