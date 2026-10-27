import { escapeHTML as e } from './html.js';
import { dataCenterSummary as s } from './curation.js';

export function briefSources(keys) {
  return keys.map(key => `<a href="${e(s.sources[key].url)}">${e(s.sources[key].publisher)}</a>`).join(' · ');
}

export function renderDataCenterPriorities() {
  return `<section class="data-center-priorities" aria-labelledby="weighted-priorities"><h2 id="weighted-priorities">What matters most</h2><p class="editorial-note">Codex editorial assessment · 27 October 2026</p><p>${e(s.intro)}</p><p class="editorial-note">Editorial priorities, not measured probabilities.</p><ul class="priority-list">${s.weights.map(w => `<li><div><strong>${e(w.priority)}</strong><span>${e(w.scope)}</span></div><div><h3>${e(w.issue)}</h3><p>${e(w.condition)}</p>${w.refs.length ? `<p class="priority-sources">${briefSources(w.refs)}</p>` : '<p class="priority-sources">Editorial judgment; assess each site.</p>'}</div></li>`).join('')}</ul><details class="source-notes"><summary>How to read these priorities</summary><p class="editorial-note">${e(s.method)}</p></details><a class="source-link" href="${e(s.courtUrl)}">Explore the full argument on Court of the Internet ↗</a></section>`;
}
