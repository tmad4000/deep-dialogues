# Deep Dialogues restoration — 2026-10-26

Outcome verified on 2026-10-27 UTC:

- Live gallery: https://deep-dialogues.ideaflow.app/
- Imported dialogue and Astra response: https://deep-dialogues.ideaflow.app/#/read/basic-needs-work-and-abundance
- Source: https://share.google/aimode/F66Bl9b9UcQBDJQV0
- Merged implementation: https://github.com/tmad4000/deep-dialogues/pull/1
- Implementation commit: `d7c9550b9ee49b00d02cc26a77ae5ebdfdcf2d7b`; merge `183d79f`.
- Tracker: `deep-dialogues-fqx`, closed in the canonical M5 beads store.

## Deployment and persistence

The dedicated service runs on the existing GCP `lightsail-migration/noos` VM,
zone `us-central1-a`. `/health` returns `ok: true`, `storage: sqlite`, release
`d7c9550`. Release code is `/opt/deep-dialogues/releases/d7c9550`; `current`
points to it. Data is `/var/lib/deep-dialogues/dialogues.sqlite`.

`deep-dialogues.service` and `deep-dialogues-backup.timer` are active. The
backup service created consistent SQLite backups and passed integrity checks.
Five previously published conversation summaries were byte-for-byte equal
before and after the final release. Their versioned messages are retained.
The new conversation's entire message array equals its versioned JSON source;
it remains readable after service restart.

The existing HTTPS load balancer at `34.160.75.73` serves the site. Certificate
Manager certificate `deep-dialogues-ideaflow-app-cert` and its map entry are
ACTIVE. Valid TLS and the application were verified with `curl --resolve`
before the domain cutover, then through the public URL from M5 and M4.

Vercel DNS, team `ideaflowco`:

- A `deep-dialogues`: `34.160.75.73`, record `rec_50a6ed37943c0468c0000e1a`.
- CNAME `_acme-challenge.deep-dialogues`:
  `206252f3-6547-4cd2-b4ca-b101c6ee8789.9.authorize.certificatemanager.goog.`,
  record `rec_b012b362bed0b4661a535013`. Retain for certificate renewal.

The former deployment was Vercel's automatically provided domain route; no
explicit old Deep Dialogues DNS record was removed. Rollback can remove the
new A record to restore that route, but the old Supabase API was already broken.
The shared nginx pre-change file is retained at
`/opt/deep-dialogues/rollback/nginx-20261027T030024Z.conf`. Only the new hostname
block was added, followed by `nginx -t` and graceful reload.

## Conversation provenance

The complete Google share page was captured through Jacob's authorized normal
M4 Chrome extension. It contained six user prompts and six Google AI Mode
answers. No particular underlying Google model was identified. The original
wording, including transcription errors and numerical claims, is preserved.
Repeated citation badges and Google controls were removed; original source
links are listed after each corresponding answer.

For each pair, whitespace-normalized prompt plus answer matched the original
rendered page exactly after removing that interface text. Character counts and
FNV-1a checksums were:

| Pair | Characters | Checksum |
| --- | ---: | --- |
| 1 | 1783 | `5e05b670` |
| 2 | 3085 | `d6b20b19` |
| 3 | 3517 | `661b5f50` |
| 4 | 3722 | `eabc79db` |
| 5 | 4326 | `3801646a` |
| 6 | 5290 | `4824bd50` |

GPT-6 Astra read those twelve messages and supplied a subsequent contribution
with primary-source citations. It is message13, explicitly labeled as a later
GPT-6 Astra contribution. Its central correction is that the original global
workforce minimum is not established by a reproducible model; its practical
proposal centers on locally verified service guarantees, complete labor
accounting, reliable maintenance and protected transitions.

## Verification

- API integration test passed locally and on Node22 in PR/main GitHub Actions:
  recovery/idempotence, restart persistence, pending isolation, operator
  publication, filters, model attribution and request validation.
- Production build and diff checks passed. All four PR checks passed; main's
  Check and GitHub Pages deployment workflows passed.
- Public `/health`, list and full-conversation reads succeeded from M5.
- Rendered reader verified in the available Paseo browser: title, six human
  prompts, all thirteen messages, original sources and distinct Astra content.
  M4 Chrome retained its old Vercel connection during migration, so it was not
  counted as a successful final-production render. No browser policy or content
  security policy was weakened to complete verification.
- Actual upload-form paste/preview/submit succeeded. A temporary two-message
  record retained contributor, tags and original URL, stayed pending and
  returned404 from its public detail endpoint. Only that exact task-owned QA
  record was removed after verification; the published catalogue stayed at6.
- Astra's child completed in full-access mode with no pending permissions.
  Parent handled the observed routine Stream approvals; no blanket external
  action approval policy was installed.

The five archived conversations came from versioned source. The old Supabase
project hostname did not resolve; database-only submissions are not claimed
recovered. Daily backups are local to the GCP VM, not independent offsite
backups. Runbook and operator commands are in README.md.
