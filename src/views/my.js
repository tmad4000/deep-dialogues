import { escapeHTML as e } from '../lib/html.js';
import { appRoute } from '../lib/paths.js';
import { account, loadSession, signInHref } from '../lib/session.js';
import { readerLink } from '../lib/curation.js';

const STATUS = { pending: 'Awaiting review', published: 'Published', rejected: 'Not published', unpublished: 'Unpublished', superseded: 'Published as highlights' };

export async function renderMySubmissions(container, _params, query = {}, context = {}) {
  container.innerHTML = '<div class="submit account-page"><p>Loading…</p></div>';
  const session = await loadSession();
  if (context.isCurrent && !context.isCurrent()) return;
  if (!session.user) {
    container.innerHTML = `<div class="submit account-page fade-in"><h1 class="submit-title">My submissions</h1>
      <p class="submit-subtitle">${session.signInAvailable ? 'Sign in with Ideaflow to see, track and edit the conversations you have submitted.' : 'Sign-in is not available on this copy of Deep Dialogues.'}</p>
      ${session.signInAvailable ? `<a class="btn-primary" href="${e(signInHref('/#/my'))}">Sign in with Ideaflow</a>` : ''}</div>`;
    return;
  }
  let rows;
  try { rows = await account('/api/my/submissions'); }
  catch (error) { container.innerHTML = `<div class="submit account-page"><p class="form-error">${e(error.message)}</p></div>`; return; }
  if (context.isCurrent && !context.isCurrent()) return;
  const editing = query.edit && rows.find(r => r.slug === query.edit && r.status === 'pending');
  if (editing) return renderEditor(container, editing);
  container.innerHTML = `<div class="submit account-page fade-in">
    <header class="submit-header"><h1 class="submit-title">My submissions</h1>
    <p class="submit-subtitle">Signed in as ${e(session.user.name || session.user.email || 'Ideaflow member')}. Conversations awaiting review can be edited until they are published.</p></header>
    ${rows.length ? `<ul class="account-list">${rows.map(r => `<li class="account-row">
      <div><div class="account-row-title">${e(r.title)}</div>
      <div class="account-row-meta"><span class="status-chip status-${e(r.status)}">${e(STATUS[r.status] || r.status)}</span><span>${r.turn_count} messages</span><span>${e(new Date(r.updated_at || r.created_at).toLocaleDateString())}</span>${r.review?.reason ? `<span>Note: ${e(r.review.reason)}</span>` : ''}</div></div>
      <div class="account-row-actions">${r.status === 'pending' ? `<a class="btn-secondary" href="${appRoute('/my?edit=' + encodeURIComponent(r.slug))}">Edit</a>` : ''}${r.status === 'published' ? `<a class="btn-secondary" href="${e(readerLink(r.slug))}">Read</a>` : ''}${r.versions?.highlights && r.versions.highlights !== r.slug ? `<a class="btn-secondary" href="${e(readerLink(r.versions.highlights))}">Highlights</a>` : ''}</div>
    </li>`).join('')}</ul>` : `<p>You have not submitted anything yet. <a href="${appRoute('/submit')}">Upload a conversation</a>.</p>`}
  </div>`;
}

function renderEditor(container, row) {
  document.title = `Edit · ${row.title} — Deep Dialogues`;
  container.innerHTML = `<div class="submit account-page fade-in">
    <a class="reader-back" href="${appRoute('/my')}">← My submissions</a>
    <header class="submit-header"><h1 class="submit-title">Edit submission</h1><p class="submit-subtitle">Changes are saved to the review queue. Nothing is public until it is approved.</p></header>
    <form id="edit-form" class="meta-form">
      <div class="form-group"><label class="form-label" for="f-title">Title</label><input class="form-input" id="f-title" required maxlength="300" value="${e(row.title)}"></div>
      <div class="form-group"><label class="form-label" for="f-name">Credit as</label><input class="form-input" id="f-name" maxlength="200" value="${e(row.contributor_name || '')}"></div>
      <div class="form-group"><label class="form-label" for="f-tags">Tags (comma separated)</label><input class="form-input" id="f-tags" value="${e((row.tags || []).join(', '))}"></div>
      <div class="form-group"><label class="form-label" for="f-url">Original link</label><input class="form-input" id="f-url" type="url" value="${e(row.original_url || '')}"></div>
      <div class="form-group"><label class="form-label" for="f-desc">Description</label><textarea class="form-input" id="f-desc" rows="3">${e(row.description || '')}</textarea></div>
      <fieldset class="message-editor"><legend class="form-label">Messages</legend>${row.messages.map((m, i) => `<div class="form-group"><label class="form-label" for="m-${i}">${i + 1} · ${m.role === 'human' ? 'Human' : e(m.model || row.ai_model || m.role)}</label><textarea class="form-input" id="m-${i}" rows="4">${e(m.content)}</textarea></div>`).join('')}</fieldset>
      <p id="edit-status" role="status" aria-live="polite"></p>
      <div class="submit-actions"><button class="btn-primary" type="submit">Save changes</button><a class="btn-secondary" href="${appRoute('/my')}">Cancel</a></div>
    </form></div>`;
  const form = container.querySelector('#edit-form'), status = container.querySelector('#edit-status');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const val = id => container.querySelector(id).value.trim();
    const body = { title: val('#f-title'), contributor_name: val('#f-name'), tags: val('#f-tags').split(',').map(t => t.trim()).filter(Boolean),
      original_url: val('#f-url') || null, description: val('#f-desc') || null, ai_model: row.ai_model || null,
      messages: row.messages.map((m, i) => ({ ...m, content: container.querySelector(`#m-${i}`).value })) };
    status.textContent = 'Saving…';
    try { await account(`/api/my/submissions/${encodeURIComponent(row.slug)}`, { method: 'PUT', body }); location.hash = '#/my'; }
    catch (error) { status.textContent = error.status === 409 ? 'This submission has already been reviewed and can no longer be edited.' : error.message; }
  });
}
