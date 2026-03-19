/**
 * Parse conversations from various formats.
 * Designed to be very forgiving — handles messy pastes gracefully.
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
  const lines = trimmed.split('\n').filter(l => l.trim());
  if (lines.length > 1 && lines.slice(0, 3).every(line => {
    try { JSON.parse(line); return true; } catch { return false; }
  })) {
    return parseJSONL(trimmed);
  }

  // Fall back to plain text — very forgiving
  return parsePlainText(trimmed);
}

/**
 * Parse plain text. Very forgiving — tries multiple strategies.
 */
function parsePlainText(text) {
  // Strategy 1: Look for explicit role prefixes
  const prefixResult = tryPrefixParsing(text);
  if (prefixResult && prefixResult.messages.length >= 2) {
    return prefixResult;
  }

  // Strategy 2: Look for Claude.ai / ChatGPT copy-paste patterns
  const copyPasteResult = tryCopyPasteParsing(text);
  if (copyPasteResult && copyPasteResult.messages.length >= 2) {
    return copyPasteResult;
  }

  // Strategy 3: Look for quoted/indented patterns (email-style)
  const quotedResult = tryQuotedParsing(text);
  if (quotedResult && quotedResult.messages.length >= 2) {
    return quotedResult;
  }

  // Strategy 4: Split by double newlines and alternate roles
  // (assume first block is human, second is AI, alternating)
  const blocks = text.split(/\n{3,}/).map(b => b.trim()).filter(Boolean);
  if (blocks.length >= 2) {
    const messages = blocks.map((block, i) => ({
      role: i % 2 === 0 ? 'human' : 'ai',
      content: formatContent(block),
    }));
    return { messages, ai_model: 'AI' };
  }

  // Fallback: treat as single message (let user fix in preview)
  return {
    messages: [{ role: 'human', content: formatContent(text) }],
    ai_model: 'AI',
  };
}

/**
 * Strategy 1: Explicit role prefixes like "Human:", "Claude:", "User:", etc.
 */
function tryPrefixParsing(text) {
  // Broad set of role patterns
  const humanPrefixes = /^(?:Human|User|Me|Person|You|I|Q|Question|Prompt|My (?:question|prompt|message)):\s*/i;
  const aiPrefixes = /^(?:Claude|Assistant|AI|ChatGPT|GPT|GPT-4|GPT-5|Gemini|Bot|Copilot|A|Answer|Response|Llama|Mistral|DeepSeek|Grok|Model):\s*/i;

  const lines = text.split('\n');
  const messages = [];
  let currentRole = null;
  let currentContent = [];

  for (const line of lines) {
    const humanMatch = line.match(humanPrefixes);
    const aiMatch = line.match(aiPrefixes);

    if (humanMatch) {
      if (currentRole !== null && currentContent.length > 0) {
        messages.push({ role: currentRole, content: formatContent(joinContent(currentContent)) });
      }
      currentRole = 'human';
      currentContent = [line.slice(humanMatch[0].length)];
    } else if (aiMatch) {
      if (currentRole !== null && currentContent.length > 0) {
        messages.push({ role: currentRole, content: formatContent(joinContent(currentContent)) });
      }
      currentRole = 'ai';
      currentContent = [line.slice(aiMatch[0].length)];
    } else {
      currentContent.push(line);
    }
  }

  if (currentRole !== null && currentContent.length > 0) {
    messages.push({ role: currentRole, content: formatContent(joinContent(currentContent)) });
  }

  // Detect AI model from prefixes used
  let ai_model = 'AI';
  const modelMatch = text.match(/^(Claude|ChatGPT|GPT-4|GPT-5|Gemini|Copilot|Llama|Mistral|DeepSeek|Grok):/im);
  if (modelMatch) ai_model = modelMatch[1];

  return messages.length >= 2 ? { messages, ai_model } : null;
}

/**
 * Strategy 2: Copy-paste from Claude.ai or ChatGPT web UI.
 * These often have patterns like "You said:" or just alternating blocks
 * with the AI name appearing as a heading.
 */
function tryCopyPasteParsing(text) {
  // Pattern: "You" / "Claude" or "ChatGPT" as standalone lines acting as headers
  const headerPattern = /^(You|Human|User|Claude|ChatGPT|Assistant|Gemini|GPT)\s*$/gim;
  const headers = [...text.matchAll(headerPattern)];

  if (headers.length >= 2) {
    const messages = [];
    for (let i = 0; i < headers.length; i++) {
      const start = headers[i].index + headers[i][0].length;
      const end = i + 1 < headers.length ? headers[i + 1].index : text.length;
      const content = text.slice(start, end).trim();
      const name = headers[i][1].toLowerCase();
      const isHuman = ['you', 'human', 'user'].includes(name);

      if (content) {
        messages.push({
          role: isHuman ? 'human' : 'ai',
          content: formatContent(content),
        });
      }
    }

    let ai_model = 'AI';
    const aiHeader = headers.find(h => !['you', 'human', 'user'].includes(h[1].toLowerCase()));
    if (aiHeader) ai_model = aiHeader[1];

    return messages.length >= 2 ? { messages, ai_model } : null;
  }

  // Pattern: "You said:" / response blocks (newer Claude.ai copy format)
  if (text.includes('You said:') || text.includes('You wrote:')) {
    const parts = text.split(/(?:You said:|You wrote:)/i);
    const messages = [];

    for (let i = 1; i < parts.length; i++) {
      // Split each part into human message and AI response
      // The human message is before the next big paragraph break
      const subParts = parts[i].split(/\n{2,}/);
      if (subParts.length >= 1) {
        messages.push({ role: 'human', content: formatContent(subParts[0].trim()) });
        if (subParts.length >= 2) {
          messages.push({ role: 'ai', content: formatContent(subParts.slice(1).join('\n\n').trim()) });
        }
      }
    }

    return messages.length >= 2 ? { messages, ai_model: 'Claude' } : null;
  }

  return null;
}

/**
 * Strategy 3: Quoted patterns (> prefix for one role).
 */
function tryQuotedParsing(text) {
  const lines = text.split('\n');
  const messages = [];
  let currentRole = null;
  let currentContent = [];

  for (const line of lines) {
    const isQuoted = line.startsWith('> ') || line.startsWith('>');
    const role = isQuoted ? 'human' : 'ai';
    const content = isQuoted ? line.replace(/^>\s?/, '') : line;

    if (role !== currentRole && currentContent.length > 0 && joinContent(currentContent).trim()) {
      messages.push({ role: currentRole, content: formatContent(joinContent(currentContent)) });
      currentContent = [];
    }
    currentRole = role;
    currentContent.push(content);
  }

  if (currentRole !== null && currentContent.length > 0 && joinContent(currentContent).trim()) {
    messages.push({ role: currentRole, content: formatContent(joinContent(currentContent)) });
  }

  return messages.length >= 2 ? { messages, ai_model: 'AI' } : null;
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

  if (Array.isArray(data)) {
    const messages = data
      .filter(m => m.role && m.content)
      .map(m => ({
        role: m.role === 'user' || m.role === 'human' ? 'human' : 'ai',
        content: formatContent(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)),
      }));
    return { messages, ai_model: 'AI' };
  }

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

  if (data.messages) {
    return parseJSON(JSON.stringify(data.messages));
  }

  throw new Error('Unrecognized JSON format');
}

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

function joinContent(lines) {
  return lines.join('\n');
}

function formatContent(text) {
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
