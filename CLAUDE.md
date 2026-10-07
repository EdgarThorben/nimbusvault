## What this project is

**Leo's Workshop**: a phone-first web app for one car mechanic (Leo). Astro SSR on Vercel, Postgres (Neon) +
Drizzle, argon2 + session-cookie auth. English UI copy. It replaced the NimbusVault IT-documentation app on the
`werkstatt` branch (2026-10-07); `main` still holds NimbusVault and serves its own production deployment.

## Deployment and data (confirmed 2026-10-07)

- Served at **leos-workshop.vercel.app**, a project domain on Vercel project `bookstack-clone` bound to git
  branch `werkstatt`. Vercel Authentication is off for previews so customers can open `/a/[token]`.
- Own database: `leos_workshop` on the same Neon endpoint as NimbusVault's `neondb`. Wired via a
  branch-scoped `DATABASE_URL` (Preview, branch `werkstatt`) and the local `.env`/`.env.local`. Never point
  this branch at `neondb` and never touch NimbusVault data from here.
- Migrate with `npm run db:generate` then `npm run db:migrate`. `npm run db:seed` only creates/resets Leo's login.

## Data model (`src/db/schema.ts`)

Customer → Vehicle (unique normalized plate) → Job (status `checked_in → awaiting_approval → approved →
in_progress → ready → invoiced`) with JobPhoto, LineItem (part/labour, qty, **net** unit price in cents) and
Approval (unguessable token, decision, decided_at). Invoice number/date sit on the job.

## Rules

- **Only Leo logs in.** `src/middleware.ts` redirects every non-public page to `/login`. Public: `/login`,
  `/a/*`, `/p/*` (checks its own access), static assets. Every action except `decideApproval` calls `requireLeo`.
- **Customers see only their own job**, through `/a/[token]`. Photos for them go through `/p/...?t=token`, which
  checks the photo belongs to that token's job. Only the newest approval link per job accepts a decision.
- **Prototype mode (2026-10-07):** `DEMO_MODE=1` (set for Preview branch `werkstatt` and in local `.env`) shows an
  "Enter the prototype" button on `/login` that logs in as `leo@example.com` without a password. Anyone with the URL
  gets in, so switch it off (remove the env var, redeploy) before real customer data is entered.
  `npm run db:seed-demo` wipes and refills `leos_workshop` with example jobs; it refuses any other database.
- Prices are stored net; VAT is applied at display/invoice time from `VAT_RATE` in `src/config.ts`.
- Photos are private Blob objects; never switch to public URLs.
- Business details and VAT rate are placeholders in `src/config.ts`.
- Voice notes use the browser's Web Speech API; `vercel.json`'s `Permissions-Policy` must keep
  `microphone=(self)` or dictation silently fails.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
