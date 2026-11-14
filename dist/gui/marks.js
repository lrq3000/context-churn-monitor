import { SERVICE_MARKS_MAX, SERVICE_MARK_RATE_MAX, SERVICE_MARK_TEXT_MAX } from '@openchamber/sdk';
import { Store } from '../storage/store.js';
/** Native marks outlive panels, not service processes. Rebuild from indexed metadata and never infer hits from notification delivery. */
export class SessionMarks {
    history;
    host;
    clock;
    published = new Map();
    uncertain = new Set();
    attempts = [];
    running;
    timer;
    started = false;
    stopped = false;
    failedSources = new Set();
    callbackFailed = false;
    constructor(history, host, clock = Date.now) {
        this.history = history;
        this.host = host;
        this.clock = clock;
    }
    start() {
        if (this.started || this.stopped)
            return;
        this.started = true;
        void this.poll();
    }
    async stop() {
        this.stopped = true;
        if (this.timer)
            clearTimeout(this.timer);
        await this.running;
    }
    refresh() {
        if (this.stopped)
            return Promise.resolve();
        return this.running ??= this.reconcile().finally(() => { this.running = undefined; });
    }
    async poll() {
        try {
            await this.refresh();
        }
        catch {
            console.warn('[context-monitor] Sidebar mark reconciliation unavailable; retrying on the next poll.');
        }
        finally {
            if (!this.stopped)
                this.timer = setTimeout(() => void this.poll(), 5000);
        }
    }
    async read() {
        const stores = [];
        let afterSource = '', candidates = new Map();
        try {
            for (;;) {
                const sources = this.history.sources(afterSource);
                if (!sources.length || this.stopped)
                    break;
                for (const source of sources) {
                    let store;
                    try {
                        store = await Store.open(source.path, {}, true);
                        store.marks(1); // Validate the projection read before accepting this source; legacy stores yield an empty page.
                        stores.push(store);
                        this.failedSources.delete(source.id);
                    }
                    catch {
                        store?.close();
                        if (!this.failedSources.has(source.id))
                            console.warn('[context-monitor] Sidebar marks could not read a registered store; its unverified marks will be removed.');
                        this.failedSources.add(source.id);
                    }
                }
                afterSource = sources.at(-1).id;
            }
            for (const store of stores) {
                let after;
                for (;;) {
                    if (this.stopped)
                        return [];
                    const page = store.marks(SERVICE_MARKS_MAX, after);
                    for (const record of page) {
                        let latest = record;
                        // Indexed point reads include clear/deletion evidence in other locations, without scanning every session or transcript.
                        for (const other of stores) {
                            const state = other.markState(record.sessionId);
                            if (state && (state.deleted || (!latest.deleted && (state.at > latest.at || (state.at === latest.at && (state.updated ?? state.at) > (latest.updated ?? latest.at))))))
                                latest = state;
                        }
                        if (!latest.deleted && latest.hits.length)
                            candidates.set(latest.sessionId, latest);
                        else
                            candidates.delete(record.sessionId);
                    }
                    // Keep at most two positive pages in memory. Cleared duplicates do not occupy the host's newest-200 selection.
                    candidates = new Map([...candidates.values()].sort(SessionMarks.newest).slice(0, SERVICE_MARKS_MAX).map(record => [record.sessionId, record]));
                    after = page.at(-1);
                    if (page.length < SERVICE_MARKS_MAX || (candidates.size === SERVICE_MARKS_MAX && after.at < [...candidates.values()].at(-1).at))
                        break;
                }
            }
            return [...candidates.values()].sort(SessionMarks.newest);
        }
        finally {
            for (const store of stores)
                store.close();
        }
    }
    static newest(a, b) { return b.at - a.at || a.sessionId.localeCompare(b.sessionId); }
    mark(record) {
        const number = (value) => Number(value.toFixed(2)).toString();
        const reasons = record.hits.map(hit => {
            const units = hit.metric === 'growth' ? hit.kind === 'live' ? ' pp' : ' pp/turn' : hit.kind === 'ema' ? '/turn' : '';
            return `${hit.metric} ${hit.kind === 'live' ? 'live' : 'EMA'} ${number(hit.value)} ≥ ${number(hit.threshold)}${units}`;
        });
        return { icon: 'pulse', tone: 'warning', text: `Turn ${record.turn}: ${reasons.join('; ')}`.slice(0, SERVICE_MARK_TEXT_MAX) };
    }
    async reconcile() {
        const desired = new Map((await this.read()).map(record => [record.sessionId, this.mark(record)]));
        const changes = [];
        // Clear before filling: a full host has no room for a replacement until the old target is removed.
        for (const session of new Set([...this.published.keys(), ...this.uncertain]))
            if (!desired.has(session))
                changes.push([session, null]);
        for (const [session, mark] of desired)
            if (this.uncertain.has(session) || this.published.get(session) !== JSON.stringify(mark))
                changes.push([session, mark]);
        for (const [sessionId, mark] of changes) {
            const now = this.clock();
            this.attempts = this.attempts.filter(at => now - at < 60000);
            if (this.stopped || this.attempts.length >= SERVICE_MARK_RATE_MAX)
                break;
            this.attempts.push(now); // Count uncertain/failed callbacks too; a lost answer does not prove the host did not spend quota.
            this.uncertain.add(sessionId); // The callback may apply before its reply is lost, including the first set for a target.
            try {
                await this.host.setMark({ sessionId }, mark);
                if (mark)
                    this.published.set(sessionId, JSON.stringify(mark));
                else
                    this.published.delete(sessionId);
                this.uncertain.delete(sessionId);
                this.callbackFailed = false;
            }
            catch {
                if (!this.callbackFailed)
                    console.warn('[context-monitor] Sidebar mark callback unavailable; retrying later.');
                this.callbackFailed = true;
                break; // Coalesce changes from fresh storage on the next poll instead of replaying a stale queue or flooding a failed host.
            }
        }
    }
}
