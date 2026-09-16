## What this project is

A single-tenant IT documentation / CMDB tool (Docusnap/i-doit style) for one org's IT department. Astro SSR, Postgres + Drizzle, argon2 + session-cookie auth.

## Data model (confirmed 2026-07-13): Collections + Items

The app was originally a BookStack-shaped clone (shelves → books → chapters → pages) with a separate, disconnected typed-asset/CMDB table bolted on later. Both were consolidated into two concepts because the split was confusing to use and duplicated entire route templates per client:

- **Collections** — simple top-level groupings (e.g. "IT Department", "Oberlinhaus (Potsdam / Berlin)"). Has a free-text `category` tag (confirmed 2026-07-14: just two values in practice, "Clients" and "Internal" — simplified down from an original 3-way "Internal Departments / Clients / Product & Engineering" split that the user found meaningless) used purely for home-page grouping — not a separate table. `/collections/new` has a create form (title, description, image, category); there's no edit form for collections yet.
- **Items** — everything that used to be split across Books/Chapters/Pages (free-text wiki docs) *and* the old `assets` table (typed CMDB records): one entity, typed (`server`, `database`, `application`, ... or `document` for wiki-style content), with structured `fields[]` (category/label/value), an optional free-text `section` label within its collection (replaces the old `chapters` table), full revision history, and an explicit relationship graph — regardless of what kind of thing the item documents.

Routing is fully generic — one dynamic `/items/[slug]` route serves every item, one `/collections/[collection]` route serves every collection. There are no per-client hardcoded route files; if you're tempted to add one (e.g. to give one collection a bespoke look), don't — either it belongs in the generic template or as a conditional bespoke-content component keyed by slug (see `src/components/OnboardingGuideContent.astro` and its siblings for that pattern, used only for the 3 narrative items whose layout can't be expressed as flat field rows).

## Current state vs. gaps

Built: DB-backed collections/items, login/logout, item create/edit with auto-diffed revision history, a JSONB `fields[]` array (category/label/value) per item, a directed relationship graph between items, encrypted credentials, impact analysis (blast radius) on the item page, an AI field-normalization assistant on the item forms, and a signed webhook ingest inbox at `/ingest`.

Not built — do not assume these exist: signup/registration, account settings, role-based permissions (any logged-in user can edit any item today), an edit form for collections (create exists at `/collections/new`, edit does not).

## v1 direction (confirmed)

- Single org, single tenant. No multi-tenant isolation needed.
- Manual documentation core first (CRUD + structured records + relationships). Do not build network discovery/scanning (SNMP/WMI/SSH) unless explicitly asked — out of scope for v1.
- Hosting: **confirmed** — stays on Vercel + Neon (cloud Postgres). Do not propose Docker Compose, on-prem Postgres, or other self-hosting changes; deploy config is settled.

## Data model rules for CMDB work

- Schema lives in `src/db/schema.ts` (Drizzle/Postgres); migrate with `npm run db:generate` then `npm run db:migrate`.
- The `items.fields` JSONB blob is fine for structured field/value data but is NOT a CI relationship model. Relationships live in the explicit `item_relationships` join table (`item_id`, `related_item_id`, `relationship_type`) with cycle detection in `src/lib/itemGraph.ts` — don't encode relationships as prose links inside `fields`.
- Dependency traversal (`getImpactGraph`, `wouldCreateCycle`) is recursive-CTE-based and lives in `src/lib/itemGraph.ts`. Walks are depth-capped (`MAX_IMPACT_DEPTH`) and guard against cycles with a path array, since rows can predate the write-time cycle check. Add new graph queries there rather than reaching for a graph database.
- Reuse the existing revision pattern (`itemRevisions`: snapshot + diffed `changes[]`) for any new versioned entity instead of inventing a second history mechanism.
- Prefer soft-delete (`status`/`archived_at` on `items`) over hard delete, so decommissioned hardware/licenses/docs stay auditable.
- Treat credentials/license keys as a separate, more sensitive field type — never store them in the general `fields` JSONB alongside plain fields; they have their own table (`credentials`, keyed by `item_id`) and field-level (not just item-level) access control.
- **Credentials encryption (confirmed 2026-07-14):** secrets are encrypted app-side with AES-256-GCM (Node `crypto`), key from an env var (Vercel/Neon env, not committed). Per-record IV. Do not add pgcrypto or an external secrets manager — this was decided against in favor of the existing stack.
- **Credentials access control (confirmed 2026-07-14):** masked-by-default, reveal-on-demand, every reveal audit-logged (who/what/when). Any logged-in user may reveal — do not build per-user/role grants for this; that would pull in full RBAC, which stays out of scope unless separately requested.
- **Field categories (confirmed 2026-07-14):** `src/lib/details.ts`'s `CATEGORY_ORDER` is `Compute, Storage & Backup, Pricing, Operations` — these are just display-ordering hints, not an enum (any category string is allowed). "Pricing" was added based on a real client VPS quote (Brutto/Netto price, setup fee, optional billable add-ons like Floating IP/Firewall/Load Balancer/Snapshots) — track pricing as regular field rows under a `Pricing` category, not a separate table/schema; this is billed-per-item bookkeeping, not sensitive enough to warrant the credentials treatment.
- **`server` type required fields (confirmed 2026-07-14):** `itemCompleteness.ts`'s required-field list for `type: "server"` is `CPU, RAM, Storage, Traffic, Operating System, Backup`, modeled directly on a real client VPS quote (Hetzner CAX11-style spec sheet) rather than the earlier generic `IP Address/Location/Owner` placeholder. Field-label matching in `getMissingRequiredFields` is an exact (normalized) string match — use these exact canonical labels on new server items, not synonyms, or the completeness check won't recognize them.

## i18n (confirmed 2026-07-14)

- English/German toggle, cookie-based (`nimbusvault_lang`), no route prefixes (`astro:i18n` routing was not used — see `src/middleware.ts` and `src/lib/i18n.ts`). Toggle link lives in `BookStackLayout.astro`'s nav, sets the cookie via a `?setLang=de|en` query param the middleware intercepts and redirects away.
- Translated: all static UI chrome (nav, labels, buttons, empty states, breadcrumb static segments, the fixed `itemTypes`/`relationshipTypes` enum labels, and the 3 bespoke-content components' hardcoded prose — `src/components/{OnboardingGuideContent,HolidayPartyContent,OutagePlanContent}.astro`, rendered conditionally by slug from `items/[slug].astro`) and `formatRelativeTime()`.
- **Not translated, by design:** seeded/user-entered database content — collection/item names & descriptions, item field categories/labels/values, credential labels. Translating that would mean either a dual-language content model or a live translation service, neither of which was requested. If real multi-language *content* is wanted later, that's a separate, bigger feature — don't conflate it with the UI-chrome toggle.
- Add new UI strings to `src/lib/i18n.ts`'s `dict` (both `en` and `de` keys), then call `t(lang, "key")` — `lang` comes from `Astro.locals.lang`, available in every `.astro` file's frontmatter (including nested components) since middleware sets it per-request.
- `DetailRowsEditor.astro`, `CredentialsPanel.astro`, and `NormalizationPanel.astro` have client-side `<script>` blocks that need translated strings too (e.g. the "Remove"/"Reveal"/"Hide" button text) — pass them via `data-*` attributes read in the script, not `define:vars` (that strips TypeScript support from the script and breaks the existing typed code).

## Modern-CMDB tech evaluated and rejected (confirmed 2026-09-16)

A "modern CMDB stack" proposal (graph database, GraphQL/Cypher, automated cloud discovery, AI reconciliation) was
assessed against this codebase. Three parts were rejected and one was built — don't re-propose the rejected ones:

- **Graph database (Neo4j et al.) — rejected.** The edge set is small (hundreds of rows) and the recursive CTEs in
  `src/lib/itemGraph.ts` already answer dependency and blast-radius questions. A second datastore would mean dual
  writes and losing transactional consistency with `items`/`credentials`, against the settled Vercel + Neon decision.
  Impact queries belong in Postgres.
- **GraphQL — rejected.** It's a transport layer, not a graph engine, and there is exactly one consumer (Astro SSR,
  already server-side with typed Actions). Nothing outside the app queries this data.
- **Automated cloud/Kubernetes discovery — still out of scope**, and structurally blocked: Vercel's serverless runtime
  has no long-lived worker to poll provider APIs or hold a watch. What *was* built is the receiving half — see below.
- **AI-assisted normalization — built** (`src/lib/fieldNormalizer.ts`), because `getMissingRequiredFields` matches
  labels by exact string, so "Memory" instead of "RAM" silently reads as incomplete.

## Webhook ingest (confirmed 2026-09-16)

`POST /api/ingest` accepts HMAC-SHA256-signed payloads (`src/lib/ingestAuth.ts`, secret in `INGEST_WEBHOOK_SECRET`;
signature covers `${timestamp}.${rawBody}`, 5-minute replay window). Deliveries land in the `ingest_events` table as
`pending` and are reviewed by a human at `/ingest` — **nothing is ever written straight into `items`**. Applying an
event goes through the normal revision machinery so an automated update is as auditable as a hand-typed one. Keep it
that way: an unattended feed that silently rewrites the documentation destroys its value as a record of what's true.

## AI-assisted normalization (confirmed 2026-09-16)

`src/lib/fieldNormalizer.ts` asks Claude (`claude-opus-5`, low effort, JSON-schema structured output) to map draft
field labels onto the canonical set for the item type and to flag likely duplicate items. Rules it must keep:

- **Advisory only.** Suggestions are rendered with Apply buttons; nothing is rewritten automatically.
- **Degrades to nothing.** No `ANTHROPIC_API_KEY` means the panel isn't rendered at all; an API failure returns empty
  arrays. A flaky model API must never block a save.
- **Re-resolve model output against real input** before it reaches the UI — a returned row index or item slug is
  looked up in the request payload, never trusted as-is.
- Duplicate candidates are shortlisted locally first (`shortlistDuplicateCandidates`); don't send the whole item table.

## Out of scope unless explicitly requested

Network discovery/scanning (outbound polling/probing — the inbound webhook receiver above is the accepted path),
multi-tenancy, granular RBAC beyond "logged in or not", self-service signup.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
