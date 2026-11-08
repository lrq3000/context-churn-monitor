import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './storage/store.js';
import { CodexAdapter } from './adapters/codex/adapter.js';
import { Backend } from './reports/backend.js';
import { AlertHistory } from './storage/alerts.js';
import { AlertPipeline } from './alerts/pipeline.js';

const root = process.env.CONTEXT_MONITOR_DATA ?? process.env.PLUGIN_DATA ?? join(homedir(), '.local', 'share', 'context-churn-monitor', 'codex');
const command = process.argv[2];
try {
  const history = await AlertHistory.open();
  const store = await Store.open(join(root, 'replay-v2', 'codex.sqlite'), {}, false, { directory: process.cwd(), settings: () => history.settings() });
  const pipeline = new AlertPipeline(history, store, process.cwd());
  await pipeline.reconcile();
  if (command === 'hook') {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const modelWindows = process.env.CONTEXT_MONITOR_MODEL_WINDOWS ? JSON.parse(process.env.CONTEXT_MONITOR_MODEL_WINDOWS) : {};
    const session = new CodexAdapter(store, { modelWindows }).event(input, input.event_id ?? randomUUID());
    await pipeline.publishPending();
    const alerts = store.snapshot(session)?.alerts ?? [];
    for (const alert of alerts) {
      const key = `notified:${session}:${alert.id}`;
      if (!store.get(key)) { console.error(`[context-monitor] ${alert.metric}: ${alert.value.toFixed(2)} (${alert.kind})`); store.set(key, true); }
    }
    // Empty JSON is valid for Stop and never adds developer context or blocks the user's turn.
    process.stdout.write('{}');
    store.close(); history.close();
  } else if (command === 'serve') {
    const path = join(root, 'codex.backend.json');
    const backend = await Backend.start(store, { directory: process.cwd(), descriptorPath: path });
    console.log(`Context Monitor pairing file: ${path}`);
    const stop = async () => { await backend.close(); store.close(); history.close(); process.exit(0); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
  } else {
    console.log('Usage: node dist/cli.js hook|serve');
    store.close(); history.close();
  }
} catch (error) {
  console.error('[context-monitor]', error instanceof Error ? error.message : error);
  // Observability must not turn an otherwise successful model/tool request into a failed hook.
  if (command === 'hook') process.stdout.write('{}'); else process.exitCode = 1;
}
