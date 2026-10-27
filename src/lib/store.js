import { seedConversations } from '../data/seed.js';

const apiBase = (import.meta.env.VITE_API_BASE_URL || import.meta.env.BASE_URL).replace(/\/$/, '');
let cache = null;

async function request(path, options) {
  const response = await fetch(`${apiBase}/api${path}`, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not reach the conversation library');
  return result;
}

export async function getConversations() {
  if (cache) return cache;
  try {
    const rows = [];
    for (let offset = 0; ; offset += 100) {
      const page = await request(`/conversations?limit=100&offset=${offset}`);
      rows.push(...page);
      if (page.length < 100) break;
    }
    cache = rows;
  } catch (error) {
    console.warn('Library unavailable; showing the bundled archive:', error.message);
    cache = seedConversations;
  }
  return cache;
}

export async function getConversation(slug) {
  try { return await request(`/conversations/${encodeURIComponent(slug)}`); }
  catch { return seedConversations.find(c => c.slug === slug) || null; }
}

export async function submitConversation(conversation) {
  const row = await request('/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(conversation) });
  cache = null;
  return row;
}

export async function getTags() {
  return [...new Set((await getConversations()).flatMap(c => c.tags || []))].sort();
}

export async function getModels() {
  return [...new Set((await getConversations()).map(c => c.ai_model).filter(Boolean))].sort();
}
