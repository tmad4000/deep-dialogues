# Deep Dialogues

A gallery of remarkable conversations with AI.

**Live:** https://deep-dialogues.ideaflow.app

The production frontend and API run together on the existing GCP `noos` VM in
`lightsail-migration`, zone `us-central1-a`. The HTTPS load balancer at
`34.160.75.73` forwards through the shared HTTP ingress to the dedicated
`deep-dialogues.service`. The Vite/vanilla JavaScript reading interface keeps
its existing design. GitHub Pages remains a static mirror.

## Development and checks

Use Node 22.13 or newer (production uses its existing Node 22 binary).

```sh
npm ci
npm test
npm run build
npm start
```

`npm start` serves the built frontend and API together on loopback port 7845.
For Vite development, run `npm run api` and `npm run dev`; Vite proxies `/api`.
Set `API_PORT` / `API_HOST` for another listen address. `VITE_API_BASE_URL` can
point a separately hosted mirror at the production API.

## Data and recovery

Production SQLite lives at `/var/lib/deep-dialogues/dialogues.sqlite`, outside
release directories, with WAL and full synchronous commits. Set `DIALOGUES_DB`
when starting the server or using operator commands. Versioned conversations
in `src/data/` and `content/` seed missing slugs once; they never replace edits.

The October 2026 recovery recovered the five versioned conversations (104
messages). The retired Supabase project's hostname did not resolve; this is
not proof that any additional database-only submissions were recovered.
The Supabase schema is retained as historical documentation. Production no
longer needs Supabase credentials or a running Supabase service.

Public submissions are validated, persisted with `pending` status and omitted
from public lists and reads. Publication is an operator-only CLI operation;
there is no public publication/update endpoint.

```sh
export DIALOGUES_DB=/var/lib/deep-dialogues/dialogues.sqlite
node server/manage.js pending
node server/manage.js import /path/to/conversation.json
node server/manage.js publish GENERATED-SLUG
```

Import JSON uses the same shape as `POST /api/conversations`: `title`,
`messages` (`role`, `content`, optional `model`), optional contributor, model,
tags, description, commentary, highlights and original URL. Each contribution
can retain its own model label. Preserve original turns and append a separately
attributed contribution; do not silently rewrite a source's claims.

`deep-dialogues-backup.timer` creates consistent, integrity-checked daily
SQLite backups under `/var/lib/deep-dialogues/backups/`. These are local to the
VM; they do not replace infrastructure-level disaster recovery. Run the backup
service before operator changes. Never copy just the main file of a live WAL
database; use SQLite's backup API as `deploy/backup.py` does.

## Production operations

Service/timer and nginx host-block templates are in `deploy/`. Production binds
to the Docker bridge gateway `172.18.0.1:8746`, reachable from the existing nginx
container, without a new public service port. Verify this gateway on a new VM.
Release code is under `/opt/deep-dialogues/releases/`, with an atomic `current`
symlink. Runtime data stays outside the release. The root-owned systemd unit
runs as `ubuntu` with a read-only filesystem except for its data directory.

Use the established account explicitly:

```sh
gcloud compute ssh noos --project=lightsail-migration --zone=us-central1-a \
  --account=874749606899-compute@developer.gserviceaccount.com
```

Build and test locally, copy a tarball containing only release files, and
install locked production dependencies with `npm ci --omit=dev --ignore-scripts`.
Switch `current` to a new release and restart only `deep-dialogues.service`.
Set `RELEASE_COMMIT` through `/etc/deep-dialogues-release` so `/health` identifies
the deployed commit. Keep the previous release and consistent data backup.

The shared nginx configuration is `/home/ubuntu/noos/nginx.conf`; back it up,
make only the Deep Dialogues host change, check `docker exec noos_nginx nginx -t`
and gracefully reload. Do not replace another service's host block. The first
cutover backup is retained in `/opt/deep-dialogues/rollback/`.

TLS resources use Certificate Manager names `deep-dialogues-ideaflow-app-*` in
the existing `openchat-chat-ideaflow-app-map`. DNS is **Vercel**, team
`ideaflowco`, managed through the authenticated M5 CLI. Keep the
`_acme-challenge.deep-dialogues` CNAME for renewal. Verify valid TLS and backend
responses at the load balancer with `curl --resolve` before changing the
`deep-dialogues` A/CNAME record. Retain the previous DNS record for rollback.

## API

- `GET /health`: storage readiness and release identity
- `GET /api/conversations`: published summaries; contributor/tag/limit/offset
- `GET /api/conversations/:slug`: full published conversation
- `POST /api/conversations`: submit to review queue (always pending)
- `GET /api/contributors`: contributor counts
- `GET /api/docs`: OpenAPI schema
- `GET /llms.txt`: machine-readable usage

Submissions are limited to 5 MiB and 10 requests per client per minute.
Compressed request bodies are rejected. Aged compatible patches for the
existing HTTP dependencies are pinned in `overrides`; no dependency younger
than one month was introduced during the recovery. Safe HTML rendering and a
content security policy restrict imported markup. The old Vercel/Supabase
function sources are legacy, not the production API.
