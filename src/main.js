import './style.css';
import { route, startRouter } from './lib/router.js';
import { renderGallery } from './views/gallery.js';
import { renderReader } from './views/reader.js';
import { renderSubmit } from './views/submit.js';

// ---- Navigation ----
function renderNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = `
    <div class="nav-inner">
      <a href="#/" class="nav-brand">AI Dialogues</a>
      <div class="nav-links">
        <a href="#/" class="nav-link">Gallery</a>
        <a href="#/submit" class="nav-link">Upload</a>
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

route('/', (container) => {
  document.title = 'AI Dialogues \u2014 A Gallery of AI Conversations';
  renderGallery(container);
});

route(/^\/read\/(?<slug>[^/]+)$/, (container, params) => {
  renderReader(container, params);
});

route('/submit', (container) => {
  document.title = 'Upload a Conversation \u2014 AI Dialogues';
  renderSubmit(container);
});

// ---- Init ----
renderNav();
startRouter(app);
