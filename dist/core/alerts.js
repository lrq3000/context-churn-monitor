const emptyEma = () => ({ growth: null, compactions: null, growthSamples: 0, compactionSamples: 0 });
const guards = () => ({ growth: { armed: true, lastTurn: -1000000, below: 0, recoveredTurn: 0 }, compactions: { armed: true, lastTurn: -1000000, below: 0, recoveredTurn: 0 } });
const copyGuards = (value) => ({ growth: { ...value.growth }, compactions: { ...value.compactions } });
/** The same metrics over eligible turns, kept separate so small-model churn cannot poison notification averages or erase ordinary accounting. */
export class AlertPolicy {
    settings;
    state;
    constructor(settings, previous) {
        this.settings = settings;
        this.state = previous?.minimum === settings.minContextWindow ? previous : { minimum: settings.minContextWindow, count: 0, ema: emptyEma(), guards: guards(), skipTurn: previous?.current?.id };
    }
    accept(event, metrics) {
        const s = this.state, source = metrics.turn, c = this.settings;
        if (!source)
            return [];
        if (s.current?.id !== source.id) {
            if (s.current && !s.current.ended)
                this.complete();
            s.current = { id: source.id, number: source.number, growth: source.growth, compactions: source.compactions, quality: source.quality, gaps: [], eligible: s.skipTurn !== source.id, hasModel: c.minContextWindow === 0, ended: false, before: { ...s.ema }, countBefore: s.count };
        }
        const t = s.current;
        // Completed samples can be corrected/reopened. Undo only their average/recovery contribution, never a warning already issued.
        if (t.ended && (source.ended === undefined || ['observe', 'gap', 'compact', 'evidence'].includes(event.type)))
            this.reopen();
        if (event.type === 'step') {
            t.hasModel = true;
            t.model = event.model;
            t.capacity = event.capacity;
            t.eligible &&= c.minContextWindow === 0 || (typeof event.capacity === 'number' && Number.isFinite(event.capacity) && event.capacity >= c.minContextWindow);
        }
        t.growth = source.growth;
        t.compactions = source.compactions;
        t.quality = source.quality;
        if (source.ended !== undefined && !t.ended)
            this.complete();
        if (!t.eligible || !t.hasModel) {
            t.hits = [];
            return [];
        }
        const hits = this.thresholds();
        t.hits ??= [];
        for (const hit of hits) {
            // A live turn still sees the previous completed EMA for notification compatibility, not as evidence about its own outcome.
            if (hit.kind === 'ema' && !t.ended)
                continue;
            if (!t.hits.some(old => old.metric === hit.metric && old.kind === hit.kind))
                t.hits.push(hit);
        }
        if (!c.warnings)
            return [];
        const result = [], index = t.countBefore + 1;
        for (const metric of ['growth', 'compactions']) {
            const guard = s.guards[metric];
            if (!guard.armed || index - guard.lastTurn < c.cooldownTurns)
                continue;
            // Live hits precede EMA hits, preserving the notification policy's existing priority.
            const hit = hits.find(hit => hit.metric === metric);
            if (!hit)
                continue;
            result.push({ ...hit, id: `${t.id}:${metric}`, turn: t.number, model: t.model, capacity: t.capacity, at: event.at });
            guard.armed = false;
            guard.lastTurn = index;
            guard.below = 0;
        }
        return result;
    }
    /** Evaluate once for both marks and delivery; only delivery observes warnings/cooldown/rearm guards. */
    thresholds() {
        const s = this.state, t = s.current, c = this.settings, hits = [];
        for (const metric of ['growth', 'compactions']) {
            const live = t[metric], average = s.ema[metric];
            const liveThreshold = metric === 'growth' ? c.liveGrowth : c.liveCompactions;
            const threshold = metric === 'growth' ? c.growthThreshold : c.compactionThreshold;
            const samples = metric === 'growth' ? s.ema.growthSamples : s.ema.compactionSamples;
            if (live !== null && live >= liveThreshold)
                hits.push({ metric, kind: 'live', value: live, threshold: liveThreshold });
            if (samples >= c.minSamples && average !== null && average >= threshold)
                hits.push({ metric, kind: 'ema', value: average, threshold });
        }
        return hits;
    }
    reopen() {
        const s = this.state, t = s.current;
        s.ema = { ...t.before };
        s.count = t.countBefore;
        t.ended = false;
        if (t.recoveryBefore)
            for (const metric of ['growth', 'compactions']) {
                const before = t.recoveryBefore[metric], current = s.guards[metric];
                if (current.lastTurn === before.lastTurn)
                    s.guards[metric] = { ...before };
                else
                    current.recoveredTurn = before.recoveredTurn;
            }
    }
    complete() {
        const s = this.state, t = s.current, c = this.settings;
        t.ended = true;
        if (!t.eligible || !t.hasModel)
            return;
        const index = t.countBefore + 1, alpha = 2 / (c.span + 1);
        s.ema = { ...t.before };
        s.count = index;
        t.recoveryBefore = copyGuards(s.guards);
        for (const metric of ['growth', 'compactions']) {
            const value = t[metric], samples = metric === 'growth' ? 'growthSamples' : 'compactionSamples';
            if (value !== null) {
                s.ema[metric] = s.ema[metric] === null ? value : value * alpha + s.ema[metric] * (1 - alpha);
                s.ema[samples]++;
            }
            const guard = s.guards[metric];
            if (guard.recoveredTurn === index)
                continue;
            guard.recoveredTurn = index;
            const reliable = metric === 'compactions' || t.quality === 'reported' || t.quality === 'estimated';
            const threshold = metric === 'growth' ? c.growthThreshold : c.compactionThreshold;
            guard.below = reliable && s.ema[metric] !== null && s.ema[metric] < threshold * c.rearmRatio ? guard.below + 1 : 0;
            if (guard.below >= c.rearmTurns)
                guard.armed = true;
        }
    }
}
