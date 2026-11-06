import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { configure, Monitor } from '../core/monitor.js';
import type { Config, Event, State, Step, Turn } from '../core/types.js';

interface Statement {
  run(...values: any[]): unknown;
  get(...values: any[]): any;
  all(...values: any[]): any[];
}
interface Database { exec(sql: string): unknown; prepare(sql: string): Statement; close(): void }
export interface StepQuery { limit?: number; offset?: number; scope?: 'all' | 'current' | 'recent'; lookback?: number; sort?: 'time' | 'growth'; maxTurn?: number }

/** SQLite provides crash-safe transactions and indexed pagination across short-lived Codex processes and long-lived OpenCode plugins. */
export class Store {
  private depth = 0;
  private constructor(readonly db: Database, private readonly config: Partial<Config>, readonly path: string, readOnly = false) {
    if (readOnly) { db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000;'); return; }
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (session TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(session,id));
      CREATE TABLE IF NOT EXISTS turns (session TEXT NOT NULL, id TEXT NOT NULL, number INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(session,id));
      CREATE INDEX IF NOT EXISTS turns_order ON turns(session,number);
      CREATE TABLE IF NOT EXISTS steps (session TEXT NOT NULL, id TEXT NOT NULL, turn_number INTEGER NOT NULL, number INTEGER NOT NULL, growth REAL, data TEXT NOT NULL, PRIMARY KEY(session,id));
      CREATE INDEX IF NOT EXISTS steps_order ON steps(session,turn_number,number);
      CREATE INDEX IF NOT EXISTS steps_growth ON steps(session,growth DESC,turn_number,number);
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  }

  static async open(path: string, config: Partial<Config> = {}, readOnly = false): Promise<Store> {
    configure(config);
    if (path !== ':memory:' && !readOnly) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // OpenCode embeds Bun; the hook CLI uses Node. Both expose the same small synchronous SQLite subset, avoiding a native npm addon.
    const moduleName = typeof (globalThis as any).Bun === 'object' ? 'bun:sqlite' : 'node:sqlite';
    const sqlite = await import(moduleName);
    const db = moduleName === 'bun:sqlite' ? new sqlite.Database(path, readOnly ? { readonly: true } : { create: true }) : new sqlite.DatabaseSync(path, { readOnly });
    return new Store(db as Database, config, path, readOnly);
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
        // Save an automatically closed preceding turn before the reducer replaces its active record.
        if (event.type === 'turn' && monitor.state.turn && monitor.state.turn.id !== event.turnId) {
          monitor.accept({ type: 'complete', id: `${event.id}:previous`, at: event.at });
          this.saveRecords(session, monitor.state);
        }
        monitor.accept(event);
        this.saveRecords(session, monitor.state);
        this.db.prepare('INSERT INTO events VALUES (?,?)').run(session, event.id);
      }
      this.db.prepare('INSERT OR REPLACE INTO sessions VALUES (?,?)').run(session, JSON.stringify(monitor.state));
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
  settings(session: string): Config { return configure({ ...this.config, ...this.get<Partial<Config>>(`settings:${session}`) }); }
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

  /** Indexed keyset traversal is linear in exported rows; OFFSET would rescan all preceding pages. */
  stepBatch(session: string, after: [number, number] = [-1, -1]): Step[] {
    return this.db.prepare('SELECT data FROM steps WHERE session=? AND (turn_number,number)>(?,?) ORDER BY turn_number,number LIMIT 200').all(session, ...after).map(row => JSON.parse(row.data));
  }

  close(): void { this.db.close(); }
}
