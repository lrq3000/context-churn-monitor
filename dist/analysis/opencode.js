import { createHash } from 'node:crypto';
import { OneShotRelay } from './relay.js';
/** A temporary model alias bounds generation without mutating the session model or adding conversation history. Native smoke verifies the actual outgoing request limit. */
export class OpenCodeGeneration {
    ctx;
    store;
    configured;
    aliases = new Map();
    disposeTransform;
    queue = Promise.resolve();
    constructor(ctx, store, configured) {
        this.ctx = ctx;
        this.store = store;
        this.configured = configured;
    }
    async setup() {
        const registration = await this.ctx.model.transform(editor => {
            for (const alias of this.aliases.values())
                editor.update(alias.providerID, alias.id, draft => Object.assign(draft, structuredClone(alias)));
        });
        this.disposeTransform = () => registration.dispose();
    }
    async resolve(mode, session) {
        const ref = this.store.get(`model:${session}`)?.ref;
        const id = mode === 'configured' ? this.configured : ref ? `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ''}` : undefined;
        if (!id)
            throw new Error(mode === 'configured' ? 'No analysisModel configured in plugin options' : 'Session model has not been observed yet');
        const model = await this.find(id);
        this.limitBody(model, 1);
        await this.baseURL(model, id.split('#')[1]);
        return { route: 'backend', id, context: Math.min(model.limit.context, model.limit.input ?? model.limit.context), output: model.limit.output };
    }
    generate(job) {
        // Catalog reloads and temporary alias cleanup are serialized; parallel callers cannot replace each other's limit.
        const request = this.queue.then(() => this.invoke(job));
        this.queue = request.catch(() => { });
        return request;
    }
    async find(reference) {
        const [base] = reference.split('#');
        const model = (await this.ctx.model.list()).data.find(m => `${m.providerID}/${m.id}` === base);
        if (!model || !model.enabled)
            throw new Error('Selected analysis model is unavailable');
        return model;
    }
    async invoke(job) {
        const source = await this.find(job.model.id);
        if (source.limit.context < job.inputBudget + job.outputBudget || source.limit.output < job.outputBudget)
            throw new Error('Model limits changed; prepare new consent');
        const alias = structuredClone(source);
        const variantID = job.model.id.split('#')[1];
        const variant = variantID ? source.variants.find(v => v.id === variantID) : undefined;
        if (variantID && !variant)
            throw new Error('Selected model variant is unavailable');
        const relay = await new OneShotRelay(await this.baseURL(source, variantID)).start();
        Object.assign(alias, {
            id: `context-monitor-${createHash('sha256').update(job.id).digest('hex').slice(0, 16)}`,
            name: 'Context Monitor bounded analysis', variants: [],
            limit: { ...source.limit, output: job.outputBudget },
            settings: { ...source.settings, ...variant?.settings, timeout: 60000, baseURL: relay.url },
            headers: { ...source.headers, ...variant?.headers }, body: { ...source.body, ...variant?.body, ...this.limitBody(source, job.outputBudget) },
        });
        this.aliases.set(alias.id, alias);
        try {
            await this.ctx.model.reload();
            const result = await this.ctx.experimental.generate.text({ prompt: job.prompt, model: { providerID: alias.providerID, id: alias.id } });
            return result.text;
        }
        finally {
            this.aliases.delete(alias.id);
            try {
                await this.ctx.model.reload();
            }
            finally {
                await relay.close();
            }
        }
    }
    async baseURL(model, variantID) {
        const provider = (await this.ctx.provider.get({ providerID: model.providerID })).data;
        const url = model.variants.find(v => v.id === variantID)?.settings?.baseURL ?? model.settings?.baseURL ?? provider.settings?.baseURL;
        // Account plugins may choose endpoints dynamically. Never guess one and send credentials to a different service.
        if (typeof url !== 'string' || !url)
            throw new Error('One-attempt analysis requires an explicit provider/model baseURL');
        return url;
    }
    limitBody(model, budget) {
        // generate.text does not forward limit.output. The native runtime's final body overlay is the enforceable boundary, verified against a local provider in the host smoke test.
        const runtime = model.package;
        if (runtime === '@opencode/ai/providers/openai-compatible')
            return { [model.compatibility?.maxTokensField ?? 'max_tokens']: budget };
        if (runtime === '@opencode/ai/providers/openai')
            return { max_output_tokens: budget };
        if (runtime === '@opencode/ai/providers/anthropic')
            return { max_tokens: budget };
        throw new Error(`Bounded analysis is unavailable for runtime ${runtime ?? '(unknown)'}; use OpenChamber Small Model`);
    }
    async dispose() { await this.queue; await this.disposeTransform?.(); }
}
