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
  shiftDecline: { deleteMany: vi.fn() },
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  notification: { createMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

import { submitBid } from "@/lib/outreach/accept";

const HOUR_MS = 60 * 60 * 1000;
// Relative to now, never a fixed date: the bid window closes when the shift ends.
const SHIFT_START = new Date(Date.now() + 24 * HOUR_MS);

const OPEN_SHIFT = {
  id: "shift-1",
  title: "Emergency (ER) – Registered Nurse",
  status: "OPEN" as const,
  startsAt: SHIFT_START,
  endsAt: new Date(SHIFT_START.getTime() + 8 * HOUR_MS),
  roleNeeded: "Registered Nurse (RN)",
  campaign: { status: "RUNNING" as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.shift.findUnique.mockResolvedValue(OPEN_SHIFT);
  dbMock.shiftBid.upsert.mockImplementation(async ({ create }: any) => ({ id: "bid-1", ...create }));
  dbMock.outreachAttempt.updateMany.mockResolvedValue({ count: 1 });
  dbMock.shiftDecline.deleteMany.mockResolvedValue({ count: 0 });
  dbMock.user.findUnique.mockResolvedValue({ name: "Maria Santos", position: "Registered Nurse" });
  dbMock.user.findMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
  dbMock.notification.createMany.mockResolvedValue({ count: 2 });
});

describe("submitBid - the single accept path", () => {
  it("creates a FULL PENDING bid and notifies every admin", async () => {
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

    // Every ADMIN is notified (not just the poster), with the SMS channel hint.
    expect(dbMock.user.findMany).toHaveBeenCalledWith({
      where: { role: { in: ["ADMIN"] } },
      select: { id: true },
    });
    expect(dbMock.notification.createMany).toHaveBeenCalledTimes(1);
    const notifs = dbMock.notification.createMany.mock.calls[0][0].data;
    expect(notifs.map((n: { userId: string }) => n.userId)).toEqual(["admin-1", "admin-2"]);
    for (const notif of notifs) {
      expect(notif.type).toBe("BID_SUBMITTED");
      expect(notif.shiftId).toBe("shift-1");
      expect(notif.message).toBe("Maria Santos bid on Emergency (ER) – Registered Nurse by text.");
    }
  });

  it("marks a bid that arrives after outreach ended", async () => {
    dbMock.shift.findUnique.mockResolvedValue({ ...OPEN_SHIFT, campaign: { status: "CANCELLED" } });
    await submitBid({ shiftId: "shift-1", workerId: "worker-1", scope: "FULL", source: "IN_APP" });
    const [notif] = dbMock.notification.createMany.mock.calls[0][0].data;
    expect(notif.message).toBe(
      "Maria Santos bid on Emergency (ER) – Registered Nurse (outreach had ended)."
    );
  });

  it("marks the matching SMS OutreachAttempt as ACCEPTED", async () => {
    await submitBid({ shiftId: "shift-1", workerId: "worker-1", scope: "FULL", source: "SMS" });
    expect(dbMock.outreachAttempt.updateMany).toHaveBeenCalledWith({
      where: { shiftId: "shift-1", userId: "worker-1", channel: "SMS" },
      data: { response: "ACCEPTED", respondedAt: expect.any(Date) },
    });
  });

  it("takes back an earlier decline - the latest answer wins", async () => {
    await submitBid({ shiftId: "shift-1", workerId: "worker-1", scope: "FULL", source: "IN_APP" });
    expect(dbMock.shiftDecline.deleteMany).toHaveBeenCalledWith({
      where: { shiftId: "shift-1", userId: "worker-1" },
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
    expect(dbMock.notification.createMany).not.toHaveBeenCalled();
  });

  it("accepts after the shift has started, while it is still unfilled", async () => {
    dbMock.shift.findUnique.mockResolvedValue({
      ...OPEN_SHIFT,
      startsAt: new Date(Date.now() - HOUR_MS),
      endsAt: new Date(Date.now() + 7 * HOUR_MS),
    });
    const result = await submitBid({ shiftId: "shift-1", workerId: "w", scope: "FULL", source: "VOICE" });
    expect(result.ok).toBe(true);
  });

  it("rejects (no bid) once the shift has ended", async () => {
    dbMock.shift.findUnique.mockResolvedValue({
      ...OPEN_SHIFT,
      startsAt: new Date(Date.now() - 9 * HOUR_MS),
      endsAt: new Date(Date.now() - HOUR_MS),
    });
    const result = await submitBid({ shiftId: "shift-1", workerId: "w", scope: "FULL", source: "VOICE" });
    expect(result).toEqual({ ok: false, reason: "SHIFT_ENDED" });
    expect(dbMock.shiftBid.upsert).not.toHaveBeenCalled();
  });

  it("rejects a partial window outside the shift hours", async () => {
    const result = await submitBid({
      shiftId: "shift-1",
      workerId: "w",
      scope: "PARTIAL",
      source: "IN_APP",
      partialStartsAt: new Date(SHIFT_START.getTime() - HOUR_MS), // before shift start
      partialEndsAt: new Date(SHIFT_START.getTime() + 3 * HOUR_MS),
    });
    expect(result).toEqual({ ok: false, reason: "INVALID_WINDOW" });
  });

  it("rejects when the shift does not exist", async () => {
    dbMock.shift.findUnique.mockResolvedValue(null);
    const result = await submitBid({ shiftId: "nope", workerId: "w", scope: "FULL", source: "SMS" });
    expect(result).toEqual({ ok: false, reason: "SHIFT_NOT_FOUND" });
  });

  it("rejects (no bid) when the worker's position doesn't match the shift's required role", async () => {
    dbMock.user.findUnique.mockResolvedValue({ name: "Thomas Nguyen", position: "Personal Support Worker" });
    const result = await submitBid({ shiftId: "shift-1", workerId: "w", scope: "FULL", source: "IN_APP" });
    expect(result).toEqual({ ok: false, reason: "POSITION_MISMATCH" });
    expect(dbMock.shiftBid.upsert).not.toHaveBeenCalled();
    expect(dbMock.notification.createMany).not.toHaveBeenCalled();
  });

  it("still accepts a Lead RN-tagged RN - the tag never factors into position matching", async () => {
    // isTeamLead lives on User but submitBid never reads it; only position does.
    dbMock.user.findUnique.mockResolvedValue({
      name: "Maria Santos",
      position: "Registered Nurse",
      isTeamLead: true,
    });
    const result = await submitBid({ shiftId: "shift-1", workerId: "w", scope: "FULL", source: "IN_APP" });
    expect(result.ok).toBe(true);
  });
});
