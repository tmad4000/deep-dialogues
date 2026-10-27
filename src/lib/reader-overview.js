import { escapeHTML as e } from './html.js';
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
