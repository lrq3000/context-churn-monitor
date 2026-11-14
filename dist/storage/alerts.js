import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { configure, defaults } from '../core/monitor.js';
import { openDatabase } from './database.js';
import { BackendRegistry } from './backend-registry.js';
export const alertSource = (path, directory) => {
    const absolute = resolve(path), identity = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
    return { id: createHash('sha256').update(identity).digest('hex'), directory, path: absolute };
};
export const alertsPath = () => process.env.CONTEXT_MONITOR_ALERTS_PATH ?? join(homedir(), '.local', 'share', 'context-churn-monitor', 'alerts.sqlite');
const keys = ['liveGrowth', 'liveCompactions', 'growthThreshold', 'compactionThreshold', 'minContextWindow'];
const selectSettings = (value) => Object.fromEntries(keys.map(key => [key, value[key]]));
const rank = { recorded: 0, attempted: 1, 'host-accepted': 2, unconfirmed: 2, unavailable: 2 };
/** A single user-wide WAL database bounds retained events, not merely the currently rendered page. */
export class AlertHistory {
    db;
    backends;
    constructor(db) {
        this.db = db;
        db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS alert_settings (id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS threshold_events (id TEXT PRIMARY KEY,at INTEGER NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS threshold_events_order ON threshold_events(at DESC,id DESC);
      CREATE TABLE IF NOT EXISTS alert_sources (id TEXT PRIMARY KEY,directory TEXT NOT NULL,path TEXT NOT NULL);`);
        this.backends = new BackendRegistry(db);
    }
    static async open(path = alertsPath()) { return new AlertHistory(await openDatabase(path)); }
    settings() {
        const saved = this.db.prepare('SELECT data FROM alert_settings WHERE id=1').get();
        return selectSettings(configure({ ...selectSettings(defaults), ...(saved ? JSON.parse(saved.data) : {}) }));
    }
    setSettings(input) {
        if (!input || typeof input !== 'object' || Object.keys(input).some(key => !keys.includes(key)))
            throw new Error('Invalid global alert settings');
        return this.atomic(() => {
            const next = selectSettings(configure({ ...this.settings(), ...input }));
            this.db.prepare('INSERT OR REPLACE INTO alert_settings VALUES(1,?)').run(JSON.stringify(next));
            return next;
        });
    }
    registerSource(source) {
        if (!isAbsolute(source.path) || !source.directory || source.id !== alertSource(source.path, source.directory).id)
            throw new Error('Invalid alert source');
        this.db.prepare('INSERT INTO alert_sources VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET directory=excluded.directory,path=excluded.path').run(source.id, source.directory, source.path);
    }
    sources(after = '') { return this.db.prepare('SELECT id,directory,path FROM alert_sources WHERE id>? ORDER BY id LIMIT 20').all(after); }
    insert(events) {
        this.atomic(() => {
            for (const event of events) {
                if (!event.id || !event.sessionId || !event.directory || !Number.isFinite(event.at) || !Number.isFinite(event.value) || !Number.isFinite(event.threshold) || !(event.delivery in rank))
                    throw new Error('Invalid threshold event');
                const bounded = { ...event, title: event.title?.slice(0, 200), model: event.model?.slice(0, 500) };
                const old = this.db.prepare('SELECT data FROM threshold_events WHERE id=?').get(event.id);
                const previous = old && JSON.parse(old.data);
                const next = previous ? { ...previous, title: bounded.title ?? previous.title, delivery: rank[bounded.delivery] > rank[previous.delivery] ? bounded.delivery : previous.delivery } : bounded;
                this.db.prepare('INSERT INTO threshold_events VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(next.id, next.at, JSON.stringify(next));
            }
            this.db.exec('DELETE FROM threshold_events WHERE id NOT IN (SELECT id FROM threshold_events ORDER BY at DESC,id DESC LIMIT 100)');
        });
    }
    update(id, detail) {
        this.atomic(() => {
            const row = this.db.prepare('SELECT data FROM threshold_events WHERE id=?').get(id);
            if (!row)
                return; // Enrichment must never resurrect an event evicted by the global cap.
            const event = JSON.parse(row.data);
            if (detail.title !== undefined)
                event.title = detail.title.slice(0, 200);
            if (detail.delivery && rank[detail.delivery] > rank[event.delivery])
                event.delivery = detail.delivery;
            this.db.prepare('UPDATE threshold_events SET data=? WHERE id=?').run(JSON.stringify(event), id);
        });
    }
    contains(id) { return Boolean(this.db.prepare('SELECT 1 FROM threshold_events WHERE id=?').get(id)); }
    list(limit = 100) {
        return this.db.prepare('SELECT data FROM threshold_events ORDER BY at DESC,id DESC LIMIT ?').all(Math.max(1, Math.min(100, Math.trunc(limit)))).map(row => JSON.parse(row.data));
    }
    atomic(operation) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const value = operation();
            this.db.exec('COMMIT');
            return value;
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    close() { this.db.close(); }
}
