import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { AlertHistory } from '../src/storage/alerts.js';

test('authenticated global alert routes need no project, session or backend pairing', async () => {
  const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'alert-service-'));
  const history = await AlertHistory.open(join(root, 'alerts.sqlite'));
  const listener = createServer(); await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as any).port; await new Promise<void>(resolve => listener.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/gui/service.ts'], { env: { ...process.env, OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: 'fixture-only', CONTEXT_MONITOR_ALERTS_PATH: join(root, 'alerts.sqlite') }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let errors = ''; child.stderr.on('data', chunk => errors = (errors + chunk).slice(-10000));
  const origin = `http://127.0.0.1:${port}`, headers = { Authorization: 'Bearer fixture-only', 'Content-Type': 'application/json' };
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(origin + '/health')).status === 401) { ready = true; break; } } catch {} await delay(100); }
    assert.ok(ready, errors);
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
  } finally { child.kill(); child.stderr.destroy(); history.close(); }
});
