import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.js';
import { createApp } from './app.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const store = openStore(process.env.DIALOGUES_DB || join(root, 'data', 'dialogues.sqlite'));
const server = createApp(store, root).listen(Number(process.env.API_PORT || 7845), process.env.API_HOST || '127.0.0.1', () => console.log('Deep Dialogues ready'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => { store.db.close(); process.exit(0); }));
