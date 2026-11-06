import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const root = 'C:/Users/33632/AppData/Local/Temp/opencode/context-churn-monitor';
const pkg = 'C:/Ai-Apps/MyGPTs/AGENTS-MD/.worktrees/context-churn-monitor/plugins/context-churn-monitor';
const profile = mkdtempSync(join(root, 'review-native-'));
const project = join(profile, 'project'); mkdirSync(project);
let phase = 'retry', calls = [];
const provider = createServer(async (req, res) => {
  const parts = []; for await (const p of req) parts.push(p);
  const input = JSON.parse(Buffer.concat(parts).toString());
  calls.push({ phase, input });
  if (phase === 'analysis-reset') { req.socket.destroy(); return; }
  if (phase === 'analysis-503' || (phase === 'retry' && calls.filter(c => c.phase === phase).length === 1)) {
    res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '0' });
    return res.end(JSON.stringify({ error: { message: 'Temporary fixture failure', type: 'server_error' } }));
  }
  const chunk = { id: 'review', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: { role: 'assistant', content: 'Local fixture response' }, finish_reason: null }] };
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const usage = phase === 'missing-usage' ? {} : { usage: { prompt_tokens: 300, completion_tokens: 3, total_tokens: 303 } };
  res.end(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], ...usage })}\n\ndata: [DONE]\n\n`);
});
await new Promise(r => provider.listen(0, '127.0.0.1', r));
const config = { model: 'fixture/test', plugins: [{ package: pkg, options: { dataDir: join(profile, 'monitor'), analysisModel: 'fixture/test', monitor: { outputBudget: 37 } } }], mcp: { servers: {} }, providers: { fixture: { env: ['CONTEXT_MONITOR_FIXTURE_KEY'], package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `http://127.0.0.1:${provider.address().port}/v1` }, models: { test: { limit: { context: 32000, output: 4096 }, capabilities: { tools: false } } } } } };
writeFileSync(join(project, 'opencode.json'), JSON.stringify(config));
const reservation = createServer(); await new Promise(r => reservation.listen(0, '127.0.0.1', r)); const port = reservation.address().port; await new Promise(r => reservation.close(r));
const child = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: project, env: { ...process.env, CONTEXT_MONITOR_FIXTURE_KEY: 'local-test-only', XDG_CONFIG_HOME: join(profile, 'config'), XDG_DATA_HOME: join(profile, 'data'), XDG_STATE_HOME: join(profile, 'state'), XDG_CACHE_HOME: join(profile, 'cache'), OPENCODE_CONFIG: join(project, 'opencode.json'), OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCHAMBER_AGENT_TOOL_URL: '', OPENCHAMBER_AGENT_TOOL_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let output = '', session, descriptor;
child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
const api = async (path, input) => {
  const password = /server password ([^\s]+)/.exec(output)?.[1];
  const r = await fetch(`http://127.0.0.1:${port}/api${path}`, { method: input ? 'POST' : 'GET', headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`, 'Content-Type': 'application/json' }, body: input ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(60000) });
  const text = await r.text(); if (!r.ok) throw new Error(`${r.status}: ${text}`); return JSON.parse(text);
};
const monitor = async (path, input) => {
  const r = await fetch(`${descriptor.url}${path}?session=${session.data.id}`, { method: input ? 'POST' : 'GET', headers: { Authorization: `Bearer ${descriptor.token}`, 'X-Context-Monitor-Instance': descriptor.instance, 'Content-Type': 'application/json' }, body: input ? JSON.stringify(input) : undefined });
  const data = await r.json(); assert.equal(r.status, 200, JSON.stringify(data)); return data;
};
try {
  for (let i = 0; i < 160; i++) {
    try { if (!session) session = await api('/session', { location: { directory: project }, title: 'Independent review fixture' }); const list = await api(`/plugin?location[directory]=${encodeURIComponent(project)}`); if (list.data?.some(x => x.id === 'context-churn-monitor')) break; } catch {} await delay(250);
  }
  descriptor = JSON.parse(readFileSync(join(profile, 'monitor', readdirSync(join(profile, 'monitor')).find(f => f.endsWith('.backend.json'))), 'utf8'));
  const results = {};
  let expectedTurn = 0;
  for (phase of ['retry', 'missing-usage', 'recovered-usage']) {
    expectedTurn++;
    await api(`/session/${session.data.id}/prompt`, { text: `Reply briefly, scenario ${phase}` });
    let snapshot;
    for (let i = 0; i < 600; i++) { snapshot = await monitor('/snapshot'); if (snapshot.state?.turn?.number === expectedTurn && snapshot.state?.turn?.ended) break; await delay(100); }
    assert.equal(snapshot.state?.turn?.number, expectedTurn); assert.ok(snapshot.state?.turn?.ended, 'Wait for the scenario to complete before changing provider behavior');
    results[phase] = { calls: calls.filter(c => c.phase === phase).length, snapshot: await monitor('/snapshot'), steps: await monitor('/steps') };
    console.log(phase, JSON.stringify({ calls: results[phase].calls, turn: results[phase].snapshot.state.turn, baseline: results[phase].snapshot.state.baseline, steps: results[phase].steps.items.map(s => ({ id: s.id, number: s.number, growth: s.growth, quality: s.quality })) }));
  }
  for (phase of ['analysis-503', 'analysis-reset']) {
    const job = await monitor('/analysis/prepare', { mode: 'configured' });
    await monitor('/analysis/run', { id: job.id, digest: job.digest, consent: true });
    let final;
    for (let i = 0; i < 600; i++) { final = await monitor('/analysis/read', { id: job.id }); if (final.status !== 'consumed') break; await delay(100); }
    results[phase] = { calls: calls.filter(c => c.phase === phase).length, status: final.status, error: final.error };
    console.log(phase, JSON.stringify(results[phase]));
  }
  writeFileSync(join(profile, 'results.json'), JSON.stringify(results, null, 2));
  writeFileSync(join(profile, 'provider-requests.json'), JSON.stringify(calls, null, 2));
} finally {
  writeFileSync(join(profile, 'server.log'), output.replace(/server password [^\s]+/g, 'server password [redacted]'));
  console.log('Artifacts:', profile);
  if (child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  child.stdout.destroy(); child.stderr.destroy(); await new Promise(r => provider.close(r));
}
