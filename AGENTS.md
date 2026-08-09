# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Roles & access control (Phase 2)

- Roles are `STAFF`, `SCHEDULER`, `UNIT_CLERK` (see `enum Role` in `prisma/schema.prisma`). `SCHEDULER` = merged scheduler+admin (the `/admin` area); `UNIT_CLERK` = read-only, scoped to one department via `User.clerkDepartmentId` (the `/clerk` area); `STAFF` = bidding (`/worker`).
- Authorization layer lives in `src/lib/authz/` and is pure (no DB/session) so it is unit-testable. `shiftReadScope(actor)` returns a `Prisma.ShiftWhereInput`; `shiftListWhere(actor, callerFilter)` AND-s the scope in **unconditionally** so a caller filter can never widen it. Any new schedule/shift-list query MUST go through `shiftListWhere` - this is the security boundary, enforced at the data layer, not the UI. Access-control tests: `tests/authz/`.
- Build `Actor` from a session with `actorFromSession`/`requireActor` in `src/lib/auth.ts`. Role→home routing lives in `src/middleware.ts` (`homeFor`) and `src/app/page.tsx`.

## Multi-channel outreach (Phase 3)

- All outreach lives in `src/lib/outreach/`. Channels (`sms.ts`/`voice.ts`/`email.ts`/`inapp.ts`) implement the `OutreachChannel` interface (`types.ts`); the dispatcher (`index.ts`) runs every applicable channel per recipient and records one `OutreachAttempt` row each. Wired into `createShift` via `outreachForNewShift(shiftId)`, which targets STAFF with a `DepartmentMembership` in the shift's department (not all staff).
- **Single accept path:** `submitBid()` in `src/lib/outreach/accept.ts` is the ONLY place a `ShiftBid` is created/updated + the scheduler notified. In-app `placeBid`, inbound SMS, and IVR all funnel through it. Acceptances are always bids (PENDING), never instant assignments.
- **Credential-optional:** every Twilio touchpoint no-ops without env vars (mirrors `src/lib/email.ts`, which builds its Resend client lazily for the same reason). `isTwilioConfigured()`/`getTwilioClient()` in `twilio.ts` gate sending; SMS/voice only fire for a number with `phoneVerifiedAt` set (Twilio Verify at `/profile`).
- **Webhooks** (`src/app/api/webhooks/twilio/*`): public + unauthenticated. Already excluded from the NextAuth `middleware` matcher (it only lists `/admin|/clerk|/worker|/profile`). EVERY handler MUST call `readVerifiedTwilioForm` (validates `X-Twilio-Signature`, fails closed → 403) before any DB write. `TWILIO_AUTH_TOKEN` stays server-only. Signature URL is rebuilt from `webhookBaseUrl()` (not the proxied host) so it matches the callback URLs we hand Twilio.
- Inbound SMS resolves sender phone → verified `User`, parses a reply code (`codes.ts`: `YES <code>`=FULL, `PART <code>`=PARTIAL, bare code=FULL; carrier keywords handled) against `Shift.smsCode`. IVR pins shiftId+userId via signed query params. Tests: `tests/outreach/`.

## Local dev / verification

- `docker-compose up -d` (Postgres), copy `.env.example` → `.env`, `pnpm install`, `pnpm prisma migrate deploy`, `pnpm prisma db seed`. Demo accounts printed by the seed; `clerk@staffly.com / clerk123` is the read-only Emergency clerk.
- `pnpm build` runs `prisma migrate deploy` first (keeps Vercel deploys migrated). Validate with `pnpm lint`, `pnpm test`, `pnpm build`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
