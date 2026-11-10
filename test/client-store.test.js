import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { seedConversations } from '../src/data/seed.js';

test('conversation lookup respects HTTP errors and falls back only offline', async () => {
  const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
  const originalFetch = globalThis.fetch;
  try {
    const { getConversation } = await vite.ssrLoadModule('/src/lib/store.js');
    const seed = seedConversations[0];
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404 });
    assert.equal(await getConversation(seed.slug), null);
    globalThis.fetch = async () => new Response('unavailable', { status: 503 });
    assert.equal(await getConversation(seed.slug), null);
    globalThis.fetch = async () => { throw new TypeError('network unavailable'); };
    assert.equal((await getConversation(seed.slug)).slug, seed.slug);
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
  }
});
