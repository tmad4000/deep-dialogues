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
For a static mirror under a path prefix, set `VITE_BASE_PATH` at build time
(GitHub Pages uses `/deep-dialogues/`). App navigation uses that prefix and hash
routes; copied reader links and summary links use the canonical production site.

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
from public lists and reads. Publication is limited to editors (the review screen
below) and the operator CLI; there is no public publication endpoint.

## Sign in with Ideaflow (optional)

Reading never needs an account. Ideaflow ID (`https://id.ideaflow.app/api/auth`;
the bare origin is not the issuer) is the OpenID Connect provider: authorization
code flow with PKCE (S256), `client_secret_basic`, and EdDSA-signed ID tokens
verified with Node's own crypto (no auth dependency). Sessions are opaque random
`dd_session` cookies (HttpOnly, Secure, SameSite=Lax, 30 days); only their SHA-256
hash is stored, in the `sessions` table. Without client credentials the site runs
signed out and `/auth/login` returns 503.

- **Contributors:** a signed-in, same-origin upload records the Ideaflow subject,
  name and email as private `submitted_by` and defaults the credit to their name.
  `#/my` lists their submissions and outcomes; pending ones can be edited until
  reviewed. `submitted_by`, `review` and highlight indices never appear on public
  routes. Anonymous uploads still work exactly as before.
- **Editors:** `#/admin` (`DD_ADMIN_SUBS`, or `DD_ADMIN_EMAILS` with a verified
  email) reviews the queue: publish the **full** conversation, **highlights only**
  (ticked messages become a new public conversation and the full transcript stays
  private, status `superseded`), or **both**, cross-linked through `versions`
  with a Full/Highlights switch in the reader. Reject (optional note shown to the
  contributor) and unpublish are also available.
- Account routes (`/api/me`, `/api/my/*`, `/api/admin/*`) send no CORS headers;
  writes require this site's `Origin` and `X-Requested-With: deep-dialogues`.

Environment (production: root-owned mode-600 `/etc/deep-dialogues.env`):
`IDEAFLOW_CLIENT_ID`, `IDEAFLOW_CLIENT_SECRET`, `PUBLIC_BASE_URL`
(`https://deep-dialogues.ideaflow.app`, which fixes the redirect URI
`/auth/callback`), `DD_ADMIN_SUBS`, `DD_ADMIN_EMAILS`, `NOOS_API_URL`,
`NOOS_API_KEY`. The client is registered as first-party application
`deep-dialogues` (environment `production`) with ideaflow-auth's
`register:first-party-client`; local copies live in `~/.config/deep-dialogues/` on
the M4 and backups in Secret Manager (`boreal-conquest-464203-v2`):
`deep-dialogues-oidc-client-id`, `deep-dialogues-oidc-client-secret`,
`deep-dialogues-noos-api-key`.

## Noos

Every **published** dialogue is also a public Noos note owned by the
`deep_dialogues` agent account, a child of one public “Deep Dialogues” list. The
note carries the title, description or opening prompt, participants (credited
contributor and AI models), message count, version links and the reader URL
(`externalUri`, `sourceType=deep-dialogues`). Tags become Noos’s shared `#topic`
lists, plus `#deep-dialogues` and one per model. Pending, rejected and private
rows are never sent; unpublishing makes the note private. The `noos_sync` table
records node IDs and content digests, so repeated syncs write nothing. Reviews
sync immediately, the service reconciles on start, and a Noos outage is recorded
and retried without blocking review. Manual: `node server/manage.js noos-sync [SLUG]`.

The Noos People overlay was not used: it is owner-private by design and cannot
hold public content.

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
- `GET /api/me`, `/api/my/submissions[/:slug]` (GET/PUT), `/api/admin/queue`,
  `/api/admin/conversations/:slug[/review]`: same-origin account routes (see above)
- `GET /api/docs`: OpenAPI schema
- `GET /llms.txt`: machine-readable usage

Submissions are limited to 5 MiB and 10 requests per client per minute.
Compressed request bodies are rejected. Aged compatible patches for the
existing HTTP dependencies are pinned in `overrides`; no dependency younger
than one month was introduced during the recovery. Safe HTML rendering and a
content security policy restrict imported markup. The old Vercel/Supabase
function sources are legacy, not the production API.

Unpublishing a bundled seed dialogue hides it from the live site and API, but its previously public text remains available in older static bundles.

## Reading, highlights and sharing

The Waves of Thought reader begins with Jacob’s previously reviewed six-message
excerpt, followed by the complete original transcript. Each expandable excerpt
turn links to its original message; the separate highlights URL remains available.
Highlights and the original are collapsible. A sticky navigation bar opens a
table of contents with three highlights themes and twelve original chapters.
Use the chapter controls to expand or collapse all original chapters at once.
Chapter links (`?section=chapter-thought-waves`, for example) reveal their section;
existing message/quote links reveal all enclosing disclosures. `?full=1` opens
the complete original and all its chapters. Chapter headings are editorial labels;
the original turns remain in their existing order.
The versioned excerpt and chapter navigation are suppressed if the message count
or any excerpt source turn or attribution changes. Transcript text and message
destinations are preserved.

The public reader accepts `/read/:slug` and the existing `/#/read/:slug` links.
Every message has a stable `message-N` destination; headings add a normalized
heading suffix. Link buttons copy public URLs with `?at=...`. Selected passages
also include the exact `quote` and its `from` character offset; readers verify
that text before highlighting it, so stale links do not mark an unrelated passage.

Bookmarks and personal highlights are saved **in that browser only**, without an
account. Copy their links to share a passage or open it elsewhere. Clearing site
data removes local saves. Storage/clipboard failures have visible recovery paths.
The prompts-only control hides responses without removing their destinations.

When the original abundance exchange still matches its source, the reader pins
Jacob’s planning question and Google AI Mode’s response at the top, each with
its own disclosure. A separate “Read the whole conversation” disclosure
contains the integrated overview, highlights, reading tools and transcript,
including Astra’s separately attributed later message. Links to messages, headings
and passages open the full conversation as needed. The pin is omitted if either
turn’s wording, role or citation destinations, or the response attribution,
differs from the source.
`/s/blueprint-for-abundance` now permanently redirects (308) to
`/read/basic-needs-work-and-abundance`; canonical and Open Graph/Twitter metadata
identify that reader URL. `/share/abundance.png` remains its 1200×630 preview.
The underlying Google model was not identified by the shared source.

The data-center reader restores Gemini’s original three-tier classification at
the top, linked to the complete response8/message16. Its headings, nine issue
labels and explanations were already in the transcript as flat paragraphs;
semantic headings/lists and the original ranking are now surfaced explicitly.
The ten-exchange source fixture matches a fresh authorized Chrome capture of
Gemini’s eighth answer after whitespace normalization. No source words were
missing or invented. Codex’s later assessment remains message21. The existing
`/s/ai-data-centers` editorial guide remains separate; it is not substituted for
Gemini’s classification. Original claims are preserved as attributed claims.

Semantic formatting for the basic-needs and data-centers dialogues is a read-time presentation
layer. For a matching slug and message count, each message is formatted only
when its normalized wording, role and ordered citation destinations match
the matching versioned conversation in `content/`; persistent originals and operator changes are
retained. Tests compare every original word, model label and citation URL with
the pre-formatting publication fixture. Other conversations use their own HTML.

Complete HTML artifacts are future work, tracked as `deep-dialogues-861`; this
release does not introduce executable HTML uploads or change the content policy.
Roll back code by restoring the previous `current` symlink and its
`RELEASE_COMMIT`, then restart the dedicated service. No database migration or
restore is needed for these reader changes; preserve new submissions.
