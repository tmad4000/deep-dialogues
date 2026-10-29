import { escapeHTML as e, safeHTML } from './html.js';
import { readerLink } from './curation.js';
import { matchesSourceMessage } from './presentation.js';
import ranking from '../../content/data-centers-original-ranking.json' with { type: 'json' };

export function renderReaderOverview(conversation, curated) {
  const favorite = curated?.favorite && matchesSourceMessage(conversation, curated.favorite.message) ? curated.favorite : null;
  const intro = favorite ? curated.intro : conversation.description;
  if (!intro && !favorite) return '';
  const originalRanking = conversation.slug === ranking.slug && matchesSourceMessage(conversation, ranking.message);
  return `<section class="reader-overview" aria-labelledby="reader-overview-title"><h2 id="reader-overview-title">About this dialogue</h2>${intro ? `<p class="reader-description">${e(intro)}</p>` : ''}${favorite ? `<figure class="favorite-passage"><figcaption>Favorite passage · ${e(favorite.label)}</figcaption><blockquote><a href="${e(readerLink(conversation.slug,favorite.target,favorite.quote))}">“${e(favorite.quote)}”</a></blockquote><a class="source-link" href="${e(readerLink(conversation.slug,favorite.target,favorite.quote))}">Read in context →</a></figure>` : ''}${originalRanking ? `<section class="original-ranking" aria-labelledby="original-ranking-title"><h3 id="original-ranking-title">Gemini’s original ranking</h3><p class="editorial-note">Quoted from response 8. These are Gemini’s classifications; the later Codex assessment remains separately attributed in message 21.</p>${ranking.tiers.map(tier=>`<div><h4><a href="${e(readerLink(conversation.slug,tier.target))}">${e(tier.heading)}</a></h4><ul>${tier.issues.map(issue=>`<li>${e(issue)}</li>`).join('')}</ul></div>`).join('')}</section>` : ''}</section>`;
}

// A public editorial pin, independent of browser-local saved passages.
export function pinnedExchangeFor(conversation, curated) {
  const pin = curated?.pinnedExchange;
  if (!pin || !matchesSourceMessage(conversation, pin.question) || !matchesSourceMessage(conversation, pin.response)) return null;
  return { ...pin, questionMessage: conversation.messages[pin.question - 1], responseMessage: conversation.messages[pin.response - 1] };
}

export function renderPinnedExchange(conversation, pin) {
  if (!pin) return '';
  return `<section class="pinned-exchange" aria-labelledby="pinned-exchange-title">
    <p class="reader-eyebrow">PINNED EXCHANGE · FROM THE ORIGINAL CONVERSATION</p>
    <h2 id="pinned-exchange-title">${e(pin.title)}</h2>
    <details class="pinned-turn" open><summary>Jacob’s question <span>Message ${pin.question}</span></summary>
      <div class="message-body pinned-question">${safeHTML(pin.questionMessage.content)}</div>
      <a class="source-link" href="${e(readerLink(conversation.slug,`message-${pin.question}`))}">Read the question in context →</a>
    </details>
    <details class="pinned-turn" open><summary>${e(pin.responseMessage.model || conversation.ai_model || 'AI')}’s response <span>Message ${pin.response}</span></summary>
      <div class="message-body">${safeHTML(pin.responseMessage.content)}</div>
      <a class="source-link" href="${e(readerLink(conversation.slug,`message-${pin.response}`))}">Read the response in context →</a>
    </details>
    <p class="editorial-note">Original wording and sources. Expand the full conversation below for the earlier questions and Astra’s later contribution.</p>
  </section>`;
}
