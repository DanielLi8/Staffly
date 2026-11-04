import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";
import { monthPrefix } from "../../prisma/seed-month/plan";
import { DEMO_EMAIL_DOMAIN } from "../../prisma/seed-month/roster";
import { seedMonth } from "../../prisma/seed-month/write";

/**
 * `pnpm seed:month` against real Postgres: a second run for the same month
 * replaces its own rows instead of adding to them, and leaves every row it
 * didn't make alone.
 *
 * Runs only via `pnpm test:db`, against a SEEDED, DISPOSABLE database in
 * DATABASE_URL. It generates a far-future month and removes it (and any demo
 * staff it had to create) afterwards.
 */

const MONTH = "2031-03";
const NOW = new Date("2031-03-10T15:00:00Z");
const prefix = monthPrefix(MONTH);

let demoStaffBefore: string[] = [];

async function counts() {
  const owned = { where: { id: { startsWith: prefix } } };
  const [shifts, bids, activity, campaigns, outreach, declines, swaps, availability, notifications, users, allShifts] = await Promise.all([
    db.shift.count(owned),
    db.shiftBid.count(owned),
    db.shiftActivity.count(owned),
    db.calloutCampaign.count(owned),
    db.outreachAttempt.count(owned),
    db.shiftDecline.count(owned),
    db.shiftSwapRequest.count(owned),
    db.availability.count(owned),
    db.notification.count(owned),
    db.user.count(),
    db.shift.count(),
  ]);
  return { shifts, bids, activity, campaigns, outreach, declines, swaps, availability, notifications, users, others: allShifts - shifts };
}

afterAll(async () => {
  const owned = { where: { id: { startsWith: prefix } } };
  await db.notification.deleteMany(owned);
  await db.availability.deleteMany(owned);
  await db.shiftSwapRequest.deleteMany(owned);
  await db.shift.deleteMany(owned);
  await db.user.deleteMany({ where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}`, notIn: demoStaffBefore } } });
  await db.$disconnect();
});

describe("seedMonth", () => {
  it("is idempotent: a re-run for the same month replaces its rows and touches nothing else", async () => {
    demoStaffBefore = (await db.user.findMany({ where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } }, select: { email: true } })).map((u) => u.email);
    const before = await counts();

    const first = await seedMonth(db, { month: MONTH, now: NOW });
    const afterFirst = await counts();
    expect(afterFirst.shifts).toBe(first.plan.shifts.length);
    expect(afterFirst.shifts).toBeGreaterThan(0);
    expect(afterFirst.others).toBe(before.others);

    const second = await seedMonth(db, { month: MONTH, now: NOW });
    expect(second.demoStaffCreated).toBe(0);
    expect(await counts()).toEqual(afterFirst);
  }, 120_000);
});
