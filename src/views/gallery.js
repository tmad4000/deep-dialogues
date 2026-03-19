import { getConversations, getTags } from '../lib/store.js';
import { navigate } from '../lib/router.js';

export async function renderGallery(container) {
  container.innerHTML = '<div class="gallery fade-in"><div class="empty-state">Loading...</div></div>';

  const conversations = await getConversations();
  const tags = await getTags();

  let activeTag = null;

  function render() {
    const filtered = activeTag
      ? conversations.filter(c => (c.tags || []).includes(activeTag))
      : conversations;

    container.innerHTML = `
      <div class="gallery fade-in">
        <header class="gallery-header">
          <h1 class="gallery-title">Dialogues</h1>
          <p class="gallery-subtitle">
            A gallery of the most interesting, beautiful, and intelligent conversations with AI
          </p>
        </header>

        ${tags.length > 0 ? `
          <div class="gallery-filters">
            <button class="filter-pill ${!activeTag ? 'active' : ''}" data-tag="">All</button>
            ${tags.map(tag => `
              <button class="filter-pill ${activeTag === tag ? 'active' : ''}" data-tag="${tag}">${tag}</button>
            `).join('')}
          </div>
        ` : ''}

        ${filtered.length > 0 ? `
          <div class="card-list">
            ${filtered.map(c => cardHTML(c)).join('')}
          </div>
        ` : `
          <div class="empty-state">
            <h3>No conversations yet</h3>
            <p>Be the first to <a href="#/submit">share a conversation</a>.</p>
          </div>
        `}
      </div>
    `;

    // Bind filter clicks
    container.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const tag = pill.dataset.tag;
        activeTag = tag || null;
        render();
      });
    });

    // Bind card clicks
    container.querySelectorAll('.conversation-card').forEach(card => {
      card.addEventListener('click', () => {
        navigate(`/read/${card.dataset.slug}`);
      });
    });
  }

  render();
}

function cardHTML(c) {
  const turnCount = c.messages ? c.messages.length : (c.turn_count || 0);
  const excerpt = getExcerpt(c);

  return `
    <article class="conversation-card" data-slug="${c.slug}">
      <div class="card-top-row">
        <span class="card-date">${formatDate(c.created_at || c.date)}</span>
        ${c.ai_model ? `<span class="card-model-badge">${c.ai_model}</span>` : ''}
        ${c.featured ? `<span class="card-featured-badge">Featured</span>` : ''}
      </div>
      <h2 class="card-title">${c.title}</h2>
      ${excerpt ? `<p class="card-excerpt">${excerpt}</p>` : ''}
      <div class="card-meta">
        ${turnCount > 0 ? `<span class="card-meta-item">${turnCount} messages</span>` : ''}
        ${c.contributor_name ? `<span class="card-meta-item">by ${c.contributor_name}</span>` : ''}
      </div>
    </article>
  `;
}

function getExcerpt(c) {
  if (c.description) return c.description;
  if (c.messages && c.messages.length > 0) {
    const first = c.messages[0];
    const text = first.content.replace(/<[^>]+>/g, '').trim();
    return text.length > 180 ? text.slice(0, 180) + '...' : text;
  }
  return '';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  // Handle "November 2024" style dates
  if (dateStr.match(/^[A-Z]/)) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
