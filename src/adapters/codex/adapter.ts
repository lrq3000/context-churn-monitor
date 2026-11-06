import type { Store } from '../../storage/store.js';
import type { Event } from '../../core/types.js';

export interface CodexOptions { modelWindows?: Record<string, number> }

export class CodexAdapter {
  constructor(readonly store: Store, readonly options: CodexOptions) {}

  /** Modern Codex hooks have no guaranteed request/event ID. The runner assigns an invocation ID; caller-provided IDs allow exact replay deduplication. */
  event(input: Record<string, any>, identity: string): string {
    if (typeof input.session_id !== 'string' || typeof input.hook_event_name !== 'string') throw new Error('Invalid Codex hook envelope');
    const session = input.agent_id ? `${input.session_id}:child:${input.agent_id}` : input.session_id;
    this.store.atomic(() => {
      if (this.store.get(`seen:codex:${session}:${identity}`)) return;
      const events: Event[] = [];
      const emit = (value: any) => events.push({ id: `${identity}:${events.length}`, at: Date.now(), ...value });
      const current = this.store.snapshot(session);
      const turnId = typeof input.turn_id === 'string' ? input.turn_id : current?.turn?.id;
      switch (input.hook_event_name) {
        case 'UserPromptSubmit':
          // Submission can still be blocked by another hook. Wait until model dispatch to commit a turn.
          this.store.set(`pending:${session}`, turnId ?? identity);
          break;
        case 'PreModelRequest':
          if (turnId && current?.turn?.id !== turnId) emit({ type: 'turn', turnId });
          else if (!current?.turn) {
            emit({ type: 'turn', turnId: this.store.get(`pending:${session}`) ?? `unattributed:${identity}` });
            if (!turnId) emit({ type: 'gap', reason: 'Codex did not supply a stable user turn ID.' });
          }
          emit({ type: 'step', stepId: identity, model: input.model });
          break;
        case 'PostModelRequest': {
          const model = typeof input.model === 'string' ? input.model : '';
          const tokens = input.token_usage?.input_tokens;
          const capacity = this.options.modelWindows?.[model];
          // Codex input_tokens includes its cached subset. Adding cached_input_tokens would double-count it.
          if (typeof tokens === 'number' && capacity) emit({ type: 'observe', tokens, capacity, model, method: 'codex-input-tokens', quality: 'reported' });
          else emit({ type: 'gap', reason: 'Codex usage or configured model window unavailable.' });
          break;
        }
        case 'PostCompact':
          emit({ type: 'compact', checkpointId: identity, trigger: input.trigger === 'auto' || input.trigger === 'manual' ? input.trigger : 'unknown', beforeKnown: false });
          break;
        case 'PostToolUse': {
          const text = typeof input.tool_response === 'string' ? input.tool_response : JSON.stringify(input.tool_response ?? null);
          emit({ type: 'evidence', evidence: { tool: String(input.tool_name ?? 'tool'), label: String(input.tool_name ?? 'tool'), visibleBytes: Buffer.byteLength(text), excerpt: text.slice(0, 1000) } });
          break;
        }
        case 'Stop':
        case 'SubagentStop':
        case 'Interrupt':
          emit({ type: 'gap', reason: 'Final retained output is not measured by Codex request hooks.' });
          emit({ type: 'complete', interrupted: input.hook_event_name === 'Interrupt' });
          break;
      }
      if (events.length) this.store.ingest(session, events);
      this.store.set(`seen:codex:${session}:${identity}`, true);
    });
    return session;
  }
}
