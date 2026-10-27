import abundance from '../../content/abundance-summary.json' with { type: 'json' };
export const publicOrigin = 'https://deep-dialogues.ideaflow.app';
export const abundanceSummary = abundance;
export function curationFor(conversation) {
  return conversation?.slug === abundance.slug && conversation.messages?.length === 13 ? abundance : null;
}
export function readerLink(slug, target, quote, start) {
  const url = new URL(`/read/${encodeURIComponent(slug)}`, publicOrigin);
  if (target) url.searchParams.set('at', target);
  if (quote) url.searchParams.set('quote', quote.slice(0, 1200));
  if (Number.isInteger(start)) url.searchParams.set('from', String(start));
  return url.href;
}
