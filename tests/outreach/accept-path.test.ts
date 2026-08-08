import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The single accept path (submitBid) is what in-app bids, SMS replies, and IVR
 * key-presses all funnel through. We mock the Prisma client so we can assert the
 * exact ShiftBid upsert and the scheduler notification without a live DB.
 */
const dbMock = vi.hoisted(() => ({
  shift: { findUnique: vi.fn() },
  shiftBid: { upsert: vi.fn() },
  outreachAttempt: { updateMany: vi.fn() },
  user: { findUnique: vi.fn() },
  notification: { create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

import { submitBid } from "@/lib/outreach/accept";

const OPEN_SHIFT = {
  id: "shift-1",
  title: "Emergency (ER) – Registered Nurse",
  status: "OPEN" as const,
  bidDeadlineAt: new Date(Date.now() + 60 * 60 * 1000),
  createdById: "scheduler-1",
  startsAt: new Date("2026-08-10T07:00:00Z"),
  endsAt: new Date("2026-08-10T15:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.shift.findUnique.mockResolvedValue(OPEN_SHIFT);
  dbMock.shiftBid.upsert.mockImplementation(async ({ create }: any) => ({ id: "bid-1", ...create }));
  dbMock.outreachAttempt.updateMany.mockResolvedValue({ count: 1 });
  dbMock.user.findUnique.mockResolvedValue({ name: "Maria Santos" });
  dbMock.notification.create.mockResolvedValue({});
});

describe("submitBid - the single accept path", () => {
  it("creates a FULL PENDING bid and notifies the scheduler", async () => {
    const result = await submitBid({
      shiftId: "shift-1",
      workerId: "worker-1",
      scope: "FULL",
      source: "SMS",
    });

    expect(result).toEqual({ ok: true, bid: expect.objectContaining({ id: "bid-1" }) });

    const upsertArg = dbMock.shiftBid.upsert.mock.calls[0][0];
    expect(upsertArg.where).toEqual({ shiftId_workerId: { shiftId: "shift-1", workerId: "worker-1" } });
    expect(upsertArg.create).toMatchObject({
      shiftId: "shift-1",
      workerId: "worker-1",
      durationScope: "FULL",
      status: "PENDING",
    });

    // Scheduler (shift.createdById) is notified, with the SMS channel hint.
    expect(dbMock.notification.create).toHaveBeenCalledTimes(1);
    const notif = dbMock.notification.create.mock.calls[0][0].data;
    expect(notif.userId).toBe("scheduler-1");
    expect(notif.type).toBe("BID_SUBMITTED");
    expect(notif.shiftId).toBe("shift-1");
    expect(notif.message).toContain("Maria Santos");
    expect(notif.message).toContain("by text");
  });

  it("marks the matching SMS OutreachAttempt as ACCEPTED", async () => {
    await submitBid({ shiftId: "shift-1", workerId: "worker-1", scope: "FULL", source: "SMS" });
    expect(dbMock.outreachAttempt.updateMany).toHaveBeenCalledWith({
      where: { shiftId: "shift-1", userId: "worker-1", channel: "SMS" },
      data: { response: "ACCEPTED", respondedAt: expect.any(Date) },
    });
  });

  it("records a PARTIAL bid when the scope is partial", async () => {
    await submitBid({ shiftId: "shift-1", workerId: "worker-1", scope: "PARTIAL", source: "VOICE" });
    expect(dbMock.shiftBid.upsert.mock.calls[0][0].create.durationScope).toBe("PARTIAL");
  });

  it("does not update an OutreachAttempt for an in-app bid (no channel)", async () => {
    await submitBid({ shiftId: "shift-1", workerId: "worker-1", scope: "FULL", source: "IN_APP" });
    expect(dbMock.outreachAttempt.updateMany).not.toHaveBeenCalled();
  });

  it("rejects (no bid) when the shift is closed", async () => {
    dbMock.shift.findUnique.mockResolvedValue({ ...OPEN_SHIFT, status: "ASSIGNED" });
    const result = await submitBid({ shiftId: "shift-1", workerId: "w", scope: "FULL", source: "SMS" });
    expect(result).toEqual({ ok: false, reason: "SHIFT_CLOSED" });
    expect(dbMock.shiftBid.upsert).not.toHaveBeenCalled();
    expect(dbMock.notification.create).not.toHaveBeenCalled();
  });

  it("rejects when the bid deadline has passed", async () => {
    dbMock.shift.findUnique.mockResolvedValue({
      ...OPEN_SHIFT,
      bidDeadlineAt: new Date(Date.now() - 1000),
    });
    const result = await submitBid({ shiftId: "shift-1", workerId: "w", scope: "FULL", source: "VOICE" });
    expect(result).toEqual({ ok: false, reason: "DEADLINE_PASSED" });
  });

  it("rejects a partial window outside the shift hours", async () => {
    const result = await submitBid({
      shiftId: "shift-1",
      workerId: "w",
      scope: "PARTIAL",
      source: "IN_APP",
      partialStartsAt: new Date("2026-08-10T06:00:00Z"), // before shift start
      partialEndsAt: new Date("2026-08-10T10:00:00Z"),
    });
    expect(result).toEqual({ ok: false, reason: "INVALID_WINDOW" });
  });

  it("rejects when the shift does not exist", async () => {
    dbMock.shift.findUnique.mockResolvedValue(null);
    const result = await submitBid({ shiftId: "nope", workerId: "w", scope: "FULL", source: "SMS" });
    expect(result).toEqual({ ok: false, reason: "SHIFT_NOT_FOUND" });
  });
});
