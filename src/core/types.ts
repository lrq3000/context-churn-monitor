export type Quality = 'reported' | 'estimated' | 'partial' | 'unavailable';
export type Trigger = 'auto' | 'manual' | 'unknown';
export interface Observation {
  tokens: number;
  capacity: number;
  model: string;
  /** Only observations produced by the same tokenizer/estimator can be differenced. */
  method: string;
  quality: 'reported' | 'estimated';
}
export type Event = { id: string; at: number } & (
  | { type: 'turn'; turnId: string }
  | { type: 'step'; stepId: string; model?: string }
  | ({ type: 'observe' } & Observation)
  | { type: 'compact'; checkpointId: string; trigger: Trigger; beforeKnown: boolean }
  | { type: 'complete'; interrupted?: boolean }
  | { type: 'gap'; reason: string }
  | { type: 'evidence'; evidence: Evidence }
  | { type: 'attempt'; attempt: Attempt }
);
export interface Attempt { transport: 'http' | 'websocket'; at: number; status?: number; outcome?: 'succeeded' | 'failed' }
export interface Evidence {
  tool: string;
  label: string;
  /** UTF-8 bytes of visible text, NOT token occupancy. No full tool-output retention by default. */
  visibleBytes?: number;
  excerpt?: string;
  messageId?: string;
}
export interface Ema {
  growth: number | null;
  compactions: number | null;
  growthSamples: number;
  compactionSamples: number;
}
export interface MetricRecord {
  growth: number | null;
  compactions: number;
  quality: Quality;
  gaps: string[];
  /** Coverage and measurement provenance are independent. Optional only for records written before provenance was retained. */
  provenance?: { estimated: boolean; methods: string[] };
}
export interface Step extends MetricRecord {
  id: string;
  turnId: string;
  turnNumber: number;
  number: number;
  at: number;
  model?: string;
  evidence: Evidence[];
  attempt?: Attempt;
}
export interface Turn extends MetricRecord {
  id: string;
  number: number;
  at: number;
  ended?: number;
  manual: number;
  automatic: number;
  steps: number;
  checkpoints: string[];
  interrupted: boolean;
  emaBefore: Ema;
  recoveryBefore?: Record<'growth' | 'compactions', Guard>;
}
export interface Alert { id: string; metric: 'growth' | 'compactions'; turn: number; value: number; kind: 'live' | 'ema'; at: number }
export interface Guard { armed: boolean; lastTurn: number; below: number; recoveredTurn: number }
export interface State {
  version: 1;
  turn: Turn | null;
  step: Step | null;
  baseline: Observation | null;
  rebase: boolean;
  ema: Ema;
  guards: Record<'growth' | 'compactions', Guard>;
  alerts: Alert[];
  revision: number;
}
export interface Config {
  span: number;
  minSamples: number;
  growthThreshold: number;
  compactionThreshold: number;
  liveGrowth: number;
  liveCompactions: number;
  cooldownTurns: number;
  rearmTurns: number;
  rearmRatio: number;
  warnings: boolean;
  lookback: number;
  inputBudget: number;
  outputBudget: number;
}
