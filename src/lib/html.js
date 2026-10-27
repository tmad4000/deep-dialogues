export function escapeHTML(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function safeURL(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? escapeHTML(url.href) : '';
  } catch { return ''; }
}

export function safeHTML(value = '') {
  const source = document.createElement('template');
  source.innerHTML = String(value);
  const output = document.createElement('div');
  const allowed = new Set('P BR STRONG EM B I U S A BLOCKQUOTE PRE CODE UL OL LI H1 H2 H3 H4 H5 H6 HR TABLE THEAD TBODY TR TH TD SUP SUB'.split(' '));
  const blocked = new Set('SCRIPT STYLE SVG MATH IFRAME OBJECT EMBED TEMPLATE FORM INPUT BUTTON TEXTAREA SELECT LINK META BASE'.split(' '));
  function copy(node, parent) {
    if (node.nodeType === Node.TEXT_NODE) { parent.append(document.createTextNode(node.textContent)); return; }
    if (node.nodeType !== Node.ELEMENT_NODE || blocked.has(node.tagName)) return;
    let target = parent;
    if (allowed.has(node.tagName)) {
      target = document.createElement(node.tagName.toLowerCase());
      if (node.tagName === 'A') {
        try {
          const url = new URL(node.getAttribute('href'));
          if (['https:', 'http:'].includes(url.protocol)) { target.href = url.href; target.target = '_blank'; target.rel = 'noopener noreferrer'; }
        } catch { /* Keep link text without an unsafe destination. */ }
      }
      parent.append(target);
    }
    for (const child of node.childNodes) copy(child, target);
  }
  for (const node of source.content.childNodes) copy(node, output);
  return output.innerHTML;
}
