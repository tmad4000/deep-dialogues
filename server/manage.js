import { readFileSync } from 'node:fs';
import { openStore, validateSubmission, submissionRow } from './store.js';
import { createNoosSync, noosConfigFromEnv } from './noos.js';

if (!process.env.DIALOGUES_DB) throw new Error('Set DIALOGUES_DB to the persistent database path');
const store = openStore(process.env.DIALOGUES_DB);
try {
  const [command, argument] = process.argv.slice(2);
  if (command === 'import') {
    const input = JSON.parse(readFileSync(argument, 'utf8'));
    const error = validateSubmission(input);
    if (error) throw new Error(error);
    if (input.original_url && store.list({ limit: Infinity }).some(r => r.original_url === input.original_url)) throw new Error('This source URL is already published');
    const row = store.save(submissionRow(input));
    console.log(JSON.stringify({ slug: row.slug, status: row.status, turn_count: row.turn_count }));
  } else if (command === 'publish') {
    const row = store.publish(argument);
    console.log(JSON.stringify({ slug: row.slug, status: row.status, turn_count: row.turn_count }));
  } else if (command === 'pending') {
    console.log(JSON.stringify(store.db.prepare("SELECT slug, created_at FROM conversations WHERE status = 'pending'").all()));
  } else if (command === 'noos-sync') {
    const noos = createNoosSync(store, noosConfigFromEnv());
    if (!noos.enabled) throw new Error('Set NOOS_API_URL and NOOS_API_KEY');
    const results = argument ? await noos.syncSlugs([argument]) : await noos.syncAll();
    console.log(JSON.stringify(results.map(({ slug, state, error }) => ({ slug, state, ...(error ? { error } : {}) }))));
  } else throw new Error('Usage: manage.js import FILE | publish SLUG | pending | noos-sync [SLUG]');
} finally { store.db.close(); }
