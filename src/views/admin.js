import { escapeHTML as e, safeHTML } from '../lib/html.js';
import { appRoute } from '../lib/paths.js';
import { account, loadSession, signInHref } from '../lib/session.js';
import { readerLink } from '../lib/curation.js';

const TABS = [['pending', 'Awaiting review'], ['published', 'Published'], ['rejected', 'Rejected'], ['unpublished', 'Unpublished'], ['superseded', 'Full kept private']];
const NOOS = { pending: 'Noos sync queued', synced: 'In Noos (public)', hidden: 'Hidden in Noos', error: 'Noos sync failed — will retry', skipped: 'Not in Noos' };

export async function renderAdmin(container, _params, query = {}, context = {}) {
  container.innerHTML = '<div class="admin"><p>Loading…</p></div>';
  const session = await loadSession();
  if (context.isCurrent && !context.isCurrent()) return;
  if (!session.user?.admin) {
    container.innerHTML = `<div class="submit account-page"><h1 class="submit-title">Review</h1><p class="submit-subtitle">${session.user ? 'This screen is for Deep Dialogues editors.' : 'Sign in with Ideaflow as an editor to review submissions.'}</p>${!session.user && session.signInAvailable ? `<a class="btn-primary" href="${e(signInHref('/#/admin'))}">Sign in with Ideaflow</a>` : ''}</div>`;
    return;
  }
  const status = TABS.some(([key]) => key === query.status) ? query.status : 'pending';
  if (query.slug) return renderDetail(container, query.slug, status, context);
  const rows = await account(`/api/admin/queue?status=${status}`);
  if (context.isCurrent && !context.isCurrent()) return;
  container.innerHTML = `<div class="admin fade-in">
    <header class="submit-header"><h1 class="submit-title">Review</h1><p class="submit-subtitle">Approve, publish and curate conversations. Published dialogues are also published to Noos.</p></header>
    <nav class="filter-pills" aria-label="Queue">${TABS.map(([key, label]) => `<a class="filter-pill ${key === status ? 'active' : ''}" href="${appRoute('/admin?status=' + key)}">${label}</a>`).join('')}</nav>
    ${rows.length ? `<ul class="account-list">${rows.map(r => `<li class="account-row"><div><a class="account-row-title" href="${appRoute(`/admin?status=${status}&slug=${encodeURIComponent(r.slug)}`)}">${e(r.title)}</a>
      <div class="account-row-meta"><span>${r.turn_count} messages</span><span>${e(r.submitted_by?.name || r.submitted_by?.email || r.contributor_name || 'Anonymous')}${r.submitted_by ? ' · Ideaflow' : ''}</span><span>${e(new Date(r.updated_at || r.created_at).toLocaleString())}</span></div></div>
      <div class="account-row-actions"><a class="btn-secondary" href="${appRoute(`/admin?status=${status}&slug=${encodeURIComponent(r.slug)}`)}">Open</a></div></li>`).join('')}</ul>` : '<p class="empty-note">Nothing here.</p>'}
  </div>`;
}

async function renderDetail(container, slug, status, context) {
  let row;
  try { row = await account(`/api/admin/conversations/${encodeURIComponent(slug)}`); }
  catch (error) { container.innerHTML = `<div class="admin"><a class="reader-back" href="${appRoute('/admin?status=' + status)}">← Queue</a><p>${e(error.message)}</p></div>`; return; }
  if (context.isCurrent && !context.isCurrent()) return;
  document.title = `Review · ${row.title} — Deep Dialogues`;
  const canPublish = ['pending', 'published', 'unpublished'].includes(row.status);
  container.innerHTML = `<div class="admin fade-in">
    <a class="reader-back" href="${appRoute('/admin?status=' + status)}">← Queue</a>
    <header class="submit-header"><h1 class="submit-title">${e(row.title)}</h1>
      <div class="account-row-meta"><span class="status-chip status-${e(row.status)}">${e(row.status)}</span><span>${row.messages.length} messages</span>
      <span>Submitted by ${e(row.submitted_by ? `${row.submitted_by.name || ''} ${row.submitted_by.email ? '<' + row.submitted_by.email + '>' : ''}`.trim() + ' (Ideaflow)' : row.contributor_name || 'anonymous')}</span>
      ${row.noos ? `<span>${e(NOOS[row.noos.state] || row.noos.state)}</span>` : ''}
      ${row.status === 'published' ? `<a href="${e(readerLink(row.slug))}">Open public page ↗</a>` : ''}
      ${row.original_url ? `<a href="${e(row.original_url)}" target="_blank" rel="noopener noreferrer">Original ↗</a>` : ''}</div></header>
    ${row.description ? `<p class="submit-subtitle">${e(row.description)}</p>` : ''}
    ${canPublish ? `<section class="review-panel" aria-labelledby="publish-heading">
      <h2 id="publish-heading" class="review-heading">Publish</h2>
      <fieldset class="version-choice"><legend class="form-label">Version</legend>
        <label><input type="radio" name="version" value="full" checked> Full conversation</label>
        <label><input type="radio" name="version" value="highlights"> Highlights only <span class="hint">(full transcript stays private)</span></label>
        <label><input type="radio" name="version" value="both"> Both, linked to each other</label>
      </fieldset>
      <div class="form-group highlights-title" hidden><label class="form-label" for="hl-title">Highlights title</label><input class="form-input" id="hl-title" value="${e(row.title)} · Highlights"></div>
      <p class="hint highlights-hint" hidden>Tick the messages to include in the highlights version. <span id="picked">0</span> selected.</p>
      <div class="submit-actions"><button class="btn-primary" id="publish-btn">${row.status === 'published' ? 'Update publication' : 'Publish'}</button>
      ${row.status === 'pending' ? '<button class="btn-secondary" id="reject-btn">Reject…</button>' : ''}
      ${row.status === 'published' ? '<button class="btn-secondary" id="unpublish-btn">Unpublish</button>' : ''}</div>
      <p id="review-status" role="status" aria-live="polite"></p>
    </section>` : `<p class="hint">This conversation is ${e(row.status)}${row.review?.reason ? `: ${e(row.review.reason)}` : ''}.</p>`}
    <div class="conversation-flow review-flow">${row.messages.map((m, i) => { const human = ['human', 'user'].includes(m.role); return `<section class="message ${human ? 'message-human' : 'message-ai'}">
      <div class="message-heading"><label class="message-label pick"><input type="checkbox" class="pick-box" value="${i}" hidden> ${human ? 'Human' : e(m.model || row.ai_model || 'AI')} <span>· ${i + 1}</span></label></div>
      <div class="message-body">${safeHTML(m.content)}</div></section>`; }).join('')}</div>
  </div>`;
  if (!canPublish) return;
  const boxes = [...container.querySelectorAll('.pick-box')], out = container.querySelector('#review-status');
  const version = () => container.querySelector('input[name=version]:checked').value;
  const refresh = () => {
    const picking = version() !== 'full';
    boxes.forEach(b => { b.hidden = !picking; });
    container.querySelector('.highlights-title').hidden = !picking;
    container.querySelector('.highlights-hint').hidden = !picking;
    container.querySelector('#picked').textContent = boxes.filter(b => b.checked).length;
  };
  container.querySelectorAll('input[name=version], .pick-box').forEach(el => el.addEventListener('change', refresh));
  const act = async (body, confirmText) => {
    if (confirmText && !confirm(confirmText)) return;
    out.textContent = 'Saving…';
    try {
      const result = await account(`/api/admin/conversations/${encodeURIComponent(row.slug)}/review`, { method: 'POST', body });
      const queued = result.noos?.some(n => n.state === 'queued');
      out.innerHTML = `Done. ${result.rows.filter(r => r.status === 'published').map(r => `<a href="${e(readerLink(r.slug))}">${e(r.title)}</a>`).join(' · ')}${queued ? ' — Noos sync queued.' : ''}`;
      setTimeout(() => { location.hash = `#/admin?status=${status}`; }, 1500);
    } catch (error) { out.textContent = error.message.replace(/_/g, ' '); }
  };
  container.querySelector('#publish-btn').addEventListener('click', () => {
    const highlights = boxes.filter(b => b.checked).map(b => Number(b.value));
    if (version() !== 'full' && !highlights.length) { out.textContent = 'Select at least one message for the highlights.'; return; }
    act({ action: 'publish', version: version(), highlights, highlights_title: container.querySelector('#hl-title').value });
  });
  container.querySelector('#reject-btn')?.addEventListener('click', () => { const reason = prompt('Optional note to the contributor:'); if (reason !== null) act({ action: 'reject', reason }); });
  container.querySelector('#unpublish-btn')?.addEventListener('click', () => act({ action: 'unpublish' }, 'Remove this conversation from the public gallery and hide it in Noos?'));
  refresh();
}
