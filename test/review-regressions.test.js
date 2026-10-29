import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
const { SourceTextModule, SyntheticModule, createContext } = vm;
import { presentConversation } from '../src/lib/presentation.js';
import { openStore } from '../server/store.js';
import { appRoute } from '../src/lib/paths.js';
import conversation from '../content/google-basic-needs.json' with { type: 'json' };
import { pinnedExchangeFor } from '../src/lib/reader-overview.js';
import { abundanceSummary, readerLink } from '../src/lib/curation.js';

async function execute(file, globals, imports) {
  const context = createContext(globals);
  const module = new SourceTextModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { context });
  await module.link(specifier => {
    const values = imports[specifier];
    assert.ok(values, `Unexpected import ${specifier}`);
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return module.namespace;
}

test('citation-only operator edits survive presentation', () => {
  const edited = structuredClone(conversation);
  const message = edited.messages.find(m => m.content.includes('href="'));
  assert.ok(message);
  message.content = message.content.replace(/href="[^"]+"/, 'href="https://example.com/corrected"');
  assert.equal(presentConversation(edited).messages[edited.messages.indexOf(message)].content, message.content);
});

test('publishing preserves raw persisted HTML while reads receive presentation', () => {
  const store = openStore(':memory:');
  try {
    const raw = () => JSON.parse(store.db.prepare('SELECT document FROM conversations WHERE slug = ?').get(conversation.slug).document);
    const original = raw();
    original.messages[11].content = original.messages[11].content.replaceAll('<strong>', '<b>').replaceAll('</strong>', '</b>');
    store.db.prepare('UPDATE conversations SET document = ? WHERE slug = ?').run(JSON.stringify(original), conversation.slug);
    const before = raw();
    assert.notEqual(before.messages[11].content, store.get(conversation.slug).messages[11].content);
    store.publish(conversation.slug);
    assert.deepEqual(raw().messages, before.messages);
    assert.equal(raw().status, 'published');
    assert.equal(store.get(conversation.slug).messages[11].content, conversation.messages[11].content);
  } finally { store.db.close(); }
});

test('blocked storage permits startup, theme toggles, and system theme events', { skip: !SourceTextModule }, async () => {
  let click, change, started = false;
  const attrs = new Map();
  const button = { addEventListener: (_, handler) => { click = handler; } };
  const document = { getElementById: id => id === 'theme-toggle' ? button : {}, documentElement: {
    setAttribute: (k,v) => attrs.set(k,v), getAttribute: k => attrs.get(k)
  } };
  const globals = { document, window: { matchMedia: () => ({ matches: false, addEventListener: (_, handler) => { change = handler; } }) } };
  Object.defineProperty(globals, 'localStorage', { get() { throw Error('blocked'); } });
  const noop = () => {};
  await execute('../src/main.js', globals, {
    './style.css': {}, './lib/paths.js': { appRoute }, './lib/router.js': { route: noop, startRouter: () => { started = true; } },
    './views/gallery.js': { renderGallery: noop }, './views/reader.js': { renderReader: noop },
    './views/submit.js': { renderSubmit: noop }, './views/contributors.js': { renderContributors: noop }, './views/api.js': { renderApi: noop }
  });
  assert.equal(started, true);
  assert.equal(attrs.get('data-theme'), 'light');
  change(); click();
  assert.equal(attrs.get('data-theme'), 'dark');
  change();
  assert.equal(attrs.get('data-theme'), 'dark');
});

for (const topic of [null, 'ai-data-centers', 'blueprint-for-abundance']) test(`reader renders correct attribution for ${topic || 'uncurated conversations'}`, { skip: !SourceTextModule }, async () => {
  const button = { addEventListener() {}, removeEventListener() {} };
  const container = { querySelector: () => button };
  const reader = await execute('../src/views/reader.js', {
    document: { getElementById: () => null, documentElement: { scrollHeight: 100 } },
    innerHeight: 100, addEventListener() {}, removeEventListener() {}
  }, {
    '../lib/html.js': { escapeHTML: v => String(v), safeHTML: v => v, safeURL: v => v },
    '../lib/store.js': { getConversation: async () => ({ title: 'Test', ai_model: 'Conversation model', messages: [
      { role: 'system', model: 'Message model', content: '<p>System instructions</p>' },
      { role: 'assistant', model: 'Message model', content: '<p>Response</p>' }
    ] }) },
    '../lib/paths.js': { appRoute }, '../lib/presentation.js': { presentConversation }, '../lib/curation.js': { curationFor: () => topic ? { slug: topic, path: '/summary', highlights: [] } : null, readerLink: () => '', publicOrigin: 'https://deep-dialogues.ideaflow.app' },
    '../lib/reader-overview.js': { renderReaderOverview: () => '', pinnedExchangeFor: () => null, renderPinnedExchange: () => '' },
    '../lib/reader-tools.js': { attachReaderTools: () => () => {} }
  });
  await reader.renderReader(container, { slug: 'test' });
  assert.ok(container.innerHTML.includes(`<h2 class="transcript-title">The original conversation${topic === 'ai-data-centers' ? ' · with Codex’s later review' : topic ? ' · with Astra’s later response' : ''}</h2>`));
  assert.match(container.innerHTML, /aria-label="Message 1, System"/);
  assert.match(container.innerHTML, /aria-label="Message 2, Message model"/);
});

test('prompts-only hides the pinned answer and restores its independent expansion state', { skip: !SourceTextModule }, async () => {
  let click;
  const attrs = new Map([['aria-pressed', 'false']]);
  const button = { getAttribute: k => attrs.get(k), setAttribute: (k,v) => attrs.set(k,v), addEventListener: (_, fn) => { click = fn; } };
  const answer = { hidden: false, open: true }, transcriptAnswer = { hidden: false };
  const container = { querySelector: () => button, querySelectorAll: selector => selector.split(',').flatMap(part => {
    switch (part.trim()) { case '.pinned-response': return [answer]; case '#conversation-flow .message-ai': return [transcriptAnswer]; default: return []; }
  }) };
  const overview = await execute('../src/lib/reader-overview.js', {}, {
    './html.js': { escapeHTML: v => String(v), safeHTML: v => v }, './curation.js': { readerLink },
    './presentation.js': { matchesSourceMessage: () => true }, '../../content/data-centers-original-ranking.json': { default: {} }
  });
  const reader = await execute('../src/views/reader.js', {
    document: { getElementById: () => null, documentElement: { scrollHeight: 100 } }, innerHeight: 100, addEventListener() {}, removeEventListener() {}
  }, {
    '../lib/html.js': { escapeHTML: v => String(v), safeHTML: v => v, safeURL: v => v },
    '../lib/store.js': { getConversation: async () => conversation }, '../lib/paths.js': { appRoute }, '../lib/presentation.js': { presentConversation },
    '../lib/curation.js': { curationFor: () => abundanceSummary, readerLink },
    '../lib/reader-overview.js': { renderReaderOverview: () => '', pinnedExchangeFor, renderPinnedExchange: overview.renderPinnedExchange },
    '../lib/reader-tools.js': { attachReaderTools: () => () => {} }
  });
  await reader.renderReader(container, { slug: conversation.slug });
  assert.match(container.innerHTML, /<details class="pinned-turn pinned-response" open>/);
  click();
  assert.equal(answer.hidden, true); assert.equal(transcriptAnswer.hidden, true); assert.equal(answer.open, true);
  click();
  assert.equal(answer.hidden, false); assert.equal(transcriptAnswer.hidden, false); assert.equal(answer.open, true);
});

if (!SourceTextModule) test('browser module behavior regressions', () => {
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', new URL(import.meta.url).pathname], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('app navigation retains the configured mirror mount', () => {
  assert.equal(new URL(appRoute('/contributors', '/deep-dialogues/'), 'https://tmad4000.github.io/deep-dialogues/').href, 'https://tmad4000.github.io/deep-dialogues/#/contributors');
  assert.equal(new URL(appRoute('/'), 'https://deep-dialogues.ideaflow.app/read/example').href, 'https://deep-dialogues.ideaflow.app/#/');
});
