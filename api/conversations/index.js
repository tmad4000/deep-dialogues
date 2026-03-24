import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);
}

function makeUniqueSlug(title) {
  return `${slugify(title)}-${Date.now().toString(36).slice(-4)}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    try {
      const { title, messages, contributor_name, ai_model, tags, description, highlights, original_url, commentary } = req.body;

      if (!title || typeof title !== 'string') {
        return res.status(400).json({ error: 'title is required' });
      }
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'messages must be a non-empty array' });
      }
      for (const msg of messages) {
        if (!msg.role || !msg.content) {
          return res.status(400).json({ error: 'each message must have role and content' });
        }
        if (!['human', 'assistant', 'user', 'system'].includes(msg.role)) {
          return res.status(400).json({ error: `invalid role "${msg.role}"` });
        }
      }

      const normalizedMessages = messages.map(m => ({
        role: m.role === 'user' ? 'human' : m.role,
        content: m.content,
      }));

      const row = {
        slug: makeUniqueSlug(title),
        title: title.trim(),
        messages: normalizedMessages,
        status: 'pending',
        turn_count: normalizedMessages.length,
        created_at: new Date().toISOString(),
      };

      if (contributor_name) row.contributor_name = contributor_name.trim();
      if (ai_model) row.ai_model = ai_model.trim();
      if (tags && Array.isArray(tags)) row.tags = tags;
      if (description) row.description = description.trim();
      if (original_url) row.original_url = original_url.trim();
      if (commentary) row.commentary = commentary.trim();
      if (highlights && Array.isArray(highlights) && highlights.length > 0) {
        row.highlights = highlights;
      }

      let { data, error } = await supabase.from('conversations').insert(row).select().single();

      if (error && error.message && error.message.includes('highlights')) {
        delete row.highlights;
        if (highlights && highlights.length > 0) {
          const hl = highlights.map(h => `> ${h}`).join('\n');
          row.description = (row.description || '') + '\n\nHighlights:\n' + hl;
        }
        ({ data, error } = await supabase.from('conversations').insert(row).select().single());
      }

      if (error) return res.status(422).json({ error: error.message });
      return res.status(201).json(data);
    } catch (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method === 'GET') {
    try {
      const { contributor, tag, limit = '20', offset = '0' } = req.query;
      const lim = Math.min(parseInt(limit, 10) || 20, 100);
      const off = parseInt(offset, 10) || 0;

      let query = supabase
        .from('conversations')
        .select('id, slug, title, description, ai_model, contributor_name, tags, turn_count, featured, status, created_at, published_at, original_url, commentary')
        .eq('status', 'published')
        .order('featured', { ascending: false })
        .order('created_at', { ascending: false })
        .range(off, off + lim - 1);

      if (contributor) query = query.ilike('contributor_name', contributor);
      if (tag) query = query.contains('tags', [tag]);

      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    } catch (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
