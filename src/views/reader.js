import { escapeHTML as e, safeHTML, safeURL } from '../lib/html.js';
import { getConversation } from '../lib/store.js';
import { presentConversation } from '../lib/presentation.js';
import { appRoute } from '../lib/paths.js';
import { curationFor, readerLink } from '../lib/curation.js';
import { renderReaderOverview } from '../lib/reader-overview.js';
import { attachReaderTools } from '../lib/reader-tools.js';

export async function renderReader(container,params,query={},context={}) {
  container.innerHTML='<div class="reader"><p>Loading conversation…</p></div>';
  const found=await getConversation(decodeURIComponent(params.slug));
  if(context.isCurrent && !context.isCurrent())return;
  const c=presentConversation(found);
  if(!c){container.innerHTML=`<div class="reader"><a href="${appRoute('/')}">Back to gallery</a><h1>Conversation not found</h1></div>`;return;}
  document.title=`${c.title} — Deep Dialogues`;
  const curated=curationFor(c);
  container.innerHTML=`<article class="reader">
    <a class="reader-back" href="${appRoute('/')}">← Gallery</a>
    <header class="reader-header reader-header-integrated"><h1 class="reader-title">${e(c.title)}</h1><div class="reader-meta"><span>${e(c.ai_model||'AI conversation')}</span><span>${c.messages.length} messages</span><span>${e(c.contributor_name||'')}</span></div></header>
    ${renderReaderOverview(c,curated)}
    ${curated?`<details class="highlight-reel" open><summary>Highlights <span>Passages from the original dialogue</span></summary>${curated.highlights.map(h=>`<figure class="highlight-card"><figcaption>${e(h.label)}</figcaption><blockquote><a href="${e(readerLink(c.slug,h.target,h.quote))}">“${e(h.quote)}”</a></blockquote><a class="source-link" href="${e(readerLink(c.slug,h.target,h.quote))}">Go to passage →</a></figure>`).join('')}</details>`:''}
    <div class="reading-toolbar" aria-label="Reading tools"><button type="button" id="highlight-selection">Highlight selection</button><button type="button" id="collapse-toggle" aria-pressed="false">Prompts only</button><button type="button" id="copy-reader-link">Copy conversation link</button></div>
    <p id="reader-status" role="status" aria-live="polite" class="reader-status"></p>
    <details class="saved-passages"><summary>Saved passages <span id="saved-count">0</span></summary><p class="editorial-note">Bookmarks and highlights are saved only in this browser. Copy a passage link to share it or open it on another device.</p><ul id="saved-items"></ul></details>
    ${c.commentary?`<details class="source-notes"><summary>About the source and transcription</summary><div>${safeHTML(c.commentary)}</div></details>`:''}
    <h2 class="transcript-title">The original conversation${curated ? (curated.slug === 'ai-data-centers' ? ' · with Codex’s later review' : ' · with Astra’s later response') : ''}</h2>
    <div id="conversation-flow" class="conversation-flow">${c.messages.map((msg,i)=>{const human=['human','user'].includes(msg.role);const label=human?'Human':msg.role==='system'?'System':msg.model||c.ai_model||'AI';const id=`message-${i+1}`;return `<section class="message ${human?'message-human':'message-ai'}" aria-label="Message ${i+1}, ${e(label)}"><div class="message-heading"><div class="message-label">${e(label)} <span>· ${i+1}</span></div><div class="message-actions"><button type="button" data-copy-target="${id}" aria-label="Copy link to message ${i+1}">Link</button><button type="button" data-bookmark="${id}" aria-pressed="false" aria-label="Bookmark message ${i+1}">Bookmark</button></div></div><div class="message-body">${safeHTML(msg.content)}</div></section>`;}).join('')}</div>
    <footer class="reader-footer">${c.original_url?`<a href="${safeURL(c.original_url)}" target="_blank" rel="noopener noreferrer">View original conversation ↗</a>`:''}</footer>
    <dialog id="copy-dialog"><h2>Copy passage link</h2><label for="copy-link-field">Public link</label><input id="copy-link-field" readonly><button type="button" id="copy-dialog-close">Close</button></dialog>
  </article>`;
  const cleanupTools=attachReaderTools(container,c);
  const collapse=container.querySelector('#collapse-toggle');
  const toggle=()=>{const active=collapse.getAttribute('aria-pressed')!=='true';collapse.setAttribute('aria-pressed',String(active));collapse.textContent=active?'Full conversation':'Prompts only';container.querySelectorAll('.message-ai').forEach(el=>el.hidden=active);};
  collapse.addEventListener('click',toggle);
  const bar=document.getElementById('progress-bar');bar?.classList.add('visible');
  const progress=()=>{const max=document.documentElement.scrollHeight-innerHeight;if(bar)bar.style.width=`${max>0?scrollY/max*100:0}%`;};
  addEventListener('scroll',progress,{passive:true});progress();
  return()=>{cleanupTools();collapse.removeEventListener('click',toggle);removeEventListener('scroll',progress);bar?.classList.remove('visible');if(bar)bar.style.width='0%';};
}
