import type { Store } from '../../storage/store.js';
import type { Event, Attempt } from '../../core/types.js';
import { OpenCodeActivity } from './activity.js';

/** OpenCode normalizes cache categories separately. Cached input still occupies the context window. */
export const promptTokens = (usage: any): number | null => {
  const counts = [usage?.input, usage?.cache?.read, usage?.cache?.write];
  if (!counts.every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0)) return null;
  const sum = counts.reduce((a, b) => a + b, 0);
  // The native host substitutes all-zero counters when the provider omits usage. Without a presence flag, zero input is ambiguous and must never replace a reported baseline.
  return sum > 0 ? sum : null;
};

export class OpenCodeAdapter {
  private attempts = new Map<string, Attempt[]>();
  private activity: OpenCodeActivity;
  constructor(readonly store: Store) {
    this.activity = new OpenCodeActivity(store);
    // A new location-scoped adapter cannot recover live-only fragments from its predecessor. Retain the text, but never leave a permanent spinner.
    store.atomic(() => { for (const session of store.sessions()) store.activities.interrupt(session, Date.now(), 'Monitoring restarted; intervening live events were not captured.'); });
  }

  /** Native hooks see physical requests; durable step events see logical messages. Reconcile at step completion so every failed retry is retained without reusing its eventual success usage. */
  attempt(session: string, transport: Attempt['transport']): Attempt {
    const attempt: Attempt = { transport, at: Date.now() };
    const key = this.requestKey(session);
    const pending = this.attempts.get(key) ?? [];
    pending.push(attempt); this.attempts.set(key, pending);
    return attempt;
  }

  /** Hooks supply a labelled fallback only; admission is counted from durable inbox delivery, never from the mutable prompt hook. */
  request(session: string, request: unknown): void {
    const text = JSON.stringify(request);
    this.store.set(`estimate:${this.requestKey(session)}`, Math.ceil(Buffer.byteLength(text, 'utf8') / 4));
  }

  private requestKey(session: string): string {
    return `${session}:${this.store.get<string>(`active-request:${session}`) ?? 'pending'}`;
  }

  event(event: { type: string; id: string; created: number; data: any }, capacity?: number): void {
    const d = event.data, session = d?.sessionID;
    if (typeof session !== 'string' || !event.id) return;
    this.store.atomic(() => {
      if (this.store.get(`seen:opencode:${event.id}`)) return;
      const events: Event[] = [];
      const emit = (value: any) => events.push({ id: `${event.id}:${events.length}`, at: event.created, ...value });
      switch (event.type) {
        case 'session.inbox.enqueued':
          this.store.set(`inbox:${session}:${d.inboxID}`, d.item?.type);
          break;
        case 'session.inbox.delivered': {
          const kind = this.store.get(`inbox:${session}:${d.inboxID}`);
          this.store.set(`admission:${session}`, kind ?? 'unknown');
          if (kind === 'user') emit({ type: 'turn', turnId: d.inboxID });
          else if (kind === undefined) emit({ type: 'gap', reason: 'Inbox type unavailable; delivered input could not be classified.' });
          break;
        }
        case 'session.step.started': {
          if (this.store.get(`request:${session}:${d.assistantMessageID}`)) break;
          if (!this.store.snapshot(session)?.turn) {
            if (this.store.get(`admission:${session}`) === 'synthetic') break;
            // Installation in the middle of a session must not pretend to have observed its original user interaction.
            emit({ type: 'turn', turnId: `unattributed:${d.assistantMessageID}` });
            emit({ type: 'gap', reason: 'Monitoring began mid-turn; the user boundary is unattributed.' });
          }
          emit({ type: 'step', stepId: d.assistantMessageID, model: `${d.model.providerID}/${d.model.id}` });
          this.store.set(`model:${session}`, { ref: d.model, capacity: capacity ?? null });
          this.store.set(`request:${session}:${d.assistantMessageID}`, { ref: d.model, capacity: capacity ?? null });
          this.store.set(`active-request:${session}`, d.assistantMessageID);
          // Hooks have only session identity in SDK 2.2.5. Bind their state at capture time, never to whichever request receives a delayed terminal event.
          const pendingKey = `${session}:pending`, key = this.requestKey(session);
          if (this.attempts.has(pendingKey)) { this.attempts.set(key, this.attempts.get(pendingKey)!); this.attempts.delete(pendingKey); }
          const estimate = this.store.get<number>(`estimate:${pendingKey}`);
          if (estimate != null) { this.store.set(`estimate:${key}`, estimate); this.store.set(`estimate:${pendingKey}`, null); }
          break;
        }
        case 'session.step.ended':
        case 'session.step.failed': {
          const key = `${session}:${d.assistantMessageID}`;
          if (this.store.get(`request-ended:${key}`)) break;
          const model = this.store.get<{ ref: { providerID: string; id: string }; capacity: number }>(`request:${key}`);
          const attempts = this.attempts.get(key) ?? [];
          this.attempts.delete(key);
          const estimate = this.store.get<number>(`estimate:${key}`);
          const state = this.store.snapshot(session);
          if (state?.step?.id !== d.assistantMessageID) {
            const origin = this.store.requestSteps(session, d.assistantMessageID)[0];
            if (origin) {
              const reason = 'Late/out-of-order request result retained as evidence; historical growth was not recomputed.';
              this.store.requestGap(session, d.assistantMessageID, reason);
              const row = this.store.activities.update(session, { id: `request-result:${d.assistantMessageID}`, messageId: d.assistantMessageID, turnId: origin.turnId, turnNumber: origin.turnNumber, at: event.created, kind: 'system', label: 'Late request result', title: reason, detail: reason, status: event.type === 'session.step.failed' ? 'failed' : 'completed' });
              this.store.activities.write(session, row.id, 'metadata', JSON.stringify({ model, tokens: d.tokens, estimate, attempts, error: d.error }, null, 2));
            }
            this.store.set(`request-ended:${key}`, true);
            break;
          }
          for (const [index, attempt] of attempts.entries()) {
            if (index) emit({ type: 'step', stepId: `${d.assistantMessageID}:attempt:${index + 1}`, model: `${model?.ref.providerID}/${model?.ref.id}` });
            emit({ type: 'attempt', attempt: { ...attempt, outcome: index === attempts.length - 1 && event.type === 'session.step.ended' ? 'succeeded' : 'failed' } });
            if (index < attempts.length - 1) emit({ type: 'gap', reason: 'Physical request failed or fell back before the final response; occupancy unavailable for this attempt.' });
          }
          const reported = promptTokens(d.tokens);
          if (reported === null) emit({ type: 'gap', reason: 'Reported request occupancy unavailable (missing or ambiguous zero usage); any fallback is estimated.' });
          const tokens = reported ?? estimate;
          if (tokens !== undefined && tokens !== null && (capacity ?? model?.capacity)) {
            emit({ type: 'observe', tokens, capacity: capacity ?? model!.capacity, model: `${model?.ref.providerID}/${model?.ref.id}`, method: reported !== null ? 'opencode-normalized-input' : 'json-utf8-div4', quality: reported !== null ? 'reported' : 'estimated' });
          } else emit({ type: 'gap', reason: 'Request usage or model context capacity unavailable.' });
          this.store.set(`request-ended:${key}`, true);
          if (this.store.get(`active-request:${session}`) === d.assistantMessageID) this.store.set(`active-request:${session}`, null);
          break;
        }
        case 'session.compaction.ended':
          emit({ type: 'compact', checkpointId: event.id, trigger: d.reason, beforeKnown: false });
          break;
        case 'session.tool.input.started':
          this.store.set(`tool:${session}:${d.id}`, d.name);
          break;
        case 'session.tool.success':
        case 'session.tool.failed': {
          // Replay storage retains the complete host-visible output, independently of request accounting.
          break;
        }
        case 'session.execution.succeeded':
        case 'session.execution.failed':
        case 'session.execution.interrupted':
          emit({ type: 'gap', reason: 'Final retained output has no subsequent request occupancy yet; growth is a lower bound.' });
          emit({ type: 'complete', interrupted: event.type !== 'session.execution.succeeded' });
          break;
      }
      if (events.length) this.store.ingest(session, events);
      this.activity.event(event);
      this.store.set(`seen:opencode:${event.id}`, true);
    });
  }
}
