// Explicit one-notification installed QA. Requires prior approval; never invokes a model or edits host settings.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [flag, origin, session, directory, output] = process.argv.slice(2);
if (flag !== '--send' || !origin || !session || !directory || !output) throw new Error('Usage: node tests/review/notification-native.mjs --send <host origin> <session> <directory> <artifact directory>');
const callback = process.env.OPENCHAMBER_AGENT_TOOL_URL, token = process.env.OPENCHAMBER_AGENT_TOOL_TOKEN;
assert.ok(callback && token, 'Managed callback credentials are required; never provide them in command arguments');
const recordResponse = await fetch(new URL(`/api/session/${encodeURIComponent(session)}`, origin));
assert.equal(recordResponse.status, 200);
const record = await recordResponse.json();
const info = record.data ?? record;
assert.equal(info.id, session);
assert.equal(info.location.directory, directory);
const installed = join(homedir(), '.config/opencode/plugins/context-churn-monitor/dist/adapters/opencode/notifications.js');
const { OpenChamberNotifications } = await import(pathToFileURL(installed).href);
let result, count = 0;
// Capture the actual installed emitter's payload and forward ONCE. The focused-show flag is test-only, so the reader can see this approved diagnostic without changing preferences.
const proxy = createServer(async (request, response) => {
  try {
    assert.equal(++count, 1);
    assert.equal(request.url, '/api/notifications/emit');
    assert.equal(request.headers.authorization, 'Bearer local-qa');
    let text = ''; for await (const part of request) text += part;
    const payload = JSON.parse(text);
    assert.equal(payload.sessionId, session);
    assert.equal(payload.directory, directory);
    const forwarded = await fetch(new URL('/api/notifications/emit', callback), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, showWhenFocused: true }), signal: AbortSignal.timeout(3000) });
    result = { status: forwarded.status, response: await forwarded.json(), payload };
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{}');
  } catch (error) {
    result = { error: String(error) };
    response.writeHead(500); response.end('{}');
  }
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
try {
  const notifier = new OpenChamberNotifications(directory, async () => info.title, { OPENCHAMBER_AGENT_TOOL_URL: `http://127.0.0.1:${proxy.address().port}`, OPENCHAMBER_AGENT_TOOL_TOKEN: 'local-qa' });
  await notifier.send(session, 'TEST: Notification routing check. Click to open this Context Churn Monitor thread; no threshold was crossed for this test.');
  assert.equal(count, 1);
  assert.equal(result?.status, 200, JSON.stringify(result));
  assert.equal(result.response.delivered, true);
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'notification-native.json'), JSON.stringify({ ...result, clickVerified: false }, null, 2));
  console.log(JSON.stringify({ status: result.status, title: result.payload.title, body: result.payload.body, targetSession: session, artifact: join(output, 'notification-native.json'), clickVerified: false }, null, 2));
} finally { await new Promise(resolve => proxy.close(resolve)); }
