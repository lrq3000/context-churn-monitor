import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/storage/store.js';
import { Analysis, type AnalysisModel } from '../src/analysis/analysis.js';

const model: AnalysisModel = { route: 'backend', id: 'provider/model', context: 32000, output: 4096 };
async function fixture(generate: (job: any) => Promise<string> = async () => 'Diagnosis') {
  const store = await Store.open(':memory:');
  for (let i = 1; i <= 8; i++) store.ingest('s', [
    { id: `u${i}`, type: 'turn', at: i, turnId: `u${i}` },
    { id: `s${i}`, type: 'step', at: i, stepId: `s${i}` },
    { id: `e${i}`, type: 'evidence', at: i, evidence: { tool: 'read', label: `file-${i}`, excerpt: 'Untrusted text '.repeat(100) } },
  ]);
  return { store, analysis: new Analysis(store, { resolve: async () => model, generate }) };
}

test('analysis freezes recent evidence and enforces a conservative input and output bound before consent', async () => {
  let calls = 0;
  const { store, analysis } = await fixture(async () => { calls++; return 'Done'; });
  store.setSettings('s', { inputBudget: 2500, outputBudget: 900 });
  const job = await analysis.prepare('s', { mode: 'session' });
  assert.equal(calls, 0);
  assert.equal(job.firstTurn, 4);
  assert.equal(job.lastTurn, 8);
  assert.ok(Buffer.byteLength(job.prompt) + 512 <= 2500);
  assert.equal(job.outputBudget, 900);
  assert.ok(job.omitted);
  store.ingest('s', [{ id: 'new', at: 10, type: 'evidence', evidence: { tool: 'read', label: 'LATE SECRET' } }]);
  assert.ok(!analysis.read('s', job.id).prompt.includes('LATE SECRET'));
  assert.throws(() => analysis.claim('s', job.id, job.digest, false), /consent/i);
  assert.throws(() => analysis.claim('other', job.id, job.digest, true), /session/i);
  store.close();
});

test('durable atomic consent prevents concurrent invocation and reuse after uncertain failure', async () => {
  let calls = 0;
  const { store, analysis } = await fixture(async () => { calls++; throw new Error('provider disconnected'); });
  const job = await analysis.prepare('s', { mode: 'configured' });
  const results = await Promise.allSettled([analysis.run('s', job.id, job.digest, true), analysis.run('s', job.id, job.digest, true)]);
  assert.equal(calls, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.equal(analysis.read('s', job.id).status, 'uncertain');
  const reloaded = new Analysis(store, { resolve: async () => model, generate: async () => { calls++; return 'bad retry'; } });
  await assert.rejects(reloaded.run('s', job.id, job.digest, true), /consumed/i);
  assert.equal(calls, 1);
  store.close();
});

test('missing model, changed digest and expired consent never reach generation', async () => {
  const { store, analysis } = await fixture();
  const missing = new Analysis(store, { resolve: async () => { throw new Error('No configured model'); } });
  await assert.rejects(missing.prepare('s', { mode: 'configured' }), /model/);
  const job = await analysis.prepare('s', { mode: 'session' });
  assert.throws(() => analysis.claim('s', job.id, 'different', true), /digest/);
  store.set(`analysis:${job.id}`, { ...job, expires: 0 });
  assert.throws(() => analysis.claim('s', job.id, job.digest, true), /expired/);
  store.close();
});

test('OpenChamber claims bind the host route and require a single-use completion receipt', async () => {
  const { store } = await fixture();
  const analysis = new Analysis(store);
  const job = await analysis.prepare('s', { mode: 'small' });
  await assert.rejects(analysis.run('s', job.id, job.digest, true), /OpenChamber/);
  const claim = analysis.claim('s', job.id, job.digest, true);
  assert.equal(claim.model.route, 'openchamber');
  assert.throws(() => analysis.finish('s', job.id, 'wrong', 'Done'), /receipt/);
  analysis.finish('s', job.id, claim.receipt!, 'Done');
  assert.equal(analysis.read('s', job.id).result, 'Done');
  assert.throws(() => analysis.finish('s', job.id, claim.receipt!, 'Again'), /receipt|consumed/i);
  assert.equal(analysis.read('s', job.id).result, 'Done');
  store.close();
});
