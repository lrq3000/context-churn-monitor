import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/storage/store.js';
import { OpenCodeAdapter, promptTokens } from '../src/adapters/opencode/adapter.js';
import { CodexAdapter } from '../src/adapters/codex/adapter.js';

test('OpenCode only delivered user items start turns; cache occupies context and cumulative usage is ignored', async () => {
  const store = await Store.open(':memory:');
  const adapter = new OpenCodeAdapter(store);
  let n = 0;
  const send = (type: string, data: any) => adapter.event({ type, data: { sessionID: 's', ...data }, id: `e${++n}`, created: n }, 1000);
  send('session.inbox.enqueued', { inboxID: 'u', item: { type: 'user' } });
  assert.equal(store.snapshot('s')?.turn ?? null, null);
  send('session.inbox.delivered', { inboxID: 'u' });
  send('session.step.started', { assistantMessageID: 'a', model: { providerID: 'p', id: 'm' } });
  send('session.step.ended', { assistantMessageID: 'a', tokens: { input: 100, cache: { read: 200, write: 0 }, output: 900, reasoning: 800 } });
  send('session.usage.updated', { tokens: { input: 900000 } });
  send('session.inbox.enqueued', { inboxID: 'synthetic', item: { type: 'synthetic' } });
  send('session.inbox.delivered', { inboxID: 'synthetic' });
  send('session.step.started', { assistantMessageID: 'b', model: { providerID: 'p', id: 'm' } });
  send('session.step.ended', { assistantMessageID: 'b', tokens: { input: 100, cache: { read: 400, write: 0 }, output: 10, reasoning: 20 } });
  send('session.compaction.failed', { reason: 'auto' });
  send('session.compaction.ended', { reason: 'auto' });
  send('session.step.started', { assistantMessageID: 'c', model: { providerID: 'p', id: 'm' } });
  send('session.step.ended', { assistantMessageID: 'c', tokens: { input: 100, cache: { read: 0, write: 0 }, output: 0, reasoning: 0 } });
  send('session.execution.succeeded', {});
  assert.equal(store.snapshot('s')?.turn?.growth, 20);
  assert.equal(store.snapshot('s')?.turn?.number, 1);
  assert.equal(store.snapshot('s')?.turn?.compactions, 1);
  assert.equal(store.snapshot('s')?.turn?.quality, 'partial');
  assert.equal(promptTokens({ input: 100, cache: { read: 200, write: 50 }, output: 999 }), 350);
  store.close();
});

test('Codex retries stay in a turn, null usage stays unknown, successful compactions count and children stay separate', async () => {
  const store = await Store.open(':memory:');
  const adapter = new CodexAdapter(store, { modelWindows: { model: 1000 } });
  let n = 0;
  const send = (hook_event_name: string, data = {}) => adapter.event({ session_id: 's', turn_id: 'u', model: 'model', hook_event_name, ...data }, `e${++n}`);
  send('UserPromptSubmit');
  assert.equal(store.snapshot('s')?.turn ?? null, null);
  send('PreModelRequest'); send('PostModelRequest', { token_usage: { input_tokens: 300, cached_input_tokens: 200 }, status: 'completed' });
  send('PreModelRequest'); send('PostModelRequest', { token_usage: null, status: 'failed' });
  send('PreModelRequest'); send('PostModelRequest', { token_usage: { input_tokens: 500 }, status: 'completed' });
  send('PreCompact', { trigger: 'auto' }); send('PostCompact', { trigger: 'auto' });
  send('Stop');
  assert.equal(store.snapshot('s')?.turn?.growth, 20);
  assert.equal(store.snapshot('s')?.turn?.steps, 3);
  assert.equal(store.snapshot('s')?.turn?.compactions, 1);
  send('PreModelRequest', { agent_id: 'child' });
  assert.equal(store.snapshot('s')?.turn?.steps, 3);
  assert.equal(store.snapshot('s:child:child')?.turn?.steps, 1);
  store.close();
});

test('Codex replay with event identity does not create an extra model attempt', async () => {
  const store = await Store.open(':memory:');
  const adapter = new CodexAdapter(store, {});
  const event = { session_id: 's', turn_id: 'u', hook_event_name: 'PreModelRequest' };
  adapter.event(event, 'same'); adapter.event(event, 'same');
  assert.equal(store.snapshot('s')?.turn?.steps, 1);
  assert.equal(store.snapshot('s')?.turn?.growth, null);
  store.close();
});

test('OpenCode normalized zero input is unavailable rather than a reported zero baseline', async () => {
  const store = await Store.open(':memory:');
  const adapter = new OpenCodeAdapter(store); let n = 0;
  const send = (type: string, data: any) => adapter.event({ type, data: { sessionID: 's', ...data }, id: `e${++n}`, created: n }, 1000);
  for (const [i, input] of [300, 0, 300].entries()) {
    send('session.inbox.enqueued', { inboxID: `u${i}`, item: { type: 'user' } });
    send('session.inbox.delivered', { inboxID: `u${i}` });
    send('session.step.started', { assistantMessageID: `a${i}`, model: { providerID: 'p', id: 'm' } });
    send('session.step.ended', { assistantMessageID: `a${i}`, tokens: { input, cache: { read: 0, write: 0 }, output: 0, reasoning: 0 } });
    send('session.execution.succeeded', {});
    if (i === 1) {
      assert.equal(store.snapshot('s')?.baseline?.tokens, 300);
      assert.equal(store.snapshot('s')?.turn?.growth, null);
      assert.equal(store.snapshot('s')?.ema.growthSamples, 0);
    }
  }
  assert.equal(store.snapshot('s')?.turn?.growth, 0);
  assert.equal(promptTokens({ input: 0, cache: { read: 0, write: 0 } }), null);
  store.close();
});

test('known synthetic-only activity does not create a user-turn EMA sample', async () => {
  const store = await Store.open(':memory:'); const adapter = new OpenCodeAdapter(store); let n = 0;
  const send = (type: string, data: any) => adapter.event({ type, data: { sessionID: 's', ...data }, id: `e${++n}`, created: n }, 1000);
  send('session.inbox.enqueued', { inboxID: 'notice', item: { type: 'synthetic' } });
  send('session.inbox.delivered', { inboxID: 'notice' });
  send('session.step.started', { assistantMessageID: 'a', model: { providerID: 'p', id: 'm' } });
  send('session.step.ended', { assistantMessageID: 'a', tokens: { input: 300, cache: { read: 0, write: 0 } } });
  send('session.execution.succeeded', {});
  assert.equal(store.snapshot('s')?.turn ?? null, null);
  assert.equal(store.snapshot('s')?.ema.compactionSamples ?? 0, 0);
  send('session.inbox.enqueued', { inboxID: 'u', item: { type: 'user' } });
  send('session.inbox.delivered', { inboxID: 'u' });
  send('session.step.started', { assistantMessageID: 'b', model: { providerID: 'p', id: 'm' } });
  assert.equal(store.snapshot('s')?.turn?.number, 1);
  store.close();
});
