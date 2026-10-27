const keyFor = slug => `deep-dialogues.reading.v1:${slug}`;
export function loadReadingState(storage, slug) {
  try {
    const value=JSON.parse(storage.getItem(keyFor(slug)) || '[]');
    return Array.isArray(value) ? value.filter(x => x && ['bookmark','highlight'].includes(x.type) && typeof x.id==='string' && typeof x.target==='string' && /^message-\d+(?:-[a-z0-9-]+)?$/.test(x.target) && typeof x.label==='string' && x.label.length<=300 && (x.type==='bookmark' || (typeof x.quote==='string' && x.quote.length>0 && x.quote.length<=1200 && Number.isInteger(x.start) && x.start>=0))).slice(0,250) : [];
  } catch { return []; }
}
export function saveReadingState(storage, slug, items) {
  try { storage.setItem(keyFor(slug),JSON.stringify(items.slice(0,250))); return true; } catch { return false; }
}
export function toggleBookmark(items, target, label) {
  const id=`bookmark:${target}`;
  return items.some(x=>x.id===id) ? items.filter(x=>x.id!==id) : [...items,{id,type:'bookmark',target,label:label.slice(0,300)}];
}
export function quoteLocation(text, quote, requestedStart) {
  if (!quote || quote.length>1200) return -1;
  if (Number.isInteger(requestedStart) && requestedStart>=0 && text.slice(requestedStart,requestedStart+quote.length)===quote) return requestedStart;
  const first=text.indexOf(quote);
  return first>=0 && text.indexOf(quote,first+1)===-1 ? first : -1;
}
