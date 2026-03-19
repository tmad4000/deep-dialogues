import { supabase } from './supabase.js';
import { seedConversations } from '../data/seed.js';

let cache = null;

/**
 * Get all published conversations.
 * Tries Supabase first, falls back to seed data.
 */
export async function getConversations() {
  if (cache) return cache;

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('status', 'published')
        .order('featured', { ascending: false })
        .order('created_at', { ascending: false });

      if (!error && data && data.length > 0) {
        cache = data;
        return data;
      }
    } catch (e) {
      console.warn('Supabase fetch failed, using seed data:', e.message);
    }
  }

  // Fallback to seed data
  cache = seedConversations;
  return seedConversations;
}

/**
 * Get a single conversation by slug.
 */
export async function getConversation(slug) {
  const all = await getConversations();
  return all.find(c => c.slug === slug) || null;
}

/**
 * Submit a new conversation (goes to pending).
 */
export async function submitConversation(conversation) {
  if (!supabase) {
    throw new Error('Database not configured');
  }

  const { data, error } = await supabase
    .from('conversations')
    .insert({
      ...conversation,
      status: 'pending',
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get unique tags from all conversations.
 */
export async function getTags() {
  const conversations = await getConversations();
  const tagSet = new Set();
  conversations.forEach(c => {
    (c.tags || []).forEach(t => tagSet.add(t));
  });
  return [...tagSet].sort();
}

/**
 * Get unique AI models from all conversations.
 */
export async function getModels() {
  const conversations = await getConversations();
  const models = new Set();
  conversations.forEach(c => {
    if (c.ai_model) models.add(c.ai_model);
  });
  return [...models].sort();
}
