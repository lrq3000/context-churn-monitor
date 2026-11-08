import type { Alert, Config, Ema, Event, Guard, MetricRecord, State } from './types.js';

export interface AlertSettings { liveGrowth: number; liveCompactions: number; growthThreshold: number; compactionThreshold: number; minContextWindow: number }
type Guards = Record<'growth' | 'compactions', Guard>;
interface AlertTurn extends MetricRecord {
  id: string; number: number; eligible: boolean; hasModel: boolean; ended: boolean;
  model?: string; capacity?: number; before: Ema; countBefore: number; recoveryBefore?: Guards;
}
export interface AlertPolicyState {
  minimum: number; count: number; ema: Ema; guards: Guards; current?: AlertTurn; skipTurn?: string;
}
const emptyEma = (): Ema => ({ growth: null, compactions: null, growthSamples: 0, compactionSamples: 0 });
const guards = (): Guards => ({ growth: { armed: true, lastTurn: -1000000, below: 0, recoveredTurn: 0 }, compactions: { armed: true, lastTurn: -1000000, below: 0, recoveredTurn: 0 } });
const copyGuards = (value: Guards): Guards => ({ growth: { ...value.growth }, compactions: { ...value.compactions } });

/** The same metrics over eligible turns, kept separate so small-model churn cannot poison notification averages or erase ordinary accounting. */
export class AlertPolicy {
  readonly state: AlertPolicyState;
  constructor(private settings: Config, previous?: AlertPolicyState) {
    this.state = previous?.minimum === settings.minContextWindow ? previous : { minimum: settings.minContextWindow, count: 0, ema: emptyEma(), guards: guards(), skipTurn: previous?.current?.id };
  }

  accept(event: Event, metrics: State): Alert[] {
    const s = this.state, source = metrics.turn, c = this.settings;
    if (!source) return [];
    if (s.current?.id !== source.id) {
      if (s.current && !s.current.ended) this.complete();
      s.current = { id: source.id, number: source.number, growth: source.growth, compactions: source.compactions, quality: source.quality, gaps: [], eligible: s.skipTurn !== source.id, hasModel: c.minContextWindow === 0, ended: false, before: { ...s.ema }, countBefore: s.count };
    }
    const t = s.current;
    // Completed samples can be corrected/reopened. Undo only their average/recovery contribution, never a warning already issued.
    if (t.ended && (source.ended === undefined || ['observe', 'gap', 'compact', 'evidence'].includes(event.type))) this.reopen();
    if (event.type === 'step') {
      t.hasModel = true; t.model = event.model; t.capacity = event.capacity;
      t.eligible &&= c.minContextWindow === 0 || (typeof event.capacity === 'number' && Number.isFinite(event.capacity) && event.capacity >= c.minContextWindow);
    }
    t.growth = source.growth; t.compactions = source.compactions; t.quality = source.quality;
    if (source.ended !== undefined && !t.ended) this.complete();
    if (!c.warnings || !t.eligible || !t.hasModel) return [];
    const result: Alert[] = [], index = t.countBefore + 1;
    for (const metric of ['growth', 'compactions'] as const) {
      const guard = s.guards[metric];
      if (!guard.armed || index - guard.lastTurn < c.cooldownTurns) continue;
      const average = s.ema[metric], live = t[metric];
      const threshold = metric === 'growth' ? c.growthThreshold : c.compactionThreshold;
      const liveThreshold = metric === 'growth' ? c.liveGrowth : c.liveCompactions;
      const samples = metric === 'growth' ? s.ema.growthSamples : s.ema.compactionSamples;
      const kind = live !== null && live >= liveThreshold ? 'live' : samples >= c.minSamples && average !== null && average >= threshold ? 'ema' : null;
      if (!kind) continue;
      result.push({ id: `${t.id}:${metric}`, metric, turn: t.number, value: (kind === 'live' ? live : average)!, threshold: kind === 'live' ? liveThreshold : threshold, model: t.model, capacity: t.capacity, kind, at: event.at });
      guard.armed = false; guard.lastTurn = index; guard.below = 0;
    }
    return result;
  }

  private reopen(): void {
    const s = this.state, t = s.current!;
    s.ema = { ...t.before }; s.count = t.countBefore; t.ended = false;
    if (t.recoveryBefore) for (const metric of ['growth', 'compactions'] as const) {
      const before = t.recoveryBefore[metric], current = s.guards[metric];
      if (current.lastTurn === before.lastTurn) s.guards[metric] = { ...before };
      else current.recoveredTurn = before.recoveredTurn;
    }
  }

  private complete(): void {
    const s = this.state, t = s.current!, c = this.settings;
    t.ended = true;
    if (!t.eligible || !t.hasModel) return;
    const index = t.countBefore + 1, alpha = 2 / (c.span + 1);
    s.ema = { ...t.before }; s.count = index; t.recoveryBefore = copyGuards(s.guards);
    for (const metric of ['growth', 'compactions'] as const) {
      const value = t[metric], samples = metric === 'growth' ? 'growthSamples' : 'compactionSamples';
      if (value !== null) { s.ema[metric] = s.ema[metric] === null ? value : value * alpha + s.ema[metric]! * (1 - alpha); s.ema[samples]++; }
      const guard = s.guards[metric];
      if (guard.recoveredTurn === index) continue;
      guard.recoveredTurn = index;
      const reliable = metric === 'compactions' || t.quality === 'reported' || t.quality === 'estimated';
      const threshold = metric === 'growth' ? c.growthThreshold : c.compactionThreshold;
      guard.below = reliable && s.ema[metric] !== null && s.ema[metric]! < threshold * c.rearmRatio ? guard.below + 1 : 0;
      if (guard.below >= c.rearmTurns) guard.armed = true;
    }
  }
}
