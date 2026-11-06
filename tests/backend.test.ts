import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/storage/store.js';
import { Backend } from '../src/reports/backend.js';

test('backend rejects unauthenticated and wrong-instance requests while serving bounded steps', async () => {
  const store = await Store.open(':memory:');
  store.ingest('s', [{ type: 'turn', turnId: 'u', id: 'u', at: 1 }, { type: 'step', stepId: 'a', id: 'a', at: 2 }]);
  const server = await Backend.start(store, { directory: '/test' });
  const d = server.descriptor;
  try {
    assert.equal((await fetch(d.url + '/snapshot?session=s')).status, 401);
    assert.equal((await fetch(d.url + '/snapshot?session=s', { headers: { Authorization: `Bearer ${d.token}`, 'X-Context-Monitor-Instance': 'wrong' } })).status, 409);
    const response = await fetch(d.url + '/steps?session=s&limit=100000', { headers: { Authorization: `Bearer ${d.token}`, 'X-Context-Monitor-Instance': d.instance } });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).items[0].id, 'a');
    assert.equal((await fetch(d.url + '/settings?session=s', { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'X-Context-Monitor-Instance': d.instance }, body: JSON.stringify({ span: 0 }) })).status, 400);
  } finally { await server.close(); store.close(); }
});
