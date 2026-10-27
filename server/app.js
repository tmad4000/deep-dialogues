import { renderSummary, renderDataCenterSummary, shareHead } from './summary.js';
import { publicOrigin } from '../src/lib/curation.js';
import { readFileSync } from 'node:fs';
import express from 'express';
import { join } from 'node:path';
import { validateSubmission, submissionRow } from './store.js';
import docs from '../api/docs.js';

export function createApp(store, root) {
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
    res.status(201).json(store.save(submissionRow(req.body)));
  });
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
    res.setHeader('Cache-Control','public, max-age=300');
    res.type('html').send(renderSummary(root));
  });
  app.get('/s/ai-data-centers', (_req, res) => {
    if (!store.get('ai-data-centers')) return res.status(404).send('Conversation unavailable');
    res.setHeader('Cache-Control','public, max-age=300');
    res.type('html').send(renderDataCenterSummary(root));
  });
  app.get('/read/:slug', (req, res) => {
    const c=store.get(req.params.slug);
    if (!c) return res.status(404).send('Conversation not found');
    const html=readFileSync(join(root,'dist','index.html'),'utf8');
    const metadata=shareHead({title:c.title,description:c.description||'An AI conversation on Deep Dialogues.',url:publicOrigin+'/read/'+encodeURIComponent(c.slug),image:publicOrigin+(c.slug==='basic-needs-work-and-abundance'?'/share/abundance.png':'/share/dialogues.png')});
    res.setHeader('Cache-Control','no-cache');
    res.type('html').send(html.replace(/<meta name="description"[^>]*>/,'').replace(/<title>[\s\S]*?<\/title>/,() => metadata));
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
