import './style.css';
import { route, startRouter } from './lib/router.js';
import { renderGallery } from './views/gallery.js';
import { renderReader } from './views/reader.js';
import { renderSubmit } from './views/submit.js';
import { renderContributors } from './views/contributors.js';

// ---- Navigation ----
function renderNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = `
    <div class="nav-inner">
      <a href="#/" class="nav-brand">Deep Dialogues</a>
      <div class="nav-links">
        <a href="#/" class="nav-link">Gallery</a>
        <a href="#/contributors" class="nav-link">Contributors</a>
        <a href="#/submit" class="nav-link">Upload</a>
        <a href="https://github.com/tmad4000/deep-dialogues" target="_blank" rel="noopener" class="nav-link" title="GitHub">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
        </a>
        <button class="theme-btn" id="theme-toggle" aria-label="Toggle theme"></button>
      </div>
    </div>
  `;

  // Theme toggle
  const btn = document.getElementById('theme-toggle');
  applyTheme();

  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme();
  });
}

function applyTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);

  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
}

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!localStorage.getItem('theme')) applyTheme();
});

// ---- Routes ----
const app = document.getElementById('app');

route('/', (container, params, query) => {
  document.title = 'Deep Dialogues \u2014 A Gallery of AI Conversations';
  renderGallery(container, params, query);
});

route(/^\/read\/(?<slug>[^/]+)$/, (container, params) => {
  renderReader(container, params);
});

route('/contributors', (container) => {
  document.title = 'Contributors \u2014 Deep Dialogues';
  renderContributors(container);
});

route('/submit', (container) => {
  document.title = 'Upload a Conversation \u2014 Deep Dialogues';
  renderSubmit(container);
});

// ---- Init ----
renderNav();
startRouter(app);
