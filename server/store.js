import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { presentConversation } from '../src/lib/presentation.js';
import { seedConversations } from '../src/data/seed.js';

export function openStore(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, status TEXT NOT NULL,
      featured INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, document TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY, sub TEXT NOT NULL, name TEXT, email TEXT, email_verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS noos_sync (
      slug TEXT PRIMARY KEY, node_id TEXT, digest TEXT, state TEXT NOT NULL, error TEXT, updated_at TEXT NOT NULL
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
  const readRaw = slug => {
    const r = db.prepare('SELECT document FROM conversations WHERE slug = ?').get(slug);
    return r ? JSON.parse(r.document) : null;
  };
  const writeRaw = row => db.prepare('UPDATE conversations SET status = ?, featured = ?, document = ? WHERE slug = ?')
    .run(row.status, row.featured ? 1 : 0, JSON.stringify(row), row.slug);
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const publishedStmt = db.prepare("SELECT 1 FROM conversations WHERE slug = ? AND status = 'published'");
  const isPublic = slug => !!publishedStmt.get(slug);
  const uniqueSlug = base => {
    let slug = base;
    for (let n = 2; exists.get(slug); n++) slug = `${base}-${n}`;
    return slug;
  };
  return {
    db, save, readRaw, transaction, isPublic,
    list({ contributor, tag, limit = 20, offset = 0 } = {}) {
      const rows = db.prepare("SELECT document FROM conversations WHERE status = 'published' ORDER BY featured DESC, created_at DESC").all()
        .map(r => publicDocument(JSON.parse(r.document), isPublic))
        .filter(r => (!contributor || r.contributor_name?.toLowerCase() === contributor.toLowerCase()) && (!tag || r.tags?.includes(tag)));
      return rows.slice(offset, offset + limit);
    },
    get(slug, includePending = false) {
      const row = readRaw(slug);
      if (!row || !(includePending || row.status === 'published')) return null;
      return presentConversation(includePending ? row : publicDocument(row, isPublic));
    },
    bySubmitter(sub) {
      return db.prepare("SELECT document FROM conversations WHERE json_extract(document, '$.submitted_by.sub') = ? ORDER BY created_at DESC")
        .all(sub).map(r => JSON.parse(r.document));
    },
    byStatus(status) {
      return db.prepare('SELECT document FROM conversations WHERE status = ? ORDER BY created_at DESC').all(status).map(r => JSON.parse(r.document));
    },
    // A contributor may edit only their own submission, and only while it awaits review.
    updatePending(slug, sub, body) {
      return transaction(() => {
        const row = readRaw(slug);
        if (!row || row.submitted_by?.sub !== sub) return { error: 'not_found' };
        if (row.status !== 'pending') return { error: 'not_editable' };
        const fresh = submissionRow(body);
        for (const key of EDITABLE) {
          if (!Object.hasOwn(body, key)) continue;
          if (body[key] == null || body[key] === '') delete row[key];
          else row[key] = fresh[key];
        }
        row.messages = fresh.messages; row.turn_count = row.messages.length; row.updated_at = new Date().toISOString();
        writeRaw(row);
        return { row };
      });
    },
    // Review outcome. version: full | highlights | both. Highlights are a separate, cross-linked published row.
    review(slug, { action, version = 'full', highlights = [], highlightsTitle, reviewer, reason } = {}) {
      return transaction(() => {
        const row = readRaw(slug);
        if (!row) return { error: 'not_found' };
        const now = new Date().toISOString();
        const wasPublic = row.status === 'published';
        const priorVersions = Object.values(row.versions || {});
        const finish = rows => {
          const slugs = new Set(rows.map(item => item.slug));
          if (wasPublic !== (row.status === 'published')) {
            for (const sibling of priorVersions) if (sibling !== row.slug && isPublic(sibling)) slugs.add(sibling);
          }
          const queue = db.prepare(`INSERT INTO noos_sync (slug, node_id, digest, state, error, updated_at) VALUES (?, NULL, ?, 'pending', NULL, ?)
            ON CONFLICT(slug) DO UPDATE SET digest = excluded.digest, state = 'pending', error = NULL, updated_at = excluded.updated_at`);
          for (const item of slugs) queue.run(item, randomUUID(), now);
          return { rows, syncSlugs: [...slugs] };
        };
        const reviewed = { by: reviewer, at: now };
        if (action === 'reject') {
          if (row.status !== 'pending') return { error: 'not_pending' };
          Object.assign(row, { status: 'rejected', review: { ...reviewed, action, reason: reason ? String(reason).slice(0, 2000) : undefined } });
          writeRaw(row); return finish([row]);
        }
        if (action === 'unpublish') {
          if (row.status !== 'published') return { error: 'not_published' };
          Object.assign(row, { status: 'unpublished', review: { ...reviewed, action } });
          writeRaw(row); return finish([row]);
        }
        if (action !== 'publish' || !['full', 'highlights', 'both'].includes(version)) return { error: 'invalid_action' };
        if (!['pending', 'published', 'unpublished'].includes(row.status)) return { error: 'not_publishable' };
        const changed = [];
        let highlightRow;
        if (version !== 'full') {
          const picks = [...new Set(highlights)].filter(i => Number.isInteger(i) && i >= 0 && i < row.messages.length).sort((a, b) => a - b);
          if (!picks.length) return { error: 'highlights_required' };
          if (picks.length === row.messages.length) return { error: 'highlights_must_be_subset' };
          const { id, slug: _s, status, review, versions, published_at, featured, ...rest } = row;
          highlightRow = save({ ...rest, title: (highlightsTitle && String(highlightsTitle).trim().slice(0, 300)) || `${row.title} · Highlights`,
            slug: uniqueSlug(`${row.slug.replace(/-highlights(-\d+)?$/, '')}-highlights`.slice(0, 120)),
            messages: picks.map(i => row.messages[i]), highlight_source_indices: picks, created_at: now }, 'published');
          if (version === 'highlights') delete highlightRow.original_url;
          highlightRow.published_at = now;
          highlightRow.review = { ...reviewed, action, version: 'highlights' };
        }
        if (version === 'highlights') {
          // The full transcript stays private; the public highlights do not link to it.
          highlightRow.versions = { highlights: highlightRow.slug };
          Object.assign(row, { status: 'superseded', review: { ...reviewed, action, version } });
          delete row.versions;
        } else {
          Object.assign(row, { status: 'published', published_at: row.published_at || now, review: { ...reviewed, action, version } });
          row.versions = { ...row.versions, full: row.slug, ...(highlightRow ? { highlights: highlightRow.slug } : {}) };
          if (highlightRow) highlightRow.versions = { full: row.slug, highlights: highlightRow.slug };
        }
        writeRaw(row); changed.push(row);
        if (highlightRow) { writeRaw(highlightRow); changed.push(highlightRow); }
        return finish(changed);
      });
    },
    publish(slug) {
      const row = readRaw(slug);
      if (!row) throw new Error('Conversation not found');
      row.status = 'published'; row.published_at = new Date().toISOString();
      db.prepare('UPDATE conversations SET status = ?, document = ? WHERE slug = ?').run(row.status, JSON.stringify(row), slug);
      return row;
    },
  };
}

const EDITABLE = ['title', 'contributor_name', 'ai_model', 'description', 'commentary', 'original_url', 'tags', 'highlights'];
// Private review and identity fields never leave the server on public routes.
const PRIVATE = ['submitted_by', 'review', 'highlight_source_indices'];
// isPublic(slug) drops links to versions that are not (or no longer) published.
export function publicDocument(row, isPublic = () => false) {
  if (!row) return row;
  const out = { ...row };
  if (row.review?.version === 'highlights' && (!row.versions?.full || !isPublic(row.versions.full))) delete out.original_url;
  for (const key of PRIVATE) delete out[key];
  if (out.versions) {
    out.versions = Object.fromEntries(Object.entries(out.versions).filter(([, slug]) => slug === row.slug || isPublic(slug)));
    if (Object.keys(out.versions).length < 2) delete out.versions;
  }
  return out;
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
