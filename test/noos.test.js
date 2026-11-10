import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.js';
import { createNoosSync, nodePayload } from '../server/noos.js';

function fakeNoos({ failOnce = false } = {}) {
  const nodes = new Map(), calls = [];
  let n = 0, failed = false;
  const fetchImpl = async (url, init) => {
    const u = new URL(url), body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path: u.pathname, body, auth: init.headers.Authorization });
    const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
    if (failOnce && !failed) { failed = true; return new Response('secret upstream detail', { status: 503 }); }
    if (init.method === 'GET') return json({ nodes: [...nodes.values()].filter(x => x.externalUri === u.searchParams.get('externalUri')) });
    if (init.method === 'POST') { const id = `node${String(++n).padStart(8, '0')}`; nodes.set(id, { id, ...body }); return json({ id, ...body }, 201); }
    if (init.method === 'PUT') { const id = decodeURIComponent(u.pathname.split('/').pop()); Object.assign(nodes.get(id), body); return json(nodes.get(id)); }
  };
  return { nodes, calls, fetchImpl };
}
const config = { enabled: true, baseUrl: 'http://noos.test', apiKey: 'noos_test', publicOrigin: 'https://dd.test' };

test('only published dialogues reach Noos, with stable upserts and unpublish hiding', async () => {
  const store = openStore(':memory:');
  const noos = fakeNoos();
  const sync = createNoosSync(store, config, { fetchImpl: noos.fetchImpl });
  try {
    const pending = store.save({ slug: 'secret-draft', title: 'Private draft', messages: [{ role: 'human', content: 'private words' }], submitted_by: { sub: 's', email: 'a@b.c' } });
    const results = await sync.syncAll();
    assert.ok(results.every(r => r.state === 'synced'));
    const dialogues = [...noos.nodes.values()].filter(x => x.type === 'note');
    assert.equal(dialogues.length, store.list({ limit: Infinity }).length);
    const everything = JSON.stringify([...noos.nodes.values()]);
    for (const leak of ['secret-draft', 'private words', 'a@b.c', 'submitted_by']) assert.ok(!everything.includes(leak), leak);
    assert.ok(dialogues.every(x => x.visibility === 'public' && x.externalUri.startsWith('https://dd.test/read/') && x.tags.includes('deep-dialogues')));
    const collection = [...noos.nodes.values()].find(x => x.type === 'list');
    assert.equal(collection.title, 'Deep Dialogues');
    assert.ok(dialogues.every(x => x.parentId === collection.id));
    assert.ok(noos.calls.every(c => c.auth === 'Bearer noos_test'));

    // Idempotent: a second pass writes nothing.
    const before = noos.calls.length;
    await sync.syncAll();
    assert.equal(noos.calls.length, before);

    // Publication creates one node; unpublishing hides it rather than leaving it public.
    store.publish(pending.slug);
    await sync.syncSlugs([pending.slug]);
    const node = [...noos.nodes.values()].find(x => x.sourceId === pending.slug);
    assert.equal(node.visibility, 'public');
    assert.ok(!JSON.stringify(node).includes('a@b.c'));
    store.review(pending.slug, { action: 'unpublish', reviewer: { sub: 'admin' } });
    await sync.syncAll();
    assert.equal(node.visibility, 'private');
    assert.equal(sync.status(pending.slug).state, 'hidden');
  } finally { store.db.close(); }
});

test('Noos failures are recorded without upstream bodies and retried', async () => {
  const store = openStore(':memory:');
  const noos = fakeNoos({ failOnce: true });
  const sync = createNoosSync(store, config, { fetchImpl: noos.fetchImpl });
  try {
    const slug = store.list({ limit: 1 })[0].slug;
    const [first] = await sync.syncSlugs([slug]);
    assert.equal(first.state, 'error');
    assert.ok(!first.error.includes('secret upstream detail'));
    const [second] = await sync.syncSlugs([slug]);
    assert.equal(second.state, 'synced');
  } finally { store.db.close(); }
});

test('node payload names participants and links both versions', () => {
  const payload = nodePayload({ slug: 'x-highlights', title: 'X · Highlights', tags: ['Philosophy of Mind'], contributor_name: 'Jacob',
    versions: { full: 'x', highlights: 'x-highlights' }, messages: [{ role: 'human', content: '<p>Why?</p>' }, { role: 'assistant', model: 'GPT-6 Astra', content: 'Because' }] }, 'https://dd.test');
  assert.match(payload.content, /Participants: Jacob, GPT-6 Astra/);
  assert.match(payload.content, /Highlights of: https:\/\/dd\.test\/read\/x\n/);
  assert.deepEqual(payload.tags, ['deep-dialogues', 'philosophy-of-mind', 'gpt-6-astra']);
});

test('highlights-only hides a previously published full dialogue', async () => {
  const store = openStore(':memory:');
  const noos = fakeNoos();
  const sync = createNoosSync(store, config, { fetchImpl: noos.fetchImpl });
  try {
    const row = store.save({ slug: 'full-private', title: 'Full', messages: [{ role: 'human', content: 'secret' }, { role: 'assistant', content: 'answer' }] }, 'published');
    await sync.syncOne(row.slug);
    const result = store.review(row.slug, { action: 'publish', version: 'highlights', highlights: [1] });
    await sync.syncSlugs(result.rows.map(r => r.slug));
    assert.equal(store.readRaw(row.slug).status, 'superseded');
    assert.equal(store.readRaw(row.slug).versions, undefined);
    assert.equal(store.get(row.slug), null);
    assert.equal([...noos.nodes.values()].find(n => n.sourceId === row.slug).visibility, 'private');
    assert.equal(store.get(result.rows[1].slug).versions, undefined);
  } finally { store.db.close(); }
});

test('unpublish during creation reconciles the resulting node to private', async () => {
  const store = openStore(':memory:');
  const noos = fakeNoos();
  let release, started;
  const blocked = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  const fetchImpl = async (url, init) => {
    if (init.method === 'POST' && JSON.parse(init.body).sourceId === 'racing') {
      started(); await blocked;
    }
    return noos.fetchImpl(url, init);
  };
  const sync = createNoosSync(store, config, { fetchImpl });
  try {
    store.save({ slug: 'racing', title: 'Race', messages: [{ role: 'human', content: 'secret' }] }, 'published');
    const publishing = sync.syncOne('racing');
    await entered;
    store.review('racing', { action: 'unpublish' });
    const unpublishing = sync.syncOne('racing');
    release();
    await Promise.all([publishing, unpublishing]);
    assert.equal([...noos.nodes.values()].find(n => n.sourceId === 'racing').visibility, 'private');
    assert.equal(sync.status('racing').state, 'hidden');
  } finally { store.db.close(); }
});

test('retry selects errors and published rows without a synced record', async () => {
  const store = openStore(':memory:');
  const noos = fakeNoos();
  const sync = createNoosSync(store, config, { fetchImpl: noos.fetchImpl });
  try {
    await sync.syncAll();
    store.save({ slug: 'missing', title: 'Missing', messages: [{ role: 'human', content: 'x' }] }, 'published');
    store.save({ slug: 'private-error', title: 'Private', messages: [{ role: 'human', content: 'x' }] });
    store.db.prepare("INSERT INTO noos_sync VALUES (?, NULL, NULL, 'error', 'failed', ?)").run('private-error', new Date().toISOString());
    const results = await sync.syncRetry();
    assert.deepEqual(new Set(results.map(r => r.slug)), new Set(['missing', 'private-error']));
    assert.equal(sync.status('missing').state, 'synced');
    assert.equal(sync.status('private-error').state, 'skipped');
  } finally { store.db.close(); }
});

test('pending edits preserve omitted fields and clear explicit null or empty fields', () => {
  const store = openStore(':memory:');
  try {
    const messages = [{ role: 'human', content: 'hello' }];
    store.save({ slug: 'edit', title: 'Old', messages, commentary: 'keep', highlights: ['keep'], description: 'remove', contributor_name: 'remove', submitted_by: { sub: 'owner' } });
    const { row } = store.updatePending('edit', 'owner', { title: 'New', messages, description: null, contributor_name: '' });
    assert.equal(row.commentary, 'keep');
    assert.deepEqual(row.highlights, ['keep']);
    assert.equal(row.description, undefined);
    assert.equal(row.contributor_name, undefined);
  } finally { store.db.close(); }
});


test('pending review recovers an unrecorded public node after a crash', async () => {
  const store = openStore(':memory:');
  const noos = fakeNoos();
  const sync = createNoosSync(store, config, { fetchImpl: noos.fetchImpl });
  try {
    store.save({ slug: 'crashed', title: 'Crashed', messages: [{ role: 'human', content: 'private' }] }, 'published');
    noos.nodes.set('lost-node', { id: 'lost-node', externalUri: 'https://dd.test/read/crashed', visibility: 'public' });
    const result = store.review('crashed', { action: 'unpublish' });
    assert.deepEqual(result.syncSlugs, ['crashed']);
    assert.equal(sync.status('crashed').state, 'pending');
    assert.equal(sync.status('crashed').node_id, null);
    await sync.syncRetry();
    assert.equal(noos.nodes.get('lost-node').visibility, 'private');
    assert.equal(sync.status('crashed').node_id, 'lost-node');
    assert.equal(sync.status('crashed').state, 'hidden');
  } finally { store.db.close(); }
});

test('visibility changes queue linked public siblings and refresh their Noos links', async () => {
  const store = openStore(':memory:');
  const noos = fakeNoos();
  const sync = createNoosSync(store, config, { fetchImpl: noos.fetchImpl });
  try {
    store.save({ slug: 'pair', title: 'Pair', messages: [{ role: 'human', content: 'one' }, { role: 'assistant', content: 'two' }] });
    const published = store.review('pair', { action: 'publish', version: 'both', highlights: [0] });
    await sync.syncSlugs(published.syncSlugs);
    const highlights = published.rows[1].slug;
    const node = [...noos.nodes.values()].find(n => n.sourceId === highlights);
    assert.match(node.content, /Highlights of:/);
    const result = store.review('pair', { action: 'unpublish' });
    assert.deepEqual(new Set(result.syncSlugs), new Set(['pair', highlights]));
    assert.equal(sync.status(highlights).state, 'pending');
    await sync.syncRetry();
    assert.doesNotMatch(node.content, /Highlights of:/);
    const republished = store.review('pair', { action: 'publish', version: 'full' });
    assert.ok(republished.syncSlugs.includes(highlights));
    await sync.syncSlugs(republished.syncSlugs);
    assert.match(node.content, /Highlights of:/);
  } finally { store.db.close(); }
});


test('public highlights hide the original source whenever the full version is private', () => {
  const store = openStore(':memory:');
  try {
    const original_url = 'https://example.test/full-transcript';
    const messages = [{ role: 'human', content: 'first' }, { role: 'assistant', content: 'second' }];
    store.save({ slug: 'private-source', title: 'Private', original_url, messages });
    const only = store.review('private-source', { action: 'publish', version: 'highlights', highlights: [0] });
    assert.equal(store.get(only.rows[1].slug).original_url, undefined);
    assert.equal(store.readRaw(only.rows[1].slug).original_url, undefined);
    assert.equal(store.readRaw('private-source').original_url, original_url);
    store.save({ slug: 'public-source', title: 'Public', original_url, messages });
    const both = store.review('public-source', { action: 'publish', version: 'both', highlights: [0] });
    const highlight = both.rows[1].slug;
    assert.equal(store.get(highlight).original_url, original_url);
    store.review('public-source', { action: 'unpublish' });
    assert.equal(store.get(highlight).original_url, undefined);
    assert.equal(store.list({ limit: Infinity }).find(row => row.slug === highlight).original_url, undefined);
    store.review('public-source', { action: 'publish', version: 'full' });
    assert.equal(store.get(highlight).original_url, original_url);
  } finally { store.db.close(); }
});
