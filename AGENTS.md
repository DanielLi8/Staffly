# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Roles & access control (Phase 2)

- Roles are `STAFF`, `SCHEDULER`, `UNIT_CLERK` (see `enum Role` in `prisma/schema.prisma`). `SCHEDULER` = merged scheduler+admin (the `/admin` area); `UNIT_CLERK` = read-only, scoped to one department via `User.clerkDepartmentId` (the `/clerk` area); `STAFF` = bidding (`/worker`).
- Authorization layer lives in `src/lib/authz/` and is pure (no DB/session) so it is unit-testable. `shiftReadScope(actor)` returns a `Prisma.ShiftWhereInput`; `shiftListWhere(actor, callerFilter)` AND-s the scope in **unconditionally** so a caller filter can never widen it. Any new schedule/shift-list query MUST go through `shiftListWhere` - this is the security boundary, enforced at the data layer, not the UI. Access-control tests: `tests/authz/`.
- Build `Actor` from a session with `actorFromSession`/`requireActor` in `src/lib/auth.ts`. Role→home routing lives in `src/middleware.ts` (`homeFor`) and `src/app/page.tsx`.

## Multi-channel outreach (Phase 3)

- All outreach lives in `src/lib/outreach/`. Channels (`sms.ts`/`voice.ts`/`email.ts`/`inapp.ts`) implement the `OutreachChannel` interface (`types.ts`); the dispatcher (`index.ts`) runs every applicable channel per recipient and records one `OutreachAttempt` row each. Who is dispatched to is decided upstream by the Phase 4 cascade; the dispatcher itself is a dumb pipe.
- **Email is currently disabled** for callouts: `EMAIL_CHANNEL_ENABLED` in `index.ts` keeps `emailChannel` out of `CHANNELS`, and `dashboard.ts` filters disabled channels out of the fill-dashboard view model. `email.ts` and the templates stay in place; flipping the flag re-enables both.
- **Single accept path:** `submitBid()` in `src/lib/outreach/accept.ts` is the ONLY place a `ShiftBid` is created/updated + the scheduler notified. In-app `placeBid`, inbound SMS, and IVR all funnel through it. Acceptances are always bids (PENDING), never instant assignments.
- **Credential-optional:** every Twilio touchpoint no-ops without env vars (mirrors `src/lib/email.ts`, which builds its Resend client lazily for the same reason). `isTwilioConfigured()`/`getTwilioClient()` in `twilio.ts` gate sending; SMS/voice only fire for a number with `phoneVerifiedAt` set (Twilio Verify at `/profile`).
- **Webhooks** (`src/app/api/webhooks/twilio/*`): public + unauthenticated. Already excluded from the NextAuth `middleware` matcher (it only lists `/admin|/clerk|/worker|/profile`). EVERY handler MUST call `readVerifiedTwilioForm` (validates `X-Twilio-Signature`, fails closed → 403) before any DB write. `TWILIO_AUTH_TOKEN` stays server-only. Signature URL is rebuilt from `webhookBaseUrl()` (not the proxied host) so it matches the callback URLs we hand Twilio.
- Inbound SMS resolves sender phone → verified `User`, parses a reply code (`codes.ts`: `YES <code>`=FULL, `PART <code>`=PARTIAL, bare code=FULL; carrier keywords handled) against `Shift.smsCode`. IVR pins shiftId+userId via signed query params. Tests: `tests/outreach/`.

## Tiered callout cascade + fill dashboard (Phase 4)

- The cascade lives in `src/lib/callout/`. **Postgres is the source of truth, not Inngest**: `CalloutCampaign` (one per shift, `status` = RUNNING/PAUSED/CANCELLED/FILLED/EXHAUSTED) holds all state, and every write goes through `campaign.ts`, which re-reads the row before acting. A scheduler "stop" writes CANCELLED and any running engine step reads that and no-ops. Keep it that way - it is what makes the engine swappable.
- Policy is pure and unit-tested, on purpose: `tiers.ts` (who is in which tier, seniority-ordered via `rankBySeniority`), `decide.ts` (`decideNextStep` with an injected `now`), `overtime.ts` (`projectOvertime`, a simplified weekly-hours stand-in for a real collective-agreement rule). `campaign.ts`/`dashboard.ts` hold the DB access. Tests: `tests/callout/` (`fake-db.ts` is a narrow in-memory Prisma stand-in for the service-level tests).
- Tiers widen 1 → available department staff, 2 → department staff who declared nothing (TENTATIVE counts as nothing), 3 → other departments. An overlapping `UNAVAILABLE` removes someone from the whole cascade. An empty tier is skipped immediately rather than waited out.
- `OutreachAttempt.tier` + `@@unique([shiftId, tier, userId, channel])` is the idempotency key: re-running a tier never re-contacts anyone. `dispatchOutreach(shift, recipients, { tier })` enforces it.
- **Posting delay:** outreach is NOT sent when a shift is posted. `startCalloutCampaign` only records `CalloutCampaign.tier1DispatchAt` (now + `TIER1_DISPATCH_DELAY_SECONDS`); Inngest's durable timer then calls `dispatchOpeningTier`, which re-reads the row, so a shift stopped/cancelled/filled inside the window reaches nobody. Non-null `tier1DispatchAt` means exactly "nobody contacted yet" - it is cleared when tier 1 goes out. Never re-implement this with `setTimeout`; a serverless invocation would drop it.
- **Credential-optional (mirrors Twilio):** `src/lib/inngest/client.ts` builds the client lazily and `sendCalloutEvent` no-ops without `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY`. Posting a shift and advance/hold/stop all work with no Inngest account; what is lost is everything needing a clock - the automatic timed escalation, and the posting delay (`startCalloutCampaign` dispatches tier 1 immediately instead). `tests/callout/no-inngest.test.ts` guards this; set the keys in any real deployment.
- **No auto-expiry.** Past the shift start an unfilled callout raises a scheduler reminder (`CALLOUT_REMINDER`) and keeps going. Never close a shift on a timer.
- Scheduler controls are `src/app/actions/callout.ts` (SCHEDULER-only via `requireActor` + `requireRole`); the dashboard is `src/features/callout/` on `/admin/shifts/[id]`.

## Server-action validation

- **Never `throw` for user-input validation in a server action.** Next.js replaces thrown server-action errors with an opaque `digest` message in production, so a routine bad input reaches the user looking like a crash (issue #7). Return a typed failure instead - see `CreateShiftFailure` in `src/app/actions/shifts.ts` - and render it as inline field errors. `throw` stays for auth and genuinely unexpected faults; the client shows a generic retry message for those.
- Keep the rules pure and shared so the client can block a bad submit with the *same* messages the server would return: `src/lib/shifts/validation.ts` (shift-time rules) and `src/lib/shifts/time.ts` (typeable AM/PM time entry, replacing `datetime-local`). Tests: `tests/validation/shift-times.test.ts`, `tests/features/shift-form.test.tsx`.

## Local dev / verification

- `docker-compose up -d` (Postgres), copy `.env.example` → `.env`, `pnpm install`, `pnpm prisma migrate deploy`, `pnpm prisma db seed`. Demo accounts printed by the seed; `clerk@staffly.com / clerk123` is the read-only Emergency clerk.
- `pnpm build` runs `prisma migrate deploy` first (keeps Vercel deploys migrated). Validate with `pnpm lint`, `pnpm test`, `pnpm build`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
