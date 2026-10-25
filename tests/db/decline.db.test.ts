import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { liveRevision } from "@/lib/live/revision";
import { submitBid } from "@/lib/outreach/accept";
import { recordDecline } from "@/lib/outreach/decline";
import { startCalloutCampaign, runTierOutreach } from "@/lib/callout/campaign";
import { loadFillDashboard } from "@/lib/callout/dashboard";

/**
 * An in-app decline against real Postgres, read back the way the admin fill
 * dashboard reads it: the `ShiftDecline` row, the dashboard view model, the
 * live revision that refreshes an open admin page, and the cascade skip.
 *
 * Runs only via `pnpm test:db`, against a SEEDED, DISPOSABLE database in
 * DATABASE_URL (CI's e2e database). It creates one shift and deletes it after.
 */

const HOUR = 60 * 60 * 1000;

let shiftId: string;
let mariaId: string;
let davidId: string;

beforeAll(async () => {
  const [admin, maria, david, er] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: "admin@staffly.com" } }),
    db.user.findUniqueOrThrow({ where: { email: "worker1@staffly.com" } }),
    db.user.findUniqueOrThrow({ where: { email: "worker2@staffly.com" } }),
    db.department.findUniqueOrThrow({ where: { code: "ER" } }),
  ]);
  mariaId = maria.id;
  davidId = david.id;

  const startsAt = new Date(Date.now() + 24 * HOUR);
  const shift = await db.shift.create({
    data: {
      title: "Decline DB test",
      unit: "4B",
      departmentId: er.id,
      roleNeeded: "Registered Nurse (RN)",
      location: "tests/db/decline",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 12 * HOUR),
      createdById: admin.id,
    },
  });
  shiftId = shift.id;
  await startCalloutCampaign(shiftId);
});

afterAll(async () => {
  if (shiftId) {
    await db.notification.deleteMany({ where: { shiftId } });
    await db.shift.delete({ where: { id: shiftId } });
  }
  await db.$disconnect();
});

describe("in-app decline (Postgres)", () => {
  it("shows on the admin fill dashboard and moves the live revision", async () => {
    const topic = { kind: "admin-shift" as const, shiftId };
    const before = await liveRevision(topic);

    const result = await recordDecline({ shiftId, workerId: davidId, source: "IN_APP" });
    expect(result).toMatchObject({ ok: true });

    expect(await liveRevision(topic)).not.toBe(before);

    const dashboard = await loadFillDashboard(shiftId);
    const row = dashboard?.reached.find((r) => r.userId === davidId);
    expect(row).toMatchObject({
      name: "David Kim",
      bidStatus: null,
      decline: { via: "IN_APP", at: expect.any(Date) },
    });
  });

  it("keeps the declined worker out of every later tier", async () => {
    const aisha = await db.user.findUniqueOrThrow({ where: { email: "worker3@staffly.com" } });
    // David (ICU) and Aisha (Med/Surg) are both tier-3 candidates for an ER shift.
    await runTierOutreach(shiftId, 3);
    expect(await db.outreachAttempt.count({ where: { shiftId, userId: davidId } })).toBe(0);
    expect(await db.outreachAttempt.count({ where: { shiftId, userId: aisha.id, tier: 3 } })).toBeGreaterThan(0);
  });

  it("a later bid takes the decline back", async () => {
    const result = await submitBid({ shiftId, workerId: davidId, scope: "FULL", source: "IN_APP" });
    expect(result.ok).toBe(true);
    expect(await db.shiftDecline.count({ where: { shiftId, userId: davidId } })).toBe(0);

    // Never contacted, no longer declined: out of the outreach log, in the bids.
    const dashboard = await loadFillDashboard(shiftId);
    expect(dashboard?.reached.find((r) => r.userId === davidId)).toBeUndefined();
    expect(dashboard?.bidders.map((b) => b.workerId)).toContain(davidId);
  });

  it("declining withdraws the pending bid again", async () => {
    await submitBid({ shiftId, workerId: mariaId, scope: "FULL", source: "IN_APP" });
    const result = await recordDecline({ shiftId, workerId: mariaId, source: "IN_APP" });
    expect(result).toMatchObject({ ok: true, withdrewBid: true });
    expect(await db.shiftBid.count({ where: { shiftId, workerId: mariaId } })).toBe(0);
  });
});
