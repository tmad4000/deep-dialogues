import test from 'node:test';
import assert from 'node:assert/strict';
import { headingIdAllocator } from '../src/lib/reader-tools.js';
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

const legacySteps = [
  'message-12-step-1-the-digital-blueprint-open-sourcing-the-engineers',
  'message-12-step-2-the-hyper-local-energy-decoupling-the-individuals',
  'message-12-step-3-micro-farming-guilds-the-neighborhoods',
  'message-12-step-4-crowdfunded-land-trusts-the-investors',
  'message-12-step-5-decentralized-ai-health-frameworks-the-medical-community'
].map(target=>({target}));

test('curated blueprint destinations retain their heading IDs', () => {
  const targets = new Set();
  conversation.messages.forEach((message, i) => {
    const allocate = headingIdAllocator(`message-${i + 1}`);
    for (const heading of message.content.matchAll(/<h([1-6])>(.*?)<\/h\1>/gs)) {
      targets.add(allocate(heading[2]));
    }
  });
  assert.equal(legacySteps.length, 5);
  for (const step of legacySteps) assert.ok(targets.has(step.target), step.target);
});
