import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../storage/store.js';
import { Backend } from '../../reports/backend.js';
import { OpenCodeAdapter } from './adapter.js';
import { Analysis } from '../../analysis/analysis.js';
import { OpenCodeGeneration } from '../../analysis/opencode.js';
import { OpenChamberNotifications } from './notifications.js';
import { AlertHistory } from '../../storage/alerts.js';
import { AlertPipeline } from '../../alerts/pipeline.js';
/** A location-scoped plugin uses durable event IDs for deduplication and keeps reports outside session messages. The plain typed object also loads from native extension folders without installed SDK dependencies. */
export default {
    id: 'context-churn-monitor',
    async setup(ctx) {
        const options = ctx.options;
        const directory = ctx.location.directory;
        const root = options.dataDir ?? process.env.CONTEXT_MONITOR_DATA ?? join(homedir(), '.local', 'share', 'context-churn-monitor');
        const key = createHash('sha256').update(directory).digest('hex').slice(0, 20);
        const history = await AlertHistory.open();
        const store = await Store.open(join(root, 'replay-v2', `${key}.sqlite`), options.monitor, false, { directory, settings: () => history.settings() });
        const adapter = new OpenCodeAdapter(store);
        const notifications = new OpenChamberNotifications(directory, async (sessionID, signal) => (await ctx.session.get({ sessionID }, { signal })).title);
        const alerts = new AlertPipeline(history, store, directory, event => {
            console.warn(`[context-monitor] ${event.metric} ${event.value.toFixed(2)} (${event.kind}); session ${event.sessionId}`);
            return notifications.send(event.sessionId, `${event.metric} threshold reached: ${event.value.toFixed(2)} (${event.kind}); threshold ${event.threshold.toFixed(2)}. Open Context Churn Monitor to inspect steps.`);
        });
        await alerts.reconcile();
        const generation = new OpenCodeGeneration(ctx, store, options.analysisModel);
        await generation.setup();
        const analysis = new Analysis(store, { resolve: (mode, session) => generation.resolve(mode, session), generate: job => generation.generate(job) });
        const backend = await Backend.start(store, { directory, descriptorPath: join(root, `${key}.backend.json`), analysis, registry: history.backends });
        const controller = new AbortController();
        const models = new Map();
        const refreshModels = async () => {
            for (const model of (await ctx.model.list()).data)
                models.set(`${model.providerID}/${model.id}`, model.limit.context);
        };
        await refreshModels();
        const hook = await ctx.session.hook('context', request => {
            try {
                adapter.request(request.sessionID, { system: request.system, messages: request.messages, tools: request.tools });
            }
            catch (error) {
                console.error('[context-monitor] Could not capture request estimate', error);
            }
        });
        const requests = new WeakMap();
        const requestHook = await ctx.session.hook('http.request', event => {
            if (event.kind === 'primary')
                requests.set(event.request, adapter.attempt(event.sessionID, 'http'));
        });
        const responseHook = await ctx.session.hook('http.response', event => {
            const attempt = requests.get(event.request);
            if (attempt)
                attempt.status = event.response.status;
        });
        const socketHook = await ctx.session.hook('experimental.ws.send', event => {
            if (event.kind !== 'primary')
                return;
            try {
                if (JSON.parse(event.frame).type === 'response.create')
                    adapter.attempt(event.sessionID, 'websocket');
            }
            catch { /* Non-request control frames are not model attempts. */ }
        });
        const types = ['session.inbox.enqueued', 'session.inbox.delivered', 'session.step.started', 'session.step.ended', 'session.step.failed', 'session.compaction.started', 'session.compaction.delta', 'session.compaction.ended', 'session.compaction.failed', 'session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted', 'session.tool.input.started', 'session.tool.input.delta', 'session.tool.input.ended', 'session.tool.called', 'session.tool.progress', 'session.tool.success', 'session.tool.failed', 'session.text.started', 'session.text.delta', 'session.text.ended', 'session.reasoning.started', 'session.reasoning.delta', 'session.reasoning.ended', 'session.skill.activated', 'session.shell.started', 'session.shell.ended', 'session.retry.scheduled', 'session.synthetic', 'session.instructions.updated', 'session.agent.selected', 'session.model.selected', 'session.moved', 'session.revert.committed', 'model.updated'];
        const task = (async () => {
            try {
                for await (const event of ctx.event.subscribe({ types: ['session.deleted', ...types], signal: controller.signal })) {
                    if (event.type === 'model.updated') {
                        await refreshModels();
                        continue;
                    }
                    if (event.location && 'directory' in event.location && event.location.directory !== directory)
                        continue;
                    try {
                        const model = event.type === 'session.step.started' ? event.data.model : undefined;
                        adapter.event(event, model ? models.get(`${model.providerID}/${model.id}`) : undefined);
                        await alerts.publishPending();
                    }
                    catch (error) {
                        console.error('[context-monitor] Event processing failed', error);
                    }
                }
            }
            catch (error) {
                if (!controller.signal.aborted)
                    console.error('[context-monitor] Event subscription ended', error);
            }
        })();
        return async () => { controller.abort(); await Promise.all([hook.dispose(), requestHook.dispose(), responseHook.dispose(), socketHook.dispose()]); await task; await backend.close(); await generation.dispose(); store.close(); history.close(); };
    },
};
