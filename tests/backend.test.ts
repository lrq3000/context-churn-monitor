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

test('activity API pages complete bodies without mixing sessions or embedding them in row summaries', async () => {
  const store = await Store.open(':memory:');
  store.ingest('s', [{ type: 'turn', turnId: 'u', id: 'u', at: 1 }, { type: 'step', stepId: 'm', id: 'm', at: 2 }]);
  store.activities.update('s', { id: 'a', turnId: 'u', turnNumber: 1, messageId: 'm', kind: 'tool', tool: 'shell', label: 'Shell command', title: 'npm test', status: 'completed', at: 3 });
  store.activities.write('s', 'a', 'output', 'large output '.repeat(5000));
  const server = await Backend.start(store, { directory: '/test' });
  const headers = { Authorization: `Bearer ${server.descriptor.token}`, 'X-Context-Monitor-Instance': server.descriptor.instance };
  try {
    const response = await fetch(server.descriptor.url + '/activities?session=s&q=npm', { headers });
    assert.equal(response.status, 200);
    const page = await response.json() as any;
    assert.equal(page.items[0].title, 'npm test');
    assert.equal(page.requests.m[0].id, 'm');
    assert.ok(JSON.stringify(page).length < 5000);
    const detail = await (await fetch(server.descriptor.url + '/activity?session=s&id=a&channel=output&limit=100', { headers })).json() as any;
    assert.equal(detail.text.length, 100);
    assert.equal(detail.total, 65000);
    assert.equal(detail.next, 100);
    assert.equal((await fetch(server.descriptor.url + '/activity?session=other&id=a', { headers })).status, 400);
    assert.equal((await fetch(server.descriptor.url + '/activity?session=s&id=a&offset=NaN', { headers })).status, 400);
  } finally { await server.close(); store.close(); }
});
