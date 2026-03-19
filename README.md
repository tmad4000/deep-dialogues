# Deep Dialogues

A gallery of the most interesting, beautiful, and intelligent conversations with AI.

**Live:** https://dialogues-gallery.ideaflow.app | https://jacobcole.ai/chat-gallery/

## Features

- Browse curated AI conversations with beautiful reading experience
- Filter by contributor or topic tags
- Upload conversations via share link (Claude, ChatGPT), pasted text, or file upload
- Dark/light mode, reading progress bar, mobile responsive
- Supabase backend for community submissions

## Stack

- **Frontend:** Vite + vanilla JS (no framework)
- **Backend:** Supabase (Postgres + RLS)
- **Fonts:** Cormorant Garamond, Work Sans, IBM Plex Mono
- **Deploy:** Vercel + GitHub Pages

## Development

```bash
npm install
npm run dev    # http://localhost:7842
```

## Contributing conversations

Visit the [Upload page](https://dialogues-gallery.ideaflow.app/#/submit) to share a conversation. You can:
1. Paste a Claude or ChatGPT share link
2. Paste conversation text (flexible format — role labels optional)
3. Upload a `.jsonl` (Claude Code) or `.json` (ChatGPT export) file

Submissions go to a review queue before appearing in the gallery.
