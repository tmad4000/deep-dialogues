import test from 'node:test';
import assert from 'node:assert/strict';
import { headingIdAllocator } from '../src/lib/reader-tools.js';
import { abundanceSummary } from '../src/lib/curation.js';
import conversation from '../content/google-basic-needs.json' with { type: 'json' };

test('heading IDs stay unique across repeated and naturally suffixed headings', () => {
  for (const [titles, expected] of [
    [['Overview', 'Overview', 'Overview 2'], ['overview', 'overview-2', 'overview-2-2']],
    [['Overview', 'Overview 2', 'Overview'], ['overview', 'overview-2', 'overview-3']],
    [['Overview 2', 'Overview', 'Overview'], ['overview-2', 'overview', 'overview-3']],
  ]) {
    const allocate = () => titles.map(headingIdAllocator('message-1'));
    assert.deepEqual(allocate(), expected.map(id => `message-1-${id}`));
    assert.deepEqual(allocate(), allocate());
  }
  assert.equal(headingIdAllocator('message-2')('Overview'), 'message-2-overview');
});

test('curated blueprint destinations retain their heading IDs', () => {
  const targets = new Set();
  conversation.messages.forEach((message, i) => {
    const allocate = headingIdAllocator(`message-${i + 1}`);
    for (const heading of message.content.matchAll(/<h([1-6])>(.*?)<\/h\1>/gs)) {
      targets.add(allocate(heading[2]));
    }
  });
  assert.equal(abundanceSummary.googleSteps.length, 5);
  for (const step of abundanceSummary.googleSteps) assert.ok(targets.has(step.target), step.target);
});
