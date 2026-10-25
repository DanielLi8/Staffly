import { describe, it, expect } from "vitest";
import {
  adminShiftRevision,
  hashRevision,
  type AdminShiftRevisionInputs,
} from "@/lib/live/revision";

/**
 * The admin-shift revision must move whenever anything the admin page shows
 * changes underneath it. These pin the hash's sensitivity to each input; the
 * SQL that gathers the inputs is exercised against Postgres in
 * tests/db/live-revision.db.test.ts and end to end in e2e/late-bid-live.spec.ts.
 */

const t = (seconds: number) => new Date(Date.UTC(2026, 9, 18, 12, 0, seconds));

const base: AdminShiftRevisionInputs = {
  shiftUpdatedAt: t(0),
  campaignUpdatedAt: t(1),
  bidCount: 1,
  bidsUpdatedAt: t(2),
  attemptCount: 3,
  attemptsUpdatedAt: t(3),
  declineCount: 1,
  declinesUpdatedAt: t(5),
  activityCount: 4,
};

const rev = (patch: Partial<AdminShiftRevisionInputs> = {}) => adminShiftRevision({ ...base, ...patch });

describe("adminShiftRevision", () => {
  it("is stable for unchanged data and short + URL-safe", () => {
    expect(rev()).toBe(rev());
    expect(rev()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it.each<[string, Partial<AdminShiftRevisionInputs>]>([
    ["a bid is created", { bidCount: 2, bidsUpdatedAt: t(10) }],
    ["a bid is withdrawn (deleted)", { bidCount: 0, bidsUpdatedAt: null }],
    ["a non-latest bid is withdrawn", { bidCount: 0 }],
    ["a bid is updated or awarded", { bidsUpdatedAt: t(10) }],
    ["the campaign transitions (stop, hold, advance, exhaust)", { campaignUpdatedAt: t(10) }],
    ["a campaign appears", { campaignUpdatedAt: null }],
    ["an outreach attempt gets a reply or delivery callback", { attemptsUpdatedAt: t(10) }],
    ["a tier dispatches new attempts", { attemptCount: 5, attemptsUpdatedAt: t(10) }],
    ["a worker declines", { declineCount: 2, declinesUpdatedAt: t(10) }],
    ["a decline is taken back by a later bid (deleted)", { declineCount: 0, declinesUpdatedAt: null }],
    ["an activity row is logged", { activityCount: 5 }],
    ["the shift itself changes (status, times, assignment)", { shiftUpdatedAt: t(10) }],
  ])("changes when %s", (_label, patch) => {
    expect(rev(patch)).not.toBe(rev());
  });

  it("keeps fields apart: equal values in different fields hash differently", () => {
    expect(rev({ bidCount: 3, attemptCount: 1 })).not.toBe(rev());
  });
});

describe("hashRevision", () => {
  it("ignores key order", () => {
    expect(hashRevision({ a: 1, b: t(0) })).toBe(hashRevision({ b: t(0), a: 1 }));
  });

  it("distinguishes null from a value", () => {
    expect(hashRevision({ a: null })).not.toBe(hashRevision({ a: 0 }));
  });
});
