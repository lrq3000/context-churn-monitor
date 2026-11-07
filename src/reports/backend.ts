import type { Store } from '../storage/store.js';
import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { authorized, body, respond } from './http.js';
import type { StepQuery } from '../storage/store.js';
import type { ActivityQuery } from '../core/activity.js';
import { exportReport } from './html.js';
import { join } from 'node:path';
import { Analysis } from '../analysis/analysis.js';

export interface Descriptor { version: 1; url: string; token: string; instance: string; directory: string }
export interface BackendOptions {
  directory: string;
  descriptorPath?: string;
  analysis?: Analysis;
  extra?: (path: string, session: string, input: any) => Promise<unknown>;
}

/** The GUI pairs to this exact private listener, not to whichever OpenCode server happens to be discoverable. */
export class Backend {
  private constructor(private server: Server, readonly descriptor: Descriptor, private analysis: Analysis) {}

  static async start(store: Store, options: BackendOptions): Promise<Backend> {
    const descriptor: Descriptor = { version: 1, url: '', token: randomBytes(32).toString('hex'), instance: randomUUID(), directory: options.directory };
    const analysis = options.analysis ?? new Analysis(store);
    const server = createServer(async (request, response) => {
      if (!authorized(request, descriptor.token)) return respond(response, 401, { error: 'Authentication required' });
      if (request.headers['x-context-monitor-instance'] !== descriptor.instance) return respond(response, 409, { error: 'Backend instance changed; pair again' });
      try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        const session = url.searchParams.get('session') ?? '';
        const number = (key: string, fallback: number) => {
          const n = Number(url.searchParams.get(key) ?? fallback);
          if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Invalid ${key}`);
          return n;
        };
        if (request.method === 'GET') {
          if (url.pathname === '/health') return respond(response, 200, { instance: descriptor.instance, directory: descriptor.directory });
          if (url.pathname === '/sessions') return respond(response, 200, store.sessions());
          if (url.pathname === '/snapshot') return respond(response, 200, { state: store.snapshot(session), settings: store.settings(session), turns: store.turns(session, 30) });
          if (url.pathname === '/activities') {
            const scope = url.searchParams.get('scope');
            const query: ActivityQuery = { limit: number('limit', 50), offset: number('offset', 0), scope: scope === 'current' || scope === 'recent' ? scope : 'all', lookback: store.settings(session).lookback, kind: url.searchParams.get('kind') ?? 'all', q: url.searchParams.get('q') ?? '' };
            const page = store.activities.list(session, query);
            const requests = Object.fromEntries([...new Set(page.items.map(a => a.messageId).filter((id): id is string => !!id))].map(id => [id, store.requestSteps(session, id)]));
            return respond(response, 200, { ...page, requests });
          }
          if (url.pathname === '/activity') {
            const id = url.searchParams.get('id') ?? '', activity = store.activities.get(session, id);
            if (!activity) throw new Error('Activity not found in this session');
            const offset = number('offset', 0), limit = number('limit', 16000), channel = url.searchParams.get('channel');
            return respond(response, 200, channel ? store.activities.detail(session, id, channel, offset, limit) : { activity, channels: store.activities.channels(session, id) });
          }
          if (url.pathname === '/steps') {
            const scope = url.searchParams.get('scope');
            const query: StepQuery = { limit: number('limit', 100), offset: number('offset', 0), scope: scope === 'current' || scope === 'recent' ? scope : 'all', sort: url.searchParams.get('sort') === 'growth' ? 'growth' : 'time' };
            return respond(response, 200, store.steps(session, query));
          }
        } else if (request.method === 'POST') {
          const input = await body(request);
          if (url.pathname.startsWith('/analysis/')) {
            let result;
            if (url.pathname === '/analysis/prepare') result = await analysis.prepare(session, input);
            else if (url.pathname === '/analysis/read') result = analysis.read(session, input.id);
            else if (url.pathname === '/analysis/run') result = analysis.start(session, input.id, input.digest, input.consent);
            else if (url.pathname === '/analysis/claim') {
              if (analysis.read(session, input.id).model.route !== 'openchamber') throw new Error('Use the backend generation route');
              return respond(response, 200, analysis.claim(session, input.id, input.digest, input.consent));
            } else if (url.pathname === '/analysis/result') {
              if (analysis.read(session, input.id).model.route !== 'openchamber') throw new Error('Only the backend can complete this analysis');
              analysis.finish(session, input.id, input.receipt, input.result, input.error);
              result = analysis.read(session, input.id);
            } else throw new Error('Unknown analysis route');
            const { receipt: _secret, ...visible } = result;
            return respond(response, 200, visible);
          }
          if (url.pathname === '/settings') return respond(response, 200, store.setSettings(session, input));
          if (url.pathname === '/export' && options.descriptorPath) return respond(response, 200, { path: await exportReport(store, session, join(dirname(options.descriptorPath), 'exports'), input.format) });
          if (options.extra) return respond(response, 200, await options.extra(url.pathname, session, input));
        }
        respond(response, 404, { error: 'Unknown route' });
      } catch (error) { respond(response, 400, { error: error instanceof Error ? error.message : 'Request failed' }); }
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    descriptor.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    if (options.descriptorPath) {
      mkdirSync(dirname(options.descriptorPath), { recursive: true, mode: 0o700 });
      writeFileSync(options.descriptorPath, JSON.stringify(descriptor), { mode: 0o600 });
    }
    return new Backend(server, descriptor, analysis);
  }

  async close(): Promise<void> { await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve())); await this.analysis.drain(); }
}
