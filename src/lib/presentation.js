import abundance from '../../content/google-basic-needs.json' with { type: 'json' };
import dataCenters from '../../content/ai-data-centers.json' with { type: 'json' };

// Compare rendered wording before overlaying this versioned, presentation-only edit.
// A conversation edited by an operator keeps its own content if the wording differs.
function codePoint(n) { return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '\uFFFD'; }
export function plainText(html) {
  return String(html).replace(/<\/(?:p|li|h[1-6]|td|th|tr|blockquote|div)>/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => codePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[n])
    .replace(/\s+/g, ' ').trim();
}
function destinations(html) {
  return [...String(html).matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    .map(match => plainText(match[1] ?? match[2] ?? match[3]));
}
function formattedSource(row) {
  return [abundance, dataCenters].find(c => c.slug === row?.slug && row.messages?.length === c.messages.length);
}
function matchesMessage(msg, source) {
  return !!msg && !!source && plainText(msg.content) === plainText(source.content) && msg.role === source.role && JSON.stringify(destinations(msg.content)) === JSON.stringify(destinations(source.content));
}
export function matchesSourceMessage(row, message) {
  const formatted = formattedSource(row);
  return !!formatted && matchesMessage(row.messages[message - 1], formatted.messages[message - 1]);
}
export function presentConversation(row) {
  const formatted = formattedSource(row);
  if (!formatted) return row;
  return { ...row, messages: row.messages.map((msg, i) => matchesMessage(msg, formatted.messages[i])
    ? { ...msg, content: formatted.messages[i].content } : msg) };
}
export function anchorSlug(text) {
  return plainText(text).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'section';
}
