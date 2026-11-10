import highlights from '../../content/waves-thought-highlights.json' with { type: 'json' };
import { escapeHTML as e, safeHTML } from './html.js';
import { readerLink } from './curation.js';
import { highlightSections } from './reader-navigation.js';

// Display the already-reviewed excerpt without replacing or renumbering source turns.
// If its source changes, leave that operator edit alone rather than show a stale pin.
export function excerptFor(conversation) {
  if (conversation?.slug !== highlights.slug || conversation.messages?.length !== highlights.messageCount) return null;
  return highlights.messages.every(turn => {
    const source = conversation.messages[turn.sourceMessage - 1];
    return source?.content === turn.source.content && source.role === turn.source.role &&
      (source.model || conversation.ai_model || 'AI') === (turn.source.model || conversation.ai_model || 'AI');
  }) ? highlights : null;
}

export function renderReaderExcerpt(conversation, excerpt) {
  if (!excerpt) return '';
  return `<details class="reader-section reader-excerpt" id="highlights" open>
    <summary><h2>Highlights</h2><span>6 messages · 3 themes</span></summary>
    <div class="reader-section-body">
    <p class="reader-eyebrow">HIGHLIGHTS · SELECTED FROM THE ORIGINAL</p>
    <h2 id="reader-excerpt-title">${e(excerpt.title)}</h2>
    <p class="editorial-note">The six-message excerpt reviewed by Jacob. Passages were omitted for focus. <a href="${e(readerLink(conversation.slug, 'message-2'))}">Read the full original below →</a> · <a href="${e(readerLink(excerpt.excerptSlug))}">Open highlights separately ↗</a></p>
    ${highlightSections.map(section => `<details class="highlight-theme" id="${section.id}" open><summary><h3>${e(section.title)}</h3></summary>${excerpt.messages.slice(section.start, section.end).map(turn => {
      const human = ['human', 'user'].includes(turn.role);
      const label = human ? 'Jacob' : turn.model || turn.source.model || conversation.ai_model || 'AI';
      return `<details class="pinned-turn${human ? '' : ' pinned-response'}" open>
        <summary>${e(label)} <span>From original message ${turn.sourceMessage}</span></summary>
        <div class="message-body${human ? ' pinned-question' : ''}">${safeHTML(turn.content)}</div>
        <a class="source-link" href="${e(readerLink(conversation.slug, `message-${turn.sourceMessage}`))}">Read in original context →</a>
      </details>`;
    }).join('')}</details>`).join('')}
    </div>
  </details>`;
}
