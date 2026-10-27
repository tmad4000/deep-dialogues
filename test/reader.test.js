import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,rmSync,mkdirSync,writeFileSync,copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { plainText,presentConversation,anchorSlug } from '../src/lib/presentation.js';
import { abundanceSummary,readerLink } from '../src/lib/curation.js';
import { loadReadingState,saveReadingState,toggleBookmark,quoteLocation } from '../src/lib/reading-state.js';
import conversation from '../content/google-basic-needs.json' with {type:'json'};
const baseline=JSON.parse(readFileSync(new URL('./fixtures/published-basic-needs.json',import.meta.url),'utf8'));

test('published API retains every original word, source link and model while adding semantic rich text',async()=>{
 const store=openStore(':memory:');const server=createApp(store,process.cwd()).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/conversations/${conversation.slug}`);const row=await response.json();
 assert.equal(row.messages.length,13);
 row.messages.forEach((m,i)=>{assert.equal(plainText(m.content),baseline[i].text);assert.equal(m.model??null,baseline[i].model);assert.equal(m.role,baseline[i].role);assert.deepEqual([...m.content.matchAll(/href="([^"]+)"/g)].map(x=>x[1]),baseline[i].links);});
 assert.match(row.messages[11].content,/<h3>.*Step 1:/);assert.match(row.messages[11].content,/<ul>/);assert.match(row.messages[7].content,/<table><thead>/);
 const edited={...row,messages:row.messages.map((m,i)=>i===1?{...m,content:'<p>An operator’s later edit.</p>'}:m)};assert.equal(presentConversation(edited).messages[1].content,edited.messages[1].content);
 }finally{await new Promise(r=>server.close(r));store.db.close();}
});

test('bookmarks survive reload, highlights have exact quote positions, storage failure is recoverable',()=>{
 const values=new Map();const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
 let items=toggleBookmark([],'message-12','Blueprint');assert.ok(saveReadingState(storage,'example',items));assert.deepEqual(loadReadingState(storage,'example'),items);assert.deepEqual(loadReadingState(storage,'other'),[]);
 items=toggleBookmark(items,'message-12','Blueprint');assert.equal(items.length,0);
 const highlight={id:'h1',target:'message-12',label:'Passage',type:'highlight',start:4,quote:'test'};assert.ok(saveReadingState(storage,'example',[highlight]));assert.deepEqual(loadReadingState(storage,'example'),[highlight]);
 assert.equal(quoteLocation('one test two','test',4),4);assert.equal(quoteLocation('test test','test'),-1);assert.equal(quoteLocation('test test','test',5),5);assert.equal(quoteLocation('altered','test',4),-1);
 assert.equal(saveReadingState({setItem(){throw Error('quota')}},'example',items),false);assert.deepEqual(loadReadingState({getItem(){throw Error('blocked')}},'example'),[]);
 values.set('deep-dialogues.reading.v1:example',JSON.stringify([{...highlight,target:'<script>'}]));assert.deepEqual(loadReadingState(storage,'example'),[]);
 const link=new URL(readerLink('example','message-12','A & B',2));assert.equal(link.pathname,'/read/example');assert.equal(link.searchParams.get('quote'),'A & B');assert.equal(link.searchParams.get('from'),'2');
});

test('curated quotations and section destinations resolve to the actual original messages',()=>{
 const targets=new Set(conversation.messages.map((_,i)=>`message-${i+1}`));
 conversation.messages.forEach((m,i)=>{const counts=new Map();for(const h of m.content.matchAll(/<h([1-6])>(.*?)<\/h\1>/gs)){const base=`message-${i+1}-${anchorSlug(h[2])}`;const n=(counts.get(base)||0)+1;counts.set(base,n);targets.add(n===1?base:`${base}-${n}`);}});
 for(const h of [...abundanceSummary.highlights,abundanceSummary.favorite]){assert.ok(plainText(conversation.messages[h.message-1].content).includes(h.quote),h.label);assert.ok(targets.has(h.target),h.target);}

});

test('retired summary redirects to canonical reader and reader has social previews; legacy URLs survive',async()=>{
 const root=mkdtempSync(join(process.env.TEST_TMPDIR||tmpdir(),'dialogue-shell-'));mkdirSync(join(root,'dist','share'),{recursive:true});writeFileSync(join(root,'dist','index.html'),readFileSync('index.html'));copyFileSync('public/share/abundance.png',join(root,'dist','share','abundance.png'));
 const store=openStore(':memory:');const server=createApp(store,root).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{const response=await fetch(base+'/s/blueprint-for-abundance',{redirect:'manual'});assert.equal(response.status,308);assert.equal(response.headers.get('location'),abundanceSummary.path);
 const html=await (await fetch(base+abundanceSummary.path)).text();
 for(const name of ['og:title','og:description','og:url','og:image','twitter:card'])assert.match(html,new RegExp(`(?:property|name)="${name}" content="[^"]+"`));
 assert.ok(html.includes(`property="og:url" content="https://deep-dialogues.ideaflow.app${abundanceSummary.path}"`));assert.ok(html.includes(abundanceSummary.description));assert.doesNotMatch(html,/Astra: make the promise dependable/);
 const card=await fetch(base+'/share/abundance.png');assert.equal(card.status,200);assert.match(card.headers.get('content-type'),/image\/png/);const bytes=Buffer.from(await card.arrayBuffer());assert.equal(bytes.readUInt32BE(16),1200);assert.equal(bytes.readUInt32BE(20),630);
 const reader=await fetch(base+`/read/${conversation.slug}?at=message-12`);assert.equal(reader.status,200);assert.match(await reader.text(),/<link rel="canonical" href="https:\/\/deep-dialogues.ideaflow.app\/read\/basic-needs-work-and-abundance"/);
 assert.equal((await fetch(base+'/#/read/'+conversation.slug)).status,200);
 assert.equal((await fetch(base+'/read/missing')).status,404);
 }finally{await new Promise(r=>server.close(r));store.db.close();rmSync(root,{recursive:true});}
});
