import { createServer } from 'node:http';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Bridge } from './bridge.js';
import { authorized, body, respond } from '../reports/http.js';
import { AlertHistory } from '../storage/alerts.js';
import { GlobalAlertService } from './alert-service.js';
import { createServiceHost } from '@openchamber/sdk';
import { SessionMarks } from './marks.js';
const token = process.env.OPENCHAMBER_SERVICE_TOKEN;
const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
if (!token || !Number.isInteger(port) || port <= 0)
    throw new Error('Start this service through OpenChamber');
async function start(token) {
    const history = await AlertHistory.open();
    const bridge = new Bridge(join(homedir(), '.local', 'share', 'context-churn-monitor', 'gui-pairings.json'), history.backends);
    const globals = new GlobalAlertService(history);
    const marks = new SessionMarks(history, createServiceHost({ env: process.env }));
    const server = createServer(async (request, response) => {
        if (!authorized(request, token))
            return respond(response, 401, { error: 'Authentication required' });
        try {
            const url = new URL(request.url ?? '/', 'http://127.0.0.1');
            if (url.pathname === '/health')
                return respond(response, 200, { ok: true });
            const input = request.method === 'POST' ? await body(request) : undefined;
            const globalResult = await globals.handle(url, request.method ?? 'GET', input);
            if (globalResult !== undefined)
                return respond(response, 200, globalResult);
            const directory = url.searchParams.get('directory') ?? '';
            if (!directory)
                throw new Error('Select a project first');
            url.searchParams.delete('directory');
            if (url.pathname === '/pair' && request.method === 'POST') {
                await bridge.pair(directory, input.path);
                return respond(response, 200, { paired: true });
            }
            const allowed = ['/sessions', '/snapshot', '/steps', '/activities', '/activity', '/settings', '/export', '/analysis/prepare', '/analysis/run', '/analysis/claim', '/analysis/result', '/analysis/read'];
            if (!allowed.includes(url.pathname))
                return respond(response, 404, { error: 'Unknown route' });
            respond(response, 200, await bridge.request(directory, url.pathname + url.search, request.method ?? 'GET', input));
        }
        catch (error) {
            respond(response, 400, { error: error instanceof Error ? error.message : 'Request failed' });
        }
    });
    // Bring up the authenticated HTTP listener before starting optional sidebar work.
    server.listen(port, '127.0.0.1', () => marks.start());
    process.once('SIGTERM', () => { void marks.stop().then(() => server.close(() => history.close())); });
}
void start(token).catch(error => { console.error('[context-monitor] GUI service could not start', error); process.exitCode = 1; });
