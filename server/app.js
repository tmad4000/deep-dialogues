import { renderDataCenterSummary, shareHead } from './summary.js';
import { publicOrigin, curationFor } from '../src/lib/curation.js';
import { readFileSync } from 'node:fs';
import express from 'express';
import { join } from 'node:path';
import { validateSubmission, submissionRow } from './store.js';
import { authConfigFromEnv, createAuth, requireSameOrigin } from './auth.js';
import docs from '../api/docs.js';

// The shell's site-wide description/og/twitter tags are replaced by per-conversation ones.
export function withoutShellShareTags(html) {
  return html.replace(/[ \t]*<meta (?:name="description"|property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\n?/g, '');
}

const PRIVATE_API = /^\/(me|my|admin)(\/|$)/;

export function createApp(store, root, { authConfig = authConfigFromEnv(), auth = createAuth(store, authConfig), noos = null } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self' https://api.allorigins.win; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    next();
  });
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    // Account routes are same-origin only; the public read/submit API stays open to any origin.
    if (PRIVATE_API.test(req.path)) return next();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  const submissions = new Map();
  app.post('/api/conversations', (req, res, next) => {
    const now = Date.now();
    for (const [ip, bucket] of submissions) if (now - bucket.start > 60000) submissions.delete(ip);
    const key = req.ip;
    const bucket = submissions.get(key) || { start: now, count: 0 };
    if (bucket.count >= 10 || (!submissions.has(key) && submissions.size >= 10000)) return res.status(429).json({ error: 'Please try again shortly' });
    bucket.count++; submissions.set(key, bucket); next();
  }, express.json({ limit: '5mb', inflate: false }), (req, res) => {
    const error = validateSubmission(req.body);
    if (error) return res.status(400).json({ error });
    const row = submissionRow(req.body);
    // Credit the Ideaflow identity only for the site's own same-origin requests.
    const user = sameOriginScript(req) ? auth.currentUser(req) : null;
    if (user) {
      row.submitted_by = { sub: user.sub, name: user.name, email: user.email };
      if (!row.contributor_name && user.name) row.contributor_name = user.name;
    }
    const saved = store.save(row);
    res.status(201).json(user ? saved : publicSubmission(saved));
  });

  const sameOriginScript = req => req.headers['x-requested-with'] === 'deep-dialogues' && req.headers.origin === authConfig.publicOrigin
    || (!authConfig.secureCookies && req.headers['x-requested-with'] === 'deep-dialogues');
  const publicSubmission = ({ submitted_by, review, ...row }) => row;
  const signedIn = (req, res, next) => { req.user = auth.currentUser(req); if (!req.user) return res.status(401).json({ error: 'Sign in with Ideaflow to continue' }); next(); };
  const admin = (req, res, next) => signedIn(req, res, () => req.user.admin ? next() : res.status(403).json({ error: 'Administrators only' }));
  const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const ownView = row => ({ slug: row.slug, title: row.title, status: row.status, created_at: row.created_at, updated_at: row.updated_at,
    published_at: row.published_at, turn_count: row.turn_count, contributor_name: row.contributor_name, tags: row.tags || [],
    description: row.description, original_url: row.original_url, ai_model: row.ai_model, messages: row.messages,
    review: row.review && { action: row.review.action, version: row.review.version, at: row.review.at, reason: row.review.reason }, versions: row.versions });

  app.get('/auth/login', asyncRoute(auth.login));
  app.get('/auth/callback', asyncRoute(auth.callback));
  app.post('/auth/logout', requireSameOrigin(authConfig), auth.logout);

  app.use(['/api/my', '/api/admin'], requireSameOrigin(authConfig));
  app.get('/api/me', (req, res) => {
    const user = auth.currentUser(req);
    res.json({ signInAvailable: authConfig.enabled, user: user && { name: user.name, email: user.email, admin: user.admin } });
  });
  app.get('/api/my/submissions', signedIn, (req, res) => res.json(store.bySubmitter(req.user.sub).map(ownView)));
  app.get('/api/my/submissions/:slug', signedIn, (req, res) => {
    const row = store.readRaw(req.params.slug);
    if (!row || row.submitted_by?.sub !== req.user.sub) return res.status(404).json({ error: 'Submission not found' });
    res.json(ownView(row));
  });
  app.put('/api/my/submissions/:slug', signedIn, express.json({ limit: '5mb', inflate: false }), (req, res) => {
    const error = validateSubmission(req.body);
    if (error) return res.status(400).json({ error });
    const result = store.updatePending(req.params.slug, req.user.sub, req.body);
    if (result.error === 'not_found') return res.status(404).json({ error: 'Submission not found' });
    if (result.error) return res.status(409).json({ error: 'Only submissions awaiting review can be edited' });
    res.json(ownView(result.row));
  });

  const adminView = row => ({ ...ownView(row), submitted_by: row.submitted_by && { name: row.submitted_by.name, email: row.submitted_by.email }, commentary: row.commentary, featured: !!row.featured });
  app.get('/api/admin/queue', admin, (req, res) => {
    const status = ['pending', 'published', 'rejected', 'unpublished', 'superseded'].includes(req.query.status) ? req.query.status : 'pending';
    res.json(store.byStatus(status).map(({ messages, ...row }) => ({ ...adminView({ ...row, messages: [] }), messages: undefined, turn_count: row.turn_count })));
  });
  app.get('/api/admin/conversations/:slug', admin, (req, res) => {
    const row = store.readRaw(req.params.slug);
    if (!row) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ ...adminView(row), noos: noos?.status(row.slug) || null });
  });
  app.post('/api/admin/conversations/:slug/review', admin, express.json({ limit: '64kb', inflate: false }), asyncRoute(async (req, res) => {
    const { action, version, highlights, highlights_title: highlightsTitle, reason } = req.body || {};
    const result = store.review(req.params.slug, { action, version, highlights: Array.isArray(highlights) ? highlights : [], highlightsTitle, reason, reviewer: { sub: req.user.sub, name: req.user.name } });
    if (result.error === 'not_found') return res.status(404).json({ error: 'Conversation not found' });
    if (result.error) return res.status(409).json({ error: result.error });
    const slugs = result.syncSlugs;
    if (noos?.enabled) Promise.resolve().then(() => noos.syncSlugs(slugs)).catch(error => console.error('Noos sync failed:', error.message));
    res.json({ rows: result.rows.map(adminView), noos: noos?.enabled ? slugs.map(slug => ({ slug, state: 'queued' })) : [] });
  }));
  app.get('/health', (_req, res) => {
    store.db.prepare('SELECT 1').get();
    res.json({ ok: true, storage: 'sqlite', release: process.env.RELEASE_COMMIT || 'development' });
  });
  app.get('/api/conversations', (req, res) => {
    const { contributor, tag } = req.query;
    if ([contributor, tag].some(v => v !== undefined && typeof v !== 'string')) return res.status(400).json({ error: 'Filters must be strings' });
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 20, 100));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    res.json(store.list({ contributor, tag, limit, offset }).map(({ messages, ...row }) => row));
  });
  app.get('/api/conversations/:slug', (req, res) => {
    const row = store.get(req.params.slug);
    if (!row) return res.status(404).json({ error: 'Conversation not found' });
    res.json(row);
  });
  app.get('/api/contributors', (_req, res) => {
    const counts = new Map();
    for (const r of store.list({ limit: Infinity })) if (r.contributor_name) counts.set(r.contributor_name, (counts.get(r.contributor_name) || 0) + 1);
    res.json([...counts].map(([contributor_name, count]) => ({ contributor_name, count })).sort((a, b) => b.count - a.count));
  });
  app.get('/api/docs', docs);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));
  app.get('/llms.txt', (_req, res) => res.sendFile(join(root, 'public', 'llms.txt')));
  app.get('/s/blueprint-for-abundance', (_req, res) => {
    if (!store.get('basic-needs-work-and-abundance')) return res.status(404).send('Conversation unavailable');
    res.setHeader('Cache-Control','no-cache');
    res.redirect(308, '/read/basic-needs-work-and-abundance');
  });
  app.get('/s/ai-data-centers', (_req, res) => {
    if (!store.get('ai-data-centers')) return res.status(404).send('Conversation unavailable');
    res.setHeader('Cache-Control','public, max-age=300');
    res.type('html').send(renderDataCenterSummary(root));
  });
  app.get('/read/:slug', (req, res) => {
    const c=store.get(req.params.slug);
    if (!c) return res.status(404).type('html').send('<!doctype html><title>Conversation not found — Deep Dialogues</title><p>Conversation not found. <a href="/">Back to the gallery</a></p>');
    const html=readFileSync(join(root,'dist','index.html'),'utf8');
    const metadata=shareHead({title:c.title,description:curationFor(c)?.description||c.description||'An AI conversation on Deep Dialogues.',url:publicOrigin+'/read/'+encodeURIComponent(c.slug),image:publicOrigin+(c.slug==='basic-needs-work-and-abundance'?'/share/abundance.png':'/share/dialogues.png')});
    res.setHeader('Cache-Control','no-cache');
    res.type('html').send(withoutShellShareTags(html).replace(/<title>[\s\S]*?<\/title>/,() => metadata));
  });
  app.use(express.static(join(root, 'dist'), { index: false, maxAge: '1h' }));
  app.get('/{*path}', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(join(root, 'dist', 'index.html')); });
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Conversation is too large' });
    if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: 'Invalid JSON' });
    if (error.status >= 400 && error.status < 500) return res.status(error.status).json({ error: 'Unsupported request body' });
    console.error('Request failed:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
