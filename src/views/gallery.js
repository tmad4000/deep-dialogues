import { getConversations, getTags } from '../lib/store.js';
import { navigate } from '../lib/router.js';

export async function renderGallery(container) {
  container.innerHTML = '<div class="gallery fade-in"><div class="empty-state">Loading...</div></div>';

  const conversations = await getConversations();
  const tags = await getTags();

  // Get unique contributors
  const contributors = [...new Set(conversations.map(c => c.contributor_name).filter(Boolean))].sort();

  let activeTag = null;
  let activeContributor = null;

  function render() {
    let filtered = conversations;
    if (activeTag) {
      filtered = filtered.filter(c => (c.tags || []).includes(activeTag));
    }
    if (activeContributor) {
      filtered = filtered.filter(c => c.contributor_name === activeContributor);
    }

    container.innerHTML = `
      <div class="gallery fade-in">
        <header class="gallery-header">
          <h1 class="gallery-title">Deep Dialogues</h1>
          <p class="gallery-subtitle">
            A gallery of the most interesting, beautiful, and intelligent conversations with AI
          </p>
        </header>

        ${contributors.length > 1 ? `
          <div class="gallery-filters" style="margin-bottom: 0.75rem; padding-bottom: 0.75rem; border-bottom: none;">
            <button class="filter-pill ${!activeContributor ? 'active' : ''}" data-contributor="">Everyone</button>
            ${contributors.map(name => `
              <button class="filter-pill ${activeContributor === name ? 'active' : ''}" data-contributor="${name}">${name}</button>
            `).join('')}
          </div>
        ` : ''}

        ${tags.length > 0 ? `
          <div class="gallery-filters">
            <button class="filter-pill ${!activeTag ? 'active' : ''}" data-tag="">All topics</button>
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
            <h3>No conversations found</h3>
            <p><a href="#/submit" style="color: var(--accent-ai)">Upload one</a> or try a different filter.</p>
          </div>
        `}
      </div>
    `;

    // Bind contributor filter clicks
    container.querySelectorAll('[data-contributor]').forEach(pill => {
      pill.addEventListener('click', () => {
        activeContributor = pill.dataset.contributor || null;
        render();
      });
    });

    // Bind tag filter clicks
    container.querySelectorAll('[data-tag]').forEach(pill => {
      pill.addEventListener('click', () => {
        activeTag = pill.dataset.tag || null;
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
  if (dateStr.match(/^[A-Z]/)) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
