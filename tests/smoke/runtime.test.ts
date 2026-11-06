import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer as httpServer } from 'node:http';
import { body, respond } from '../../src/reports/http.js';
import { Store } from '../../src/storage/store.js';

const root = process.env.CONTEXT_MONITOR_TEST_TMP ?? tmpdir();

test('built Codex hook CLI processes a real stdin payload without injecting context', () => {
  const data = mkdtempSync(join(root, 'codex-smoke-'));
  for (const hook_event_name of ['UserPromptSubmit', 'PreModelRequest', 'PostModelRequest', 'Stop']) {
    const run = spawnSync(process.execPath, ['dist/cli.js', 'hook'], { encoding: 'utf8', env: { ...process.env, CONTEXT_MONITOR_DATA: data, CONTEXT_MONITOR_MODEL_WINDOWS: '{"test":1000}' }, input: JSON.stringify({ session_id: 'smoke', turn_id: 'u', model: 'test', hook_event_name, token_usage: { input_tokens: 300 } }) });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), {});
  }
});

for (const runtime of ['openai-compatible', 'openai', 'anthropic']) test(`installed OpenCode enforces bounded analysis through ${runtime}`, { timeout: 90000 }, async () => {
  const profile = mkdtempSync(join(root, 'opencode-smoke-'));
  const project = join(profile, 'project'); mkdirSync(project);
  const providerRequests: any[] = [];
  let failAnalysis = false;
  let omitUsage = false;
  let failPrimaryOnce = runtime === 'openai-compatible';
  const provider = httpServer(async (req, res) => {
    const input = await body(req, 1000000); providerRequests.push(input);
    if (input.stream && failPrimaryOnce) { failPrimaryOnce = false; return respond(res, 503, { error: { message: 'Retry this primary request' } }); }
    if (failAnalysis) return respond(res, 503, { error: { message: 'Temporary provider failure' } });
    if (runtime === 'openai') {
      const message = { type: 'message', id: 'msg_test', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'Local diagnosis', annotations: [] }] };
      const response = { id: 'resp_test', object: 'response', created_at: 1, status: 'completed', model: 'test', output: [message], usage: { input_tokens: 300, output_tokens: 3, total_tokens: 303, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
      if (!input.stream) return respond(res, 200, response);
      const events = [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }, { type: 'response.output_item.added', output_index: 0, item: { ...message, status: 'in_progress', content: [] } }, { type: 'response.content_part.added', item_id: message.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }, { type: 'response.output_text.delta', item_id: message.id, output_index: 0, content_index: 0, delta: 'Local diagnosis' }, { type: 'response.output_item.done', output_index: 0, item: message }, { type: 'response.completed', response }];
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      return res.end(events.map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''));
    }
    if (runtime === 'anthropic') {
      const message = { id: 'msg_test', type: 'message', role: 'assistant', model: 'test', content: [{ type: 'text', text: 'Local diagnosis' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 300, output_tokens: 3 } };
      if (!input.stream) return respond(res, 200, message);
      const events = [{ type: 'message_start', message: { ...message, content: [], stop_reason: null } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Local diagnosis' } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } }, { type: 'message_stop' }];
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      return res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
    }
    const chunk = { id: 'test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: { role: 'assistant', content: 'Local diagnosis' }, finish_reason: null }] };
    if (input.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], ...(omitUsage ? {} : { usage: { prompt_tokens: 300, completion_tokens: 3, total_tokens: 303 } }) })}\n\ndata: [DONE]\n\n`);
    } else respond(res, 200, { id: 'test', object: 'chat.completion', created: 1, model: 'test', choices: [{ index: 0, message: { role: 'assistant', content: 'Local diagnosis' }, finish_reason: 'stop' }], usage: { prompt_tokens: 300, completion_tokens: 3, total_tokens: 303 } });
  });
  await new Promise<void>(r => provider.listen(0, '127.0.0.1', r));
  const config = {
    model: 'fixture/test',
    plugins: [{ package: resolve('.'), options: { dataDir: join(profile, 'monitor'), analysisModel: 'fixture/test', monitor: { outputBudget: 37 } } }],
    mcp: { servers: {} },
    providers: { fixture: {
      env: ['CONTEXT_MONITOR_FIXTURE_KEY'], package: `@opencode/ai/providers/${runtime}`,
      settings: { baseURL: `http://127.0.0.1:${(provider.address() as any).port}/v1` },
      models: { test: { limit: { context: 32000, output: 4096 }, capabilities: { tools: false } } },
    } },
  };
  writeFileSync(join(project, 'opencode.json'), JSON.stringify(config));
  const listener = createServer();
  await new Promise<void>(r => listener.listen(0, '127.0.0.1', r));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>(r => listener.close(() => r()));
  const env = { ...process.env, XDG_CONFIG_HOME: join(profile, 'config'), XDG_DATA_HOME: join(profile, 'data'), XDG_STATE_HOME: join(profile, 'state'), XDG_CACHE_HOME: join(profile, 'cache'), OPENCODE_CONFIG: join(project, 'opencode.json'), OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCHAMBER_AGENT_TOOL_URL: '', OPENCHAMBER_AGENT_TOOL_TOKEN: '' };
  const child = spawn(process.env.CONTEXT_MONITOR_OPENCODE ?? 'opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: project, env: { ...env, CONTEXT_MONITOR_FIXTURE_KEY: 'local-test-only' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
  try {
    let result: any, session: any, initialized = false;
    for (let i = 0; i < 160; i++) {
      if (child.exitCode !== null) break;
      try {
        const password = /server password ([^\s]+)/.exec(output)?.[1];
        const headers = password ? { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } : undefined;
        const response = await fetch(`http://127.0.0.1:${port}/api/plugin?location[directory]=${encodeURIComponent(project)}`, { headers, signal: AbortSignal.timeout(2000) });
        if (response.ok) {
          result = await response.json();
          if (result.data?.length) break;
          if (!initialized) {
            initialized = true;
            session = await (await fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ location: { directory: project }, title: 'Context Monitor isolated smoke' }) })).json();
          }
        }
      } catch {}
      await delay(250);
    }
    const sanitized = output.replace(/server password [^\s]+/g, 'server password [redacted]');
    writeFileSync(join(profile, 'server.log'), sanitized);
    assert.ok(result, `No successful plugin API response: ${sanitized.slice(-5000)}`);
    writeFileSync(join(profile, 'plugins.json'), JSON.stringify(result, null, 2));
    assert.ok(result.data?.some((plugin: any) => plugin.id === 'context-churn-monitor'), JSON.stringify(result));
    const descriptors = readdirSync(join(profile, 'monitor')).filter(name => name.endsWith('.backend.json'));
    assert.equal(descriptors.length, 1, JSON.stringify(result));
    const descriptor = JSON.parse(readFileSync(join(profile, 'monitor', descriptors[0]), 'utf8'));
    const health = await fetch(descriptor.url + '/health', { headers: { Authorization: `Bearer ${descriptor.token}`, 'X-Context-Monitor-Instance': descriptor.instance } });
    assert.equal(health.status, 200);
    const password = /server password ([^\s]+)/.exec(output)![1];
    const sessionID = session.data.id;
    if (runtime === 'openai-compatible') {
      const prompt = await fetch(`http://127.0.0.1:${port}/api/session/${sessionID}/prompt`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Reply with one brief local test response.' }) });
      assert.equal(prompt.status, 200, await prompt.text());
    } else {
      // Other transports exercise the native generation route; lifecycle accounting is independently covered above with an actual request.
      const database = readdirSync(join(profile, 'monitor')).find(name => name.endsWith('.sqlite'))!;
      const store = await Store.open(join(profile, 'monitor', database));
      store.ingest(sessionID, [{ id: 'u', type: 'turn', turnId: 'u', at: 1 }, { id: 's', type: 'step', stepId: 's', at: 2 }, { id: 'c', type: 'complete', at: 3 }]);
      store.close();
    }
    const monitor = async (path: string, input?: unknown) => {
      const r = await fetch(`${descriptor.url}${path}?session=${sessionID}`, { method: input ? 'POST' : 'GET', headers: { Authorization: `Bearer ${descriptor.token}`, 'X-Context-Monitor-Instance': descriptor.instance }, body: input ? JSON.stringify(input) : undefined });
      const value = await r.json() as any;
      assert.equal(r.status, 200, JSON.stringify(value)); return value;
    };
    let snapshot: any;
    for (let i = 0; i < 100; i++) { snapshot = await monitor('/snapshot'); if (snapshot.state?.turn?.ended) break; await delay(100); }
    assert.ok(snapshot.state?.turn?.steps >= 1, JSON.stringify(snapshot));
    if (runtime === 'openai-compatible') {
      assert.equal(snapshot.state.turn.steps, 2, 'A retried primary request must retain both physical attempts');
      const retrySteps = await monitor('/steps');
      assert.equal(retrySteps.items[0].attempt.status, 503);
      assert.equal(retrySteps.items[1].attempt.status, 200);
      assert.equal(retrySteps.items[0].growth, null, 'Failed attempts cannot invent occupancy');
      for (const missing of [true, false]) {
        omitUsage = missing;
        const nextTurn = snapshot.state.turn.number + 1;
        const prompt = await fetch(`http://127.0.0.1:${port}/api/session/${sessionID}/prompt`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Another local response.' }) });
        assert.equal(prompt.status, 200);
        for (let i = 0; i < 100; i++) { snapshot = await monitor('/snapshot'); if (snapshot.state?.turn?.number === nextTurn && snapshot.state.turn.ended) break; await delay(100); }
        assert.equal(snapshot.state.turn.number, nextTurn);
        assert.ok(snapshot.state.baseline.tokens > 0, 'Native absent usage must never become a reported zero');
        assert.equal(snapshot.state.baseline.quality, missing ? 'estimated' : 'reported');
        assert.equal(snapshot.state.turn.growth, null, 'Estimator changes must rebase rather than invent growth');
      }
    }
    const before = snapshot.state.revision;
    const exported = await monitor('/export', { format: 'json' });
    const exportedReport = JSON.parse(readFileSync(exported.path, 'utf8'));
    assert.equal(exportedReport.snapshot.revision, before, 'Native Bun worker exports a consistent SQLite snapshot');
    assert.ok(exportedReport.steps.length >= 1);
    const job = await monitor('/analysis/prepare', { mode: 'configured' });
    const claim = { id: job.id, digest: job.digest, consent: true };
    await monitor('/analysis/run', claim);
    let resultJob: any;
    for (let i = 0; i < 100; i++) { resultJob = await monitor('/analysis/read', { id: job.id }); if (resultJob.status !== 'consumed') break; await delay(100); }
    assert.equal(resultJob.status, 'complete', JSON.stringify(resultJob));
    assert.equal(resultJob.result, 'Local diagnosis');
    const generation = providerRequests.at(-1);
    assert.equal(generation.max_tokens ?? generation.max_completion_tokens ?? generation.max_output_tokens, 37);
    assert.equal(generation.model, 'test');
    assert.ok(!generation.tools?.length);
    assert.equal((await monitor('/snapshot')).state.revision, before, 'Analysis must not append monitored session steps');
    failAnalysis = true;
    const failed = await monitor('/analysis/prepare', { mode: 'configured' });
    const requestCount = providerRequests.length;
    await monitor('/analysis/run', { id: failed.id, digest: failed.digest, consent: true });
    for (let i = 0; i < 300; i++) { resultJob = await monitor('/analysis/read', { id: failed.id }); if (resultJob.status !== 'consumed') break; await delay(100); }
    assert.equal(resultJob.status, 'uncertain');
    assert.equal(providerRequests.length - requestCount, 1, 'One consent must permit only one outgoing provider attempt, including retryable HTTP failures');
  } finally {
    // The Windows package-manager shim launches a second executable which inherits pipes. Killing only the shim leaves the test hung.
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
    child.stdout.destroy(); child.stderr.destroy();
    await new Promise<void>(r => provider.close(() => r()));
  }
});
