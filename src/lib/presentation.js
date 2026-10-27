import formatted from '../../content/google-basic-needs.json' with { type: 'json' };

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
export function presentConversation(row) {
  if (!row || row.slug !== formatted.slug || row.messages?.length !== formatted.messages.length) return row;
  return { ...row, messages: row.messages.map((msg, i) => plainText(msg.content) === plainText(formatted.messages[i].content) && msg.role === formatted.messages[i].role && JSON.stringify(destinations(msg.content)) === JSON.stringify(destinations(formatted.messages[i].content))
    ? { ...msg, content: formatted.messages[i].content } : msg) };
}
export function anchorSlug(text) {
  return plainText(text).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'section';
}
