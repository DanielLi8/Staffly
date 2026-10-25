import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", async () => (await import("./race-helpers")).authModuleMock);
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { db } from "@/lib/db";
import { advanceTier, holdCallout, stopCallout } from "@/app/actions/callout";
import {
  advanceCampaignTier,
  dispatchOpeningTier,
  raisePastStartReminder,
  runTierOutreach,
} from "@/lib/callout/campaign";
import { as, cleanup, createFixtures, createShift, ROUNDS, wins, type RaceFixtures } from "./race-helpers";

/**
 * Callout cascade races against real Postgres (R5-R7, R16 in the plan): Stop
 * vs Advance, two Advances, the engine and a scheduler dispatching at once, and
 * the past-start reminder. The fixture workers share a department and declared
 * no availability, so the cascade's tier 2 is exactly them (tier 1 and 3 are
 * empty unless a test adds availability); in-app outreach is a Notification
 * per contacted worker, which is what "contacted twice" is counted by.
 */

let f: RaceFixtures;

beforeAll(async () => {
  f = await createFixtures("cascade");
});

afterAll(async () => {
  await cleanup(f);
  await db.$disconnect();
});

/** A shift whose callout is RUNNING on tier 1, tier 1 already sent. */
async function runningCampaign(extra: { tier1DispatchAt?: Date; hoursAhead?: number } = {}) {
  const shift = await createShift(f, { hoursAhead: extra.hoursAhead });
  await db.calloutCampaign.create({
    data: {
      shiftId: shift.id,
      currentTier: 1,
      status: "RUNNING",
      tier1EnteredAt: extra.tier1DispatchAt ? null : new Date(),
      tier1DispatchAt: extra.tier1DispatchAt ?? null,
    },
  });
  return shift;
}

const contacts = (shiftId: string) => db.notification.count({ where: { shiftId, type: "NEW_SHIFT" } });
const campaignOf = (shiftId: string) => db.calloutCampaign.findUniqueOrThrow({ where: { shiftId } });

describe("R5: one admin stops outreach while another advances it", () => {
  it("Stop always wins: the callout ends stopped, and a losing advance contacts nobody", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const shift = await runningCampaign();

      const [stop, advance] = await Promise.all([
        as(f.sarah, () => stopCallout(shift.id)),
        as(f.james, () => advanceTier(shift.id, 1)),
      ]);

      expect(stop).toEqual({ ok: true });
      expect((await campaignOf(shift.id)).status).toBe("CANCELLED");
      if (!advance.ok) {
        expect(advance.error).toBe(`Outreach was just stopped by ${f.sarah.name}.`);
        expect(await db.outreachAttempt.count({ where: { shiftId: shift.id, tier: 2 } })).toBe(0);
        expect(await contacts(shift.id)).toBe(0);
      }
    }
  });

  it("nothing is sent once Stop has returned, even by an outreach run already under way", async () => {
    const shift = await runningCampaign();
    expect(await as(f.sarah, () => stopCallout(shift.id))).toEqual({ ok: true });

    // What an advance that read the campaign just before the Stop would do next.
    await runTierOutreach(shift.id, 2);
    expect(await db.outreachAttempt.count({ where: { shiftId: shift.id } })).toBe(0);
    expect(await contacts(shift.id)).toBe(0);
  });
});

describe("R6: two admins click Advance on the same tier", () => {
  it("the callout moves one tier, once; the second admin is told it already moved", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const shift = await runningCampaign();

      const results = await Promise.all([
        as(f.sarah, () => advanceTier(shift.id, 1)),
        as(f.james, () => advanceTier(shift.id, 1)),
      ]);

      expect(wins(results)).toBe(1);
      const winner = results[0].ok ? f.sarah : f.james;
      expect(results.find((r) => !r.ok)).toEqual({
        ok: false,
        error: `${winner.name} just advanced this callout to tier 2.`,
      });
      const campaign = await campaignOf(shift.id);
      expect(campaign).toMatchObject({ status: "RUNNING", currentTier: 2 });
      expect(await db.shiftActivity.count({ where: { shiftId: shift.id, action: "CALLOUT_ESCALATED" } })).toBe(1);
      expect(await contacts(shift.id)).toBe(f.workers.length);
    }
  });

  it("the engine never lifts a hold that landed after it decided to advance", async () => {
    const shift = await runningCampaign();
    expect(await as(f.sarah, () => holdCallout(shift.id))).toEqual({ ok: true });

    const engine = await advanceCampaignTier(shift.id, { actorId: f.sarah.id, automatic: true }, { fromTier: 1 });
    expect(engine).toEqual({ ok: false, reason: "CHANGED" });
    expect(await campaignOf(shift.id)).toMatchObject({ status: "PAUSED", currentTier: 1 });
    expect(await contacts(shift.id)).toBe(0);
  });
});

describe("R7: the same tier dispatched twice at once (engine retry, concurrent advance)", () => {
  it("contacts each person once per channel", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const shift = await runningCampaign();
      await db.calloutCampaign.update({ where: { shiftId: shift.id }, data: { currentTier: 2 } });

      await Promise.all([runTierOutreach(shift.id, 2), runTierOutreach(shift.id, 2), runTierOutreach(shift.id, 2)]);

      expect(await contacts(shift.id)).toBe(f.workers.length);
      const perWorker = await db.notification.groupBy({
        by: ["userId"],
        where: { shiftId: shift.id, type: "NEW_SHIFT" },
        _count: true,
      });
      expect(perWorker.every((g) => g._count === 1)).toBe(true);
    }
  });

  it("the held-back opening tier goes out exactly once when two callers dispatch it", async () => {
    // Make the fixture workers tier 1 (available) so tier 1 is not skipped.
    for (let round = 0; round < ROUNDS; round++) {
      const shift = await runningCampaign({ tier1DispatchAt: new Date(Date.now() - 1000) });
      await db.availability.createMany({
        data: f.workers.map((w) => ({
          userId: w.id,
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          status: "AVAILABLE" as const,
        })),
      });
      const engine = { actorId: f.sarah.id, automatic: true };

      await Promise.all([dispatchOpeningTier(shift.id, engine), dispatchOpeningTier(shift.id, engine)]);

      expect(await db.shiftActivity.count({ where: { shiftId: shift.id, action: "CALLOUT_TIER1_SENT" } })).toBe(1);
      expect(await campaignOf(shift.id)).toMatchObject({ currentTier: 1, tier1DispatchAt: null });
      expect(await contacts(shift.id)).toBe(f.workers.length);
      await db.availability.deleteMany({ where: { userId: { in: f.workers.map((w) => w.id) } } });
    }
  });
});

describe("R16: the past-start reminder raised by two engine steps at once", () => {
  it("reminds the scheduler once", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const shift = await runningCampaign({ hoursAhead: -1 });

      const raised = await Promise.all([raisePastStartReminder(shift.id), raisePastStartReminder(shift.id)]);

      expect(raised.filter(Boolean)).toHaveLength(1);
      expect(
        await db.notification.count({
          where: { shiftId: shift.id, userId: f.sarah.id, title: "Shift started unfilled" },
        })
      ).toBe(1);
      expect(await db.shiftActivity.count({ where: { shiftId: shift.id, action: "CALLOUT_PAST_START" } })).toBe(1);
    }
  });
});
