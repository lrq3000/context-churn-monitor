import { Store } from 'file:///C:/Ai-Apps/MyGPTs/AGENTS-MD/.worktrees/context-churn-monitor/plugins/context-churn-monitor/src/storage/store.ts';
import { exportReport } from 'file:///C:/Ai-Apps/MyGPTs/AGENTS-MD/.worktrees/context-churn-monitor/plugins/context-churn-monitor/src/reports/html.ts';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (process.argv[2] === 'writer') {
  const store = await Store.open(process.argv[3]);
  process.send!('ready');
  process.once('message', async () => {
    await delay(200);
    const start = performance.now();
    try { store.ingest('s', [{ id: 'during-export', type: 'step', stepId: 'during-export', at: 2 }]); process.send!({ result: 'written', elapsed: performance.now() - start }); }
    catch (e) { process.send!({ result: String(e), elapsed: performance.now() - start }); }
    finally { store.close(); process.disconnect(); }
  });
} else {
  const root = mkdtempSync('C:/Users/33632/AppData/Local/Temp/opencode/context-churn-monitor/review-export-');
  const path = join(root, 'state.sqlite'); const store = await Store.open(path);
  store.ingest('s', [{ id: 'u', type: 'turn', turnId: 'u', at: 1 }]);
  const insert = store.db.prepare('INSERT INTO steps VALUES (?,?,?,?,?,?)');
  store.atomic(() => { for (let i = 1; i <= 200000; i++) insert.run('s', `s${i}`, 1, i, 0, JSON.stringify({ id: `s${i}`, turnId: 'u', turnNumber: 1, number: i, at: i, growth: 0, compactions: 0, quality: 'partial', gaps: [], evidence: [] })); });
  const child = fork(fileURLToPath(import.meta.url), ['writer', path]);
  await new Promise(r => child.once('message', r));
  const writer = new Promise(r => child.once('message', r));
  child.send('go');
  const start = performance.now(); const report = exportReport(store, 's', root, 'json');
  const result = { rows: 200000, exportMilliseconds: performance.now() - start, writer: await writer, report, root };
  console.log(JSON.stringify(result)); writeFileSync(join(root, 'results.json'), JSON.stringify(result, null, 2));
  store.close();
}
