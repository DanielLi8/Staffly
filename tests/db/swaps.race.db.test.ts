import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", async () => (await import("./race-helpers")).authModuleMock);
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { db } from "@/lib/db";
import { approveShiftSwapRequest, denyShiftSwapRequest } from "@/app/actions/shift-swap-approvals";
import {
  acceptShiftSwapRequest,
  createShiftSwapRequest,
  rejectShiftSwapRequest,
} from "@/app/actions/shift-swap";
import { as, cleanup, createFixtures, createShift, ROUNDS, wins, type RaceFixtures } from "./race-helpers";

/**
 * Shift Swap / Giveaway races against real Postgres (R8, R9, R14 in the plan,
 * plus the colleague's accept vs reject): every decision on a request, and
 * every reassignment of a shift, has exactly one winner.
 */

let f: RaceFixtures;

beforeAll(async () => {
  f = await createFixtures("swaps", 4);
});

afterAll(async () => {
  await cleanup(f);
  await db.$disconnect();
});

const swapNotes = (userIds: string[], since: Date) =>
  db.notification.findMany({
    where: { userId: { in: userIds }, createdAt: { gte: since }, type: { in: ["SWAP_APPROVED", "SWAP_DENIED"] } },
    select: { type: true },
  });

/** A giveaway of one of `from`'s shifts to `to`, already accepted by `to`. */
async function pendingGiveaway(from: { id: string }, to: { id: string }) {
  const shift = await createShift(f, { status: "ASSIGNED", assignedWorkerId: from.id });
  const request = await db.shiftSwapRequest.create({
    data: {
      requesterId: from.id,
      giveShiftId: shift.id,
      kind: "GIVEAWAY",
      targetUserId: to.id,
      status: "PENDING_APPROVAL",
      respondedAt: new Date(),
    },
  });
  return { shift, request };
}

describe("R8: one admin approves a giveaway while another denies it", () => {
  it("exactly one decision lands, and the parties hear only that one", async () => {
    const [a, b] = f.workers;
    for (let round = 0; round < ROUNDS; round++) {
      const { shift, request } = await pendingGiveaway(a, b);
      const since = new Date();

      const [approve, deny] = await Promise.all([
        as(f.sarah, () => approveShiftSwapRequest(request.id)),
        as(f.james, () => denyShiftSwapRequest(request.id)),
      ]);

      expect(wins([approve, deny])).toBe(1);
      const after = await db.shiftSwapRequest.findUniqueOrThrow({ where: { id: request.id } });
      const owner = (await db.shift.findUniqueOrThrow({ where: { id: shift.id } })).assignedWorkerId;
      const notes = (await swapNotes([a.id, b.id], since)).map((n) => n.type);
      if (approve.ok) {
        expect(after).toMatchObject({ status: "APPROVED", approvedById: f.sarah.id });
        expect(owner).toBe(b.id);
        expect(notes).toEqual(["SWAP_APPROVED", "SWAP_APPROVED"]);
        expect(deny).toEqual({ ok: false, error: `This request was just approved by ${f.sarah.name}.` });
      } else {
        expect(after).toMatchObject({ status: "DENIED", approvedById: f.james.id });
        expect(owner).toBe(a.id);
        expect(notes).toEqual(["SWAP_DENIED", "SWAP_DENIED"]);
        expect(approve).toEqual({ ok: false, error: `This request was just denied by ${f.james.name}.` });
      }
    }
  });
});

describe("R9: two approvals move the same shift", () => {
  it("two admins approving one request (a double click) reassign it once", async () => {
    const [a, b] = f.workers;
    for (let round = 0; round < ROUNDS; round++) {
      const { shift, request } = await pendingGiveaway(a, b);

      const results = await Promise.all([
        as(f.sarah, () => approveShiftSwapRequest(request.id)),
        as(f.james, () => approveShiftSwapRequest(request.id)),
      ]);

      expect(wins(results)).toBe(1);
      expect(await db.shiftActivity.count({ where: { shiftId: shift.id, action: "SHIFT_GIVEAWAY_REASSIGNED" } })).toBe(1);
    }
  });

  it("a giveaway and a swap that both take the same shift: one is approved, the other refused", async () => {
    const [a, b, c] = f.workers;
    for (let round = 0; round < ROUNDS; round++) {
      // A gives shift S to B; separately C offers C's shift T in exchange for S.
      const { shift: s, request: giveaway } = await pendingGiveaway(a, b);
      const t = await createShift(f, { status: "ASSIGNED", assignedWorkerId: c.id, hoursAhead: 60 });
      const swap = await db.shiftSwapRequest.create({
        data: {
          requesterId: c.id,
          giveShiftId: t.id,
          kind: "SWAP",
          targetUserId: a.id,
          receiveShiftId: s.id,
          status: "PENDING_APPROVAL",
          respondedAt: new Date(),
        },
      });

      const results = await Promise.all([
        as(f.sarah, () => approveShiftSwapRequest(giveaway.id)),
        as(f.james, () => approveShiftSwapRequest(swap.id)),
      ]);

      expect(wins(results)).toBe(1);
      const [sAfter, tAfter] = await Promise.all([
        db.shift.findUniqueOrThrow({ where: { id: s.id } }),
        db.shift.findUniqueOrThrow({ where: { id: t.id } }),
      ]);
      if (results[0].ok) {
        expect([sAfter.assignedWorkerId, tAfter.assignedWorkerId]).toEqual([b.id, c.id]);
        expect(results[1]).toEqual({ ok: false, error: "The receive shift is no longer valid for this request." });
        expect((await db.shiftSwapRequest.findUniqueOrThrow({ where: { id: swap.id } })).status).toBe("PENDING_APPROVAL");
      } else {
        expect([sAfter.assignedWorkerId, tAfter.assignedWorkerId]).toEqual([c.id, a.id]);
        expect(results[0]).toEqual({ ok: false, error: "The give shift is no longer valid for this request." });
        expect((await db.shiftSwapRequest.findUniqueOrThrow({ where: { id: giveaway.id } })).status).toBe(
          "PENDING_APPROVAL"
        );
      }
    }
  });
});

describe("R14: a worker submits the same giveaway twice at once (double tap)", () => {
  it("creates one active request", async () => {
    // A colleague who isn't picking up shifts elsewhere in this file, so the
    // 75-hour / 7-day pickup rules never refuse the request on their own.
    const [a, , , d] = f.workers;
    for (let round = 0; round < ROUNDS; round++) {
      const shift = await createShift(f, { status: "ASSIGNED", assignedWorkerId: a.id });
      const input = { giveShiftId: shift.id, kind: "GIVEAWAY" as const, targetUserId: d.id };

      const results = await Promise.all([
        as(a, () => createShiftSwapRequest(input)),
        as(a, () => createShiftSwapRequest(input)),
      ]);

      expect(wins(results)).toBe(1);
      expect(results.find((r) => !r.ok)).toEqual({
        ok: false,
        error: "This shift already has a pending swap request.",
      });
      expect(await db.shiftSwapRequest.count({ where: { giveShiftId: shift.id } })).toBe(1);
    }
  });
});

describe("the colleague accepts and rejects at once (two tabs)", () => {
  it("records exactly one answer", async () => {
    const [a, b] = f.workers;
    for (let round = 0; round < ROUNDS; round++) {
      const shift = await createShift(f, { status: "ASSIGNED", assignedWorkerId: a.id });
      const request = await db.shiftSwapRequest.create({
        data: { requesterId: a.id, giveShiftId: shift.id, kind: "GIVEAWAY", targetUserId: b.id },
      });

      const results = await Promise.all([
        as(b, () => acceptShiftSwapRequest(request.id)),
        as(b, () => rejectShiftSwapRequest(request.id)),
      ]);

      expect(wins(results)).toBe(1);
      const after = await db.shiftSwapRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(after.status).toBe(results[0].ok ? "PENDING_APPROVAL" : "REJECTED");
    }
  });
});
