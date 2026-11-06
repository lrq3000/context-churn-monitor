import { Store } from 'file:///C:/Ai-Apps/MyGPTs/AGENTS-MD/.worktrees/context-churn-monitor/plugins/context-churn-monitor/src/storage/store.ts';
import { OpenCodeAdapter } from 'file:///C:/Ai-Apps/MyGPTs/AGENTS-MD/.worktrees/context-churn-monitor/plugins/context-churn-monitor/src/adapters/opencode/adapter.ts';
import { stepRow } from 'file:///C:/Ai-Apps/MyGPTs/AGENTS-MD/.worktrees/context-churn-monitor/plugins/context-churn-monitor/src/reports/view.ts';
const store = await Store.open(':memory:');
const adapter = new OpenCodeAdapter(store); let i = 0;
const send = (type: string, data: any = {}) => adapter.event({ type, data: { sessionID: 's', ...data }, id: String(++i), created: i }, 1000);
send('session.inbox.enqueued', { inboxID: 'notice', item: { type: 'synthetic' } });
send('session.inbox.delivered', { inboxID: 'notice' });
send('session.step.started', { assistantMessageID: 'a', model: { providerID: 'p', id: 'm' } });
send('session.step.ended', { assistantMessageID: 'a', tokens: { input: 100, cache: { read: 0, write: 0 } } });
send('session.execution.succeeded');
console.log('Known synthetic-only session:', JSON.stringify(store.snapshot('s')));
send('session.tool.success', { id: 'tool', content: [{ type: 'text', text: 'x'.repeat(2500) }] });
console.log('Excerpt truncation:', JSON.stringify({ length: store.snapshot('s')?.step?.evidence[0].excerpt?.length, gaps: store.snapshot('s')?.step?.gaps }));
store.ingest('estimated', [
  { type: 'turn', id: 'u', turnId: 'u', at: 1 },
  { type: 'step', id: 's', stepId: 's', at: 2 },
  { type: 'observe', id: 'o1', at: 3, tokens: 300, capacity: 1000, model: 'm', method: 'json-utf8-div4', quality: 'estimated' },
  { type: 'observe', id: 'o2', at: 4, tokens: 500, capacity: 1000, model: 'm', method: 'json-utf8-div4', quality: 'estimated' },
  { type: 'gap', id: 'g', at: 5, reason: 'Final retained output not measured.' },
  { type: 'complete', id: 'c', at: 6 },
]);
const estimated = store.steps('estimated').items[0];
console.log('Partial estimate row:', JSON.stringify(estimated));
console.log('Partial estimate renders as lower bound:', stepRow(estimated).includes('≥20.00 pp'));
store.close();
