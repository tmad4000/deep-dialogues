/**
 * Fetch and parse conversations from share links.
 * Uses allorigins.win as a CORS proxy for client-side fetching.
 */

const PROXY = 'https://api.allorigins.win/get?url=';

/**
 * Fetch a share link and parse into conversation format.
 */
export async function fetchShareLink(url) {
  // Validate URL
  const parsed = new URL(url);
  const hostname = parsed.hostname;

  // Fetch via CORS proxy
  const proxyUrl = PROXY + encodeURIComponent(url);
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error('Failed to fetch the link');

  const data = await res.json();
  const html = data.contents;
  if (!html) throw new Error('Empty response from link');

  // Route to appropriate parser
  if (hostname.includes('claude.ai')) {
    return parseClaudeShare(html, url);
  } else if (hostname.includes('chatgpt.com') || hostname.includes('chat.openai.com')) {
    return parseChatGPTShare(html, url);
  } else {
    // Generic: try to extract conversation-like content
    return parseGenericShare(html, url);
  }
}

/**
 * Parse Claude share link HTML.
 * Claude share pages render conversations in structured HTML.
 */
function parseClaudeShare(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const messages = [];

  // Claude share pages have [data-testid="user-message"] and [data-testid="assistant-message"]
  // or div elements with specific class patterns
  // Try multiple selectors
  const humanEls = doc.querySelectorAll('[data-testid="user-message"], .font-user-message, .whitespace-pre-wrap.break-words');
  const aiEls = doc.querySelectorAll('[data-testid="assistant-message"], .font-claude-message, .grid-cols-1.grid');

  // If structured selectors work
  if (humanEls.length > 0 || aiEls.length > 0) {
    // Interleave messages by DOM order
    const allMsgEls = doc.querySelectorAll('[data-testid="user-message"], [data-testid="assistant-message"]');
    allMsgEls.forEach(el => {
      const isHuman = el.getAttribute('data-testid') === 'user-message';
      messages.push({
        role: isHuman ? 'human' : 'ai',
        content: elementToHTML(el),
      });
    });
  }

  // Fallback: look for the conversation in script tags (Next.js hydration data)
  if (messages.length === 0) {
    const scriptEls = doc.querySelectorAll('script');
    for (const script of scriptEls) {
      const text = script.textContent;
      if (text.includes('conversation') || text.includes('messages') || text.includes('chat_messages')) {
        try {
          // Try to find JSON data in script tags
          const jsonMatch = text.match(/\{[\s\S]*"chat_messages"[\s\S]*\}/);
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);
            if (data.chat_messages) {
              for (const msg of data.chat_messages) {
                messages.push({
                  role: msg.sender === 'human' ? 'human' : 'ai',
                  content: formatTextToHTML(msg.text || msg.content?.[0]?.text || ''),
                });
              }
            }
          }
        } catch (e) {
          // Continue trying other scripts
        }
      }
    }
  }

  // Try __NEXT_DATA__ pattern
  if (messages.length === 0) {
    const nextData = doc.querySelector('#__NEXT_DATA__');
    if (nextData) {
      try {
        const data = JSON.parse(nextData.textContent);
        const chatMessages = findInObject(data, 'chat_messages') || findInObject(data, 'messages');
        if (Array.isArray(chatMessages)) {
          for (const msg of chatMessages) {
            const role = (msg.sender === 'human' || msg.role === 'user') ? 'human' : 'ai';
            const content = msg.text || (msg.content && Array.isArray(msg.content)
              ? msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
              : msg.content) || '';
            if (content) {
              messages.push({ role, content: formatTextToHTML(content) });
            }
          }
        }
      } catch (e) {}
    }
  }

  // Extract title
  const titleEl = doc.querySelector('title');
  const title = titleEl ? titleEl.textContent.replace(/ - Claude$/, '').trim() : '';

  if (messages.length === 0) {
    throw new Error('Could not extract messages from Claude share link. Try copying the conversation text and pasting it in the "Paste text" tab.');
  }

  return {
    messages,
    ai_model: 'Claude',
    title: title || null,
    original_url: url,
  };
}

/**
 * Parse ChatGPT share link HTML.
 */
function parseChatGPTShare(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const messages = [];

  // ChatGPT share pages have role-based message containers
  const msgEls = doc.querySelectorAll('[data-message-author-role]');
  msgEls.forEach(el => {
    const role = el.getAttribute('data-message-author-role');
    if (role === 'user' || role === 'assistant') {
      messages.push({
        role: role === 'user' ? 'human' : 'ai',
        content: elementToHTML(el),
      });
    }
  });

  // Fallback: try __NEXT_DATA__
  if (messages.length === 0) {
    const nextData = doc.querySelector('#__NEXT_DATA__');
    if (nextData) {
      try {
        const data = JSON.parse(nextData.textContent);
        const mapping = findInObject(data, 'mapping');
        if (mapping && typeof mapping === 'object') {
          const nodes = Object.values(mapping)
            .filter(n => n.message?.content?.parts)
            .sort((a, b) => (a.message.create_time || 0) - (b.message.create_time || 0));
          for (const node of nodes) {
            const msg = node.message;
            const role = msg.author?.role === 'user' ? 'human' : 'ai';
            if (role === 'human' || msg.author?.role === 'assistant') {
              const content = msg.content.parts.join('\n');
              if (content.trim()) {
                messages.push({ role, content: formatTextToHTML(content) });
              }
            }
          }
        }
      } catch (e) {}
    }
  }

  const titleEl = doc.querySelector('title');
  const title = titleEl ? titleEl.textContent.replace(/ \| ChatGPT$/, '').trim() : '';

  if (messages.length === 0) {
    throw new Error('Could not extract messages from ChatGPT share link. Try copying the conversation text and pasting it in the "Paste text" tab.');
  }

  return {
    messages,
    ai_model: 'ChatGPT',
    title: title || null,
    original_url: url,
  };
}

/**
 * Generic share page parser — extract text that looks like a conversation.
 */
function parseGenericShare(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Try to get the main text content
  const body = doc.body?.textContent || '';

  // Try to parse as conversation text
  const { parseConversation } = import('../lib/parser.js');
  // Can't dynamically import in sync context — just extract text and throw
  throw new Error('Auto-fetch is not supported for this URL. Copy the conversation text from the page and paste it in the "Paste text" tab.');
}

/**
 * Convert a DOM element's content to HTML paragraphs.
 */
function elementToHTML(el) {
  // Get inner HTML, clean it up
  let html = el.innerHTML;
  // Remove script tags
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  // If it's already well-structured, return as-is
  if (html.includes('<p>') || html.includes('<p ')) return html;
  // Wrap in paragraphs
  return formatTextToHTML(el.textContent);
}

/**
 * Convert plain text to HTML paragraphs.
 */
function formatTextToHTML(text) {
  if (!text) return '';
  if (text.includes('<p>')) return text;
  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      p = p.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      p = p.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      p = p.replace(/\n/g, '<br>');
      return `<p>${p}</p>`;
    })
    .join('');
}

/**
 * Recursively search an object for a key.
 */
function findInObject(obj, key) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj[key] !== undefined) return obj[key];
  for (const k of Object.keys(obj)) {
    const result = findInObject(obj[k], key);
    if (result !== null) return result;
  }
  return null;
}
