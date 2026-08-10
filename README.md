# Staffly Web

Hospital callout coverage staffing platform. Administrators post urgent shifts, workers bid, and coordinators assign coverage — all in one responsive web app.

## Live demo

**Try it:** [Open the portal (sign in)](https://staffly-gamma.vercel.app/)

Use the demo accounts below. Choose **Staff Member** or **Administrator** on the login page to match the account role.

> Deployed on [Vercel](https://vercel.com). Demo data and credentials are for evaluation only.

## Features

- Role-based portals (admin vs worker) with NextAuth.js
- Shift posting, bidding, and assignment workflow
- In-app notifications; email via Resend (optional in local dev)

## Tech stack

Next.js 14 · TypeScript · Tailwind CSS · NextAuth.js v4 · Prisma · PostgreSQL · Resend · Vitest · Playwright

## Local development

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io) (`npm i -g pnpm`)
- Docker (for PostgreSQL) *or* your own PostgreSQL instance

### 1. Start PostgreSQL

```bash
docker-compose up -d
```

### 2. Environment

```bash
cp .env.example .env
```

Edit `.env`: set `NEXTAUTH_SECRET` (e.g. `openssl rand -base64 32`). Defaults match `docker-compose` for `DATABASE_URL`.

Everything else in `.env.example` is optional. Without Resend the app skips emails, without Twilio it skips SMS/voice, and without Inngest the callout cascade still runs - posting a shift fires tier-1 outreach immediately and a scheduler can advance, hold, or stop the cascade by hand. Inngest only adds the automatic timed escalation between tiers.

### 3. Install, migrate, and seed

```bash
pnpm install
pnpm prisma migrate dev
pnpm prisma db seed
```

### 4. Run the app

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Secrets & deployment

### Where secrets live in production

Production values are **not** kept in the repo. They live in the Vercel project under **Settings → Environment Variables**, where they are encrypted at rest. Mark every secret as **Sensitive** so it becomes write-only - it can be read by the running app but never displayed again in the dashboard or CLI.

Scope values per environment:

- **Production** - live keys (real database, live Twilio credentials).
- **Preview / Development** - **test** keys: Twilio test credentials and a non-production database, so a preview deploy can never send a real SMS or voice call, or touch production data.

### The `NEXT_PUBLIC_` rule

Anything prefixed `NEXT_PUBLIC_` is inlined into the browser bundle at build time and shipped to every visitor. **Never** put a secret behind that prefix. All of Staffly's secrets are server-only and must stay unprefixed.

### Current environment variables

| Variable | Secret? | Required | Differs per environment |
|----------|---------|----------|--------------------------|
| `DATABASE_URL` | Secret | Yes | Yes - prod DB vs. a separate preview/local DB |
| `NEXTAUTH_SECRET` | Secret | Yes | Yes - use a distinct value per environment |
| `NEXTAUTH_URL` | Public (a URL) | Yes | Yes - deployment URL vs. `http://localhost:3000` |
| `RESEND_API_KEY` | Secret | Optional | Yes - live vs. test key |
| `EMAIL_FROM` | Public | Optional | Usually not |
| `TWILIO_ACCOUNT_SID` | Secret | Optional | Yes - live vs. test account |
| `TWILIO_AUTH_TOKEN` | Secret (highly sensitive - also validates inbound webhook signatures) | Optional | Yes |
| `TWILIO_PHONE_NUMBER` | Secret | Optional | Yes - live number vs. Twilio test number |
| `TWILIO_VERIFY_SERVICE_SID` | Secret | Optional | Yes |
| `TWILIO_WEBHOOK_BASE_URL` | Public (a URL) | Optional | Yes - public callback host, e.g. an ngrok tunnel in dev |

The escalation-cascade phase adds `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` (both secret, both optional - see `.env.example`).

### Syncing values locally

```bash
npm i -g vercel        # or use npx vercel
vercel login
vercel link            # links this repo to the Vercel project, creates .vercel/
vercel env pull .env.local
```

`vercel env pull` writes the cloud values into `.env.local`. Both `.vercel/` and `.env.local` are gitignored - the only env file tracked in git is `.env.example`, which holds no real values.

To set a value from the CLI:

```bash
vercel env add <NAME> <production|preview|development>
```

## Demo accounts

Use these after `pnpm prisma db seed`, or on the live demo (if seeded there).

| Role        | Email               | Password   |
|------------|---------------------|------------|
| Admin      | admin@staffly.com   | admin123   |
| Admin      | admin2@staffly.com  | admin123   |
| Worker     | worker1@staffly.com | worker123  |
| Worker     | worker2@staffly.com | worker123  |
| Worker     | worker3@staffly.com | worker123  |

Select the matching portal tab (**Staff Member** / **Administrator**) before signing in.

## Scripts

| Command        | Description                |
|----------------|----------------------------|
| `pnpm dev`     | Dev server (port 3000)     |
| `pnpm build`   | Production build           |
| `pnpm lint`    | ESLint                     |
| `pnpm test`    | Vitest unit tests          |
| `pnpm test:e2e`| Playwright E2E tests       |
| `pnpm prisma studio` | Prisma database browser |

## Core flow

1. **Admin** posts a callout shift (unit, role, dates, bid deadline).
2. **Workers** are notified in-app and by email (when configured).
3. **Workers** browse open shifts and submit a bid with an optional note.
4. **Admin** reviews bidders on the shift detail page and selects assignee.
5. **Bidders** are notified — winner confirmed, others notified as not selected.

## UI theme

Inspired by Unity Health Toronto: deep navy primary (`#003087`), red accent (`#C41230`), light-neutral surfaces, accessible contrast.
