import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { OpenChamberNotifications } from '../src/adapters/opencode/notifications.js';
import { body, respond } from '../src/reports/http.js';

/** Only the external host is replaced: notification formatting, authenticated HTTP and per-call routing stay real. */
async function fixture(run: (environment: NodeJS.ProcessEnv, notices: any[]) => Promise<void>) {
  const notices: any[] = [];
  const host = createServer(async (req, res) => {
    notices.push({ path: req.url, authorization: req.headers.authorization, ...await body(req) });
    respond(res, 200, { delivered: true });
  });
  await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve));
  try { await run({ OPENCHAMBER_AGENT_TOOL_URL: `http://127.0.0.1:${(host.address() as any).port}`, OPENCHAMBER_AGENT_TOOL_TOKEN: 'fixture-only' }, notices); }
  finally { await new Promise<void>(resolve => host.close(() => resolve())); }
}

test('notifications identify the thread and project and carry native click routing', async () => fixture(async (env, notices) => {
  const notifier = new OpenChamberNotifications('C:\\work\\project-one\\', async () => 'Investigate retries', env);
  await notifier.send('session-one', 'growth threshold reached: 82.00 (live).');
  assert.equal(notices.length, 1);
  const notice = notices[0];
  assert.equal(notice.sessionId, 'session-one');
  assert.equal(notice.directory, 'C:\\work\\project-one\\');
  assert.match(notice.title, /Investigate retries/);
  assert.match(notice.body, /project-one/);
  assert.match(notice.body, /growth threshold reached: 82.00/);
  assert.ok(!notice.body.includes('C:\\work'));
  assert.equal(notice.path, '/api/notifications/emit');
  assert.equal(notice.authorization, 'Bearer fixture-only');
}));

test('missing, blank and failed title lookups still emit a routable session-ID fallback', async () => fixture(async (env, notices) => {
  for (const resolve of [async () => undefined, async () => ' \n ', async () => { throw new Error('Unavailable'); }]) {
    await new OpenChamberNotifications('/projects/alpha/', resolve, env).send('session-fallback', 'compactions threshold reached: 2.00 (live).');
  }
  assert.equal(notices.length, 3);
  for (const notice of notices) {
    assert.equal(notice.sessionId, 'session-fallback');
    assert.equal(notice.directory, '/projects/alpha/');
    assert.match(notice.title + ' ' + notice.body, /session-fallback/);
    assert.match(notice.body, /alpha/);
  }
}));

test('long Unicode titles fit host limits without losing the threshold or routing', async () => fixture(async (env, notices) => {
  const notifier = new OpenChamberNotifications('/projects/' + '項'.repeat(150), async () => '😀'.repeat(200) + '\n\0secret-tail', env);
  await notifier.send('session-long', 'growth threshold reached: 91.00 (live).');
  const notice = notices[0];
  assert.ok(notice.title.length <= 120);
  assert.ok(notice.body.length <= 500);
  assert.ok(!/[\u0000\ud800-\udfff]/u.test(notice.title), 'No controls or lone surrogates');
  assert.match(notice.body, /growth threshold reached: 91.00/);
  assert.equal(notice.sessionId, 'session-long');
}));

test('out-of-order title lookups cannot route one session notification to another', async () => fixture(async (env, notices) => {
  let release!: (title: string) => void;
  const firstTitle = new Promise<string>(resolve => release = resolve);
  const notifier = new OpenChamberNotifications('/projects/alpha', session => session === 'session-a' ? firstTitle : Promise.resolve('Thread B'), env);
  const first = notifier.send('session-a', 'First alert');
  await notifier.send('session-b', 'Second alert');
  release('Thread A'); await first;
  assert.deepEqual(notices.map(notice => notice.sessionId), ['session-b', 'session-a']);
  assert.match(notices[0].title, /Thread B/); assert.match(notices[1].title, /Thread A/);
  assert.notEqual(notices[0].tag, notices[1].tag);
}));

test('without managed callback credentials no notification or title lookup occurs', async () => {
  let called = false;
  await new OpenChamberNotifications('/project', async () => { called = true; return 'Thread'; }, {}).send('session', 'Alert');
  assert.equal(called, false);
});

test('an uncancellable stalled title lookup falls back after the deadline and late resolution cannot notify twice', async () => fixture(async (env, notices) => {
  let release!: (title: string) => void;
  const pending = new Promise<string>(resolve => release = resolve);
  const notifier = new OpenChamberNotifications('/projects/alpha', () => pending, env);
  const send = notifier.send('session-stalled', 'Threshold alert');
  assert.equal(await Promise.race([send.then(() => 'sent'), delay(1800, 'stalled')]), 'sent', 'A resolver ignoring its abort signal must not block notification delivery');
  assert.equal(notices.length, 1);
  assert.match(notices[0].title + ' ' + notices[0].body, /session-stalled/);
  release('Late title'); await pending; await new Promise(resolve => setImmediate(resolve));
  assert.equal(notices.length, 1, 'Late title completion must not repeat the notification');
}));
