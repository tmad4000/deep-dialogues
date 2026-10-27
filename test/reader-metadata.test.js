import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

test('reader HTTP metadata preserves literal dollar sequences and escapes operator text', async () => {
  const root = mkdtempSync(join(process.cwd(), '.metadata-test-'));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist', 'index.html'), '<!doctype html><html><head><title>Shell title</title><meta name="description" content="Shell description"></head><body><main>Reader shell</main></body></html>');
  const title = 'Title $& $\' $` $$ "<tag>"';
  const description = 'Description $& $\' $` $$ "<tag>"';
  const escapedTitle = 'Title $&amp; $&#39; $` $$ &quot;&lt;tag&gt;&quot;';
  const escapedDescription = 'Description $&amp; $&#39; $` $$ &quot;&lt;tag&gt;&quot;';
  const server = createApp({ get: () => ({ slug: 'operator-edited', title, description }) }, root).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/read/operator-edited`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes(`<title>${escapedTitle} — Deep Dialogues</title>`));
    for (const attribute of ['name="description"', 'property="og:description"', 'name="twitter:description"']) {
      assert.ok(html.includes(`<meta ${attribute} content="${escapedDescription}">`));
    }
    for (const attribute of ['property="og:title"', 'name="twitter:title"']) {
      assert.ok(html.includes(`<meta ${attribute} content="${escapedTitle}">`));
    }
    assert.equal((html.match(/<body>/g) || []).length, 1);
    assert.ok(html.endsWith('<body><main>Reader shell</main></body></html>'));
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
