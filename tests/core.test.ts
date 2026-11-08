import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Monitor, defaults } from '../src/core/monitor.js';
import { stepRow } from '../src/reports/view.js';

/** Independent metric fixtures disable the window filter and use a 1000-token window, so ten tokens are exactly one percentage point. Eligibility has separate production-default tests. */
function fixture(config = {}) {
  const m = new Monitor({ minContextWindow: 0, ...config });
  let n = 0;
  const send = (event: any) => m.accept({ id: String(++n), at: n, ...event });
  const obs = (tokens: number, extra = {}) => send({ type: 'observe', tokens, capacity: 1000, model: 'a', method: 'reported-input', quality: 'reported', ...extra });
  return { m, send, obs };
}

test('accumulates positive growth across two checkpoints without charging replacement history', () => {
  const { m, send, obs } = fixture();
  obs(300); send({ type: 'turn', turnId: 'u1' });
  send({ type: 'step', stepId: 's1' }); obs(500);
  send({ type: 'compact', checkpointId: 'c1', trigger: 'auto', beforeKnown: true }); obs(100); obs(300);
  send({ type: 'compact', checkpointId: 'c2', trigger: 'manual', beforeKnown: true }); obs(200); obs(400);
  send({ type: 'complete' });
  assert.equal(m.state.turn?.growth, 60);
  assert.equal(m.state.turn?.compactions, 2);
  assert.equal(m.state.turn?.manual, 1);
  assert.equal(m.state.ema.growth, 60);
});

test('unknown pre-compaction evidence remains a partial lower bound', () => {
  const { m, send, obs } = fixture();
  obs(300); send({ type: 'turn', turnId: 'u1' }); obs(500);
  send({ type: 'compact', checkpointId: 'c1', trigger: 'auto', beforeKnown: false }); obs(100); obs(300);
  assert.equal(m.state.turn?.growth, 40);
  assert.equal(m.state.turn?.quality, 'partial');
  assert.match(m.state.turn!.gaps.join(' '), /compaction/i);
});

test('missing occupancy does not contribute a healthy zero EMA sample', () => {
  const { m, send } = fixture();
  send({ type: 'turn', turnId: 'u1' }); send({ type: 'step', stepId: 's1' }); send({ type: 'complete' });
  assert.equal(m.state.ema.growth, null);
  assert.equal(m.state.ema.compactions, 0);
  assert.equal(m.state.turn?.quality, 'unavailable');
});

test('capacity and tokenizer changes rebase instead of inventing growth', () => {
  const { m, send, obs } = fixture();
  obs(300); send({ type: 'turn', turnId: 'u1' }); obs(500);
  obs(1000, { capacity: 2000, model: 'b' });
  obs(1200, { capacity: 2000, model: 'b' });
  assert.equal(m.state.turn?.growth, 30);
  assert.equal(m.state.turn?.quality, 'partial');
});

test('EMA is fed once at completion and replaces a reopened latest turn', () => {
  const { m, send, obs } = fixture();
  obs(0);
  for (const [id, tokens] of [['a', 200], ['b', 600], ['c', 1400]] as const) {
    send({ type: 'turn', turnId: id }); obs(tokens); send({ type: 'complete' });
  }
  assert.ok(Math.abs(m.state.ema.growth! - 44.44444444444444) < 1e-9);
  send({ type: 'step', stepId: 'continued' }); obs(1600);
  assert.ok(Math.abs(m.state.ema.growth! - 26.666666666666668) < 1e-9);
  send({ type: 'complete' });
  assert.ok(Math.abs(m.state.ema.growth! - 51.11111111111111) < 1e-9);
  assert.equal(m.state.ema.compactionSamples, 3);
});

test('duplicate completion and applied checkpoint are idempotent', () => {
  const { m, send, obs } = fixture();
  obs(0); send({ type: 'turn', turnId: 'u1' }); obs(200);
  send({ type: 'compact', checkpointId: 'c', trigger: 'auto', beforeKnown: true });
  send({ type: 'compact', checkpointId: 'c', trigger: 'auto', beforeKnown: true });
  send({ type: 'complete' }); send({ type: 'complete' });
  assert.equal(m.state.turn?.compactions, 1);
  assert.equal(m.state.ema.compactionSamples, 1);
});

test('live alerts do not require minimum EMA samples and warning disable preserves counters', () => {
  const { m, send, obs } = fixture();
  obs(0); send({ type: 'turn', turnId: 'u1' }); obs(810);
  assert.equal(m.state.alerts.length, 1);
  obs(900); assert.equal(m.state.alerts.length, 1);
  const disabled = fixture({ warnings: false });
  disabled.obs(0); disabled.send({ type: 'turn', turnId: 'u' }); disabled.obs(900);
  assert.equal(disabled.m.state.turn?.growth, 90);
  assert.equal(disabled.m.state.alerts.length, 0);
});

test('invalid configuration and nonfinite measurements cannot poison stored state', () => {
  assert.throws(() => new Monitor({ span: 0 }), /span/);
  assert.throws(() => new Monitor({ growthThreshold: -1 }), /growthThreshold/);
  const { m, send, obs } = fixture();
  send({ type: 'turn', turnId: 'u1' }); obs(Number.NaN);
  assert.equal(m.state.turn?.growth, null);
  assert.equal(defaults.lookback, 5);
});

test('growth and compaction guards recover independently and gaps cannot establish recovery', () => {
  const { m, send, obs } = fixture({ span: 1, minSamples: 1, cooldownTurns: 1 });
  obs(0); send({ type: 'turn', turnId: 'one' }); obs(900);
  for (const id of ['a', 'b']) send({ type: 'compact', checkpointId: id, trigger: 'auto', beforeKnown: true });
  send({ type: 'complete' });
  for (const id of ['two', 'three']) {
    send({ type: 'turn', turnId: id }); obs(900); obs(900);
    send({ type: 'compact', checkpointId: id, trigger: 'auto', beforeKnown: true }); send({ type: 'complete' });
  }
  assert.equal(m.state.guards.growth.armed, true);
  assert.equal(m.state.guards.compactions.armed, false);
  send({ type: 'turn', turnId: 'four' }); obs(900); obs(1800); send({ type: 'complete' });
  assert.equal(m.state.alerts.filter(a => a.metric === 'growth').length, 2);
  for (const id of ['five', 'six']) {
    send({ type: 'turn', turnId: id }); obs(1800); send({ type: 'gap', reason: 'Output unavailable' }); send({ type: 'complete' });
  }
  assert.equal(m.state.guards.growth.armed, false);
});

test('reopening a low completed turn retracts its recovery contribution before evaluating live growth', () => {
  const { m, send, obs } = fixture({ span: 1, minSamples: 1, cooldownTurns: 1 });
  obs(0); send({ type: 'turn', turnId: 'one' }); obs(900); send({ type: 'complete' });
  for (const id of ['two', 'three']) { send({ type: 'turn', turnId: id }); obs(900); send({ type: 'complete' }); }
  send({ type: 'step', stepId: 'continuation' }); obs(1800); send({ type: 'complete' });
  assert.equal(m.state.alerts.filter(a => a.metric === 'growth').length, 1, 'A reopened turn must not use its provisional low completion as recovery');
});

test('a late occupancy correction replaces the completed EMA sample without reopening the turn', () => {
  const { m, send, obs } = fixture();
  obs(300); send({ type: 'turn', turnId: 'one' }); obs(500); send({ type: 'complete' });
  const ended = m.state.turn!.ended;
  obs(600);
  assert.equal(m.state.turn!.ended, ended);
  assert.equal(m.state.ema.growth, 30);
  assert.equal(m.state.ema.growthSamples, 1);
  assert.equal(m.state.ema.compactionSamples, 1);
  send({ type: 'gap', reason: 'Late coverage correction' });
  assert.equal(m.state.turn!.ended, ended);
  assert.equal(m.state.ema.growthSamples, 1);
  send({ type: 'step', stepId: 'real-continuation' });
  assert.equal(m.state.turn!.ended, undefined);
  assert.equal(m.state.ema.growthSamples, 0);
});

test('partial estimated growth retains provenance in stored records and never renders as a factual lower bound', () => {
  const { m, send, obs } = fixture();
  obs(300, { method: 'json-utf8-div4', quality: 'estimated' });
  send({ type: 'turn', turnId: 'one' }); send({ type: 'step', stepId: 's' });
  obs(500, { method: 'json-utf8-div4', quality: 'estimated' });
  send({ type: 'gap', reason: 'Final output unknown' });
  const row = stepRow(JSON.parse(JSON.stringify(m.state.step)));
  assert.match(row, /estimated/);
  assert.match(row, /json-utf8-div4/);
  assert.ok(!row.includes('≥20.00'));
  assert.match(row, /~20.00/);
});
