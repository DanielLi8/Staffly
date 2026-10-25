import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", async () => (await import("./race-helpers")).authModuleMock);
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { db } from "@/lib/db";
import { assignWorker, cancelShift, editShiftTime } from "@/app/actions/shifts";
import { placeBid, withdrawBid } from "@/app/actions/bids";
import { recordDecline } from "@/lib/outreach/decline";
import { as, cleanup, createFixtures, createShift, ROUNDS, wins, type RaceFixtures } from "./race-helpers";

/**
 * Two admins (or an admin and a worker) acting on ONE shift at the same moment,
 * against real Postgres. Each pair of server actions is fired concurrently and
 * the test asserts exactly one of them took effect, the database is in a state
 * one of them alone could have produced, and the loser got a typed message.
 * Races R1-R4 and R13 in the access-control plan.
 */

let f: RaceFixtures;
const HOUR = 60 * 60 * 1000;

beforeAll(async () => {
  f = await createFixtures("shifts");
});

afterAll(async () => {
  await cleanup(f);
  await db.$disconnect();
});

async function openShiftWithBids(bidders: { id: string }[]) {
  const shift = await createShift(f);
  for (const w of bidders) await db.shiftBid.create({ data: { shiftId: shift.id, workerId: w.id } });
  return shift;
}

describe("R1: two admins award one shift to two different bidders", () => {
  it("awards it exactly once; the other admin is told who got it and from whom", async () => {
    const [a, b] = f.workers;
    for (let round = 0; round < ROUNDS; round++) {
      const shift = await openShiftWithBids([a, b]);

      const results = await Promise.all([
        as(f.sarah, () => assignWorker(shift.id, a.id)),
        as(f.james, () => assignWorker(shift.id, b.id)),
      ]);

      expect(wins(results)).toBe(1);
      const sarahWon = results[0].ok;
      const [winner, admin] = sarahWon ? [a, f.sarah] : [b, f.james];
      const loser = results[sarahWon ? 1 : 0];
      expect(loser).toEqual({
        ok: false,
        error: `This shift was just awarded to ${winner.name} by ${admin.name}.`,
      });

      const after = await db.shift.findUniqueOrThrow({ where: { id: shift.id }, include: { bids: true } });
      expect(after.status).toBe("ASSIGNED");
      expect(after.assignedWorkerId).toBe(winner.id);
      expect(after.bids.filter((x) => x.status === "SELECTED").map((x) => x.workerId)).toEqual([winner.id]);
      expect(await db.shiftActivity.count({ where: { shiftId: shift.id, action: "WORKER_ASSIGNED" } })).toBe(1);
      // Only the winning award notified anyone: one "assigned", one "not selected".
      const notes = await db.notification.findMany({
        where: { shiftId: shift.id, type: { in: ["BID_SELECTED", "BID_NOT_SELECTED"] } },
      });
      expect(notes.map((n) => `${n.userId}:${n.type}`).sort()).toEqual(
        [`${winner.id}:BID_SELECTED`, `${(winner.id === a.id ? b : a).id}:BID_NOT_SELECTED`].sort()
      );
    }
  });
});

describe("R2: an admin awards a bid while the worker withdraws it", () => {
  it("either the award or the withdrawal wins - never assigned with no bid", async () => {
    const [a] = f.workers;
    for (let round = 0; round < ROUNDS; round++) {
      const shift = await openShiftWithBids([a]);

      const [award, withdraw] = await Promise.all([
        as(f.sarah, () => assignWorker(shift.id, a.id)),
        as(a, () => withdrawBid(shift.id)),
      ]);

      expect(wins([award, withdraw])).toBe(1);
      const after = await db.shift.findUniqueOrThrow({ where: { id: shift.id }, include: { bids: true } });
      if (award.ok) {
        expect(after).toMatchObject({ status: "ASSIGNED", assignedWorkerId: a.id });
        expect(after.bids).toMatchObject([{ workerId: a.id, status: "SELECTED" }]);
        expect(withdraw).toMatchObject({ ok: false, error: expect.stringContaining("You were just awarded this shift") });
      } else {
        expect(after).toMatchObject({ status: "OPEN", assignedWorkerId: null });
        expect(after.bids).toEqual([]);
        expect(award).toEqual({
          ok: false,
          error: `${a.name} just withdrew their bid, so they can't be awarded this shift.`,
        });
      }
    }
  });
});

describe("an admin awards a bid while the worker declines the shift (SMS NO, IVR 2, app)", () => {
  it("either the award or the decline wins - never 'you declined' on a shift just given to you", async () => {
    const [a] = f.workers;
    for (let round = 0; round < ROUNDS; round++) {
      const shift = await openShiftWithBids([a]);

      const [award, decline] = await Promise.all([
        as(f.sarah, () => assignWorker(shift.id, a.id)),
        recordDecline({ shiftId: shift.id, workerId: a.id, source: "SMS" }),
      ]);

      expect(wins([award, decline])).toBe(1);
      const after = await db.shift.findUniqueOrThrow({ where: { id: shift.id }, include: { bids: true, declines: true } });
      if (award.ok) {
        expect(after).toMatchObject({ status: "ASSIGNED", assignedWorkerId: a.id });
        expect(after.declines).toEqual([]);
        expect(["BID_PROCESSED", "SHIFT_CLOSED"]).toContain((decline as { reason: string }).reason);
      } else {
        expect(after).toMatchObject({ status: "OPEN", assignedWorkerId: null, bids: [] });
        expect(after.declines).toMatchObject([{ userId: a.id }]);
      }
    }
  });
});

describe("R3: one admin awards while another cancels", () => {
  it("exactly one lands: never a cancelled shift resurrected as ASSIGNED, never an un-notified cancel", async () => {
    const [a] = f.workers;
    for (let round = 0; round < ROUNDS; round++) {
      const shift = await openShiftWithBids([a]);

      const [award, cancel] = await Promise.all([
        as(f.sarah, () => assignWorker(shift.id, a.id)),
        as(f.james, () => cancelShift(shift.id, shift.version)),
      ]);

      expect(wins([award, cancel])).toBe(1);
      const after = await db.shift.findUniqueOrThrow({ where: { id: shift.id } });
      const activity = await db.shiftActivity.findMany({ where: { shiftId: shift.id }, select: { action: true } });
      if (award.ok) {
        expect(after.status).toBe("ASSIGNED");
        expect(activity.map((x) => x.action)).not.toContain("SHIFT_CANCELLED");
        expect(cancel).toMatchObject({
          ok: false,
          error: expect.stringContaining(`This shift was just awarded to ${a.name} by ${f.sarah.name}.`),
        });
      } else {
        expect(after.status).toBe("CANCELLED");
        expect(after.assignedWorkerId).toBeNull();
        expect(activity.map((x) => x.action)).not.toContain("WORKER_ASSIGNED");
        expect(award).toEqual({ ok: false, error: `This shift was just cancelled by ${f.james.name}.` });
      }
    }
  });

  it("a cancel based on a stale page can't silently cancel a shift someone was just awarded", async () => {
    const [a] = f.workers;
    const shift = await openShiftWithBids([a]);
    expect(await as(f.sarah, () => assignWorker(shift.id, a.id))).toEqual({ ok: true });

    // James's page still shows the OPEN shift (version from before the award).
    const result = await as(f.james, () => cancelShift(shift.id, shift.version));
    expect(result.ok).toBe(false);
    expect((await db.shift.findUniqueOrThrow({ where: { id: shift.id } })).status).toBe("ASSIGNED");

    // With the current version the cancel goes through and the assignee is told.
    const current = await db.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(await as(f.james, () => cancelShift(shift.id, current.version))).toEqual({ ok: true });
    expect(
      await db.notification.count({ where: { shiftId: shift.id, userId: a.id, type: "SHIFT_CANCELLED" } })
    ).toBe(1);
    // A cancelled shift can't be cancelled again (canCancelShift, server-side).
    const cancelled = await db.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(await as(f.sarah, () => cancelShift(shift.id, cancelled.version))).toEqual({
      ok: false,
      error: "This shift is already cancelled.",
    });
  });
});

describe("R4: two admins edit one shift's hours", () => {
  it("the first save wins; the second is refused as stale instead of overwriting it", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const shift = await createShift(f);
      const sarahTimes = { startsAt: new Date(shift.startsAt.getTime() + HOUR), endsAt: shift.endsAt };
      const jamesTimes = { startsAt: shift.startsAt, endsAt: new Date(shift.endsAt.getTime() - HOUR) };

      const results = await Promise.all([
        as(f.sarah, () => editShiftTime({ shiftId: shift.id, ...sarahTimes, expectedVersion: shift.version })),
        as(f.james, () => editShiftTime({ shiftId: shift.id, ...jamesTimes, expectedVersion: shift.version })),
      ]);

      expect(wins(results)).toBe(1);
      const sarahWon = results[0].ok;
      const after = await db.shift.findUniqueOrThrow({ where: { id: shift.id } });
      expect({ startsAt: after.startsAt, endsAt: after.endsAt }).toEqual(sarahWon ? sarahTimes : jamesTimes);
      expect(after.version).toBe(shift.version + 1);
      expect(await db.shiftActivity.count({ where: { shiftId: shift.id, action: "SHIFT_TIME_EDITED" } })).toBe(1);
      const loser = results[sarahWon ? 1 : 0];
      expect(loser).toMatchObject({
        ok: false,
        formError: expect.stringContaining(`${(sarahWon ? f.sarah : f.james).name} just changed this shift's hours to`),
      });
    }
  });

  it("an edit racing a cancel never edits a cancelled shift", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const shift = await createShift(f);
      const results = await Promise.all([
        as(f.sarah, () =>
          editShiftTime({
            shiftId: shift.id,
            startsAt: shift.startsAt,
            endsAt: new Date(shift.endsAt.getTime() - HOUR),
            expectedVersion: shift.version,
          })
        ),
        as(f.james, () => cancelShift(shift.id, shift.version)),
      ]);

      expect(wins(results)).toBe(1);
      const after = await db.shift.findUniqueOrThrow({ where: { id: shift.id } });
      if (results[1].ok) {
        expect(after.status).toBe("CANCELLED");
        expect(after.endsAt).toEqual(shift.endsAt);
      } else {
        expect(after.status).toBe("OPEN");
      }
    }
  });
});

describe("R13: a worker bids while an admin awards the shift", () => {
  it("never leaves a PENDING bid on an awarded shift", async () => {
    const [a, , c] = f.workers;
    for (let round = 0; round < ROUNDS * 2; round++) {
      const shift = await openShiftWithBids([a]);

      const [award, bid] = await Promise.all([
        as(f.sarah, () => assignWorker(shift.id, a.id)),
        as(c, () => placeBid({ shiftId: shift.id, durationScope: "FULL" })),
      ]);

      expect(award).toEqual({ ok: true });
      const late = await db.shiftBid.findUnique({
        where: { shiftId_workerId: { shiftId: shift.id, workerId: c.id } },
      });
      if (bid.ok) {
        // The bid landed first, so the award saw it and closed it out.
        expect(late?.status).toBe("NOT_SELECTED");
      } else {
        expect(late).toBeNull();
        expect(bid.error).toBe("This shift is no longer accepting bids - it was just awarded or cancelled.");
      }
    }
  });
});
