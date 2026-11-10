// Publishes PUBLIC dialogues into Noos as public nodes owned by the Deep Dialogues agent account.
// Only rows with status "published" are ever sent; anything else is made private in Noos.
// The database is the source of truth: a Noos outage records an error and never blocks review.
import { createHash } from 'node:crypto';
import { plainText } from '../src/lib/presentation.js';

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

  async function syncOne(slug) {
    const row = store.readRaw(slug);
    const known = get(slug);
    const isPublic = row?.status === 'published';
    if (!isPublic && !known?.node_id) return { slug, state: 'skipped' };
    // Only public rows produce content; everything else is reduced to a visibility change.
    const payload = isPublic ? nodePayload({ ...row, versions: Object.fromEntries(Object.entries(row.versions || {}).filter(([, s]) => s === row.slug || store.isPublic(s))) }, config.publicOrigin) : { visibility: 'private' };
    const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    if (known?.digest === digest && known.state !== 'error') return { slug, state: known.state, node_id: known.node_id };
    try {
      let nodeId = known?.node_id || (isPublic ? await findByExternalUri(payload.externalUri) : null);
      if (!nodeId) {
        const created = await api('POST', '/api/nodes', { ...payload, parentId: await ensureCollection() });
        nodeId = created.id || created.node?.id;
      } else {
        const { type, externalUri, sourceType, sourceId, sourceUrl, sourceAuthorName, sourceTimestamp, idempotencyKey, ...update } = payload;
        await api('PUT', `/api/nodes/${encodeURIComponent(nodeId)}`, update);
      }
      const state = isPublic ? 'synced' : 'hidden';
      record(slug, { node_id: nodeId, digest, state });
      return { slug, state, node_id: nodeId };
    } catch (error) {
      record(slug, { node_id: known?.node_id, digest: null, state: 'error', error: error.message.slice(0, 300) });
      console.error('Noos sync failed:', slug, error.message);
      return { slug, state: 'error', error: error.message };
    }
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

  return { enabled: config.enabled, status: get, syncOne, syncSlugs, syncAll };
}
