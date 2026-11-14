/** Indexed metadata keeps polling bounded. Append-only body chunks avoid rewriting an ever-growing reasoning/tool stream for every token. */
export class ActivityStore {
    db;
    snapshot;
    constructor(db, snapshot, readOnly = false) {
        this.db = db;
        this.snapshot = snapshot;
        if (readOnly)
            return;
        db.exec(`CREATE TABLE IF NOT EXISTS activities (seq INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL, id TEXT NOT NULL, turn_number INTEGER NOT NULL, message TEXT, kind TEXT NOT NULL, status TEXT NOT NULL, search TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(session,id));
      CREATE INDEX IF NOT EXISTS activities_order ON activities(session,seq);
      CREATE INDEX IF NOT EXISTS activities_turn ON activities(session,turn_number,seq);
      CREATE INDEX IF NOT EXISTS activities_message ON activities(session,message,seq);
      CREATE TABLE IF NOT EXISTS activity_channels (session TEXT NOT NULL,id TEXT NOT NULL,channel TEXT NOT NULL,total INTEGER NOT NULL,PRIMARY KEY(session,id,channel));
      CREATE TABLE IF NOT EXISTS activity_chunks (session TEXT NOT NULL,id TEXT NOT NULL,channel TEXT NOT NULL,start INTEGER NOT NULL,size INTEGER NOT NULL,text TEXT NOT NULL,PRIMARY KEY(session,id,channel,start));`);
    }
    get(session, id) {
        const row = this.db.prepare('SELECT seq,data FROM activities WHERE session=? AND id=?').get(session, id);
        return row ? { ...JSON.parse(row.data), order: row.seq } : undefined;
    }
    update(session, activity) {
        const old = this.get(session, activity.id);
        // First observation owns position and provenance, even when a result arrives during another turn.
        const next = { ...old, ...activity, at: old?.at ?? activity.at, turnId: old?.turnId ?? activity.turnId, turnNumber: old?.turnNumber ?? activity.turnNumber };
        const search = [next.label, next.title, next.tool, next.preview, next.callId].filter(Boolean).join(' ');
        this.db.prepare(`INSERT INTO activities(session,id,turn_number,message,kind,status,search,data) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(session,id) DO UPDATE SET status=excluded.status,search=excluded.search,data=excluded.data`).run(session, next.id, next.turnNumber, next.messageId ?? null, next.kind, next.status, search, JSON.stringify(next));
        const state = this.snapshot(session);
        if (state) {
            state.revision++;
            this.db.prepare('UPDATE sessions SET state=? WHERE id=?').run(JSON.stringify(state), session);
        }
        return this.get(session, next.id);
    }
    write(session, id, channel, text, append = false) {
        if (!append) {
            this.db.prepare('DELETE FROM activity_chunks WHERE session=? AND id=? AND channel=?').run(session, id, channel);
            this.db.prepare('DELETE FROM activity_channels WHERE session=? AND id=? AND channel=?').run(session, id, channel);
        }
        let start = this.db.prepare('SELECT total FROM activity_channels WHERE session=? AND id=? AND channel=?').get(session, id, channel)?.total ?? 0;
        // Bound canonical values as well as deltas. Code-point iteration retains NUL and astral characters without allocating an array for the entire body.
        const insert = this.db.prepare('INSERT INTO activity_chunks VALUES(?,?,?,?,?,?)');
        let chunk = '', size = 0;
        const flush = () => { if (size)
            insert.run(session, id, channel, start, size, chunk); start += size; chunk = ''; size = 0; };
        for (const point of text) {
            chunk += point;
            if (++size === 16000)
                flush();
        }
        flush();
        this.db.prepare('INSERT OR REPLACE INTO activity_channels VALUES(?,?,?,?)').run(session, id, channel, start);
    }
    channels(session, id) {
        return this.db.prepare('SELECT channel,total FROM activity_channels WHERE session=? AND id=? ORDER BY channel').all(session, id);
    }
    detail(session, id, channel, offset = 0, limit = 16000) {
        if (!this.get(session, id))
            throw new Error('Activity not found in this session');
        if (!['input', 'output', 'progress', 'error', 'metadata'].includes(channel))
            throw new Error('Invalid activity channel');
        offset = Math.max(0, Math.trunc(offset));
        limit = Math.max(1, Math.min(32000, Math.trunc(limit)));
        const total = this.db.prepare('SELECT total FROM activity_channels WHERE session=? AND id=? AND channel=?').get(session, id, channel)?.total ?? 0;
        const end = Math.min(total, offset + limit);
        // Indexed bounded chunks make sequential paging linear. Decode/slice in JavaScript: SQLite TEXT substr stops at embedded NUL.
        const first = this.db.prepare('SELECT start FROM activity_chunks WHERE session=? AND id=? AND channel=? AND start<=? ORDER BY start DESC LIMIT 1').get(session, id, channel, offset)?.start ?? offset;
        const rows = this.db.prepare(`SELECT start,text FROM activity_chunks
      WHERE session=? AND id=? AND channel=? AND start>=? AND start<? ORDER BY start`).all(session, id, channel, first, end);
        return { text: rows.map(row => Array.from(row.text).slice(Math.max(0, offset - row.start), end - row.start).join('')).join(''), offset, next: end < total ? end : null, total };
    }
    list(session, query = {}) {
        const limit = Math.max(1, Math.min(200, Math.trunc(query.limit ?? 100)));
        const offset = Math.max(0, Math.trunc(query.offset ?? 0));
        const last = query.maxTurn ?? this.snapshot(session)?.turn?.number ?? 0;
        const first = query.scope === 'current' ? last : query.scope === 'recent' ? Math.max(0, last - (query.lookback ?? 5) + 1) : 0;
        const conditions = ['session=?', 'turn_number>=?', 'turn_number<=?'], values = [session, first, last];
        if (query.after !== undefined) {
            conditions.push('seq>?');
            values.push(query.after);
        }
        if (query.kind && query.kind !== 'all') {
            conditions.push(query.kind === 'tools' ? "kind IN ('tool','shell','skill')" : 'kind=?');
            if (query.kind !== 'tools')
                values.push(query.kind);
        }
        if (query.q) {
            conditions.push('instr(lower(search),lower(?))>0');
            values.push(query.q.slice(0, 500));
        }
        if (query.messageId) {
            conditions.push('message=?');
            values.push(query.messageId);
        }
        const rows = this.db.prepare(`SELECT seq,data FROM activities WHERE ${conditions.join(' AND ')} ORDER BY seq LIMIT ? OFFSET ?`).all(...values, limit + 1, offset);
        return { items: rows.slice(0, limit).map(row => ({ ...JSON.parse(row.data), order: row.seq })), next: rows.length > limit ? offset + limit : null };
    }
    interrupt(session, at, reason) {
        const rows = this.db.prepare("SELECT data FROM activities WHERE session=? AND status IN ('running','streaming')").all(session);
        for (const row of rows)
            this.update(session, { ...JSON.parse(row.data), status: 'interrupted', ended: at, detail: reason });
    }
}
