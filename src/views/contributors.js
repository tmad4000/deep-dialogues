import { getConversations } from '../lib/store.js';
import { navigate } from '../lib/router.js';

export async function renderContributors(container) {
  container.innerHTML = '<div class="contributors fade-in"><div class="empty-state">Loading...</div></div>';

  const conversations = await getConversations();

  // Build contributor map: name -> { conversations, latestDate }
  const contributorMap = new Map();
  for (const c of conversations) {
    const name = c.contributor_name;
    if (!name) continue;
    if (!contributorMap.has(name)) {
      contributorMap.set(name, { name, conversations: [], latestDate: null });
    }
    const entry = contributorMap.get(name);
    entry.conversations.push(c);
    const date = c.created_at || c.date;
    if (date && (!entry.latestDate || date > entry.latestDate)) {
      entry.latestDate = date;
    }
  }

  // Sort by number of conversations (descending), then by name
  const contributors = [...contributorMap.values()].sort((a, b) =>
    b.conversations.length - a.conversations.length || a.name.localeCompare(b.name)
  );

  container.innerHTML = `
    <div class="contributors fade-in">
      <header class="gallery-header">
        <h1 class="gallery-title">Contributors</h1>
        <p class="gallery-subtitle">
          ${contributors.length} ${contributors.length === 1 ? 'person has' : 'people have'} shared conversations
        </p>
      </header>

      ${contributors.length > 0 ? `
        <div class="contributor-grid">
          ${contributors.map((p, i) => `
            <article class="contributor-card" data-contributor="${p.name}" style="animation-delay: ${Math.min(i * 0.05, 0.3)}s">
              <div class="contributor-avatar">${p.name.charAt(0).toUpperCase()}</div>
              <div class="contributor-info">
                <h2 class="contributor-name">${p.name}</h2>
                <div class="contributor-stats">
                  <span>${p.conversations.length} ${p.conversations.length === 1 ? 'conversation' : 'conversations'}</span>
                  ${p.latestDate ? `<span class="contributor-date">Latest: ${formatDate(p.latestDate)}</span>` : ''}
                </div>
                <div class="contributor-recent">
                  ${p.conversations.slice(0, 3).map(c => `
                    <span class="contributor-recent-title" data-slug="${c.slug}">${c.title}</span>
                  `).join('')}
                </div>
              </div>
            </article>
          `).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <h3>No contributors yet</h3>
          <p><a href="#/submit" style="color: var(--accent-ai)">Upload a conversation</a> to be the first.</p>
        </div>
      `}
    </div>
  `;

  // Click on a contributor card -> go to gallery filtered by that person
  container.querySelectorAll('.contributor-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // If they clicked a specific conversation title, go to that conversation
      const titleEl = e.target.closest('.contributor-recent-title');
      if (titleEl) {
        navigate(`/read/${titleEl.dataset.slug}`);
        return;
      }
      navigate(`/?contributor=${encodeURIComponent(card.dataset.contributor)}`);
    });
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  if (dateStr.match(/^[A-Z]/)) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
