# NimbusVault

An Astro SSR app that clones the BookStack UI as a real, single-tenant IT-documentation tool (Docusnap/i-doit style): shelves → books → chapters → pages, backed by Postgres, with real authentication and revision history instead of static demo data.

- **Framework**: Astro (SSR, `@astrojs/vercel` adapter)
- **Database**: Postgres (Neon, provisioned via the Vercel Marketplace integration) + Drizzle ORM
- **Auth**: argon2-hashed passwords, session cookies, Astro Actions (`src/actions/`)
- **Content model**: structured field/value page records (category/label/value + diffed revision history) — not markdown

## Development

```sh
npm install
cp .env.example .env   # fill in DATABASE_URL (see "Database" below)
npm run db:migrate
npm run db:seed        # seeds 3 demo users + IT Department content
astro dev --background
```

Manage the background dev server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

Demo login (any of these, shared password): `barry@nimbusvault.io`, `priya@nimbusvault.io`, `marcus@nimbusvault.io` — password `NimbusDemo!2024`.

## Database

Schema lives in `src/db/schema.ts` (Drizzle). Common commands:

| Command              | Action                                             |
| :------------------- | :-------------------------------------------------- |
| `npm run db:generate` | Generate a migration from schema changes            |
| `npm run db:migrate`  | Apply migrations to `DATABASE_URL`                   |
| `npm run db:seed`     | Populate demo users, shelves, books, pages, revisions |

`DATABASE_URL` for local dev comes from the Neon Postgres instance provisioned on the linked Vercel project (`vercel env pull .env.local`, then copy `DATABASE_URL` into `.env` since `drizzle-kit` and `scripts/seed.ts` run outside Vite and don't read `.env.local`).

## Deployment

Linked to Vercel project `nimbusvault` (connected to this GitHub repo for git-based deploys). `DATABASE_URL` and related Neon env vars are provisioned for Production, Preview, and Development on Vercel already.

```sh
vercel deploy --prod
```

## Project structure

```text
src/
  actions/       Astro Actions (login, logout, createPage, updatePage)
  components/    Shared Astro components (nav, breadcrumbs, details panel, form editor)
  db/            Drizzle schema + client
  layouts/       Page layout (header, search, auth-aware nav)
  lib/           Auth, queries, diffing, slugs, relative time — all data-agnostic helpers
  middleware.ts  Resolves the session cookie into Astro.locals.user on every request
  pages/         Routes (shelves, books, IT Department pages, new/edit forms, login)
scripts/seed.ts  Seeds demo users + content into Postgres
```

## What's built vs. not yet

Built: real DB-backed shelves/books/pages, login/logout, page create + edit with auto-computed revision diffs.

Not yet: signup/registration (only seeded demo users exist), account settings, role-based permissions (any logged-in user can edit any page), and UI to create books/chapters/shelves (the other 4 books besides IT Department are still "Coming soon" stubs).
