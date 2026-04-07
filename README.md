# Staffly Web

Hospital callout coverage staffing platform. Administrators post urgent shifts, workers bid, and coordinators assign coverage — all in one responsive web app.

## Quick Start

### 1. Prerequisites

- Node.js 20+
- pnpm (`npm i -g pnpm`)
- Docker (for PostgreSQL) _or_ an existing PostgreSQL instance

### 2. Start PostgreSQL

```bash
docker-compose up -d
```

### 3. Environment

```bash
cp .env.example .env
# Edit .env — the defaults work with docker-compose
# Generate NEXTAUTH_SECRET:
openssl rand -base64 32
```

### 4. Install & migrate

```bash
pnpm install
pnpm prisma migrate dev --name init
pnpm prisma db seed
```

### 5. Run

```bash
pnpm dev
```

Open http://localhost:3000

## Demo Accounts

| Role   | Email                 | Password   |
|--------|-----------------------|------------|
| Admin  | admin@staffly.com     | admin123   |
| Admin  | admin2@staffly.com    | admin123   |
| Worker | worker1@staffly.com   | worker123  |
| Worker | worker2@staffly.com   | worker123  |
| Worker | worker3@staffly.com   | worker123  |

## Commands

```bash
pnpm dev              # Development server (localhost:3000)
pnpm build            # Production build
pnpm lint             # ESLint
pnpm test             # Vitest unit tests
pnpm test:e2e         # Playwright e2e tests
pnpm prisma studio    # Database browser
```

## Core Flow

1. **Admin logs in** → posts a callout shift with unit, role, dates, and bid deadline
2. **All workers are notified** in-app and by email
3. **Workers browse** open shifts and submit a bid with an optional note
4. **Admin reviews bidders** on the shift detail page and clicks "Select" to assign
5. **All bidders are notified** — winner gets a confirmation, others get a "not selected" update

## Tech Stack

Next.js 14 · TypeScript · Tailwind CSS · NextAuth.js v4 · Prisma · PostgreSQL · Resend · Vitest · Playwright

## UI Theme

Inspired by Unity Health Toronto: deep navy primary (#003087), red accent (#C41230), white/light-neutral surfaces, clean card layouts, accessible contrast.
