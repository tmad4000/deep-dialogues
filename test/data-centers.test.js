import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { plainText } from '../src/lib/presentation.js';
import { curationFor, dataCenterSummary } from '../src/lib/curation.js';
import source from './fixtures/gemini-data-centers-source.json' with { type: 'json' };
const normalize = text => text.replace(/\s+/g, ' ').trim();

test('data-center publication preserves ten exchanges and separates review from abundance', async () => {
  const root = mkdtempSync(join(process.cwd(), '.data-center-test-'));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist/index.html'), '<html><head><title>Deep Dialogues</title></head><body></body></html>');
  const store = openStore(':memory:');
  const server = createApp(store, root).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const row = await (await fetch(base + '/api/conversations/ai-data-centers')).json();
    assert.equal(row.messages.length, 21);
    source.turns.forEach((turn, i) => {
      assert.equal(plainText(row.messages[2*i].content), normalize(turn.prompt.split('\n\n').slice(1).join('\n\n')));
      assert.equal(plainText(row.messages[2*i+1].content), normalize(turn.response));
      assert.equal(row.messages[2*i+1].model, 'Gemini (Flash per Jacob; version unverified)');
    });
    assert.equal(row.messages[20].model, 'Codex · independent review');
    assert.equal(curationFor(row).slug, 'ai-data-centers');
    for (const highlight of dataCenterSummary.highlights) assert.ok(plainText(row.messages[highlight.message-1].content).includes(highlight.quote));
    const brief = await fetch(base + '/s/ai-data-centers');
    assert.equal(brief.status, 200);
    const html = await brief.text();
    assert.ok(html.indexOf('What matters most') < html.indexOf('Where Gemini went off track'));
    assert.match(html, /https:\/\/court.globalbr.ai\/case\/ai-data-center-siting/);
    assert.match(html, /Editorial priorities, not measured probabilities/);
    assert.ok(html.indexOf('Editorial priorities, not measured probabilities') < html.indexOf('<ul class="priority-list">'));
    assert.match(html, /<\/ul><details class="source-notes"><summary>How to read these priorities<\/summary>/);
    assert.ok(html.indexOf(dataCenterSummary.method) > html.indexOf('<ul class="priority-list">'));
    assert.doesNotMatch(html, /Google AI Mode’s blueprint|<script/);
    const abundance = await fetch(base + '/s/blueprint-for-abundance', {redirect:'manual'});
    assert.equal(abundance.status,308);
    assert.equal(abundance.headers.get('location'),'/read/basic-needs-work-and-abundance');
  } finally {
    await new Promise(resolve => server.close(resolve)); store.db.close();
    rmSync(root, { recursive: true });
  }
});
