import { Plugin } from '@opencode/plugin';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../storage/store.js';
import { Backend } from '../../reports/backend.js';
import { OpenCodeAdapter } from './adapter.js';
import type { Config } from '../../core/types.js';
import { Analysis } from '../../analysis/analysis.js';
import { OpenCodeGeneration } from '../../analysis/opencode.js';

/** A location-scoped plugin uses durable event IDs for deduplication and keeps reports outside session messages. */
export default Plugin.define({
  id: 'context-churn-monitor',
  async setup(ctx) {
    const options = ctx.options as { dataDir?: string; monitor?: Partial<Config>; analysisModel?: string };
    const directory = ctx.location.directory;
    const root = options.dataDir ?? process.env.CONTEXT_MONITOR_DATA ?? join(homedir(), '.local', 'share', 'context-churn-monitor');
    const key = createHash('sha256').update(directory).digest('hex').slice(0, 20);
    const store = await Store.open(join(root, 'replay-v2', `${key}.sqlite`), options.monitor);
    const adapter = new OpenCodeAdapter(store);
    const generation = new OpenCodeGeneration(ctx, store, options.analysisModel);
    await generation.setup();
    const analysis = new Analysis(store, { resolve: (mode, session) => generation.resolve(mode, session), generate: job => generation.generate(job) });
    const backend = await Backend.start(store, { directory, descriptorPath: join(root, `${key}.backend.json`), analysis });
    const controller = new AbortController();
    const models = new Map<string, number>();
    const refreshModels = async () => {
      for (const model of (await ctx.model.list()).data) models.set(`${model.providerID}/${model.id}`, model.limit.context);
    };
    await refreshModels();
    const hook = await ctx.session.hook('context', request => {
      try { adapter.request(request.sessionID, { system: request.system, messages: request.messages, tools: request.tools }); }
      catch (error) { console.error('[context-monitor] Could not capture request estimate', error); }
    });
    const requests = new WeakMap<Request, ReturnType<OpenCodeAdapter['attempt']>>();
    const requestHook = await ctx.session.hook('http.request', event => {
      if (event.kind === 'primary') requests.set(event.request, adapter.attempt(event.sessionID, 'http'));
    });
    const responseHook = await ctx.session.hook('http.response', event => {
      const attempt = requests.get(event.request);
      if (attempt) attempt.status = event.response.status;
    });
    const socketHook = await ctx.session.hook('experimental.ws.send', event => {
      if (event.kind !== 'primary') return;
      try { if (JSON.parse(event.frame).type === 'response.create') adapter.attempt(event.sessionID, 'websocket'); }
      catch { /* Non-request control frames are not model attempts. */ }
    });
    const types = ['session.inbox.enqueued', 'session.inbox.delivered', 'session.step.started', 'session.step.ended', 'session.step.failed', 'session.compaction.started', 'session.compaction.delta', 'session.compaction.ended', 'session.compaction.failed', 'session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted', 'session.tool.input.started', 'session.tool.input.delta', 'session.tool.input.ended', 'session.tool.called', 'session.tool.progress', 'session.tool.success', 'session.tool.failed', 'session.text.started', 'session.text.delta', 'session.text.ended', 'session.reasoning.started', 'session.reasoning.delta', 'session.reasoning.ended', 'session.skill.activated', 'session.shell.started', 'session.shell.ended', 'session.retry.scheduled', 'session.synthetic', 'session.instructions.updated', 'session.agent.selected', 'session.model.selected', 'session.moved', 'session.revert.committed', 'model.updated'] as const;
    const task = (async () => {
      try {
        for await (const event of ctx.event.subscribe({ types: [...types], signal: controller.signal })) {
          if (event.type === 'model.updated') { await refreshModels(); continue; }
          if (event.location && 'directory' in event.location && event.location.directory !== directory) continue;
          try {
            const model = event.type === 'session.step.started' ? event.data.model : undefined;
            adapter.event(event, model ? models.get(`${model.providerID}/${model.id}`) : undefined);
            const state = store.snapshot(event.data.sessionID);
            for (const alert of state?.alerts ?? []) {
              const delivered = `notification:${event.data.sessionID}:${alert.id}`;
              if (store.get(delivered)) continue;
              // Persist before sending: an uncertain network outcome must not flood the user with repeat warnings.
              store.set(delivered, 'attempted');
              console.warn(`[context-monitor] ${alert.metric} ${alert.value.toFixed(2)} (${alert.kind}); session ${event.data.sessionID}`);
              await notify(`${alert.metric} threshold reached: ${alert.value.toFixed(2)} (${alert.kind}). Open Context Churn Monitor to inspect steps.`);
            }
          } catch (error) { console.error('[context-monitor] Event processing failed', error); }
        }
      } catch (error) { if (!controller.signal.aborted) console.error('[context-monitor] Event subscription ended', error); }
    })();
    return async () => { controller.abort(); await Promise.all([hook.dispose(), requestHook.dispose(), responseHook.dispose(), socketHook.dispose()]); await task; await backend.close(); await generation.dispose(); store.close(); };
  },
});

/** Managed OpenChamber supplies this authenticated callback. No callback means console + persisted alerts, not a guessed port. */
async function notify(message: string): Promise<void> {
  const callback = process.env.OPENCHAMBER_AGENT_TOOL_URL, token = process.env.OPENCHAMBER_AGENT_TOOL_TOKEN;
  if (!callback || !token) return;
  try {
    await fetch(new URL('/api/notifications/emit', callback), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Context Churn Monitor', body: message }), signal: AbortSignal.timeout(3000) });
  } catch { /* The persistent alert remains visible even when notification delivery is unavailable. */ }
}
