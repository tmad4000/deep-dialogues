import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { seedConversations } from '../src/data/seed.js';

export function openStore(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, status TEXT NOT NULL,
      featured INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, document TEXT NOT NULL
    );`);
  const insert = db.prepare('INSERT INTO conversations VALUES (?, ?, ?, ?, ?, ?)');
  const save = (input, status = 'pending') => {
    const row = { ...input, id: input.id || randomUUID(), status,
      created_at: input.created_at || new Date().toISOString(), turn_count: input.messages.length };
    insert.run(row.id, row.slug, row.status, row.featured ? 1 : 0, row.created_at, JSON.stringify(row));
    return row;
  };
  const exists = db.prepare('SELECT 1 FROM conversations WHERE slug = ?');
  db.exec('BEGIN');
  try {
    // Idempotent recovery: never replace a later edit to a recovered conversation.
    for (const row of seedConversations) if (!exists.get(row.slug)) save(row, 'published');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  return {
    db, save,
    list({ contributor, tag, limit = 20, offset = 0 } = {}) {
      const rows = db.prepare("SELECT document FROM conversations WHERE status = 'published' ORDER BY featured DESC, created_at DESC").all()
        .map(r => JSON.parse(r.document))
        .filter(r => (!contributor || r.contributor_name?.toLowerCase() === contributor.toLowerCase()) && (!tag || r.tags?.includes(tag)));
      return rows.slice(offset, offset + limit);
    },
    get(slug, includePending = false) {
      const r = db.prepare('SELECT document FROM conversations WHERE slug = ?').get(slug);
      const row = r ? JSON.parse(r.document) : null;
      return row && (includePending || row.status === 'published') ? row : null;
    },
    publish(slug) {
      const row = this.get(slug, true);
      if (!row) throw new Error('Conversation not found');
      row.status = 'published'; row.published_at = new Date().toISOString();
      db.prepare('UPDATE conversations SET status = ?, document = ? WHERE slug = ?').run(row.status, JSON.stringify(row), slug);
      return row;
    },
  };
}

export function validateSubmission(body) {
  if (!body || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 300) return 'title must contain 1–300 characters';
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 2000) return 'messages must contain 1–2000 messages';
  if (body.messages.some(m => !m || !['human', 'assistant', 'user', 'ai', 'system'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 500000 || (m.model !== undefined && (typeof m.model !== 'string' || m.model.length > 200)))) return 'each message needs a valid role and non-empty content';
  for (const key of ['contributor_name', 'ai_model', 'description', 'commentary', 'original_url']) {
    if (body[key] != null && (typeof body[key] !== 'string' || body[key].length > (['description', 'commentary'].includes(key) ? 50000 : 2000))) return `invalid ${key}`;
  }
  for (const key of ['tags', 'highlights']) if (body[key] != null && (!Array.isArray(body[key]) || body[key].length > 100 || body[key].some(v => typeof v !== 'string' || v.length > 10000))) return `invalid ${key}`;
  if (body.original_url) {
    try { if (!['http:', 'https:'].includes(new URL(body.original_url).protocol)) return 'original_url must use http or https'; }
    catch { return 'original_url must be a valid URL'; }
  }
  return null;
}

export function submissionRow(body) {
  const title = body.title.trim();
  const row = {
    title, slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'dialogue'}-${randomUUID().slice(0, 8)}`,
    messages: body.messages.map(m => ({ role: ['user', 'human'].includes(m.role) ? 'human' : m.role === 'system' ? 'system' : 'assistant', content: m.content, ...(m.model ? { model: m.model } : {}) })),
  };
  for (const key of ['contributor_name', 'ai_model', 'description', 'commentary', 'original_url', 'tags', 'highlights']) if (body[key] != null) row[key] = body[key];
  return row;
}
