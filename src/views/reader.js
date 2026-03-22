import { getConversation } from '../lib/store.js';

export async function renderReader(container, params) {
  const slug = params.slug;
  container.innerHTML = '<div class="reader fade-in"><div class="empty-state">Loading...</div></div>';

  const c = await getConversation(slug);

  if (!c) {
    container.innerHTML = `
      <div class="reader fade-in">
        <a href="#/" class="reader-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Back
        </a>
        <div class="empty-state">
          <h3>Conversation not found</h3>
          <p>It may have been removed or the link is incorrect.</p>
        </div>
      </div>
    `;
    return;
  }

  const turnCount = c.messages ? c.messages.length : 0;

  container.innerHTML = `
    <div class="reader fade-in">
      <a href="#/" class="reader-back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        Back to gallery
      </a>

      <header class="reader-header">
        <h1 class="reader-title">${c.title}</h1>
        <div class="reader-meta">
          ${c.created_at || c.date ? `<span>${formatDate(c.created_at || c.date)}</span>` : ''}
          ${c.ai_model ? `<span class="divider">/</span><span>${c.ai_model}</span>` : ''}
          ${turnCount > 0 ? `<span class="divider">/</span><span>${turnCount} messages</span>` : ''}
          ${c.contributor_name ? `<span class="divider">/</span><a href="#/?contributor=${encodeURIComponent(c.contributor_name)}" class="contributor-link">${c.contributor_name}</a>` : ''}
        </div>
        ${c.description ? `<p class="reader-description">${c.description}</p>` : ''}
        ${(c.tags && c.tags.length > 0) ? `
          <div class="reader-tags">
            ${c.tags.map(t => `<span class="reader-tag">${t}</span>`).join('')}
          </div>
        ` : ''}
      </header>

      <div class="reader-controls">
        <button class="reader-toggle-btn" id="collapse-toggle">
          <span class="toggle-icon">◧</span> Prompts only
        </button>
      </div>

      ${c.commentary ? `<div class="reader-commentary">${c.commentary}</div>` : ''}

      <div class="conversation-flow" id="conversation-flow">
        ${renderMessages(c.messages || [])}
      </div>

      <footer class="reader-footer">
        ${c.original_url ? `
          <a href="${c.original_url}" target="_blank" rel="noopener" class="reader-footer-link">
            View original conversation
          </a>
        ` : ''}
        <button class="share-btn" data-slug="${c.slug}">
          Copy link
        </button>
      </footer>
    </div>
  `;

  // Stagger message animations
  container.querySelectorAll('.message').forEach((msg, i) => {
    msg.style.animationDelay = `${0.05 + i * 0.03}s`;
  });

  // Collapse toggle — show only human prompts
  let collapsed = false;
  const collapseBtn = container.querySelector('#collapse-toggle');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      collapsed = !collapsed;
      const flow = container.querySelector('#conversation-flow');
      flow.classList.toggle('prompts-only', collapsed);
      collapseBtn.innerHTML = collapsed
        ? '<span class="toggle-icon">◨</span> Full conversation'
        : '<span class="toggle-icon">◧</span> Prompts only';
    });
  }

  // Share button
  const shareBtn = container.querySelector('.share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      const url = `${window.location.origin}${window.location.pathname}#/read/${c.slug}`;
      navigator.clipboard.writeText(url).then(() => {
        shareBtn.textContent = 'Copied!';
        shareBtn.classList.add('copied');
        setTimeout(() => {
          shareBtn.textContent = 'Copy link';
          shareBtn.classList.remove('copied');
        }, 2000);
      });
    });
  }

  // Reading progress bar
  const progressBar = document.getElementById('progress-bar');
  progressBar.classList.add('visible');

  function updateProgress() {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    progressBar.style.width = `${progress}%`;
  }

  window.addEventListener('scroll', updateProgress);
  updateProgress();

  // Cleanup function
  return () => {
    window.removeEventListener('scroll', updateProgress);
    progressBar.classList.remove('visible');
    progressBar.style.width = '0%';
  };
}

function renderMessages(messages) {
  return messages.map((msg, i) => {
    const isHuman = msg.role === 'human';
    const label = isHuman ? 'Human' : (msg.model || 'Claude');
    const cls = isHuman ? 'message-human' : 'message-ai';

    return `
      <div class="message ${cls}">
        <div class="message-label">${label}</div>
        <div class="message-body">${msg.content}</div>
      </div>
    `;
  }).join('');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  if (dateStr.match(/^[A-Z]/)) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
