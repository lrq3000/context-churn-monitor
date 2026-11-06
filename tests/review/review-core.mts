import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Monitor } from 'file:///C:/Ai-Apps/MyGPTs/AGENTS-MD/.worktrees/context-churn-monitor/plugins/context-churn-monitor/src/core/monitor.ts';
import { Store } from 'file:///C:/Ai-Apps/MyGPTs/AGENTS-MD/.worktrees/context-churn-monitor/plugins/context-churn-monitor/src/storage/store.ts';
import { exportReport } from 'file:///C:/Ai-Apps/MyGPTs/AGENTS-MD/.worktrees/context-churn-monitor/plugins/context-churn-monitor/src/reports/html.ts';

const m = new Monitor(); let id = 0;
const emit = (e: any) => m.accept({ id: String(++id), at: id, ...e });
const obs = (tokens: number) => emit({ type: 'observe', tokens, capacity: 1000, model: 'm', method: 'reported', quality: 'reported' });
obs(300); emit({ type: 'turn', turnId: 'u' }); emit({ type: 'step', stepId: 's' }); obs(500); emit({ type: 'complete' });
console.log('Before late usage:', JSON.stringify({ ended: m.state.turn?.ended, growth: m.state.turn?.growth, ema: m.state.ema }));
obs(600);
console.log('After late usage:', JSON.stringify({ ended: m.state.turn?.ended ?? null, growth: m.state.turn?.growth, ema: m.state.ema }));
assert.equal(m.state.turn?.growth, 30); assert.equal(m.state.turn?.ended, undefined); assert.equal(m.state.ema.growth, null);

const store = await Store.open(':memory:');
store.ingest('history', [{ id: 't', type: 'turn', turnId: 't', at: 1 }]);
const row = store.db.prepare('INSERT INTO steps VALUES (?,?,?,?,?,?)');
store.atomic(() => { for (let i = 1; i <= 100000; i++) row.run('history', `s${i}`, 1, i, i % 10, JSON.stringify({ id: `s${i}`, turnId: 't', turnNumber: 1, number: i, at: i, growth: i % 10, compactions: 0, quality: 'partial', gaps: [], evidence: [] })); });
console.log('Query plan:', store.db.prepare('EXPLAIN QUERY PLAN SELECT data FROM steps WHERE session=? AND turn_number>=? AND turn_number<=? ORDER BY turn_number,number LIMIT ? OFFSET ?').all('history', 0, 1, 101, 99900));
for (const count of [10000, 100000]) {
  const start = performance.now();
  for (let offset = 0; offset < count; offset += 100) store.steps('history', { limit: 100, offset });
  console.log(`Pagination ${count}: ${Math.round(performance.now() - start)}ms`);
}
const start = performance.now();
console.log('Export path:', exportReport(store, 'history', 'C:/Users/33632/AppData/Local/Temp/opencode/context-churn-monitor', 'json'));
console.log('Export elapsed ms:', Math.round(performance.now() - start));
store.close();
