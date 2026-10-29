import test from 'node:test';
import assert from 'node:assert/strict';
import { pinnedExchangeFor } from '../src/lib/reader-overview.js';
import { abundanceSummary } from '../src/lib/curation.js';
import abundance from '../content/google-basic-needs.json' with {type:'json'};

test('the pinned planning exchange uses the exact question and original response, not the later contribution',()=>{
 const before=JSON.stringify(abundance);
 const pin=pinnedExchangeFor(abundance,abundanceSummary);
 assert.equal(pin.question,11);assert.equal(pin.response,12);
 assert.equal(pin.questionMessage,abundance.messages[10]);
 assert.equal(pin.responseMessage,abundance.messages[11]);
 assert.notEqual(pin.responseMessage,abundance.messages[12]);
 assert.equal(JSON.stringify(abundance),before);
});

test('an edited original question or answer suppresses stale editorial pinning',()=>{
 for(const index of [10,11]) {
  const edited=structuredClone(abundance);edited.messages[index].content='<p>A changed message</p>';
  assert.equal(pinnedExchangeFor(edited,abundanceSummary),null);
 }
 assert.equal(pinnedExchangeFor({slug:'another-topic',messages:abundance.messages},abundanceSummary),null);
 assert.equal(pinnedExchangeFor(abundance,null),null);
});
