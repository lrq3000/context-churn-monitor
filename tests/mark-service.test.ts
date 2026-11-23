import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ServiceHost, ServiceMark, ServiceMarkTarget } from '@openchamber/sdk';
import { AlertHistory, alertSource } from '../src/storage/alerts.js';
import { Store } from '../src/storage/store.js';
import { SessionMarks } from '../src/gui/marks.js';
import { OpenCodeAdapter } from '../src/adapters/opencode/adapter.js';

/** Only the external host is doubled: registry, ingestion, projections and read-only source connections are real. */
class MarkFixture {
  readonly visible = new Map<string, ServiceMark>();
  readonly calls: { session: string; mark: ServiceMark | null }[] = [];
  readonly stores: Store[] = [];
  now = 0;
  fail = false;
  private constructor(readonly root: string, readonly history: AlertHistory) {}
  readonly host: Pick<ServiceHost, 'setMark'> = { setMark: async (target: ServiceMarkTarget, mark: ServiceMark | null) => {
    assert.ok('sessionId' in target, 'Only session rows may receive churn marks');
    this.calls.push({ session: target.sessionId, mark });
    if (this.fail) throw new Error('Callback unavailable');
    if (mark) this.visible.set(target.sessionId, mark); else this.visible.delete(target.sessionId);
    return { saved: true };
  } };
  static async open(): Promise<MarkFixture> {
    const root = mkdtempSync(join(process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir(), 'mark-service-'));
    return new MarkFixture(root, await AlertHistory.open(join(root, 'alerts.sqlite')));
  }
  async source(): Promise<Store> {
    const store = await Store.open(join(this.root, `source-${this.stores.length}.sqlite`), { warnings: false });
    this.stores.push(store); this.history.registerSource(alertSource(store.path, this.root)); return store;
  }
  qualify(store: Store, session: string, at = 1): void {
    store.ingest(session, [
      { type: 'turn', id: 'turn', turnId: 'turn', at },
      { type: 'step', id: 'step', stepId: 'step', model: 'fixture', capacity: 64000, at: at + 1 },
      { type: 'compact', id: 'c1', checkpointId: 'c1', trigger: 'auto', beforeKnown: true, at: at + 2 },
      { type: 'compact', id: 'c2', checkpointId: 'c2', trigger: 'auto', beforeKnown: true, at: at + 3 },
    ]);
  }
  reconciler(): SessionMarks { return new SessionMarks(this.history, this.host, () => this.now); }
  close(): void { for (const store of this.stores) store.close(); this.history.close(); }
}

test('startup restores native marks across projects without a panel and unchanged polls make no callbacks', async () => {
  const f = await MarkFixture.open();
  try {
    f.qualify(await f.source(), 'one'); f.qualify(await f.source(), 'two');
    const marks = f.reconciler(); await marks.refresh();
    assert.deepEqual([...f.visible.keys()].sort(), ['one', 'two']);
    assert.deepEqual(f.visible.get('one'), { icon: 'pulse', tone: 'warning', text: 'Turn 1: compactions live 2 ≥ 2' });
    await marks.refresh(); assert.equal(f.calls.length, 2);
    const restarted = f.reconciler(); await restarted.refresh();
    assert.equal(f.calls.length, 4, 'A fresh service process must restore marks even though storage did not change');
    await marks.stop(); await restarted.stop();
  } finally { f.close(); }
});

test('a new turn removes its mark and pending never-published hits are coalesced away', async () => {
  const f = await MarkFixture.open();
  try {
    const store = await f.source();
    for (let i = 0; i < 65; i++) f.qualify(store, `s${i}`, i);
    const marks = f.reconciler(); await marks.refresh();
    assert.equal(f.visible.size, 60);
    for (let i = 0; i < 65; i++) store.ingest(`s${i}`, [{ type: 'turn', id: 'next', turnId: 'next', at: 100 }]);
    f.now = 59999; await marks.refresh(); assert.equal(f.calls.length, 60, 'Do not exceed the rolling callback budget');
    f.now = 60000; await marks.refresh();
    assert.equal(f.visible.size, 0); assert.equal(f.calls.length, 120);
    assert.ok(f.calls.slice(60).every(call => call.mark === null), 'Do not publish queued hits belonging to old turns');
    await marks.stop();
  } finally { f.close(); }
});

test('a newer clear or eligibility loss in another source overrides a session old positive mark', async () => {
  const f = await MarkFixture.open();
  try {
    const old = await f.source(), moved = await f.source(); f.qualify(old, 'moved', 10);
    const marks = f.reconciler(); await marks.refresh(); assert.equal(f.visible.size, 1);
    moved.ingest('moved', [{ type: 'turn', id: 'next', turnId: 'next', at: 100 }]);
    await marks.refresh(); assert.equal(f.visible.size, 0, 'A clean turn in the new location must override the old source');
    moved.ingest('moved', [
      { type: 'step', id: 'new-step', stepId: 'new-step', model: 'large', capacity: 64000, at: 101 },
      { type: 'compact', id: 'new-c1', checkpointId: 'new-c1', trigger: 'auto', beforeKnown: true, at: 102 },
      { type: 'compact', id: 'new-c2', checkpointId: 'new-c2', trigger: 'auto', beforeKnown: true, at: 103 },
    ]);
    await marks.refresh(); assert.equal(f.visible.size, 1);
    moved.ingest('moved', [{ type: 'step', id: 'small', stepId: 'small', model: 'small', capacity: 1000, at: 104 }]);
    await marks.refresh(); assert.equal(f.visible.size, 0, 'Do not resurrect the old source after same-turn eligibility loss');
    await marks.stop();
  } finally { f.close(); }
});

test('cleared duplicate-source records do not hide qualifying candidates beyond the first 200 rows', async () => {
  const f = await MarkFixture.open();
  try {
    const old = await f.source(), moved = await f.source();
    for (let i = 0; i < 205; i++) {
      f.qualify(old, `s${i}`, i);
      moved.ingest(`s${i}`, [{ type: 'turn', id: 'clean', turnId: 'clean', at: 1000 + i }]);
    }
    f.qualify(old, 'older-still-qualifies', -10);
    const marks = f.reconciler(); await marks.refresh();
    assert.deepEqual([...f.visible.keys()], ['older-still-qualifies'], 'Fill capacity from verified candidates, not from the first page of stale positives');
    await marks.stop();
  } finally { f.close(); }
});

test('native session deletion clears all source copies without deleting replay or resurrecting on late usage', async () => {
  const f = await MarkFixture.open();
  try {
    const old = await f.source(), current = await f.source(); f.qualify(old, 'deleted', 10); f.qualify(current, 'deleted', 100);
    const adapter = new OpenCodeAdapter(current), marks = f.reconciler();
    await marks.refresh(); assert.equal(f.visible.size, 1);
    adapter.event({ type: 'session.deleted', id: 'deletion', created: 200, data: { sessionID: 'deleted' } });
    await marks.refresh(); assert.equal(f.visible.size, 0, 'Deleted sessions must not occupy native capacity or fall back to a prior source');
    assert.ok(current.snapshot('deleted'), 'Deletion cleanup is confined to marks; preserve diagnostic evidence');
    current.ingest('deleted', [{ type: 'compact', id: 'late', checkpointId: 'late', trigger: 'auto', beforeKnown: true, at: 201 }]);
    await marks.refresh(); assert.equal(f.visible.size, 0);
    await marks.stop();
  } finally { f.close(); }
});

test('host capacity selects the newest 200 marks and removes an evicted mark before adding its replacement', async () => {
  const f = await MarkFixture.open();
  try {
    const store = await f.source();
    for (let i = 0; i < 205; i++) f.qualify(store, `s${String(i).padStart(3, '0')}`, i);
    const marks = f.reconciler();
    for (let i = 0; i < 4; i++) { f.now = i * 60000; await marks.refresh(); }
    assert.equal(f.visible.size, 200); assert.equal(f.visible.has('s004'), false); assert.equal(f.visible.has('s005'), true);
    f.qualify(store, 'newest', 1000); await marks.refresh();
    assert.equal(f.visible.size, 200); assert.equal(f.visible.has('s005'), false); assert.equal(f.visible.has('newest'), true);
    assert.deepEqual(f.calls.slice(-2).map(call => [call.session, call.mark === null]), [['s005', true], ['newest', false]]);
    await marks.stop();
  } finally { f.close(); }
});

test('failed callbacks are retried without caching success or exceeding the rate limit', async () => {
  const f = await MarkFixture.open();
  try {
    f.qualify(await f.source(), 'retry'); const marks = f.reconciler();
    f.fail = true; await marks.refresh(); assert.equal(f.visible.size, 0);
    f.fail = false; await marks.refresh(); assert.equal(f.visible.size, 1);
    assert.equal(f.calls.length, 2); await marks.refresh(); assert.equal(f.calls.length, 2);
    await marks.stop();
  } finally { f.close(); }
});

test('an applied mark with a lost callback reply is removed after the turn changes', async () => {
  const f = await MarkFixture.open();
  try {
    const store = await f.source(); f.qualify(store, 'uncertain');
    let loseReply = true;
    const marks = new SessionMarks(f.history, { setMark: async (target, mark) => {
      const result = await f.host.setMark(target, mark);
      if (loseReply) { loseReply = false; throw new Error('The host applied the mark but its reply was lost'); }
      return result;
    } }, () => f.now);
    await marks.refresh(); assert.equal(f.visible.size, 1);
    store.ingest('uncertain', [{ type: 'turn', id: 'new', turnId: 'new', at: 10 }]);
    await marks.refresh();
    assert.equal(f.visible.size, 0, 'An uncertain target must still receive removal when it is no longer desired');
    await marks.stop();
  } finally { f.close(); }
});

test('unreadable and legacy sources create no database or false marks and source failure removes stale marks', async () => {
  const f = await MarkFixture.open();
  try {
    const store = await f.source(); f.qualify(store, 'readable');
    const legacy = await f.source(); legacy.db.exec('DROP TABLE threshold_marks');
    const missing = join(f.root, 'missing.sqlite'); f.history.registerSource(alertSource(missing, f.root));
    const marks = f.reconciler(); await marks.refresh();
    assert.equal(f.visible.size, 1); assert.equal(existsSync(missing), false);
    assert.equal(legacy.db.prepare("SELECT name FROM sqlite_master WHERE name='threshold_marks'").get(), undefined);
    // An invalidated store is a deterministic read failure without deleting user files or relying on OS-specific locking.
    store.db.exec('ALTER TABLE threshold_marks RENAME TO unavailable_marks; CREATE VIEW threshold_marks AS SELECT * FROM missing_table;');
    await marks.refresh(); assert.equal(f.visible.size, 0, 'Unverified old turn status must not remain visible forever');
    await marks.stop();
  } finally { f.close(); }
});

test('a store locked after validation does not prevent healthy marks and recovers on the next poll', async t => {
  const f = await MarkFixture.open();
  try {
    const healthy = await f.source(), busy = await f.source();
    f.qualify(healthy, 'healthy'); f.qualify(busy, 'busy');
    busy.db.exec('PRAGMA journal_mode=DELETE');
    assert.equal(busy.db.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
    const sources = f.history.sources.bind(f.history);
    let locked = false;
    // Acquire a real SQLite lock just after the registry iterator has opened/validated both sources.
    const timing = t.mock.method(f.history, 'sources', (after?: string) => {
      const page = sources(after);
      if (after && !page.length) { busy.db.exec('BEGIN EXCLUSIVE'); locked = true; }
      return page;
    });
    const marks = f.reconciler();
    try {
      await marks.refresh();
      assert.equal(locked, true);
      assert.deepEqual([...f.visible.keys()], ['healthy']);
    } finally {
      timing.mock.restore();
      if (locked) busy.db.exec('ROLLBACK');
    }
    await marks.refresh();
    assert.deepEqual([...f.visible.keys()].sort(), ['busy', 'healthy']);
    await marks.stop();
  } finally { f.close(); }
});

test('concurrent refreshes share one run and stopping the service prevents later callbacks', async () => {
  const f = await MarkFixture.open();
  try {
    f.qualify(await f.source(), 'one');
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => entered = resolve);
    const waiting = new Promise<void>(resolve => release = resolve);
    const marks = new SessionMarks(f.history, { setMark: async (target, mark) => { entered(); await waiting; return f.host.setMark(target, mark); } }, () => f.now);
    const first = marks.refresh(), second = marks.refresh();
    assert.equal(first, second); await started;
    const stopping = marks.stop(); release(); await stopping;
    await marks.refresh(); assert.equal(f.calls.length, 1);
  } finally { f.close(); }
});
