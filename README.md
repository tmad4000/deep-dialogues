# Deep Dialogues

A gallery of the most interesting, beautiful, and intelligent conversations with AI.

**Live:** https://deep-dialogues.ideaflow.app | https://jacobcole.ai/deep-dialogues/

## Features

- Browse curated AI conversations with beautiful reading experience
- Filter by contributor or topic tags
- Upload conversations via share link (Claude, ChatGPT), pasted text, or file upload
- Dark/light mode, reading progress bar, mobile responsive
- Supabase backend for community submissions

## Stack

- **Frontend:** Vite + vanilla JS (no framework)
- **Backend:** Supabase (Postgres + RLS)
- **API:** Vercel serverless functions (`/api/*`)
- **Fonts:** Cormorant Garamond, Work Sans, IBM Plex Mono
- **Deploy:** Vercel (primary) + GitHub Pages (mirror)

## Deployment

The app is deployed on **Vercel** at `deep-dialogues.ideaflow.app`.

- **Frontend:** Vite builds to `dist/`, served as static files
- **API:** Vercel serverless functions in `api/` directory
- **Static assets:** `public/llms.txt` served at `/llms.txt`
- **Env vars:** Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the Vercel dashboard (Project Settings > Environment Variables) for the API functions. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the frontend build.
- **Local API server:** `server/index.js` (Express) is for local dev only — not deployed

## Development

```bash
npm install
npm run dev    # http://localhost:7842
```

## Contributing conversations

Visit the [Upload page](https://deep-dialogues.ideaflow.app/#/submit) to share a conversation. You can:
1. Paste a Claude or ChatGPT share link
2. Paste conversation text (flexible format — role labels optional)
3. Upload a `.jsonl` (Claude Code) or `.json` (ChatGPT export) file

Submissions go to a review queue before appearing in the gallery.

## API

Deep Dialogues has a REST API for programmatic submission and browsing. LLMs and agents can read `/llms.txt` at the site root for a machine-friendly description of all endpoints.

### Running the API server

```bash
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_ANON_KEY=your-anon-key
npm run api    # http://localhost:7845
```

### Submit a conversation

```bash
curl -X POST https://deep-dialogues.ideaflow.app/api/conversations \
  -H "Content-Type: application/json" \
  -d '{
    "title": "On the Nature of Consciousness",
    "messages": [
      {"role": "human", "content": "What do you think consciousness actually is?"},
      {"role": "assistant", "content": "That is one of the deepest questions we can ask..."}
    ],
    "contributor_name": "Jane Smith",
    "ai_model": "Claude Opus 4",
    "tags": ["philosophy", "consciousness"],
    "highlights": ["That is one of the deepest questions we can ask..."]
  }'
```

### List published conversations

```bash
curl https://deep-dialogues.ideaflow.app/api/conversations
curl https://deep-dialogues.ideaflow.app/api/conversations?tag=philosophy&limit=5
```

### Get a single conversation

```bash
curl https://deep-dialogues.ideaflow.app/api/conversations/on-the-nature-of-consciousness-a1b2
```

### List contributors

```bash
curl https://deep-dialogues.ideaflow.app/api/contributors
```

### LLM discovery

```bash
curl https://deep-dialogues.ideaflow.app/llms.txt
```
