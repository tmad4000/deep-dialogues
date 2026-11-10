// Publishes PUBLIC dialogues into Noos as public nodes owned by the Deep Dialogues agent account.
// Only rows with status "published" are ever sent; anything else is made private in Noos.
// The database is the source of truth: a Noos outage records an error and never blocks review.
import { createHash } from 'node:crypto';
import { plainText } from '../src/lib/presentation.js';
import { publicDocument } from './store.js';

const COLLECTION = '__collection__';

export function noosConfigFromEnv(env = process.env) {
  return {
    enabled: !!(env.NOOS_API_KEY && env.NOOS_API_URL),
    baseUrl: (env.NOOS_API_URL || '').replace(/\/$/, ''),
    apiKey: env.NOOS_API_KEY,
    publicOrigin: (env.PUBLIC_BASE_URL || 'https://deep-dialogues.ideaflow.app').replace(/\/$/, ''),
  };
}

const topicTag = value => String(value).toLowerCase().trim().replace(/^#/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export function participantsOf(row) {
  const models = [...new Set(row.messages.filter(m => !['human', 'user', 'system'].includes(m.role)).map(m => m.model || row.ai_model).filter(Boolean))];
  return { human: row.contributor_name || null, models };
}

// The public node body: what the dialogue is, who took part, and where to read it. No private fields.
export function nodePayload(row, publicOrigin) {
  const readerUrl = `${publicOrigin}/read/${encodeURIComponent(row.slug)}`;
  const { human, models } = participantsOf(row);
  const description = plainText(row.description || '').slice(0, 1200);
  const firstPrompt = plainText(row.messages.find(m => ['human', 'user'].includes(m.role))?.content || '').slice(0, 400);
  const lines = [
    description || (firstPrompt ? `Opening prompt: “${firstPrompt}${firstPrompt.length === 400 ? '…' : ''}”` : ''),
    '',
    `Participants: ${[human, ...models].filter(Boolean).join(', ') || 'Unattributed'}`,
    `Messages: ${row.messages.length}`,
    row.versions?.full && row.versions.full !== row.slug ? `Highlights of: ${publicOrigin}/read/${encodeURIComponent(row.versions.full)}` : '',
    row.versions?.highlights && row.versions.highlights !== row.slug ? `Highlights: ${publicOrigin}/read/${encodeURIComponent(row.versions.highlights)}` : '',
    '',
    `Read on Deep Dialogues: ${readerUrl}`,
  ].filter((line, i, all) => line !== '' || (all[i - 1] !== '' && i > 0));
  const tags = [...new Set(['deep-dialogues', ...(row.tags || []), ...models].map(topicTag).filter(Boolean))].slice(0, 20);
  return {
    type: 'note', title: row.title.slice(0, 300), content: lines.join('\n').trim(), tags,
    visibility: 'public', editPermission: 'owner', url: readerUrl, externalUri: readerUrl,
    sourceType: 'deep-dialogues', sourceId: row.slug, sourceUrl: readerUrl,
    sourceAuthorName: human || undefined, sourceTimestamp: row.published_at || row.created_at,
    idempotencyKey: `deep-dialogues:${row.slug}`,
  };
}

export function createNoosSync(store, config, { fetchImpl = fetch } = {}) {
  const get = slug => store.db.prepare('SELECT node_id, digest, state, error, updated_at FROM noos_sync WHERE slug = ?').get(slug) || null;
  const record = (slug, fields) => store.db.prepare(`INSERT INTO noos_sync (slug, node_id, digest, state, error, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET node_id = excluded.node_id, digest = excluded.digest, state = excluded.state, error = excluded.error, updated_at = excluded.updated_at`)
    .run(slug, fields.node_id ?? null, fields.digest ?? null, fields.state, fields.error ?? null, new Date().toISOString());

  async function api(method, path, body) {
    const response = await fetchImpl(`${config.baseUrl}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    // Never echo Noos response bodies into logs or errors.
    if (!response.ok) throw new Error(`Noos ${method} ${path.split('?')[0].replace(/\/[A-Za-z0-9_-]{10,}$/, '/:id')} failed (${response.status})`);
    return response.status === 204 ? null : response.json();
  }

  async function findByExternalUri(uri) {
    const result = await api('GET', `/api/nodes?mine=true&lite=true&limit=5&externalUri=${encodeURIComponent(uri)}`);
    const nodes = Array.isArray(result) ? result : result?.nodes || [];
    return nodes.find(n => n.externalUri === uri || !n.externalUri)?.id || null;
  }

  async function ensureCollection() {
    const known = get(COLLECTION);
    if (known?.node_id) return known.node_id;
    const uri = `${config.publicOrigin}/`;
    let id = await findByExternalUri(uri);
    if (!id) {
      const created = await api('POST', '/api/nodes', {
        type: 'list', layout: 'cards', title: 'Deep Dialogues', visibility: 'public', editPermission: 'owner',
        content: 'A public gallery of remarkable conversations with AI. Each published dialogue appears here.',
        url: uri, externalUri: uri, sourceType: 'deep-dialogues', sourceUrl: uri, idempotencyKey: 'deep-dialogues:collection', tags: ['deep-dialogues'],
      });
      id = created.id || created.node?.id;
    }
    record(COLLECTION, { node_id: id, state: 'synced' });
    return id;
  }

  const locks = new Map();

  function desired(slug) {
    const row = store.readRaw(slug);
    const isPublic = row?.status === 'published';
    const payload = isPublic ? nodePayload(publicDocument(row, store.isPublic), config.publicOrigin) : { visibility: 'private' };
    return { isPublic, payload, digest: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
  }

  async function reconcile(slug) {
    while (true) {
      const { isPublic, payload, digest } = desired(slug);
      const known = get(slug);
      if (known?.digest === digest && (known.state === (isPublic ? 'synced' : 'hidden') || (!isPublic && known.state === 'skipped'))) return { slug, state: known.state, node_id: known.node_id };
      let nodeId = known?.node_id;
      try {
        const uri = `${config.publicOrigin}/read/${encodeURIComponent(slug)}`;
        if (!nodeId) nodeId = await findByExternalUri(uri);
        if (!nodeId && isPublic) {
          const created = await api('POST', '/api/nodes', { ...payload, parentId: await ensureCollection() });
          nodeId = created.id || created.node?.id;
          if (!nodeId) throw new Error('Noos create returned no node id');
        } else if (nodeId) {
          const { type, externalUri, sourceType, sourceId, sourceUrl, sourceAuthorName, sourceTimestamp, idempotencyKey, ...update } = payload;
          await api('PUT', `/api/nodes/${encodeURIComponent(nodeId)}`, update);
        }
        if (JSON.stringify(get(slug)) !== JSON.stringify(known)) {
          if (nodeId) store.db.prepare('UPDATE noos_sync SET node_id = ? WHERE slug = ?').run(nodeId, slug);
          continue;
        }
        const state = isPublic ? 'synced' : nodeId ? 'hidden' : 'skipped';
        record(slug, { node_id: nodeId, digest, state });
        if (desired(slug).digest === digest) return { slug, state, node_id: nodeId };
      } catch (error) {
        if (JSON.stringify(get(slug)) !== JSON.stringify(known)) {
          if (nodeId) store.db.prepare('UPDATE noos_sync SET node_id = ? WHERE slug = ?').run(nodeId, slug);
          continue;
        }
        record(slug, { node_id: nodeId, digest: null, state: 'error', error: error.message.slice(0, 300) });
        console.error('Noos sync failed:', slug, error.message);
        return { slug, state: 'error', error: error.message };
      }
    }
  }

  function syncOne(slug) {
    const previous = locks.get(slug) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => reconcile(slug));
    locks.set(slug, current);
    current.finally(() => { if (locks.get(slug) === current) locks.delete(slug); }).catch(() => {});
    return current;
  }

  async function syncSlugs(slugs) {
    if (!config.enabled) return [];
    const out = [];
    for (const slug of slugs) out.push(await syncOne(slug)); // sequential: small volume, gentle on the shared host
    return out;
  }

  // Reconcile every published row plus anything Noos already knows about (for unpublished rows).
  async function syncAll() {
    const slugs = new Set(store.db.prepare("SELECT slug FROM conversations WHERE status = 'published'").all().map(r => r.slug));
    for (const { slug } of store.db.prepare('SELECT slug FROM noos_sync WHERE slug != ?').all(COLLECTION)) slugs.add(slug);
    return syncSlugs([...slugs]);
  }

  async function syncRetry() {
    const rows = store.db.prepare(`SELECT c.slug FROM conversations c LEFT JOIN noos_sync n ON n.slug = c.slug
      WHERE n.state IN ('pending', 'error') OR (c.status = 'published' AND (n.slug IS NULL OR n.state != 'synced'))
        OR (c.status != 'published' AND n.state = 'synced')
      UNION SELECT slug FROM noos_sync WHERE state IN ('pending', 'error') AND slug != ?`).all(COLLECTION);
    return syncSlugs(rows.map(row => row.slug));
  }

  return { enabled: config.enabled, status: get, syncOne, syncSlugs, syncAll, syncRetry };
}
