import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { liveRevision } from "@/lib/live/revision";
import type { LiveTopic } from "@/lib/live/topics";
import { submitBid } from "@/lib/outreach/accept";
import { startCalloutCampaign, stopCampaign } from "@/lib/callout/campaign";

/**
 * The admin-shift revision against real Postgres: each write below goes through
 * the same code (or the same Prisma call) the app uses, and the revision must
 * move after every one. This is what proves the SQL in revision.ts reads the
 * right columns and that `@updatedAt` ticks on the `updateMany`s the webhooks
 * use - the pure hash tests can't.
 *
 * Runs only via `pnpm test:db`, against a SEEDED, DISPOSABLE database in
 * DATABASE_URL (CI's e2e database). It creates one shift and deletes it after.
 */

const HOUR = 60 * 60 * 1000;

let shiftId: string;
let topic: LiveTopic;
let adminId: string;
let davidId: string;
let mariaId: string;

const revision = () => liveRevision(topic);

beforeAll(async () => {
  const [admin, david, maria, er] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: "admin@staffly.com" } }),
    db.user.findUniqueOrThrow({ where: { email: "worker2@staffly.com" } }),
    db.user.findUniqueOrThrow({ where: { email: "worker1@staffly.com" } }),
    db.department.findUniqueOrThrow({ where: { code: "ER" } }),
  ]);
  adminId = admin.id;
  davidId = david.id;
  mariaId = maria.id;

  const startsAt = new Date(Date.now() + 24 * HOUR);
  const shift = await db.shift.create({
    data: {
      title: "Live revision DB test",
      unit: "4B",
      departmentId: er.id,
      roleNeeded: "Registered Nurse (RN)",
      location: "tests/db/live-revision",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 12 * HOUR),
      bidDeadlineAt: new Date(startsAt.getTime() - 6 * HOUR),
      createdById: adminId,
    },
  });
  shiftId = shift.id;
  topic = { kind: "admin-shift", shiftId };
  await startCalloutCampaign(shiftId);
});

afterAll(async () => {
  if (shiftId) {
    await db.notification.deleteMany({ where: { shiftId } });
    await db.shift.delete({ where: { id: shiftId } });
  }
  await db.$disconnect();
});

describe("admin-shift revision (Postgres)", () => {
  it("is null for a shift that does not exist", async () => {
    expect(await liveRevision({ kind: "admin-shift", shiftId: "does-not-exist" })).toBeNull();
  });

  it("is stable while nothing changes", async () => {
    const r = await revision();
    expect(r).toEqual(expect.any(String));
    expect(await revision()).toBe(r);
  });

  it("changes when a bid is created", async () => {
    const before = await revision();
    const result = await submitBid({ shiftId, workerId: davidId, scope: "FULL", source: "IN_APP" });
    expect(result.ok).toBe(true);
    expect(await revision()).not.toBe(before);
  });

  it("changes when a bid is updated in place", async () => {
    const before = await revision();
    await submitBid({ shiftId, workerId: davidId, scope: "FULL", source: "IN_APP", note: "Can stay late" });
    expect(await revision()).not.toBe(before);
  });

  it("changes when a bid is withdrawn", async () => {
    const before = await revision();
    // Exactly what withdrawBid does.
    await db.shiftBid.delete({ where: { shiftId_workerId: { shiftId, workerId: davidId } } });
    expect(await revision()).not.toBe(before);
  });

  it("changes when the campaign transitions (Stop)", async () => {
    const before = await revision();
    const result = await stopCampaign(shiftId, { actorId: adminId });
    expect(result).toMatchObject({ ok: true });
    expect((await db.calloutCampaign.findUniqueOrThrow({ where: { shiftId } })).status).toBe("CANCELLED");
    expect(await revision()).not.toBe(before);
  });

  it("changes when an outreach attempt gets a delivery callback, then a reply", async () => {
    await db.outreachAttempt.create({
      data: { shiftId, userId: mariaId, channel: "SMS", tier: 1, status: "SENT", providerMessageId: `SM-live-${shiftId}` },
    });

    const beforeCallback = await revision();
    // What the Twilio status webhook does.
    await db.outreachAttempt.updateMany({
      where: { providerMessageId: `SM-live-${shiftId}` },
      data: { status: "DELIVERED" },
    });
    const afterCallback = await revision();
    expect(afterCallback).not.toBe(beforeCallback);

    // An SMS reply after Stop: submitBid records the bid and marks the attempt.
    const result = await submitBid({ shiftId, workerId: mariaId, scope: "FULL", source: "SMS" });
    expect(result.ok).toBe(true);
    const attempt = await db.outreachAttempt.findFirstOrThrow({ where: { shiftId, userId: mariaId, channel: "SMS" } });
    expect(attempt.response).toBe("ACCEPTED");
    expect(attempt.updatedAt.getTime()).toBeGreaterThan(attempt.createdAt.getTime());
    expect(await revision()).not.toBe(afterCallback);
  });

  it("changes when only an attempt's reply is recorded", async () => {
    const before = await revision();
    // The attempt half of submitBid on its own, so the bid upsert can't be what moved it.
    await db.outreachAttempt.updateMany({
      where: { shiftId, userId: mariaId, channel: "SMS" },
      data: { response: "DECLINED", respondedAt: new Date() },
    });
    expect(await revision()).not.toBe(before);
  });
});
