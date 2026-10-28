import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What deactivating a staff account (src/app/actions/staff.ts) does to the
 * rest of the app: the callout cascade never loads them and the single accept
 * path refuses their bid on every channel.
 */
const dbMock = vi.hoisted(() => ({
  shift: { findUnique: vi.fn() },
  shiftBid: { upsert: vi.fn() },
  user: { findUnique: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import { submitBid } from "@/lib/outreach/accept";
import { loadTierCandidates } from "@/lib/callout/campaign";

const start = new Date(Date.now() + 24 * 3_600_000);
const SHIFT = {
  id: "shift-1",
  title: "ER – Registered Nurse",
  status: "OPEN" as const,
  startsAt: start,
  endsAt: new Date(start.getTime() + 8 * 3_600_000),
  roleNeeded: "Registered Nurse (RN)",
  campaign: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.shift.findUnique.mockResolvedValue(SHIFT);
  dbMock.user.findMany.mockResolvedValue([]);
});

describe("a deactivated account", () => {
  it("can't bid, whatever the channel", async () => {
    dbMock.user.findUnique.mockResolvedValue({
      name: "Maria",
      position: "Registered Nurse",
      deactivatedAt: new Date(),
    });
    for (const source of ["IN_APP", "SMS", "VOICE"] as const) {
      const result = await submitBid({ shiftId: "shift-1", workerId: "w1", scope: "FULL", source });
      expect(result).toEqual({ ok: false, reason: "ACCOUNT_DEACTIVATED" });
    }
    expect(dbMock.shiftBid.upsert).not.toHaveBeenCalled();
  });

  it("is never loaded as a callout candidate", async () => {
    await loadTierCandidates(SHIFT);
    expect(dbMock.user.findMany.mock.calls[0][0].where).toEqual({ role: "STAFF", deactivatedAt: null });
  });
});
