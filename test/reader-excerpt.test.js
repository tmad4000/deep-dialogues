import test from 'node:test';
import assert from 'node:assert/strict';
import { excerptFor } from '../src/lib/reader-excerpt.js';
import highlights from '../content/waves-thought-highlights.json' with { type: 'json' };

function original() {
  const messages = Array.from({ length: highlights.messageCount }, () => ({ role: 'human', content: '<p>Other original turn</p>' }));
  for (const turn of highlights.messages) messages[turn.sourceMessage - 1] = structuredClone(turn.source);
  return { slug: highlights.slug, ai_model: 'Codex GPT-6 Astra', messages };
}

test('reviewed excerpt retains its six attributed turns and original destinations without changing the transcript', () => {
  const conversation = original(), before = structuredClone(conversation);
  const excerpt = excerptFor(conversation);
  assert.equal(excerpt.messages.length, 6);
  assert.deepEqual(excerpt.messages.map(turn => turn.sourceMessage), [107, 108, 114, 117, 118, 120]);
  assert.deepEqual(excerpt.messages.map(turn => turn.role), ['human', 'assistant', 'human', 'assistant', 'human', 'assistant']);
  assert.deepEqual(conversation, before);
});

test('edited source text, citation, speaker or model suppresses the excerpt instead of showing stale highlights', () => {
  for (const edit of [
    source => { source.content += '<p>A correction</p>'; },
    source => { source.content += '<a href="https://example.com/corrected">New citation</a>'; },
    source => { source.role = 'system'; },
    source => { source.model = 'Another model'; },
  ]) {
    const conversation = original();
    edit(conversation.messages[116]);
    const before = structuredClone(conversation);
    assert.equal(excerptFor(conversation), null);
    assert.deepEqual(conversation, before);
  }
  assert.equal(excerptFor({ ...original(), slug: 'another-dialogue' }), null);
  const shorter = original(); shorter.messages.pop();
  assert.equal(excerptFor(shorter), null);
});
