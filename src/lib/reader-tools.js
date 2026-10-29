import { escapeHTML as e } from './html.js';
import { anchorSlug } from './presentation.js';
import { readerLink } from './curation.js';
import { loadReadingState,saveReadingState,toggleBookmark,quoteLocation } from './reading-state.js';

function nodes(body) {
  const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement.closest('.section-tools')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  const result=[];while(walker.nextNode()) result.push(walker.currentNode);return result;
}
function text(body) { return nodes(body).map(n=>n.textContent).join(''); }
function fragmentText(fragment) { fragment.querySelectorAll('.section-tools').forEach(n=>n.remove());return fragment.textContent; }
function mark(body,start,quote,id,shared=false) {
  if(text(body).slice(start,start+quote.length)!==quote)return null;
  let offset=0;const pieces=[];
  for(const node of nodes(body)){const end=offset+node.length;if(end>start && offset<start+quote.length)pieces.push({node,a:Math.max(0,start-offset),b:Math.min(node.length,start+quote.length-offset)});offset=end;}
  let first;
  for(const {node,a,b} of pieces.reverse()) {if(b<node.length)node.splitText(b);const selected=a?node.splitText(a):node;const tag=document.createElement('mark');tag.dataset.highlight=id;tag.className=shared?'shared-highlight':'saved-highlight';selected.replaceWith(tag);tag.append(selected);first=tag;}
  return first;
}

export function headingIdAllocator(messageId) {
  const used = new Set();
  return title => {
    const base = `${messageId}-${anchorSlug(title)}`;
    let id = base, suffix = 2;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id);
    return id;
  };
}

export function attachReaderTools(container,c) {
  const flow=container.querySelector('#conversation-flow');
  const status=container.querySelector('#reader-status');
  const saved=container.querySelector('#saved-items');
  const say=message=>{status.textContent=message;};
  let storage;try{storage=window.localStorage;}catch{storage=null;}
  let items=loadReadingState(storage,c.slug),selection=null,activeShared=null;
  const sectionNames=new Map();
  flow.querySelectorAll('.message').forEach((message,i)=>{
    message.id=`message-${i+1}`;sectionNames.set(message.id,`Message ${i+1} · ${message.querySelector('.message-label').textContent}`);
    const headingId=headingIdAllocator(message.id);
    message.querySelectorAll('.message-body h1,.message-body h2,.message-body h3,.message-body h4,.message-body h5,.message-body h6').forEach(heading=>{
      heading.id=headingId(heading.textContent);heading.tabIndex=-1;sectionNames.set(heading.id,heading.textContent);
      const actions=document.createElement('div');actions.className='section-tools';actions.innerHTML=`<button type="button" data-copy-target="${heading.id}" aria-label="Copy link to ${e(heading.textContent)}">Link</button><button type="button" data-bookmark="${heading.id}" aria-pressed="false" aria-label="Bookmark ${e(heading.textContent)}">Bookmark</button>`;heading.after(actions);
    });
    message.querySelectorAll('table').forEach(table=>{const wrap=document.createElement('div');wrap.className='table-scroll';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Response table; scroll horizontally on small screens');table.replaceWith(wrap);wrap.append(table);});
  });
  const linkFor=(target,quote,start)=>readerLink(c.slug,target,quote,start);
  async function copy(url) {
    try{await navigator.clipboard.writeText(url);say('Link copied.');}
    catch {const dialog=container.querySelector('#copy-dialog');const input=dialog.querySelector('input');input.value=url;dialog.showModal();input.focus();input.select();say('Copy is unavailable here. The link is selected in the dialog.');}
  }
  function refreshMarks() {
    flow.querySelectorAll('mark[data-highlight]').forEach(n=>n.replaceWith(...n.childNodes));flow.normalize();
    for(const item of items.filter(x=>x.type==='highlight')) {const message=container.querySelector(`#${item.target}`)?.closest('.message');if(message)mark(message.querySelector('.message-body'),item.start,item.quote,item.id);}
    if(activeShared)mark(activeShared.body,activeShared.start,activeShared.quote,'shared',true);
  }
  function renderSaved() {
    saved.innerHTML=items.length ? items.map(item=>`<li><a href="${e(linkFor(item.target,item.quote,item.start))}">${e(item.label)}</a>${item.quote?`<p>“${e(item.quote)}”</p>`:''}<div class="saved-item-actions"><button type="button" data-copy-saved="${e(item.id)}">Copy link</button><button type="button" data-remove-saved="${e(item.id)}">Remove</button></div></li>`).join('') : '<li>No saved passages yet. Bookmark a message or heading, or select text and choose Highlight selection.</li>';
    container.querySelector('#saved-count').textContent=String(items.length);
    container.querySelectorAll('[data-bookmark]').forEach(button=>button.setAttribute('aria-pressed',String(items.some(x=>x.id===`bookmark:${button.dataset.bookmark}`))));
  }
  function persist(next) {
    if(next.length>250){say('This browser has reached the 250 saved-passage limit. Remove an item before adding another.');return false;}
    if(!saveReadingState(storage,c.slug,next)){say('This browser cannot save bookmarks. Enable local storage or use a copyable passage link.');return false;}
    items=next;refreshMarks();renderSaved();return true;
  }
  function rememberSelection() {
    const selected=window.getSelection();
    if(!selected?.rangeCount || selected.isCollapsed)return;
    const range=selected.getRangeAt(0);const el=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;const body=el.closest('.message-body');
    if(!body || !flow.contains(body) || !body.contains(range.endContainer)){selection=null;return;}
    const quote=fragmentText(range.cloneContents());if(!quote.trim()||quote.length>1200){selection=null;return;}
    const prefix=document.createRange();prefix.selectNodeContents(body);prefix.setEnd(range.startContainer,range.startOffset);
    selection={target:body.closest('.message').id,start:fragmentText(prefix.cloneContents()).length,quote};
  }
  function click(event) {
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.copyTarget)copy(linkFor(button.dataset.copyTarget));
    if(button.dataset.bookmark){if(persist(toggleBookmark(items,button.dataset.bookmark,sectionNames.get(button.dataset.bookmark)||button.dataset.bookmark)))say(button.getAttribute('aria-pressed')==='true'?'Bookmark saved in this browser.':'Bookmark removed.');}
    if(button.dataset.copySaved){const item=items.find(x=>x.id===button.dataset.copySaved);if(item)copy(linkFor(item.target,item.quote,item.start));}
    if(button.dataset.removeSaved){if(persist(items.filter(x=>x.id!==button.dataset.removeSaved))){say('Saved passage removed.');saved.closest('details').querySelector('summary').focus();}}
    if(button.id==='highlight-selection') {
      if(!selection){say('Select up to 1,200 characters within one message, then choose Highlight selection.');return;}
      const body=container.querySelector(`#${selection.target} .message-body`);
      if(!body || text(body).slice(selection.start,selection.start+selection.quote.length)!==selection.quote){say('That selection has changed. Please select the passage again.');return;}
      const item={...selection,id:crypto.randomUUID(),type:'highlight',label:`Highlighted passage · ${selection.target.replace('message-','message ')}`};
      if(persist([...items,item])){say('Highlight saved in this browser. Open Saved passages to copy its public link.');selection=null;}
    }
    if(button.id==='copy-reader-link')copy(linkFor());
    if(button.id==='copy-dialog-close')container.querySelector('#copy-dialog').close();
  }
  container.addEventListener('click',click);
  document.addEventListener('selectionchange',rememberSelection);
  function storageChanged(event){if(event.key===`deep-dialogues.reading.v1:${c.slug}`){items=loadReadingState(storage,c.slug);refreshMarks();renderSaved();}}
  window.addEventListener('storage',storageChanged);
  renderSaved();refreshMarks();
  const params=new URLSearchParams(location.hash.startsWith('#/read/')?location.hash.split('?')[1]||'':location.search);
  const at=params.get('at');
  if(at && /^message-\d+(?:-[a-z0-9-]+)?$/.test(at)) {
    const target=container.querySelector(`#${at}`);
    if(target){
      // Deep links must reveal their target even when the whole transcript starts collapsed.
      let disclosure=target.closest('details');
      while(disclosure){disclosure.open=true;disclosure=disclosure.parentElement?.closest('details');}
      const quote=params.get('quote');const body=target.closest('.message').querySelector('.message-body');const raw=params.get('from');const start=quoteLocation(text(body),quote,raw!==null&&/^\d+$/.test(raw)?Number(raw):undefined);const highlighted=start>=0?mark(body,start,quote,'shared',true):null;
      if(highlighted)activeShared={body,start,quote};
      if(quote&&!highlighted)say('The linked passage could not be matched; showing its original message instead.');
      requestAnimationFrame(()=>{(highlighted||target).scrollIntoView({block:'start'});target.tabIndex=-1;target.focus({preventScroll:true});});
    } else say('That section was not found in this conversation.');
  }
  return ()=>{container.removeEventListener('click',click);document.removeEventListener('selectionchange',rememberSelection);window.removeEventListener('storage',storageChanged);};
}
