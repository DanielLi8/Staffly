# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

One responsive Next.js web app (App Router). There is no native app; phone use is mobile web.

## Users

- **Hospital admins / schedulers** (`ADMIN` role, the `/admin` area). Work at a desktop, are busy and constantly interrupted. Their job: post an urgent open shift, watch the callout cascade fill it, pick a bidder, approve shift swaps, and keep each department's roster covered. They need to re-orient instantly after an interruption.
- **Nursing and clinical staff** (`STAFF` role, the `/worker` area). Mostly on their phones, often mid-shift or tired. Their job: see shifts they are eligible for, respond to a callout in seconds, check their own schedule, declare availability, and request a swap or giveaway with a colleague.

An admin can preview the worker experience through the "View as" toggle; that is a preview, not a third audience.

## Product Purpose

Staffly is a hospital shift-callout staffing app for one hospital in Canada. When a shift opens, it reaches the right qualified staff (by department, clinical position, and declared availability), collects their responses as bids, and lets a scheduler assign coverage, all in one place instead of phone trees. Success means an open shift is filled quickly by an eligible person, nobody is paged for a role they cannot fill, and nobody is double-booked or pushed past safe hours.

## Positioning

Coverage is driven by a tiered, seniority-ordered callout cascade that widens on its own (available department staff, then the rest of the department, then other departments), with Postgres as the source of truth so a scheduler can hold or stop it at any moment. Every response channel (in-app, SMS reply, voice IVR) funnels into one accept path that only ever creates a bid; a human scheduler always makes the assignment.

## Operating Context

- A single hospital, one hospital timezone; shift labels (Day / Evening / Night) are derived from the hospital-time start.
- Departments (e.g. Emergency, ICU, Medical/Surgical) with memberships, roster titles (e.g. "Lead RN"), and a Team Lead tag.
- Fixed 14-day pay periods; swap eligibility blocks pickups beyond 75 pay-period hours or 7 consecutive days.
- Outreach by in-app notification, SMS, and automated voice (Twilio); email outreach exists but is disabled.
- Admins work on large desktop screens; staff check the app on phones between tasks, often one-handed.

## Capabilities and Constraints

- Post, edit time, cancel, and assign shifts; bid on shifts; tiered callout cascade with advance / hold / stop controls; fill dashboard.
- Personal schedule calendar (day / week / month), department roster grid ("Location Schedule"), availability editor, shift swap and giveaway with colleague accept and admin approval.
- Role matching: a shift's `roleNeeded` must match the worker's clinical `position`; a mismatch fails closed.
- A cancelled or closed shift is immutable. Acceptances are always bids, never instant assignments.
- Terminology: "shift", "callout", "bid", "Location Schedule", "Shift Swap", "Shift Giveaway", "pay period", "Team Lead".
- Out of scope today: multi-hospital tenancy, payroll, native mobile apps.

## Brand Commitments

- Name: **Staffly**. Wordmark set in the display serif on the dark purple top bar.
- Voice: calm, clinical, trustworthy, fast. Plain, specific language; no hype, no playfulness around patient-care work.
- The incumbent visual system (deep purple primary, clinical red accent, Inter + DM Serif Display) is the identity; see DESIGN.md.

## Evidence on Hand

- Seeded demo data only (`prisma/seed.ts`): demo departments, staff, shifts, bids, and swap requests. No real hospital data, customers, testimonials, or metrics exist; do not fabricate any.

## Product Principles

1. **Speed under interruption.** Every screen answers "what needs me now?" first; the primary action is reachable in one step on a phone.
2. **Trust through correctness.** Never show something actionable that the server would refuse (ineligible shift, wrong role, closed shift); explain why instead.
3. **A human assigns.** Automation widens the net and collects responses; a scheduler makes the final call.
4. **Calm, not alarming.** Urgency is communicated with clarity and hierarchy, not with noise.

## Accessibility & Inclusion

Accessibility matters: target WCAG 2.2 AA. Staff use the app tired, in bright or dim wards, one-handed on phones, so text contrast, generous tap targets (44px where possible), visible keyboard focus, form labels, and reduced-motion support are product requirements, not polish.
