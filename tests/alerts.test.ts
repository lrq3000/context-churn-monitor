import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Monitor } from '../src/core/monitor.js';

let clock = 0;
const event = (monitor: Monitor, value: any) => monitor.accept({ id: `alert-event-${++clock}`, at: clock, ...value });
function turn(monitor: Monitor, id: string, capacity: number | undefined, growth = 90, compactions = 2) {
  event(monitor, { type: 'turn', turnId: id });
  event(monitor, { type: 'step', stepId: `${id}-request`, model: 'fixture/model', capacity });
  for (const tokens of [0, (capacity ?? 128000) * growth / 100]) event(monitor, { type: 'observe', tokens, capacity: capacity ?? 128000, model: 'fixture/model', method: 'fixture', quality: 'reported' });
  for (let i = 0; i < compactions; i++) event(monitor, { type: 'compact', checkpointId: `${id}-checkpoint-${i}`, trigger: 'auto', beforeKnown: true });
  event(monitor, { type: 'complete' });
}

test('small and unknown model windows cannot alert but their growth and compactions remain recorded', () => {
  for (const capacity of [8000, undefined]) {
    const monitor = new Monitor();
    turn(monitor, 'small', capacity);
    assert.deepEqual(monitor.state.alerts, []);
    assert.equal(monitor.state.turn!.growth, 90);
    assert.equal(monitor.state.turn!.compactions, 2);
  }
});

test('the inclusive 32000 minimum admits both existing alert metrics and retains threshold evidence', () => {
  const monitor = new Monitor(); turn(monitor, 'eligible', 32000);
  assert.deepEqual(monitor.state.alerts.map(alert => alert.metric), ['growth', 'compactions']);
  assert.equal((monitor.state.alerts[0] as any).threshold, 80);
  assert.equal((monitor.state.alerts[0] as any).capacity, 32000);
  assert.equal((monitor.state.alerts[0] as any).model, 'fixture/model');
});

test('a zero minimum disables only the eligibility filter', () => {
  const monitor = new Monitor({ minContextWindow: 0 } as any); turn(monitor, 'local', 8000);
  assert.equal(monitor.state.alerts.length, 2);
});

test('a later large model cannot charge the small-model part of a mixed turn to alert detection', () => {
  const monitor = new Monitor();
  event(monitor, { type: 'turn', turnId: 'mixed' });
  event(monitor, { type: 'step', stepId: 'small', model: 'local', capacity: 8000 });
  event(monitor, { type: 'step', stepId: 'large', model: 'large', capacity: 128000 });
  for (const tokens of [0, 120000]) event(monitor, { type: 'observe', tokens, capacity: 128000, model: 'large', method: 'fixture', quality: 'reported' });
  event(monitor, { type: 'complete' });
  assert.equal(monitor.state.alerts.length, 0);
  assert.equal(monitor.state.turn!.growth, 93.75);
});

test('small-context turns cannot seed the eligible growth or compaction averages', () => {
  const monitor = new Monitor({ minSamples: 1, span: 5, liveGrowth: 1000, liveCompactions: 1000 });
  turn(monitor, 'small', 8000, 90, 10);
  turn(monitor, 'large', 128000, 10, 0);
  assert.equal(monitor.state.alerts.length, 0, 'The first eligible average is 10 pp and zero compactions, not the small-model churn');
  assert.ok(monitor.state.ema.growth! > 40, 'Unfiltered monitoring EMA is still retained independently');
});

test('ineligible turns do not rearm an alert and minimum changes do not replay the current turn', () => {
  const monitor = new Monitor({ span: 1, minSamples: 1, cooldownTurns: 2, rearmTurns: 1 });
  turn(monitor, 'first', 128000, 90, 0);
  for (let i = 0; i < 4; i++) turn(monitor, `small-${i}`, 8000, 0, 0);
  turn(monitor, 'second', 128000, 90, 0);
  assert.equal(monitor.state.alerts.length, 1);
  const changed = new Monitor({ ...monitor.config, minContextWindow: 64000 } as any, monitor.state);
  event(changed, { type: 'gap', reason: 'Later update' });
  assert.equal(changed.state.alerts.length, 1, 'Changing the filter cannot replay a completed sample');
  turn(changed, 'new-low', 128000, 0, 0);
  turn(changed, 'new-high', 128000, 90, 0);
  assert.equal(changed.state.alerts.length, 2);
});
