import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { seedConversations } from '../src/data/seed.js';

test('persistent archive, pending submissions, filters and publication', async () => {
  const dir = mkdtempSync(join(process.env.TEST_TMPDIR || tmpdir(), 'dialogues-'));
  let store = openStore(join(dir, 'test.sqlite'));
  let server = createApp(store, process.cwd()).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(store.list({ limit: Infinity }).length, seedConversations.length);
    const body = { title: 'Persistence verification', status: 'published', featured: true, contributor_name: 'QA', tags: ['verification'], original_url: 'https://example.com/dialogue', messages: [{ role: 'user', content: 'Question' }, { role: 'ai', model: 'GPT-6 Astra', content: 'Thoughts' }] };
    const submit = await fetch(url + '/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(submit.status, 201);
    const row = await submit.json();
    assert.equal(row.status, 'pending');
    assert.equal(row.featured, undefined);
    assert.equal(row.contributor_name, 'QA');
    assert.equal(row.messages[1].model, 'GPT-6 Astra');
    assert.equal((await fetch(url + '/api/conversations/' + row.slug)).status, 404);
    assert.equal((await (await fetch(url + '/api/conversations?tag=verification')).json()).length, 0);
    await new Promise(resolve => server.close(resolve));
    store.db.close();
    store = openStore(join(dir, 'test.sqlite'));
    assert.equal(store.get(row.slug, true).messages[0].role, 'human');
    assert.equal(store.list({ limit: Infinity }).length, seedConversations.length);
    store.publish(row.slug);
    assert.equal(store.list({ tag: 'verification', contributor: 'qa', limit: 100 }).length, 1);
    assert.equal(store.get(row.slug).messages.length, 2);
    server = createApp(store, process.cwd()).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const restarted = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(restarted + '/api/conversations/' + row.slug)).status, 200);
    assert.equal((await (await fetch(restarted + '/api/conversations?tag=verification')).json()).length, 1);
    assert.equal((await fetch(restarted + '/api/conversations?tag[a]=bad')).status, 200);
    const compressed = await fetch(restarted + '/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: 'invalid' });
    assert.equal(compressed.status, 415);
    const invalid = await fetch(restarted + '/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Bad', messages: [{ role: 'assistant', content: 3 }] }) });
    assert.equal(invalid.status, 400);
    const unknown = await fetch(restarted + '/api/not-a-route');
    assert.equal(unknown.status, 404);
    assert.match(unknown.headers.get('Content-Type'), /json/);
    assert.equal((await fetch(restarted + '/health')).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.db.close(); rmSync(dir, { recursive: true });
  }
});
