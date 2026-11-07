/** Activity identity/order is independent of model attempts and their occupancy measurements. Bodies are deliberately absent from this lightweight record. */
export type ActivityKind = 'user' | 'thinking' | 'text' | 'tool' | 'compaction' | 'skill' | 'shell' | 'retry' | 'system';
export type ActivityStatus = 'streaming' | 'running' | 'completed' | 'failed' | 'interrupted';
export type BodyChannel = 'input' | 'output' | 'progress' | 'error' | 'metadata';
export interface Activity {
  id: string;
  order?: number;
  turnId: string;
  turnNumber: number;
  messageId?: string;
  kind: ActivityKind;
  label: string;
  title: string;
  status: ActivityStatus;
  at: number;
  ended?: number;
  tool?: string;
  callId?: string;
  reason?: string;
  preview?: string;
  detail?: string;
}
export interface ActivityQuery {
  limit?: number; offset?: number; after?: number; scope?: 'all' | 'current' | 'recent';
  lookback?: number; maxTurn?: number; kind?: string; q?: string; messageId?: string;
}
export interface BodyPage { text: string; offset: number; next: number | null; total: number }
export const excerpt = (value: unknown, limit = 160): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);

/** Prefer the host's own human title; tool-specific prefixes are deterministic and incur no model invocation. */
export function toolSummary(name: string, input: any = {}, hostTitle?: unknown): { label: string; title: string } {
  const tool = name.split(/[.:/]/).at(-1) ?? name;
  let label = 'Tool', title = name;
  if (/^(shell|bash|exec_command)$/.test(tool)) { label = 'Shell command'; title = input.command ?? input.cmd ?? name; }
  else if (/^(read|read_file)$/.test(tool)) { label = 'Read file'; title = (input.path ?? input.file_path ?? name) + (input.offset ? ` · line ${input.offset}` : ''); }
  else if (/^(patch|apply_patch|edit|write)$/.test(tool)) { label = 'Patch'; title = input.path ?? input.file_path ?? /\*\*\* (?:Update|Add|Delete) File: (.+)/.exec(input.patchText ?? input.patch ?? '')?.[1] ?? name; }
  else if (/^(skill|load_skill)$/.test(tool)) { label = 'Load skill'; title = input.id ?? input.name ?? name; }
  else if (/^(subagent|task)$/.test(tool)) { label = 'Subagent'; title = input.description ?? input.prompt ?? name; }
  else if (/^(grep|glob|search)$/.test(tool)) { label = 'Search'; title = input.pattern ?? input.query ?? name; }
  return { label, title: excerpt(typeof hostTitle === 'string' && hostTitle.trim() ? hostTitle : title) };
}
