import type { Activity } from '../core/activity.js';
import type { Step } from '../core/types.js';
import { escapeHtml as e, growthMetric, coverage } from './view.js';

const paths: Record<string, string> = {
  thinking: '<path d="M6 14c-2-1-3-3-2-6 0-3 3-5 6-5 4 0 6 3 6 6 0 2-1 4-3 5v3H7v-3M7 10l2 2 4-5"/>',
  file: '<path d="M5 2h6l4 4v12H5zM11 2v5h4M8 10h4M8 13h4"/>',
  shell: '<rect x="2" y="3" width="16" height="14" rx="2"/><path d="m5 7 3 3-3 3m6 0h4"/>',
  patch: '<path d="M5 2h6l4 4v12H5zM11 2v5h4M8 11h4m-2-2v4"/>',
  compaction: '<path d="M3 3h14M3 17h14m2-11 5 4 5-4m-5-4v8M5 14l5-4 5 4m-5-4v8"/>',
  skill: '<path d="m10 2 2 5 5 3-5 2-2 6-2-6-5-2 5-3z"/>',
  subagent: '<circle cx="7" cy="6" r="3"/><path d="M2 17v-2c0-3 2-5 5-5 2 0 4 1 5 3m1 1 2 2 4-5"/>',
  text: '<path d="M3 3h14v11H8l-4 3v-3H3zM6 7h8M6 10h5"/>',
};
const icon = (a: Activity) => {
  const key = a.kind === 'tool' ? ({ 'Shell command': 'shell', 'Read file': 'file', Patch: 'patch', 'Load skill': 'skill', Subagent: 'subagent' } as Record<string, string>)[a.label] ?? 'file' : a.kind;
  return `<span class="activity-icon" aria-hidden="true"><svg viewBox="0 0 20 20">${paths[key] ?? paths.text}</svg></span>`;
};

export const measurementNotice = `<details class="measurement"><summary>About growth and request diagnostics</summary><p>Growth is measured at model-request boundaries, not separately for each tool or thinking entry. A measured increase is not proof that one activity alone caused it. “≥” is a partial lower bound, “~” is estimated, and “—” is unavailable. Successful transport status stays in technical details; failures remain visible. IDs, measurement methods and coverage gaps remain available to analysis.</p></details>`;

export function activityOpen(a: Activity): string {
  const status = a.status === 'failed' || a.status === 'interrupted' ? `<span class="activity-status ${a.status}">${e(a.status)}</span>` : a.status === 'running' || a.status === 'streaming' ? `<span class="activity-status live">${e(a.status)}</span>` : '';
  const duration = a.ended === undefined ? '' : `<span class="duration">${Math.max(0, (a.ended - a.at) / 1000).toFixed(1)} s</span>`;
  return `<details class="activity ${e(a.kind)}" data-activity="${e(a.id)}" data-kind="${e(a.kind)}" data-status="${e(a.status)}"><summary>${icon(a)}<span class="activity-words"><span class="kind">${e(a.label)}</span><span class="activity-title${['tool', 'shell'].includes(a.kind) ? ' code-title' : ''}">${e(a.title)}</span></span><span class="activity-tail">${status}${duration}<span class="chevron">›</span></span></summary><div class="activity-detail">${a.detail ? `<p class="gap">${e(a.detail)}</p>` : ''}<div class="activity-body">`;
}
export function activityClose(a: Activity): string {
  return `</div><details class="technical"><summary>Technical details</summary><p>Activity ${e(a.id)}${a.callId ? `<br>Call ${e(a.callId)}` : ''}${a.messageId ? `<br>Request ${e(a.messageId)}` : ''}<br>Turn ${a.turnNumber} · ${e(a.status)}<br>${e(new Date(a.at).toISOString())}</p></details></div></details>`;
}
export const activityRow = (a: Activity): string => activityOpen(a) + '<span class="muted">Expand to load captured content.</span>' + activityClose(a);

export function requestHeader(a: Activity, steps: Step[] = []): string {
  const last = steps.at(-1);
  const heading = steps.length ? `Request ${steps[0].turnNumber}.${steps[0].number}` : `Turn ${a.turnNumber}`;
  const diagnostics = steps.map(step => `<p>${e(step.id)} · ${e(step.model)} · ${e(coverage(step))}${step.attempt ? `<br>${e(step.attempt.transport)} · ${e(step.attempt.outcome)}${step.attempt.status ? ` · HTTP ${step.attempt.status}` : ''}` : ''}${step.gaps.map(g => `<br>${e(g)}`).join('')}</p>`).join('');
  const failed = steps.some(step => step.attempt?.outcome === 'failed');
  return `<div class="request-head"><strong>${heading}</strong>${failed ? '<span class="activity-status failed">Failed attempt</span>' : ''}<span class="growth">${last ? growthMetric(last) : ''}</span>${diagnostics ? `<details class="request-tech"><summary>Request details${steps.length > 1 ? ` · ${steps.length} attempts` : ''}</summary>${diagnostics}</details>` : ''}</div>`;
}

export function replayRows(items: Activity[], requests: Record<string, Step[]>): string {
  let group = '';
  return items.map(a => {
    const key = `${a.turnNumber}:${a.messageId ?? 'between'}`;
    const header = key === group ? '' : requestHeader(a, requests[a.messageId ?? '']);
    group = key;
    return header + activityRow(a);
  }).join('');
}

export const activityStyle = `
#analysis-run button{background:var(--info-text,#245fae);border-color:var(--info-text,#245fae);color:var(--primary-foreground,#fff)}#analysis-run button:disabled{opacity:.5}
.replay-heading{display:flex;gap:12px;align-items:start;justify-content:space-between;margin-top:18px}.replay-heading h2{font-size:1.15rem;font-weight:600;margin:0 0 4px}.replay-heading p{margin:0}.activity-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0 10px}.activity-toolbar input{flex:1 1 200px;min-width:0}.activity-toolbar select{max-width:160px}.timeline{max-height:520px;overflow:auto;scrollbar-width:thin;padding-right:2px}.request-head{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:7px 9px;border-radius:5px;background:color-mix(in srgb,var(--info-text,#245fae) 7%,var(--surface-background,#fff));font-size:.74rem;color:var(--muted-text,#6b7280);margin:8px 0 0}.request-head strong{color:var(--primary-text,#222)}.request-head .growth{margin-left:auto;font-weight:600}.request-tech{flex-basis:100%;font-size:.7rem}.request-tech summary{font-size:.7rem}.request-tech p{overflow-wrap:anywhere}.activity{margin-left:10px;border-left:1px solid var(--border,#e2e4e8);padding-left:10px}.activity>summary{display:flex;gap:9px;align-items:center;list-style:none;padding:10px 2px;min-width:0}.activity>summary::-webkit-details-marker{display:none}.activity-icon{flex:0 0 18px;width:18px;height:18px;color:var(--muted-text,#6b7280)}.activity-icon svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.55;stroke-linecap:round;stroke-linejoin:round}.activity.compaction .activity-icon,.compaction .kind{color:var(--success-text,#15754a)}.activity-words{min-width:0;flex:1;font-size:.82rem;line-height:1.5}.kind{font-weight:550;margin-right:8px}.activity-title{color:var(--muted-text,#6b7280);overflow-wrap:anywhere}.code-title{font-family:var(--font-mono,monospace);font-size:.77rem}.activity-tail{display:flex;gap:8px;align-items:center;font-size:.7rem;color:var(--muted-text,#6b7280);flex-shrink:0}.chevron{font-size:.75rem;transition:transform .15s}.activity[open]>summary .chevron{transform:rotate(90deg)}.activity-status{border-radius:4px;padding:2px 5px;font-size:.69rem}.activity-status.failed,.activity-status.interrupted{color:var(--error-text,#a43a3a);background:color-mix(in srgb,var(--error-text,#a43a3a) 10%,transparent)}.activity-status.live{color:var(--info-text,#245fae)}.activity-detail{margin:0 0 9px 27px;padding:10px;background:var(--surface-muted,#f3f4f6);border-radius:5px;font-size:.79rem;line-height:1.6;overflow-wrap:anywhere}.activity-detail pre{margin:5px 0;white-space:pre-wrap;word-break:break-word;font-size:.75rem;font-family:var(--font-mono,monospace);max-height:280px;overflow:auto}.technical{margin-top:8px;font-size:.7rem;color:var(--muted-text,#6b7280)}.technical p{margin:5px 0}.measurement{margin:10px 0;color:var(--muted-text,#6b7280);font-size:.74rem;line-height:1.55}.measurement p{padding:8px;background:var(--surface-muted,#f3f4f6);border-radius:4px}#action-error{color:var(--error-text,#a43a3a);overflow-wrap:anywhere}.activity-body button,.activity-toolbar button{font:inherit;color:var(--primary-text,#222);background:var(--surface-background,#fff);border:1px solid var(--border,#e2e4e8);border-radius:5px;padding:6px 9px;cursor:pointer;font-size:.8rem}.activity-body section+section{margin-top:10px}#analysis{margin-top:12px;background:var(--surface-muted,#f3f4f6);padding:14px;border-radius:6px}#analysis h2{font-size:.95rem;font-weight:600}.standalone .timeline{max-height:none}.activity-search{width:100%;max-width:400px;margin:10px 0}.standalone .request-accounting{margin-top:20px}@media(max-width:450px){.activity{margin-left:5px;padding-left:7px}.activity>summary{align-items:start;gap:7px}.kind{display:block}.duration{display:none}.activity-toolbar input{flex-basis:100%}.timeline{max-height:470px}.activity-detail{margin-left:0}}@media(prefers-reduced-motion:reduce){.chevron{transition:none}}`;
