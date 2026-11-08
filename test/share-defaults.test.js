import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

const shell = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

async function withServer(store, fn) {
  // Not a dot-directory: express.sendFile refuses dotfile paths.
  const root = mkdtempSync(join(process.cwd(), 'share-defaults-test-'));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist', 'index.html'), shell);
  const server = createApp(store, root).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
}

const count = (html, needle) => html.split(needle).length - 1;

test('gallery shell carries site-wide link-preview tags', async () => {
  await withServer({ get: () => null }, async base => {
    const html = await (await fetch(base + '/')).text();
    assert.ok(html.includes('<meta property="og:title" content="Deep Dialogues — A Gallery of AI Conversations">'));
    assert.ok(html.includes('<meta property="og:image" content="https://deep-dialogues.ideaflow.app/share/dialogues.png">'));
    assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image">'));
  });
});

test('reader replaces every shell share tag with the conversation’s own', async () => {
  const conversation = { slug: 'clockwork', title: 'Clockwork and Souls', description: 'Mechanism that wonders.' };
  await withServer({ get: slug => slug === 'clockwork' ? conversation : null }, async base => {
    const html = await (await fetch(base + '/read/clockwork')).text();
    for (const tag of ['property="og:title"', 'property="og:description"', 'property="og:url"', 'property="og:image"',
      'property="og:type"', 'name="twitter:card"', 'name="twitter:title"', 'name="description"']) {
      assert.equal(count(html, `<meta ${tag}`), 1, tag);
    }
    assert.ok(html.includes('<title>Clockwork and Souls — Deep Dialogues</title>'));
    assert.ok(html.includes('<meta property="og:title" content="Clockwork and Souls">'));
    assert.ok(html.includes('<meta property="og:type" content="article">'));
    assert.doesNotMatch(html, /A Gallery of AI Conversations/);
    const missing = await fetch(base + '/read/unpublished');
    assert.equal(missing.status, 404);
    const missingHtml = await missing.text();
    assert.ok(missingHtml.includes('<title>Conversation not found — Deep Dialogues</title>'));
    assert.doesNotMatch(missingHtml, /og:title|unpublished/);
  });
});
