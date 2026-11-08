import type { Config, Ema, Event, MetricRecord, Observation, State } from './types.js';
import { AlertPolicy } from './alerts.js';

export const defaults: Config = {
  span: 5, minSamples: 3, growthThreshold: 40, compactionThreshold: 0.30,
  liveGrowth: 80, liveCompactions: 2, minContextWindow: 32000, cooldownTurns: 5, rearmTurns: 2,
  rearmRatio: 0.8, warnings: true, lookback: 5, inputBudget: 12000, outputBudget: 3000,
};

export function configure(input: Partial<Config> = {}): Config {
  const config = { ...defaults, ...input };
  for (const [key, value] of Object.entries(config)) {
    if (key === 'warnings') {
      if (typeof value !== 'boolean') throw new Error('warnings must be boolean');
    } else if (typeof value !== 'number' || !Number.isFinite(value) || (key === 'minContextWindow' ? !Number.isSafeInteger(value) || value < 0 : value <= 0)) {
      throw new Error(`${key} must be a positive finite number`);
    }
  }
  for (const key of ['span', 'minSamples', 'cooldownTurns', 'rearmTurns', 'lookback', 'inputBudget', 'outputBudget'] as const) {
    if (!Number.isInteger(config[key])) throw new Error(`${key} must be an integer`);
  }
  if (config.rearmRatio >= 1) throw new Error('rearmRatio must be below 1');
  return config;
}

const emptyEma = (): Ema => ({ growth: null, compactions: null, growthSamples: 0, compactionSamples: 0 });
const metrics = (): MetricRecord => ({ growth: null, compactions: 0, quality: 'unavailable', gaps: [], provenance: { estimated: false, methods: [] } });

/** Incremental accounting is O(1) per observation. Persist the small state and changed records transactionally outside this host-independent class. */
export class Monitor {
  readonly config: Config;
  readonly state: State;

  constructor(config: Partial<Config> = {}, state?: State) {
    this.config = configure(config);
    this.state = state ?? {
      version: 1, turn: null, step: null, baseline: null, rebase: false, ema: emptyEma(), revision: 0, alerts: [],
      guards: {
        growth: { armed: true, lastTurn: -1000000, below: 0, recoveredTurn: 0 },
        compactions: { armed: true, lastTurn: -1000000, below: 0, recoveredTurn: 0 },
      },
    };
  }

  accept(event: Event): void {
    const s = this.state;
    s.revision++;
    // Only an explicit request step resumes execution. Delayed measurements/coverage/checkpoints correct a completed sample in place, retaining its original completion time.
    const completedAt = ['observe', 'gap', 'compact', 'evidence'].includes(event.type) ? s.turn?.ended : undefined;
    if (event.type === 'compact' && s.turn?.checkpoints.includes(event.checkpointId)) return;
    if (completedAt !== undefined) this.reopen();
    if (event.type === 'turn') {
      if (s.turn?.id === event.turnId) return;
      this.complete(event.at);
      s.turn = { ...metrics(), id: event.turnId, number: (s.turn?.number ?? 0) + 1, at: event.at, steps: 0, manual: 0, automatic: 0, checkpoints: [], interrupted: false, emaBefore: { ...s.ema } };
      s.step = null;
    } else if (event.type === 'step') {
      if (!s.turn || s.step?.id === event.stepId) return;
      this.reopen();
      s.step = { ...metrics(), id: event.stepId, turnId: s.turn.id, turnNumber: s.turn.number, number: ++s.turn.steps, at: event.at, model: event.model, capacity: event.capacity, evidence: [] };
    } else if (event.type === 'observe') {
      this.observe(event);
    } else if (event.type === 'gap') {
      this.gap(event.reason);
    } else if (event.type === 'compact') {
      if (!s.turn || s.turn.checkpoints.includes(event.checkpointId)) return;
      this.reopen();
      s.turn.checkpoints.push(event.checkpointId);
      s.turn.compactions++;
      if (s.step) s.step.compactions++;
      if (event.trigger === 'auto') s.turn.automatic++;
      if (event.trigger === 'manual') s.turn.manual++;
      if (!event.beforeKnown) this.gap('Pre-compaction occupancy unavailable; growth is a lower bound.');
      s.rebase = true;
    } else if (event.type === 'complete') {
      if (s.turn) s.turn.interrupted ||= event.interrupted ?? false;
      this.complete(event.at);
    } else if (event.type === 'attempt' && s.step) {
      s.step.attempt = event.attempt;
    } else if (event.type === 'evidence' && s.step) {
      // A pathological step must not make every subsequent state write grow without bound.
      if (s.step.evidence.length < 32) s.step.evidence.push({ ...event.evidence, label: event.evidence.label.slice(0, 200), excerpt: event.evidence.excerpt?.slice(0, 1000) });
      else this.gap('Additional tool evidence omitted from compact step metadata.');
    }
    if (completedAt !== undefined) this.complete(completedAt);
    const policy = new AlertPolicy(this.config, s.alerting);
    s.alerts = [...s.alerts, ...policy.accept(event, s)].slice(-20);
    s.alerting = policy.state;
    s.guards = { growth: { ...policy.state.guards.growth }, compactions: { ...policy.state.guards.compactions } };
  }

  private reopen(): void {
    const t = this.state.turn;
    if (t?.ended !== undefined) {
      // A Stop hook or idle transition can be followed by automatic continuation. Replace that turn's EMA contribution, never feed it twice.
      this.state.ema = { ...t.emaBefore };
      delete t.ended;
    }
  }

  private gap(reason: string): void {
    for (const record of [this.state.turn, this.state.step]) {
      if (!record) continue;
      if (record.gaps.length < 32 && !record.gaps.includes(reason)) record.gaps.push(reason);
      record.quality = record.growth === null ? 'unavailable' : 'partial';
    }
  }

  private observe(observation: Observation): void {
    const s = this.state;
    if (![observation.tokens, observation.capacity].every(Number.isFinite) || observation.tokens < 0 || observation.capacity <= 0) {
      this.gap('Invalid occupancy or context capacity.');
      return;
    }
    const previous = s.baseline;
    const comparable = previous && previous.capacity === observation.capacity && previous.model === observation.model && previous.method === observation.method;
    if (s.turn) {
      for (const record of [s.turn, s.step]) {
        if (!record) continue;
        // A legacy partial record cannot be retroactively certified as reported. Treat its lost provenance conservatively.
        const provenance = record.provenance ??= { estimated: record.quality !== 'reported', methods: ['legacy-unspecified'] };
        provenance.estimated ||= observation.quality === 'estimated' || (comparable && previous.quality === 'estimated') || false;
        if (provenance.methods.length < 32 && !provenance.methods.includes(observation.method)) provenance.methods.push(observation.method);
      }
      if (!s.rebase && comparable) {
        const growth = Math.max(0, observation.tokens - previous.tokens) / observation.capacity * 100;
        for (const record of [s.turn, s.step]) {
          if (!record) continue;
          record.growth = (record.growth ?? 0) + growth;
          record.quality = record.gaps.length ? 'partial' : record.provenance?.estimated ? 'estimated' : 'reported';
        }
      } else if (!s.rebase) {
        this.gap(previous ? 'Model, capacity or measurement method changed; baseline reset.' : 'First occupancy establishes baseline; earlier growth is unknown.');
      }
    }
    s.baseline = { tokens: observation.tokens, capacity: observation.capacity, model: observation.model, method: observation.method, quality: observation.quality };
    s.rebase = false;
  }

  private complete(at: number): void {
    const s = this.state, t = s.turn;
    if (!t || t.ended !== undefined) return;
    t.ended = at;
    const alpha = 2 / (this.config.span + 1);
    const next = (before: number | null, value: number) => before === null ? value : value * alpha + before * (1 - alpha);
    s.ema = { ...t.emaBefore };
    if (t.growth !== null) {
      s.ema.growth = next(s.ema.growth, t.growth);
      s.ema.growthSamples++;
    }
    s.ema.compactions = next(s.ema.compactions, t.compactions);
    s.ema.compactionSamples++;
  }

}
