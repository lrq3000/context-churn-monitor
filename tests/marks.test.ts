import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Monitor } from '../src/core/monitor.js';
import type { Config, Event } from '../src/core/types.js';
import { Store } from '../src/storage/store.js';

type EventInput = Event extends infer E ? E extends Event ? Omit<E, 'id' | 'at'> : never : never;

/** Feed real reducer events; thresholds use compactions where token provenance is irrelevant to the assertion. */
class TurnFixture {
  readonly monitor: Monitor;
  private sequence = 0;
  constructor(config: Partial<Config> = {}) { this.monitor = new Monitor(config); }
  send(event: EventInput): void { this.monitor.accept({ ...event, id: `event-${++this.sequence}`, at: this.sequence }); }
  turn(id: string, capacity: number | undefined = 64000): void {
    this.send({ type: 'turn', turnId: id });
    this.send({ type: 'step', stepId: `step-${id}`, model: 'fixture', capacity });
  }
  compact(): void { this.send({ type: 'compact', checkpointId: `checkpoint-${this.sequence}`, trigger: 'auto', beforeKnown: true }); }
  hits() { return this.monitor.state.alerting?.current?.hits ?? []; }
}

test('live hits are inclusive and persist with warnings disabled without creating alerts', () => {
  const f = new TurnFixture({ warnings: false });
  f.turn('live'); f.compact();
  assert.deepEqual(f.hits(), []);
  f.compact();
  assert.deepEqual(f.hits(), [{ metric: 'compactions', kind: 'live', value: 2, threshold: 2 }]);
  f.compact(); f.send({ type: 'complete' });
  assert.deepEqual(f.hits(), [{ metric: 'compactions', kind: 'live', value: 2, threshold: 2 }], 'Keep the first reached value so tooltips do not consume quota on every step');
  assert.deepEqual(f.monitor.state.alerts, []);
});

test('cooldown and disarmed notification guards do not suppress a new turn mark', () => {
  const f = new TurnFixture();
  f.turn('one'); f.compact(); f.compact(); f.send({ type: 'complete' });
  assert.equal(f.monitor.state.alerts.length, 1);
  f.turn('two');
  assert.deepEqual(f.hits(), [], 'A new turn must not inherit the preceding hit');
  f.compact(); f.compact();
  assert.equal(f.hits()[0]?.kind, 'live');
  assert.equal(f.monitor.state.alerts.length, 1, 'Do not bypass notification cooldown/rearm');
});

test('eligible EMA hits require minimum samples and are captured on completion', () => {
  const f = new TurnFixture({ warnings: false, minSamples: 3, compactionThreshold: 1, liveCompactions: 99 });
  for (let i = 1; i <= 3; i++) {
    f.turn(`turn-${i}`); f.compact();
    assert.deepEqual(f.hits(), [], 'Live-turn EMAs must not invent a completed sample');
    f.send({ type: 'complete' });
    assert.deepEqual(f.hits(), i < 3 ? [] : [{ metric: 'compactions', kind: 'ema', value: 1, threshold: 1 }]);
  }
});

test('growth and compaction live and EMA thresholds can all contribute to one turn', () => {
  const f = new TurnFixture({ warnings: false, minSamples: 1, liveGrowth: 80, growthThreshold: 80, compactionThreshold: 2 });
  f.turn('both', 100000);
  f.send({ type: 'observe', tokens: 0, capacity: 100000, model: 'fixture', method: 'reported', quality: 'reported' });
  f.send({ type: 'observe', tokens: 80000, capacity: 100000, model: 'fixture', method: 'reported', quality: 'reported' });
  f.compact(); f.compact(); f.send({ type: 'complete', interrupted: true });
  assert.equal(f.hits().length, 4);
  assert.deepEqual(f.hits().map(hit => `${hit.metric}:${hit.kind}`).sort(), ['compactions:ema', 'compactions:live', 'growth:ema', 'growth:live']);
  f.send({ type: 'step', stepId: 'continuation', model: 'fixture', capacity: 100000 });
  assert.equal(f.hits().length, 4, 'An automatic continuation of the same turn retains reached thresholds');
});

test('ineligible mixed/unknown model turns lose hits, while a zero minimum allows unknown windows', () => {
  const f = new TurnFixture();
  f.turn('mixed'); f.compact(); f.compact();
  assert.equal(f.hits().length, 1);
  f.send({ type: 'step', stepId: 'small-model', model: 'small', capacity: 16000 });
  assert.deepEqual(f.hits(), []);
  f.send({ type: 'step', stepId: 'large-again', model: 'large', capacity: 128000 });
  assert.deepEqual(f.hits(), [], 'A later large model does not repair an ineligible mixed turn');
  f.turn('unknown');
  f.send({ type: 'step', stepId: 'unknown-capacity', model: 'unknown' }); f.compact(); f.compact();
  assert.deepEqual(f.hits(), []);
  const unfiltered = new TurnFixture({ minContextWindow: 0, warnings: false });
  unfiltered.turn('unfiltered'); unfiltered.send({ type: 'step', stepId: 'unknown', model: 'unknown' });
  unfiltered.compact(); unfiltered.compact();
  assert.equal(unfiltered.hits().length, 1);
});

test('indexed projections survive restart independently of notifications and disappear on the next turn', async () => {
  const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'threshold-marks-'));
  const path = join(root, 'state.sqlite');
  let store = await Store.open(path, { warnings: false });
  try {
    store.ingest('session', [
      { type: 'turn', id: 't', turnId: 't', at: 10 },
      { type: 'step', id: 's', stepId: 's', model: 'fixture', capacity: 32000, at: 11 },
      { type: 'compact', id: 'c1', checkpointId: 'c1', trigger: 'auto', beforeKnown: true, at: 12 },
      { type: 'compact', id: 'c2', checkpointId: 'c2', trigger: 'auto', beforeKnown: true, at: 13 },
    ]);
    assert.deepEqual(store.pendingAlerts(), []);
    store.close(); store = await Store.open(path, {}, true);
    assert.deepEqual(store.marks(), [{ sessionId: 'session', turn: 1, at: 10, hits: [{ metric: 'compactions', kind: 'live', value: 2, threshold: 2 }] }]);
    store.close(); store = await Store.open(path, { warnings: false });
    store.ingest('session', [{ type: 'turn', id: 'new', turnId: 'new', at: 20 }]);
    assert.deepEqual(store.marks(), []);
  } finally { store.close(); }
});

test('a read-only legacy store without the projection table yields no reconstructed marks', async () => {
  const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'legacy-marks-'));
  const path = join(root, 'state.sqlite');
  const old = await Store.open(path);
  old.db.exec('DROP TABLE IF EXISTS threshold_marks'); old.close();
  const store = await Store.open(path, {}, true);
  try {
    assert.deepEqual(store.marks(), []);
    assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE name='threshold_marks'").get(), undefined, 'A service read must not migrate a source database');
  } finally { store.close(); }
});
