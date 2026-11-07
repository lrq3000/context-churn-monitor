import type { Store } from '../../storage/store.js';
import { excerpt, toolSummary, type Activity, type BodyChannel } from '../../core/activity.js';

export interface NativeEvent { type: string; id: string; created: number; data: any }

/** Native terminal values are authoritative; transient provider-native replay blobs are not visible reasoning and are never interpreted. */
export class OpenCodeActivity {
  constructor(private store: Store) {}

  private ignore(old: Activity | undefined, terminal: boolean): boolean {
    return !!old && (old.status === 'completed' || old.status === 'failed' || (old.status === 'interrupted' && !terminal));
  }

  private attachment(value: any) {
    return { type: value.type, mime: value.mime, name: value.name, uri: value.uri, source: value.source };
  }

  event(event: NativeEvent): void {
    const d = event.data, session = d.sessionID, type = event.type.replace('session.', '');
    const a = this.store.activities, state = this.store.snapshot(session);
    if (type === 'inbox.enqueued') {
      const item = d.item?.payload?.files ? { ...d.item, payload: { ...d.item.payload, files: d.item.payload.files.map((file: any) => this.attachment(file)) } } : d.item;
      this.store.set(`replay:inbox:${session}:${d.inboxID}`, item); return;
    }
    if (type === 'step.started' && state?.turn) {
      this.store.set(`replay:message:${session}:${d.assistantMessageID}`, { turnId: state.turn.id, turnNumber: state.turn.number });
      return;
    }
    if (!state?.turn) return;
    const origin = d.assistantMessageID ? this.store.get<{ turnId: string; turnNumber: number }>(`replay:message:${session}:${d.assistantMessageID}`) : undefined;
    const base = { turnId: origin?.turnId ?? state.turn.id, turnNumber: origin?.turnNumber ?? state.turn.number, messageId: d.assistantMessageID, at: event.created };
    const write = (row: Activity, channel: BodyChannel, text: string, append = false) => a.write(session, row.id, channel, text, append);
    const error = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value ?? {});
    if (/^(reasoning|text)\./.test(type)) {
      const reasoning = type.startsWith('reasoning.');
      const id = `${d.assistantMessageID}:${reasoning ? 'thinking' : 'text'}:${d.ordinal}`;
      const old = a.get(session, id);
      const ended = type.endsWith('.ended');
      if (this.ignore(old, ended)) return;
      const text = ended ? d.text : d.delta ?? '';
      const preview = ended ? excerpt(text) : excerpt((old?.preview ?? '') + text);
      const row = a.update(session, { ...base, ...old, id, kind: reasoning ? 'thinking' : 'text', label: reasoning ? 'Thinking' : 'Response', title: preview || (reasoning ? 'Thinking…' : 'Writing…'), preview, status: ended ? 'completed' : 'streaming', ...(ended ? { ended: event.created, detail: undefined } : {}) });
      if (text || ended) write(row, 'output', text, !ended);
      return;
    }
    if (type.startsWith('tool.')) {
      const id = `${d.assistantMessageID}:tool:${d.id}`, old = a.get(session, id);
      const terminal = type === 'tool.success' || type === 'tool.failed';
      if (this.ignore(old, terminal)) return;
      const tool = d.name ?? old?.tool ?? 'tool';
      let input: any;
      if (type === 'tool.called') input = d.input;
      if (type === 'tool.input.ended') { try { input = JSON.parse(d.text); } catch { /* Preserve incomplete/invalid JSON verbatim. */ } }
      const summary = input || d.metadata?.title ? toolSummary(tool, input, d.metadata?.title) : { label: old?.label ?? toolSummary(tool).label, title: old?.title ?? tool };
      const output = (d.content ?? []).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n');
      const row = a.update(session, { ...base, ...old, id, kind: 'tool', ...summary, tool, callId: d.id, status: terminal ? (type === 'tool.failed' ? 'failed' : 'completed') : type === 'tool.called' || type === 'tool.progress' ? 'running' : old?.status ?? 'streaming', ...(terminal ? { ended: event.created, detail: undefined, preview: excerpt(output || error(d.error)) } : {}) });
      if (type === 'tool.input.delta') write(row, 'input', d.delta, true);
      if (type === 'tool.input.ended') write(row, 'input', d.text);
      if (type === 'tool.called') write(row, 'input', JSON.stringify(d.input));
      if (terminal) {
        write(row, 'output', output);
        if (d.error) write(row, 'error', error(d.error));
      }
      // Progress is exposed evidence, not canonical output. Retain each update even when terminal metadata omits it.
      if (type === 'tool.progress' && typeof d.metadata?.output === 'string') {
        const previous = a.channels(session, row.id).some(channel => channel.channel === 'progress' && channel.total > 0);
        write(row, 'progress', (previous ? '\n' : '') + d.metadata.output, true);
      }
      if (d.metadata || terminal) write(row, 'metadata', JSON.stringify({ ...d.metadata, executed: d.executed, attachments: (d.content ?? []).filter((p: any) => p.type !== 'text').map((p: any) => this.attachment(p)) }, null, 2));
      return;
    }
    if (type.startsWith('compaction.')) {
      const key = `replay:compaction:${session}`;
      const id = type === 'compaction.started' ? `compaction:${event.id}` : this.store.get<string>(key) ?? `compaction:${event.id}`;
      const old = a.get(session, id), ended = type === 'compaction.ended', failed = type === 'compaction.failed';
      if (this.ignore(old, ended || failed)) return;
      if (type === 'compaction.started' || !old) this.store.set(key, id);
      const reason = d.reason ?? old?.reason ?? 'unknown';
      const row = a.update(session, { ...base, ...old, id, kind: 'compaction', label: 'Compacting context', title: `${reason === 'auto' ? 'Automatic' : reason === 'manual' ? 'Manual' : 'Unknown trigger'} · ${ended ? 'checkpoint applied' : failed ? 'failed' : 'in progress'}`, reason, status: ended ? 'completed' : failed ? 'failed' : 'running', ...(ended || failed ? { ended: event.created } : {}) });
      if (d.text !== undefined) write(row, 'output', d.text, type === 'compaction.delta');
      if (failed) write(row, 'error', error(d.error));
      return;
    }
    if (type === 'inbox.delivered') {
      const item: any = this.store.get(`replay:inbox:${session}:${d.inboxID}`);
      if (!item) return;
      const text = item.payload?.text ?? item.text ?? '';
      const row = a.update(session, { ...base, id: `input:${d.inboxID}`, kind: item.type === 'user' ? 'user' : 'system', label: item.type === 'user' ? 'User' : 'Continuation', title: excerpt(text) || 'Delivered input', status: 'completed' });
      write(row, 'input', typeof text === 'string' ? text : JSON.stringify(text));
      if (item.payload?.files?.length) write(row, 'metadata', JSON.stringify({ attachments: item.payload.files }, null, 2));
      return;
    }
    if (type.startsWith('execution.')) {
      if (type === 'execution.started') return;
      a.interrupt(session, event.created, type === 'execution.succeeded' ? 'No terminal event received before execution ended.' : `Execution ${type.split('.')[1]}${d.reason ? `: ${d.reason}` : ''}`);
      if (type === 'execution.succeeded') return;
    }
    const labels: Record<string, string> = { 'skill.activated': 'Load skill', 'retry.scheduled': 'Retry scheduled', 'synthetic': 'Continuation', 'instructions.updated': 'Instructions updated', 'agent.selected': 'Agent changed', 'model.selected': 'Model changed', 'moved': 'Location changed', 'execution.failed': 'Execution failed', 'execution.interrupted': 'Execution interrupted', 'revert.committed': 'Conversation reverted' };
    if (type.startsWith('shell.')) {
      const shell = d.shell ?? {}, id = `shell:${shell.id ?? event.id}`, old = a.get(session, id);
      const ended = type === 'shell.ended';
      if (this.ignore(old, ended)) return;
      const failed = shell.status === 'timeout' || shell.status === 'killed' || (typeof shell.exit === 'number' && shell.exit !== 0);
      const row = a.update(session, { ...base, ...old, id, kind: 'shell', label: 'Shell command', title: excerpt(shell.command), status: ended ? failed ? 'failed' : 'completed' : 'running', ...(ended ? { ended: event.created } : {}), detail: d.output?.truncated ? 'Host shell output truncated; only the exposed page was captured.' : undefined });
      write(row, 'input', shell.command ?? '');
      if (ended) { write(row, 'output', typeof d.output === 'string' ? d.output : d.output?.output ?? ''); write(row, 'metadata', JSON.stringify({ shell, output: d.output && { cursor: d.output.cursor, size: d.output.size, truncated: d.output.truncated } }, null, 2)); }
      return;
    }
    if (!labels[type]) return;
    const text = d.text ?? (d.error ? error(d.error) : JSON.stringify(d));
    const row = a.update(session, { ...base, id: event.id, kind: type === 'skill.activated' ? 'skill' : type === 'retry.scheduled' ? 'retry' : 'system', label: labels[type], title: excerpt(d.name ?? d.description ?? (type === 'retry.scheduled' ? `Attempt ${d.attempt}: ${error(d.error)}` : text)), status: type === 'execution.failed' ? 'failed' : type === 'execution.interrupted' ? 'interrupted' : 'completed' });
    write(row, d.error ? 'error' : 'output', text);
  }
}
