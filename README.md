# Leo's Workshop

A phone-first web app for a single car mechanic: check in a car, take photos, dictate findings,
write an estimate, send the customer an approval link by WhatsApp or SMS, and turn the job into a
PDF invoice. Installable on Android as a PWA.

- **Framework**: Astro SSR on Vercel (`@astrojs/vercel`)
- **Database**: Postgres (Neon) + Drizzle ORM
- **Photos**: private Vercel Blob store, streamed through `/p/[...path]`
- **Auth**: one login (Leo), argon2 password hash + session cookie
- **PDF**: `pdf-lib`

## Development

```sh
npm install
cp .env.example .env          # DATABASE_URL, BLOB_READ_WRITE_TOKEN
npm run db:migrate
npm run db:seed-demo           # example data + demo login leo@example.com / workshop-demo
astro dev --background
```

With `DEMO_MODE=1`, `/login` shows an "Enter the prototype" button that skips the password.
Turn it off before real customers use the app.

## Screens

| Route | Who | What |
| --- | --- | --- |
| `/jobs` | Leo | Today's jobs, status counts, "Check in a new car" |
| `/jobs/new` | Leo | Check-in form (plate, car, task, customer) |
| `/jobs/[id]` | Leo | Photos, voice note → findings, estimate lines, status, send for approval |
| `/a/[token]` | Customer | Photos, findings, estimate; Approve / Not now / Call Leo |
| `/customers` | Leo | Customer list with call/email |
| `/invoices` | Leo | Create invoice from an approved job; open PDF |

## Placeholders to fill in

Business name, address, phone, email, VAT ID, bank details, payment terms and the VAT rate
live in `src/config.ts`.
