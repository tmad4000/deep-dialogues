import { escapeHTML as e, safeHTML } from './html.js';
import { readerLink } from './curation.js';

const chapters = [
  ['agency', 'Agency, vision, and personal coaching', 1, 20],
  ['learning', 'Feedback, curiosity, and goals', 21, 41],
  ['ripples', 'Presence and the ripples we make', 42, 60],
  ['world-model', 'Senses, world models, and effectors', 61, 72],
  ['shared-system', 'One shared system and its implications', 73, 84],
  ['still-point', 'The still point and beautiful systems', 85, 103],
  ['charged-words', 'Words that carry charge', 104, 106],
  ['thought-waves', 'Waves of thought and the duplex', 107, 120],
  ['centers', 'Awareness, centers, and collective intelligence', 121, 132],
  ['networks', 'Designing a system of networks', 133, 139],
  ['prototype', 'The presence companion: build and review', 140, 155],
  ['love', 'A loving and effective presence', 156, 158],
].map(([id, title, start, end]) => ({ id: `chapter-${id}`, title, start, end }));

export const highlightSections = [
  { id: 'highlights-waves', title: 'Waves of thought and silence', start: 0, end: 2 },
  { id: 'highlights-observer', title: 'The observer changes the system', start: 2, end: 4 },
  { id: 'highlights-gaps', title: 'The space between responses', start: 4, end: 6 },
];

export function navigationFor(conversation, excerpt) {
  return excerpt && conversation.messages.length === 158 ? { chapters, highlights: highlightSections } : null;
}

export function sectionLink(slug, section) {
  const url = new URL(readerLink(slug));
  url.searchParams.set('section', section);
  return url.href;
}

function jump(conversation, id, title, extra = '') {
  return `<a href="${e(sectionLink(conversation.slug, id))}" data-reader-jump="${e(id)}">${e(title)}${extra}</a>`;
}

export function renderReaderNavigation(conversation, navigation) {
  if (!navigation) return '';
  return `<nav class="reader-navigation" aria-label="Dialogue navigation">
    ${jump(conversation, 'highlights', 'Highlights')}
    ${jump(conversation, 'original-conversation', 'Original')}
    <details class="reader-toc" id="reader-contents">
      <summary>Contents</summary>
      <div class="reader-toc-panel"><p class="reader-eyebrow">TABLE OF CONTENTS</p>
        <p class="toc-group">${jump(conversation, 'highlights', 'Highlights')}</p>
        <ol>${navigation.highlights.map(s => `<li>${jump(conversation, s.id, s.title)}</li>`).join('')}</ol>
        <p class="toc-group">${jump(conversation, 'original-conversation', 'Full original · 158 messages')}</p>
        <ol>${navigation.chapters.map(s => `<li>${jump(conversation, s.id, s.title, `<span>Messages ${s.start}–${s.end}</span>`)}</li>`).join('')}</ol>
      </div>
    </details>
    ${jump(conversation, 'reader-top', '↑ Top')}
  </nav>`;
}

export function renderTranscript(conversation, navigation, expanded = false) {
  const message = (msg, i) => {
    const human = ['human', 'user'].includes(msg.role);
    const label = human ? 'Human' : msg.role === 'system' ? 'System' : msg.model || conversation.ai_model || 'AI';
    const id = `message-${i + 1}`;
    return `<section class="message ${human ? 'message-human' : 'message-ai'}" aria-label="Message ${i + 1}, ${e(label)}"><div class="message-heading"><div class="message-label">${e(label)} <span>· ${i + 1}</span></div><div class="message-actions"><button type="button" data-copy-target="${id}" aria-label="Copy link to message ${i + 1}">Link</button><button type="button" data-bookmark="${id}" aria-pressed="false" aria-label="Bookmark message ${i + 1}">Bookmark</button></div></div><div class="message-body">${safeHTML(msg.content)}</div></section>`;
  };
  if (!navigation) return conversation.messages.map(message).join('');
  return navigation.chapters.map(chapter => `<details class="dialogue-chapter" id="${chapter.id}"${expanded ? ' open' : ''}>
    <summary><h3>${e(chapter.title)}</h3><span>Messages ${chapter.start}–${chapter.end}</span></summary>
    ${conversation.messages.slice(chapter.start - 1, chapter.end).map((msg, i) => message(msg, chapter.start - 1 + i)).join('')}
  </details>`).join('');
}

export function revealReaderTarget(target) {
  let disclosure = target.closest('details');
  while (disclosure) { disclosure.open = true; disclosure = disclosure.parentElement?.closest('details'); }
}

export function attachReaderNavigation(container, query = {}) {
  const contents = container.querySelector('#reader-contents');
  function fitContents() {
    if (contents?.open) {
      const panel = contents.querySelector('.reader-toc-panel');
      panel.style.maxHeight = `${Math.max(120, innerHeight - contents.parentElement.getBoundingClientRect().bottom - 16)}px`;
    }
  }
  if (contents) {
    contents.addEventListener('toggle', fitContents);
    addEventListener('resize', fitContents);
    addEventListener('scroll', fitContents, { passive: true });
  }
  function show(id, updateURL = false) {
    if (!/^(?:reader-top|highlights(?:-[a-z-]+)?|original-conversation|chapter-[a-z-]+)$/.test(id)) return;
    const target = container.querySelector(`#${id}`);
    if (!target) return;
    const contents = container.querySelector('#reader-contents');
    if (contents) contents.open = false;
    revealReaderTarget(target);
    if (updateURL) {
      const url = new URL(location.href);
      const legacy = url.hash.startsWith('#/read/');
      const params = new URLSearchParams(legacy ? url.hash.split('?')[1] || '' : url.search);
      ['at', 'quote', 'from'].forEach(key => params.delete(key));
      params.set('section', id);
      if (legacy) url.hash = `${url.hash.split('?')[0]}?${params}`;
      else url.search = params.toString();
      history.replaceState(null, '', url);
    }
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      const focus = target.matches('details') ? target.querySelector('summary') : target;
      if (!target.matches('details')) focus.tabIndex = -1;
      focus.focus({ preventScroll: true });
    });
  }
  function click(event) {
    const contents = container.querySelector('#reader-contents');
    if (contents?.open && !contents.contains(event.target)) contents.open = false;
    const link = event.target.closest('[data-reader-jump]');
    if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
      event.preventDefault(); show(link.dataset.readerJump, true);
    }
    const control = event.target.closest('[data-chapter-action]');
    if (control) container.querySelectorAll('.dialogue-chapter').forEach(chapter => { chapter.open = control.dataset.chapterAction === 'expand'; });
  }
  function keydown(event) {
    const contents = container.querySelector('#reader-contents');
    if (event.key === 'Escape' && contents?.open) {
      contents.open = false; contents.querySelector('summary').focus();
    }
  }
  container.addEventListener('click', click);
  container.addEventListener('keydown', keydown);
  if (query.section && !query.at) show(query.section);
  return () => {
    container.removeEventListener('click', click); container.removeEventListener('keydown', keydown);
    if (contents) {
      contents.removeEventListener('toggle', fitContents);
      removeEventListener('resize', fitContents); removeEventListener('scroll', fitContents);
    }
  };
}
