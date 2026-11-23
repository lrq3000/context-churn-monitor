import { createHash } from 'node:crypto';
import { configure, Monitor } from '../core/monitor.js';
import type { Config, Event, State, Step, Turn } from '../core/types.js';
import { ActivityStore } from './activities.js';
import { openDatabase } from './database.js';
import { alertSource, type ThresholdEvent } from './alerts.js';
import type { AlertSettings, ThresholdHit } from '../core/alerts.js';

interface Statement {
  run(...values: any[]): unknown;
  get(...values: any[]): any;
  all(...values: any[]): any[];
}
export interface Database { exec(sql: string): unknown; prepare(sql: string): Statement; close(): void }
export interface StepQuery { limit?: number; offset?: number; scope?: 'all' | 'current' | 'recent'; lookback?: number; sort?: 'time' | 'growth'; maxTurn?: number }
export interface AlertContext { directory: string; settings: () => AlertSettings }
export interface ThresholdMarkRecord { sessionId: string; turn: number; at: number; hits: ThresholdHit[]; updated?: number; deleted?: true }

/** SQLite provides crash-safe transactions and indexed pagination across short-lived Codex processes and long-lived OpenCode plugins. */
export class Store {
  readonly activities: ActivityStore;
  private depth = 0;
  private constructor(readonly db: Database, private readonly config: Partial<Config>, readonly path: string, readOnly = false, private readonly alertContext?: AlertContext, readBusyTimeout: 0 | 3000 = 3000) {
    if (readOnly) { db.exec(`PRAGMA query_only=ON; PRAGMA busy_timeout=${readBusyTimeout};`); this.activities = new ActivityStore(db, session => this.snapshot(session), true); return; }
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (session TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(session,id));
      CREATE TABLE IF NOT EXISTS turns (session TEXT NOT NULL, id TEXT NOT NULL, number INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(session,id));
      CREATE INDEX IF NOT EXISTS turns_order ON turns(session,number);
      CREATE TABLE IF NOT EXISTS steps (session TEXT NOT NULL, id TEXT NOT NULL, turn_number INTEGER NOT NULL, number INTEGER NOT NULL, growth REAL, data TEXT NOT NULL, PRIMARY KEY(session,id));
      CREATE INDEX IF NOT EXISTS steps_order ON steps(session,turn_number,number);
      CREATE INDEX IF NOT EXISTS steps_growth ON steps(session,growth DESC,turn_number,number);
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS alert_outbox (id TEXT PRIMARY KEY,at INTEGER NOT NULL,acked INTEGER NOT NULL DEFAULT 0,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS alert_outbox_order ON alert_outbox(at DESC,id DESC);
      CREATE TABLE IF NOT EXISTS threshold_marks (session TEXT PRIMARY KEY,at INTEGER NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS threshold_marks_order ON threshold_marks(at DESC,session) WHERE json_array_length(data,'$.hits')>0;`);
    this.activities = new ActivityStore(db, session => this.snapshot(session));
  }

  static async open(path: string, config: Partial<Config> = {}, readOnly = false, alertContext?: AlertContext): Promise<Store> {
    configure(config);
    return new Store(await openDatabase(path, readOnly), config, path, readOnly, alertContext);
  }

  /** Sidebar polling is best-effort and shares the service's HTTP thread. A lock must not block that thread for seconds per source. */
  static async openMarkSource(path: string): Promise<Store> {
    const db = await openDatabase(path, true);
    try { return new Store(db, {}, path, true, undefined, 0); }
    catch (error) { db.close(); throw error; }
  }

  /** Deferred read transaction pins a WAL snapshot without reserving the writer. Use on a separate read-only connection, never around monitoring ingestion. */
  readSnapshot<T>(operation: () => T): T {
    this.db.exec('BEGIN');
    try { const value = operation(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  atomic<T>(operation: () => T): T {
    if (this.depth) return operation();
    this.db.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const value = operation();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally { this.depth--; }
  }

  ingest(session: string, events: Event[]): State {
    return this.atomic(() => {
      const monitor = new Monitor(this.settings(session), this.snapshot(session) ?? undefined);
      for (const event of events) {
        if (this.db.prepare('SELECT 1 FROM events WHERE session=? AND id=?').get(session, event.id)) continue;
        // Implicit completion below can itself cross an EMA threshold; include that transition in outbox detection.
        const beforeAlerts = new Set(monitor.state.alerts.map(alert => alert.id));
        // Save an automatically closed preceding turn before the reducer replaces its active record.
        if (event.type === 'turn' && monitor.state.turn && monitor.state.turn.id !== event.turnId) {
          monitor.accept({ type: 'complete', id: `${event.id}:previous`, at: event.at });
          this.saveRecords(session, monitor.state);
        }
        monitor.accept(event);
        if (this.alertContext) for (const alert of monitor.state.alerts) {
          if (beforeAlerts.has(alert.id)) continue;
          const marker = `threshold:${alert.id}`;
          if (this.db.prepare('SELECT 1 FROM events WHERE session=? AND id=?').get(session, marker)) continue;
          const source = alertSource(this.path, this.alertContext.directory);
          const id = createHash('sha256').update(source.id).update('\0').update(session).update('\0').update(alert.id).digest('hex');
          const record: ThresholdEvent = { id, at: alert.at, sessionId: session, directory: source.directory, metric: alert.metric, value: alert.value, threshold: alert.threshold!, kind: alert.kind, model: alert.model?.slice(0, 500), capacity: alert.capacity, delivery: 'recorded' };
          this.db.prepare('INSERT OR IGNORE INTO alert_outbox(id,at,data) VALUES(?,?,?)').run(id, record.at, JSON.stringify(record));
          this.db.prepare('INSERT INTO events VALUES(?,?)').run(session, marker);
          this.db.exec('DELETE FROM alert_outbox WHERE id NOT IN (SELECT id FROM alert_outbox ORDER BY at DESC,id DESC LIMIT 100)');
        }
        this.saveRecords(session, monitor.state);
        this.db.prepare('INSERT INTO events VALUES (?,?)').run(session, event.id);
      }
      this.db.prepare('INSERT OR REPLACE INTO sessions VALUES (?,?)').run(session, JSON.stringify(monitor.state));
      const turn = monitor.state.turn, current = monitor.state.alerting?.current;
      const hits = current?.eligible && current.hasModel ? current.hits ?? [] : [];
      // Only small current-turn projections are read by the persistent GUI service, never replay bodies or the notification outbox.
      const previous = this.markState(session);
      if (!previous?.deleted) {
        const updated = events.reduce((at, event) => Math.max(at, event.at), previous?.updated ?? turn?.at ?? 0);
        // Keep empty-hit records as clear-state evidence: an older source must not resurrect a moved session's obsolete mark.
        const record: ThresholdMarkRecord = { sessionId: session, turn: turn?.number ?? 0, at: turn?.at ?? updated, updated, hits };
        this.db.prepare('INSERT OR REPLACE INTO threshold_marks VALUES(?,?,?)').run(session, record.at, JSON.stringify(record));
      }
      return monitor.state;
    });
  }

  private saveRecords(session: string, state: State): void {
    const t = state.turn, step = state.step;
    if (t) this.db.prepare('INSERT OR REPLACE INTO turns VALUES (?,?,?,?)').run(session, t.id, t.number, JSON.stringify(t));
    if (step) this.db.prepare('INSERT OR REPLACE INTO steps VALUES (?,?,?,?,?,?)').run(session, step.id, step.turnNumber, step.number, step.growth, JSON.stringify(step));
  }

  snapshot(session: string): State | null {
    const row = this.db.prepare('SELECT state FROM sessions WHERE id=?').get(session);
    return row ? JSON.parse(row.state) : null;
  }

  sessions(): string[] { return this.db.prepare('SELECT id FROM sessions ORDER BY id').all().map(row => row.id); }
  private hasMarks(): boolean { return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='threshold_marks'").get(); }
  markState(session: string): ThresholdMarkRecord | undefined {
    if (!this.hasMarks()) return undefined;
    const row = this.db.prepare('SELECT data FROM threshold_marks WHERE session=?').get(session);
    return row ? JSON.parse(row.data) : undefined;
  }
  clearMark(session: string, at: number): void {
    // Session IDs are not reused. Retain a tombstone to suppress older source copies and delayed terminal events, not to erase replay evidence.
    const record: ThresholdMarkRecord = { sessionId: session, turn: this.snapshot(session)?.turn?.number ?? 0, at, updated: at, hits: [], deleted: true };
    this.db.prepare('INSERT OR REPLACE INTO threshold_marks VALUES(?,?,?)').run(session, at, JSON.stringify(record));
  }
  marks(limit = 200, after?: Pick<ThresholdMarkRecord, 'at' | 'sessionId'>): ThresholdMarkRecord[] {
    // Read-only service connections must not migrate an old backend or invent its historical threshold settings.
    if (!this.hasMarks()) return [];
    const size = Math.max(1, Math.min(200, Math.trunc(limit)));
    const cursor = after ? ' AND (at<? OR (at=? AND session>?))' : '';
    return this.db.prepare(`SELECT data FROM threshold_marks WHERE json_array_length(data,'$.hits')>0${cursor} ORDER BY at DESC,session LIMIT ?`).all(...(after ? [after.at, after.at, after.sessionId] : []), size).map(row => JSON.parse(row.data));
  }
  settings(session: string): Config { return configure({ ...this.config, ...this.get<Partial<Config>>(`settings:${session}`), ...this.alertContext?.settings() }); }
  setSettings(session: string, input: Partial<Config>): Config {
    return this.atomic(() => {
      const next = configure({ ...this.settings(session), ...input });
      this.set(`settings:${session}`, next);
      return next;
    });
  }

  get<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM kv WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : undefined;
  }
  set(key: string, value: unknown): void { this.db.prepare('INSERT OR REPLACE INTO kv VALUES (?,?)').run(key, JSON.stringify(value)); }

  pendingAlerts(limit = 100): ThresholdEvent[] {
    return this.db.prepare('SELECT data FROM alert_outbox WHERE acked=0 ORDER BY at,id LIMIT ?').all(Math.max(1, Math.min(100, Math.trunc(limit)))).map(row => JSON.parse(row.data));
  }
  unclaimedAlerts(): ThresholdEvent[] {
    return this.db.prepare("SELECT a.data FROM alert_outbox a LEFT JOIN kv k ON k.key='delivery:'||a.id WHERE k.key IS NULL ORDER BY a.at,a.id LIMIT 100").all().map(row => JSON.parse(row.data)).filter(event => event.delivery === 'recorded');
  }
  acknowledgeAlerts(ids: string[]): void { this.atomic(() => { for (const id of ids) this.db.prepare('UPDATE alert_outbox SET acked=1 WHERE id=?').run(id); }); }
  updateAlert(id: string, detail: Partial<Pick<ThresholdEvent, 'title' | 'delivery'>>): void {
    this.atomic(() => {
      const row = this.db.prepare('SELECT data FROM alert_outbox WHERE id=?').get(id);
      if (row) this.db.prepare('UPDATE alert_outbox SET acked=0,data=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(row.data), ...detail, title: detail.title?.slice(0, 200) ?? JSON.parse(row.data).title }), id);
    });
  }
  claimAlertDelivery(id: string): boolean {
    return this.atomic(() => {
      if (this.get(`delivery:${id}`)) return false;
      this.set(`delivery:${id}`, 'attempted'); this.updateAlert(id, { delivery: 'attempted' }); return true;
    });
  }

  steps(session: string, query: StepQuery = {}): { items: Step[]; next: number | null } {
    const limit = Math.max(1, Math.min(200, Math.trunc(query.limit ?? 100)));
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));
    const last = query.maxTurn ?? this.snapshot(session)?.turn?.number ?? 0;
    const first = query.scope === 'current' ? last : query.scope === 'recent' ? Math.max(1, last - (query.lookback ?? this.settings(session).lookback) + 1) : 0;
    const order = query.sort === 'growth' ? 'growth DESC,turn_number,number' : 'turn_number,number';
    const rows = this.db.prepare(`SELECT data FROM steps WHERE session=? AND turn_number>=? AND turn_number<=? ORDER BY ${order} LIMIT ? OFFSET ?`).all(session, first, last, limit + 1, offset);
    return { items: rows.slice(0, limit).map(row => JSON.parse(row.data)), next: rows.length > limit ? offset + limit : null };
  }

  turns(session: string, limit = 5): Turn[] {
    return this.db.prepare('SELECT data FROM turns WHERE session=? ORDER BY number DESC LIMIT ?').all(session, Math.max(1, Math.min(200, limit))).reverse().map(row => JSON.parse(row.data));
  }

  /** An assistant message can contain multiple physical attempts. Prefix range lookup keeps activity pages independent of total session history. */
  requestSteps(session: string, messageId: string): Step[] {
    return this.db.prepare('SELECT data FROM steps WHERE session=? AND (id=? OR (id>=? AND id<?)) ORDER BY number LIMIT 200').all(session, messageId, `${messageId}:`, `${messageId};`).map(row => JSON.parse(row.data));
  }

  /** Late usage cannot be replayed through an incremental reducer without corrupting intervening turns/EMAs. Preserve its original coverage gap and break the next occupancy comparison instead. */
  requestGap(session: string, messageId: string, reason: string): void {
    for (const step of this.requestSteps(session, messageId)) {
      if (!step.gaps.includes(reason) && step.gaps.length < 32) step.gaps.push(reason);
      step.quality = step.growth === null ? 'unavailable' : 'partial';
      this.db.prepare('UPDATE steps SET data=? WHERE session=? AND id=?').run(JSON.stringify(step), session, step.id);
    }
    const state = this.snapshot(session);
    if (state) { state.rebase = true; state.revision++; this.db.prepare('UPDATE sessions SET state=? WHERE id=?').run(JSON.stringify(state), session); }
  }

  /** Indexed keyset traversal is linear in exported rows; OFFSET would rescan all preceding pages. */
  stepBatch(session: string, after: [number, number] = [-1, -1]): Step[] {
    return this.db.prepare('SELECT data FROM steps WHERE session=? AND (turn_number,number)>(?,?) ORDER BY turn_number,number LIMIT 200').all(session, ...after).map(row => JSON.parse(row.data));
  }

  close(): void { this.db.close(); }
}
