import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/storage/store.js';
import { OpenCodeAdapter } from '../src/adapters/opencode/adapter.js';
import { CodexAdapter } from '../src/adapters/codex/adapter.js';

/** Real event reduction and SQLite: dropping a subscription, terminal guard or message association must break these assertions. */
async function fixture() {
  const store = await Store.open(':memory:');
  const adapter = new OpenCodeAdapter(store);
  let clock = 0;
  const send = (type: string, data: any = {}, id?: string) => adapter.event({ type: `session.${type}`, id: id ?? `e${++clock}`, created: ++clock, data: { sessionID: 's', ...data } }, 10000);
  send('inbox.enqueued', { inboxID: 'u', item: { type: 'user', payload: { text: 'Inspect the bridge' }, delivery: 'steer' } });
  send('inbox.delivered', { inboxID: 'u' });
  send('step.started', { assistantMessageID: 'm', model: { providerID: 'test', id: 'model' } });
  const activities = () => (store as any).activities?.list('s').items ?? [];
  return { store, send, activities };
}

test('replay keeps first activity order, canonical text and full tool input/output without counting activities as requests', async () => {
  const { store, send, activities } = await fixture();
  try {
    send('reasoning.started', { assistantMessageID: 'm', ordinal: 0 });
    send('reasoning.delta', { assistantMessageID: 'm', ordinal: 0, delta: 'Check ' });
    send('reasoning.ended', { assistantMessageID: 'm', ordinal: 0, text: 'Check the descriptor' }, 'reason-end');
    send('reasoning.ended', { assistantMessageID: 'm', ordinal: 0, text: 'Check the descriptor' }, 'reason-end');
    send('tool.input.started', { assistantMessageID: 'm', id: 'call_abc', name: 'shell' });
    send('tool.input.ended', { assistantMessageID: 'm', id: 'call_abc', text: '{"command":"npm test"}' });
    send('tool.called', { assistantMessageID: 'm', id: 'call_abc', input: { command: 'npm test' }, executed: true });
    const text = '✅ output '.repeat(500);
    send('tool.success', { assistantMessageID: 'm', id: 'call_abc', content: [{ type: 'text', text }], executed: true });
    send('reasoning.delta', { assistantMessageID: 'm', ordinal: 0, delta: 'late fragment' });
    const rows = activities();
    assert.deepEqual(rows.map((a: any) => a.kind), ['user', 'thinking', 'tool']);
    assert.equal(rows[0].title, 'Inspect the bridge');
    assert.equal(rows[1].title, 'Check the descriptor');
    assert.equal(rows[2].title, 'npm test');
    assert.equal(rows[2].label, 'Shell command');
    assert.equal(rows[2].status, 'completed');
    assert.equal(store.snapshot('s')!.turn!.steps, 1);
    assert.equal(store.activities.detail('s', rows[1].id, 'output').text, 'Check the descriptor');
    let all = '', offset = 0;
    for (;;) {
      const body = store.activities.detail('s', rows[2].id, 'output', offset, 101);
      all += body.text;
      if (body.next === null) break;
      offset = body.next;
    }
    assert.equal(all, text);
    assert.equal(store.activities.detail('s', rows[2].id, 'input').text, '{"command":"npm test"}');
    assert.throws(() => store.activities.detail('other', rows[2].id, 'output'));
  } finally { store.close(); }
});

test('direct shell timeout is a failure and stores the exposed output text with its truncation evidence', async () => {
  const { store, send, activities } = await fixture();
  try {
    const shell = { id: 'sh_one', command: 'sleep 20', status: 'running', cwd: '/project', shell: 'sh', file: '/output', metadata: {}, time: { started: 1 } };
    send('shell.started', { shell });
    send('shell.ended', { shell: { ...shell, status: 'timeout' }, output: { output: 'Partial shell text', cursor: 18, size: 50, truncated: true } });
    const row = activities().find((a: any) => a.kind === 'shell');
    assert.equal(row.status, 'failed');
    assert.equal(store.activities.detail('s', row.id, 'output').text, 'Partial shell text');
    assert.match(row.detail, /truncated/i);
  } finally { store.close(); }
});

test('Codex tool evidence joins the shared replay without losing long text or changing request counts', async () => {
  const store = await Store.open(':memory:');
  try {
    const adapter = new CodexAdapter(store, {});
    adapter.event({ session_id: 's', turn_id: 'u', hook_event_name: 'PreModelRequest', model: 'test' }, 'request');
    adapter.event({ session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'shell', tool_input: { command: 'npm test' }, tool_response: 'result'.repeat(1000) }, 'result');
    const rows = store.activities.list('s').items;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'npm test');
    assert.equal(store.activities.detail('s', rows[0].id, 'output').text.length, 6000);
    assert.equal(store.snapshot('s')!.turn!.steps, 1);
  } finally { store.close(); }
});

test('reconstructing the adapter marks unfinished captured activity incomplete without discarding its text', async () => {
  const { store, send, activities } = await fixture();
  try {
    send('reasoning.started', { assistantMessageID: 'm', ordinal: 0 });
    send('reasoning.delta', { assistantMessageID: 'm', ordinal: 0, delta: 'Captured before restart' });
    new OpenCodeAdapter(store);
    const row = activities().find((a: any) => a.kind === 'thinking');
    assert.equal(row.status, 'interrupted');
    assert.match(row.detail, /restart|restarted/i);
    assert.equal(store.activities.detail('s', row.id, 'output').text, 'Captured before restart');
  } finally { store.close(); }
});

test('late stream fragments cannot revive interruptions or overwrite a completed shell', async () => {
  const { store, send, activities } = await fixture();
  try {
    send('text.delta', { assistantMessageID: 'm', ordinal: 0, delta: 'Partial' });
    send('execution.interrupted', { reason: 'user' });
    send('text.delta', { assistantMessageID: 'm', ordinal: 0, delta: ' late' });
    const text = activities().find((a: any) => a.kind === 'text');
    assert.equal(text.status, 'interrupted');
    assert.equal(store.activities.detail('s', text.id, 'output').text, 'Partial');
    send('text.ended', { assistantMessageID: 'm', ordinal: 0, text: 'Canonical' });
    assert.equal(store.activities.get('s', text.id)!.status, 'completed');
    const shell = { id: 'sh_done', command: 'exit 1', status: 'exited', exit: 1 };
    send('shell.ended', { shell, output: { output: 'Failed' } });
    send('shell.started', { shell: { ...shell, status: 'running' } });
    assert.equal(activities().find((a: any) => a.kind === 'shell').status, 'failed');
  } finally { store.close(); }
});

test('body paging retains embedded NUL and Unicode across bounded canonical chunks', async () => {
  const { store, activities } = await fixture();
  try {
    const id = activities()[0].id;
    const text = 'A😀é\0尾Z'.repeat(20000);
    store.activities.write('s', id, 'output', text);
    let result = '', offset = 0;
    for (;;) {
      const page = store.activities.detail('s', id, 'output', offset, 1001);
      result += page.text;
      if (page.next === null) break;
      offset = page.next;
    }
    assert.equal(result, text);
    // Bound the data decoded for a far-end page, not a timing-sensitive benchmark.
    assert.ok(store.db.prepare('SELECT max(size) AS size FROM activity_chunks').get().size <= 16000);
  } finally { store.close(); }
});

test('progress text and attachment descriptors survive canonical tool completion', async () => {
  const { store, send, activities } = await fixture();
  try {
    send('inbox.enqueued', { inboxID: 'files', item: { type: 'user', payload: { text: 'Read attachment', files: [{ mime: 'image/png', name: 'screen.png', source: { type: 'inline' }, data: 'AAAA' }] } } });
    send('inbox.delivered', { inboxID: 'files' });
    const user = activities().find((a: any) => a.id === 'input:files');
    const metadata = store.activities.detail('s', user.id, 'metadata').text;
    assert.match(metadata, /image\/png/); assert.match(metadata, /screen.png/); assert.ok(!metadata.includes('AAAA'));
    send('tool.input.started', { assistantMessageID: 'm', id: 'progress', name: 'shell' });
    send('tool.progress', { assistantMessageID: 'm', id: 'progress', metadata: { output: 'First progress text' } });
    send('tool.success', { assistantMessageID: 'm', id: 'progress', content: [{ type: 'image', mime: 'image/png', data: 'AAAA' }, { type: 'text', text: 'Final text' }], executed: true });
    const row = activities().find((a: any) => a.callId === 'progress');
    assert.equal(store.activities.detail('s', row.id, 'progress').text, 'First progress text');
    assert.equal(store.activities.detail('s', row.id, 'output').text, 'Final text');
    assert.match(store.activities.detail('s', row.id, 'metadata').text, /image\/png/);
  } finally { store.close(); }
});

test('late tool results stay with the originating request and replay search reaches beyond the first page', async () => {
  const { store, send, activities } = await fixture();
  try {
    for (let i = 0; i < 45; i++) send('tool.input.started', { assistantMessageID: 'm', id: `call_${i}`, name: 'read' });
    send('inbox.enqueued', { inboxID: 'u2', item: { type: 'user', text: 'Next turn' } });
    send('inbox.delivered', { inboxID: 'u2' });
    send('step.started', { assistantMessageID: 'm2', model: { providerID: 'test', id: 'model' } });
    send('tool.called', { assistantMessageID: 'm', id: 'call_44', input: { path: 'needle-file.ts' }, executed: true });
    send('tool.failed', { assistantMessageID: 'm', id: 'call_44', error: { message: 'File missing' }, executed: true });
    assert.equal(activities().length, 47);
    const hits = store.activities.list('s', { q: 'needle-file', limit: 2 }).items;
    assert.equal(hits.length, 1);
    assert.equal(hits[0].turnNumber, 1);
    assert.equal(hits[0].messageId, 'm');
    assert.equal(hits[0].status, 'failed');
    assert.equal(store.activities.list('s', { scope: 'current' }).items.length, 1);
    assert.equal(store.activities.list('s', { limit: 10 }).next, 10);
  } finally { store.close(); }
});

test('compaction failure is visible but only a successful checkpoint counts; interruption closes unfinished streams', async () => {
  const { store, send, activities } = await fixture();
  try {
    send('compaction.started', { reason: 'auto' });
    send('compaction.delta', { text: 'Partial summary' });
    send('compaction.failed', { reason: 'auto', error: { message: 'Provider unavailable' } });
    send('compaction.started', { reason: 'manual' });
    send('compaction.ended', { reason: 'manual', text: 'Canonical checkpoint summary' });
    send('text.started', { assistantMessageID: 'm', ordinal: 2 });
    send('text.delta', { assistantMessageID: 'm', ordinal: 2, delta: 'Unfinished answer' });
    send('execution.interrupted', { reason: 'user' });
    const compactions = activities().filter((a: any) => a.kind === 'compaction');
    assert.equal(compactions.length, 2);
    assert.deepEqual(compactions.map((a: any) => a.status), ['failed', 'completed']);
    assert.equal(store.snapshot('s')!.turn!.compactions, 1);
    const answer = activities().find((a: any) => a.kind === 'text');
    assert.equal(answer.status, 'interrupted');
    assert.equal(store.activities.detail('s', answer.id, 'output').text, 'Unfinished answer');
  } finally { store.close(); }
});
