/**
 * Parse conversations from various formats.
 */

/**
 * Auto-detect format and parse.
 */
export function parseConversation(input) {
  const trimmed = input.trim();

  // Try JSON/JSONL first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return parseJSON(trimmed);
    } catch (e) {
      // Not valid JSON, try as text
    }
  }

  // Try JSONL (Claude Code transcript)
  if (trimmed.includes('\n') && trimmed.split('\n').every(line => {
    if (!line.trim()) return true;
    try { JSON.parse(line); return true; } catch { return false; }
  })) {
    return parseJSONL(trimmed);
  }

  // Fall back to plain text
  return parsePlainText(trimmed);
}

/**
 * Parse plain text with role prefixes.
 * Supports: Human/Claude, User/Assistant, Me/ChatGPT, etc.
 */
function parsePlainText(text) {
  const rolePatterns = [
    { pattern: /^(Human|User|Me|Person):\s*/im, role: 'human' },
    { pattern: /^(Claude|Assistant|AI|ChatGPT|GPT|Gemini|Bot):\s*/im, role: 'ai' },
  ];

  // Split by role markers
  const lines = text.split('\n');
  const messages = [];
  let currentRole = null;
  let currentContent = [];

  for (const line of lines) {
    let matched = false;

    for (const { pattern, role } of rolePatterns) {
      const match = line.match(pattern);
      if (match) {
        // Save previous message
        if (currentRole && currentContent.length > 0) {
          messages.push({
            role: currentRole,
            content: formatContent(currentContent.join('\n').trim()),
          });
        }
        currentRole = role;
        currentContent = [line.slice(match[0].length)];
        matched = true;
        break;
      }
    }

    if (!matched) {
      currentContent.push(line);
    }
  }

  // Save last message
  if (currentRole && currentContent.length > 0) {
    messages.push({
      role: currentRole,
      content: formatContent(currentContent.join('\n').trim()),
    });
  }

  // If no roles detected, treat as single AI message
  if (messages.length === 0 && text.trim()) {
    messages.push({
      role: 'ai',
      content: formatContent(text.trim()),
    });
  }

  // Detect AI model from role labels
  let ai_model = 'AI';
  const modelMatch = text.match(/^(Claude|ChatGPT|GPT|Gemini):/im);
  if (modelMatch) ai_model = modelMatch[1];

  return { messages, ai_model };
}

/**
 * Parse JSONL (Claude Code transcript format).
 */
function parseJSONL(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const messages = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);

      if (obj.type === 'human' || obj.role === 'user') {
        messages.push({
          role: 'human',
          content: formatContent(extractText(obj)),
        });
      } else if (obj.type === 'assistant' || obj.role === 'assistant') {
        const text = extractText(obj);
        if (text) {
          messages.push({
            role: 'ai',
            content: formatContent(text),
          });
        }
      }
    } catch (e) {
      continue;
    }
  }

  return { messages, ai_model: 'Claude' };
}

/**
 * Parse JSON (ChatGPT export or generic format).
 */
function parseJSON(text) {
  const data = JSON.parse(text);

  // If it's an array of messages already
  if (Array.isArray(data)) {
    const messages = data
      .filter(m => m.role && m.content)
      .map(m => ({
        role: m.role === 'user' || m.role === 'human' ? 'human' : 'ai',
        content: formatContent(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)),
      }));
    return { messages, ai_model: 'AI' };
  }

  // ChatGPT export format with mapping
  if (data.mapping) {
    const messages = [];
    const nodes = Object.values(data.mapping)
      .filter(n => n.message && n.message.content && n.message.content.parts)
      .sort((a, b) => (a.message.create_time || 0) - (b.message.create_time || 0));

    for (const node of nodes) {
      const msg = node.message;
      const role = msg.author?.role === 'user' ? 'human' : 'ai';
      const content = msg.content.parts.join('\n');
      if (content.trim()) {
        messages.push({ role, content: formatContent(content) });
      }
    }
    return { messages, ai_model: 'ChatGPT' };
  }

  // Generic object with messages array
  if (data.messages) {
    return parseJSON(JSON.stringify(data.messages));
  }

  throw new Error('Unrecognized JSON format');
}

/**
 * Extract text content from a JSONL message object.
 */
function extractText(obj) {
  if (typeof obj.content === 'string') return obj.content;
  if (Array.isArray(obj.content)) {
    return obj.content
      .filter(c => typeof c === 'string' || c.type === 'text')
      .map(c => typeof c === 'string' ? c : c.text)
      .join('\n');
  }
  if (obj.message) return extractText(obj.message);
  return '';
}

/**
 * Convert plain text to HTML paragraphs.
 */
function formatContent(text) {
  if (text.includes('<p>')) return text; // Already HTML

  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      // Convert *text* to <em>text</em>
      p = p.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      // Convert **text** to <strong>text</strong>
      p = p.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      // Convert single newlines to <br>
      p = p.replace(/\n/g, '<br>');
      return `<p>${p}</p>`;
    })
    .join('');
}
