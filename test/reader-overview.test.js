import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReaderOverview } from '../src/lib/reader-overview.js';
import { abundanceSummary, dataCenterSummary } from '../src/lib/curation.js';
import { plainText, anchorSlug, presentConversation } from '../src/lib/presentation.js';
import { escapeHTML } from '../src/lib/html.js';
import abundance from '../content/google-basic-needs.json' with {type:'json'};
import centers from '../content/ai-data-centers.json' with {type:'json'};
import ranking from '../content/data-centers-original-ranking.json' with {type:'json'};
import source from './fixtures/gemini-data-centers-source.json' with {type:'json'};

test('reader overview quotes the original favorite, links to its source and does not split out Astra', () => {
 const html=renderReaderOverview(abundance,abundanceSummary);
 assert.ok(plainText(abundance.messages[11].content).includes(abundanceSummary.favorite.quote));
 assert.ok(html.includes(escapeHTML(abundanceSummary.favorite.quote)));
 assert.match(html,/at=message-12-how-this-wins-in-the-long-run/);
 assert.doesNotMatch(html,/\/s\/|Astra:|astra-note/);
 assert.ok(html.includes(abundanceSummary.intro));
 assert.match(renderReaderOverview({description:'<b>Operator description</b>'},null),/&lt;b&gt;Operator description&lt;\/b&gt;/);
});

test('data-center original ranking retains all three source tiers and nine exact issue labels', () => {
 const html=renderReaderOverview(centers,dataCenterSummary);
 const answer=source.turns[7].response.replace(/\s+/g,' ').trim();
 assert.equal(plainText(centers.messages[15].content),answer);
 assert.equal((centers.messages[15].content.match(/<h3>/g)||[]).length,4);
 assert.equal((centers.messages[15].content.match(/<ol>/g)||[]).length,3);
 assert.equal((centers.messages[15].content.match(/<li>/g)||[]).length,9);
 for(const tier of ranking.tiers){
  assert.ok(answer.includes(tier.heading));assert.ok(html.includes(escapeHTML(tier.heading)));
  assert.equal(tier.target,'message-16-'+anchorSlug(tier.heading));
  for(const issue of tier.issues){assert.ok(answer.includes(issue));assert.ok(html.includes(escapeHTML(issue)));}
 }
 assert.doesNotMatch(html,/What matters most|priority-list/);
 assert.match(html,/Gemini’s original ranking/);assert.match(html,/message 21/);
 const flat=structuredClone(centers);flat.messages[15].content=flat.messages[15].content.replace(/h3/g,'p');
 assert.equal(presentConversation(flat).messages[15].content,centers.messages[15].content);
 const edited=structuredClone(flat);edited.messages[15].content='<p>Operator correction</p>';
 assert.equal(presentConversation(edited).messages[15].content,edited.messages[15].content);
});

for (const [name, conversation, curated, index, marker, target] of [
 ['ranking', centers, dataCenterSummary, 15, 'Gemini’s original ranking', ranking.tiers[0].target],
 ['favorite', abundance, abundanceSummary, 11, 'Favorite passage', abundanceSummary.favorite.target],
]) {
 test(`${name} only quotes a matching source answer`, () => {
  for (const change of [
   message => { message.content = '<p>Operator correction</p>'; },
   message => { message.role = 'user'; },
   message => { message.content += '<a href="https://example.com/corrected-source">Source</a>'; },
  ]) {
   const edited = structuredClone(conversation);
   change(edited.messages[index]);
   const presented = presentConversation(edited);
   const html = renderReaderOverview(presented, curated);
   assert.ok(!html.includes(marker));
   assert.ok(!html.includes(target));
   assert.deepEqual(presented.messages[index], edited.messages[index]);
   assert.deepEqual(presented.messages.at(-1), conversation.messages.at(-1));
  }
  const flat = structuredClone(conversation);
  flat.messages[index].content = flat.messages[index].content.replace(/h[1-6]/g, 'p');
  for (const row of [conversation, flat, presentConversation(flat)]) {
   const html = renderReaderOverview(row, curated);
   assert.ok(html.includes(marker));
   assert.ok(html.includes(target));
  }
 });
}
