import { escapeHTML as e } from '../src/lib/html.js';
import { readerLink, publicOrigin } from '../src/lib/curation.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataCenterSummary } from '../src/lib/curation.js';
import { renderDataCenterPriorities, briefSources } from '../src/lib/data-center-brief.js';

export function renderDataCenterSummary(root) {
  const s = dataCenterSummary;
  const shell = readFileSync(join(root,'dist','index.html'),'utf8');
  const styles = [...shell.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(m=>m[0]).join('');
  const link = readerLink(s.slug);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${shareHead({title:s.title,description:s.description,url:publicOrigin+s.path,image:publicOrigin+'/share/dialogues.png'})}${styles}</head><body><nav id="nav"><div class="nav-inner"><a class="nav-brand" href="/">Deep Dialogues</a><a class="summary-nav-link" href="${link}">Read the conversation ↗</a></div></nav><main class="reader summary-page"><header class="reader-header"><p class="reader-eyebrow">CONVERSATION BRIEF · OCTOBER 2026</p><h1 class="reader-title">${e(s.title)}</h1><p class="summary-attribution">${e(s.attribution)}</p></header>${renderDataCenterPriorities()}${s.sections.map(section=>`<section><h2>${e(section.title)}</h2><p>${e(section.text)}</p>${section.refs.length?`<p class="priority-sources">${briefSources(section.refs)}</p>`:''}</section>`).join('')}<section><h2>Original questions and later assessment</h2>${s.highlights.map(h=>`<figure class="highlight-card"><figcaption>${e(h.label)}</figcaption><blockquote><a href="${e(readerLink(s.slug,h.target,h.quote))}">“${e(h.quote)}”</a></blockquote></figure>`).join('')}</section><footer class="summary-footer"><a class="btn-primary" href="${link}">Read the full conversation</a><p>Ten original exchanges followed by a separate Codex review. Gemini’s version is unverified; Flash is Jacob’s identification. The source article/comments were not available for independent review.</p><a href="${e(s.originalUrl)}">Original Gemini share ↗</a> · <a href="${e(s.courtUrl)}">Court of the Internet ↗</a></footer></main></body></html>`;
}

export function shareHead({title,description,url,image}) {
  return `<title>${e(title)} — Deep Dialogues</title><meta name="description" content="${e(description)}"><link rel="canonical" href="${e(url)}"><meta property="og:type" content="article"><meta property="og:site_name" content="Deep Dialogues"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:url" content="${e(url)}"><meta property="og:image" content="${e(image)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${e(title)} — Deep Dialogues"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${e(title)}"><meta name="twitter:description" content="${e(description)}"><meta name="twitter:image" content="${e(image)}">`;
}
