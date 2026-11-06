import { createServer } from 'node:http';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Bridge } from './bridge.js';
import { authorized, body, respond } from '../reports/http.js';

const token = process.env.OPENCHAMBER_SERVICE_TOKEN;
const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
if (!token || !Number.isInteger(port) || port <= 0) throw new Error('Start this service through OpenChamber');
const bridge = new Bridge(join(homedir(), '.local', 'share', 'context-churn-monitor', 'gui-pairings.json'));
const server = createServer(async (request, response) => {
  if (!authorized(request, token)) return respond(response, 401, { error: 'Authentication required' });
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/health') return respond(response, 200, { ok: true });
    const directory = url.searchParams.get('directory') ?? '';
    if (!directory) throw new Error('Select a project first');
    url.searchParams.delete('directory');
    const input = request.method === 'POST' ? await body(request) : undefined;
    if (url.pathname === '/pair' && request.method === 'POST') {
      await bridge.pair(directory, input.path);
      return respond(response, 200, { paired: true });
    }
    const allowed = ['/sessions', '/snapshot', '/steps', '/settings', '/export', '/analysis/prepare', '/analysis/run', '/analysis/claim', '/analysis/result', '/analysis/read'];
    if (!allowed.includes(url.pathname)) return respond(response, 404, { error: 'Unknown route' });
    respond(response, 200, await bridge.request(directory, url.pathname + url.search, request.method ?? 'GET', input));
  } catch (error) { respond(response, 400, { error: error instanceof Error ? error.message : 'Request failed' }); }
});
server.listen(port, '127.0.0.1');
process.once('SIGTERM', () => server.close());
