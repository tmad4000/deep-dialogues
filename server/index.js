import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.js';
import { createApp } from './app.js';
import { createNoosSync, noosConfigFromEnv } from './noos.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const store = openStore(process.env.DIALOGUES_DB || join(root, 'data', 'dialogues.sqlite'));
const noos = createNoosSync(store, noosConfigFromEnv());
const server = createApp(store, root, { noos }).listen(Number(process.env.API_PORT || 7845), process.env.API_HOST || '127.0.0.1', () => {
  console.log('Deep Dialogues ready');
  // Reconcile published dialogues with Noos in the background; serving never waits on Noos.
  if (noos.enabled) noos.syncAll().then(r => console.log(`Noos sync: ${r.filter(x => x.state === 'error').length} errors of ${r.length}`)).catch(e => console.error('Noos sync failed:', e.message));
});
if (noos.enabled) {
  setInterval(() => { noos.syncRetry().catch(e => console.error('Noos retry failed:', e.message)); }, 5 * 60 * 1000).unref();
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => { store.db.close(); process.exit(0); }));
