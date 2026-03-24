import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.API_PORT || 7845;

// Supabase — accept either VITE_ prefixed or plain env vars
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// --- Helpers ---

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function makeUniqueSlug(title) {
  const base = slugify(title);
  const suffix = Date.now().toString(36).slice(-4);
  return `${base}-${suffix}`;
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 'messages must be a non-empty array';
  }
  for (const msg of messages) {
    if (!msg.role || !msg.content) {
      return 'each message must have role and content';
    }
    if (!['human', 'assistant', 'user', 'system'].includes(msg.role)) {
      return `invalid role "${msg.role}" — use human, assistant, user, or system`;
    }
  }
  return null;
}

function normalizeMessages(messages) {
  return messages.map(m => ({
    role: m.role === 'user' ? 'human' : m.role,
    content: m.content,
  }));
}

// --- llms.txt ---

app.get('/llms.txt', (_req, res) => {
  const llmsTxt = readFileSync(join(__dirname, '..', 'public', 'llms.txt'), 'utf8');
  res.type('text/plain').send(llmsTxt);
});

// --- API Docs ---

app.get('/api/docs', (_req, res) => {
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'Deep Dialogues API',
      version: '1.0.0',
      description: 'Submit and browse curated AI conversations.',
    },
    servers: [{ url: '/api' }],
    paths: {
      '/conversations': {
        post: {
          summary: 'Submit a conversation',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title', 'messages'],
                  properties: {
                    title: { type: 'string', description: 'Title of the conversation' },
                    messages: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['role', 'content'],
                        properties: {
                          role: { type: 'string', enum: ['human', 'assistant', 'user', 'system'] },
                          content: { type: 'string' },
                        },
                      },
                    },
                    contributor_name: { type: 'string' },
                    ai_model: { type: 'string' },
                    tags: { type: 'array', items: { type: 'string' } },
                    description: { type: 'string' },
                    highlights: { type: 'array', items: { type: 'string' }, description: 'Notable excerpts from the conversation' },
                    original_url: { type: 'string' },
                    commentary: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { 201: { description: 'Conversation created' } },
        },
        get: {
          summary: 'List published conversations',
          parameters: [
            { name: 'contributor', in: 'query', schema: { type: 'string' } },
            { name: 'tag', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: { 200: { description: 'Array of conversations (without full messages)' } },
        },
      },
      '/conversations/{slug}': {
        get: {
          summary: 'Get a single conversation with full messages',
          parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Conversation object' },
            404: { description: 'Not found' },
          },
        },
      },
      '/contributors': {
        get: {
          summary: 'List all contributors with conversation counts',
          responses: { 200: { description: 'Array of {contributor_name, count}' } },
        },
      },
    },
  });
});

// --- POST /api/conversations ---

app.post('/api/conversations', async (req, res) => {
  try {
    const { title, messages, contributor_name, ai_model, tags, description, highlights, original_url, commentary } = req.body;

    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'title is required' });
    }

    const msgError = validateMessages(messages);
    if (msgError) {
      return res.status(400).json({ error: msgError });
    }

    const normalizedMessages = normalizeMessages(messages);
    const slug = makeUniqueSlug(title);

    const row = {
      slug,
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

    // Try to include highlights if the column exists; retry without if it doesn't
    if (highlights && Array.isArray(highlights) && highlights.length > 0) {
      row.highlights = highlights;
    }

    let { data, error } = await supabase
      .from('conversations')
      .insert(row)
      .select()
      .single();

    // If highlights column doesn't exist yet, retry without it
    if (error && error.message && error.message.includes('highlights')) {
      delete row.highlights;
      // Append highlights to description instead
      if (highlights && highlights.length > 0) {
        const hl = highlights.map(h => `> ${h}`).join('\n');
        row.description = (row.description || '') + '\n\nHighlights:\n' + hl;
      }
      ({ data, error } = await supabase
        .from('conversations')
        .insert(row)
        .select()
        .single());
    }

    if (error) {
      console.error('Supabase insert error:', error);
      return res.status(422).json({ error: error.message });
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('POST /api/conversations error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- GET /api/conversations ---

app.get('/api/conversations', async (req, res) => {
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

    if (contributor) {
      query = query.ilike('contributor_name', contributor);
    }
    if (tag) {
      query = query.contains('tags', [tag]);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (err) {
    console.error('GET /api/conversations error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- GET /api/conversations/:slug ---

app.get('/api/conversations/:slug', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('slug', req.params.slug)
      .eq('status', 'published')
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json(data);
  } catch (err) {
    console.error('GET /api/conversations/:slug error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- GET /api/contributors ---

app.get('/api/contributors', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('contributor_name')
      .eq('status', 'published')
      .not('contributor_name', 'is', null);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const counts = {};
    for (const row of data || []) {
      const name = row.contributor_name;
      counts[name] = (counts[name] || 0) + 1;
    }

    const contributors = Object.entries(counts)
      .map(([contributor_name, count]) => ({ contributor_name, count }))
      .sort((a, b) => b.count - a.count);

    res.json(contributors);
  } catch (err) {
    console.error('GET /api/contributors error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Start ---

app.listen(PORT, () => {
  console.log(`Deep Dialogues API running on port ${PORT}`);
  console.log(`  POST /api/conversations    — Submit a conversation`);
  console.log(`  GET  /api/conversations    — List published conversations`);
  console.log(`  GET  /api/conversations/:s — Get conversation by slug`);
  console.log(`  GET  /api/contributors     — List contributors`);
  console.log(`  GET  /api/docs             — OpenAPI schema`);
  console.log(`  GET  /llms.txt             — LLM discovery document`);
});
