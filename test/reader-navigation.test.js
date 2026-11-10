import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationFor, highlightSections, sectionLink, revealReaderTarget } from '../src/lib/reader-navigation.js';
import excerpt from '../content/waves-thought-highlights.json' with { type: 'json' };

test('chapters cover all original messages exactly once and highlights retain their three pairs', () => {
  const conversation = { slug: excerpt.slug, messages: Array.from({ length: 158 }, (_, i) => ({ content: `Original ${i + 1}` })) };
  const before = structuredClone(conversation);
  const navigation = navigationFor(conversation, excerpt);
  assert.deepEqual(navigation.chapters.flatMap(chapter => Array.from({ length: chapter.end - chapter.start + 1 }, (_, i) => chapter.start + i)), Array.from({ length: 158 }, (_, i) => i + 1));
  assert.equal(new Set(navigation.chapters.map(chapter => chapter.id)).size, 12);
  assert.deepEqual(highlightSections.map(section => excerpt.messages.slice(section.start, section.end).map(turn => turn.sourceMessage)), [[107, 108], [114, 117], [118, 120]]);
  assert.deepEqual(conversation, before);
  assert.equal(navigationFor(conversation, null), null);
});

test('a shared chapter URL retains the clean reader path and a section parameter', () => {
  const link = new URL(sectionLink(excerpt.slug, 'chapter-thought-waves'));
  assert.equal(link.pathname, `/read/${excerpt.slug}`);
  assert.equal(link.searchParams.get('section'), 'chapter-thought-waves');
  assert.equal(link.hash, '');
});

test('jumping to a message or chapter opens every enclosing disclosure', () => {
  const original = { open: false, parentElement: { closest: () => null } };
  const chapter = { open: false, parentElement: { closest: () => original }, closest() { return this; } };
  const message = { closest: () => chapter };
  revealReaderTarget(message);
  assert.ok(chapter.open && original.open);
  chapter.open = false; original.open = false;
  revealReaderTarget(chapter);
  assert.ok(chapter.open && original.open);
});
