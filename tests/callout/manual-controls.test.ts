import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFakeDb, createFakeState, type FakeStaff, type FakeState } from "./fake-db";

/**
 * Manual cascade control: advance / hold / resume / stop, plus the DB-authoritative
 * guarantee that a stopped campaign cannot be resurrected by a stale caller or by
 * the engine.
 */

const holder = vi.hoisted(() => ({ db: null as unknown as Record<string, unknown> }));
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_target, prop: string) => (holder.db as Record<string, unknown>)[prop],
    }
  ),
}));

import {
  advanceCampaignTier,
  holdCampaign,
  markCampaignFilled,
  resumeCampaign,
  startCalloutCampaign,
  stepCampaign,
  stopCampaign,
} from "@/lib/callout/campaign";

const SHIFT_START = new Date("2026-08-12T11:00:00Z");
const SHIFT_END = new Date("2026-08-12T19:00:00Z");

function staff(overrides: Partial<FakeStaff> & { id: string }): FakeStaff {
  return {
    name: overrides.id,
    email: `${overrides.id}@example.com`,
    phone: null,
    phoneVerifiedAt: null,
    seniorityRank: null,
    hireDate: null,
    departmentIds: [],
    availabilities: [],
    ...overrides,
  };
}

const AVAILABLE = {
  startsAt: SHIFT_START,
  endsAt: SHIFT_END,
  status: "AVAILABLE" as const,
};

/** One person per tier, so each tier's outreach is unambiguous. */
const POOL: FakeStaff[] = [
  staff({ id: "tier1-nurse", departmentIds: ["dept-er"], availabilities: [AVAILABLE] }),
  staff({ id: "tier2-nurse", departmentIds: ["dept-er"] }),
  staff({ id: "tier3-nurse", departmentIds: ["dept-icu"] }),
];

const SCHEDULER = { actorId: "scheduler-1" };

let state: FakeState;

beforeEach(() => {
  state = createFakeState({ staff: POOL });
  holder.db = createFakeDb(state) as unknown as Record<string, unknown>;
});

/** Distinct users reached in a given tier. */
function reachedInTier(tier: number): string[] {
  return Array.from(new Set(state.attempts.filter((a) => a.tier === tier).map((a) => a.userId)));
}

describe("starting a campaign", () => {
  it("opens tier 1 and contacts only the tier-1 candidates", async () => {
    await startCalloutCampaign(state.shift.id);

    expect(state.campaign?.status).toBe("RUNNING");
    expect(state.campaign?.currentTier).toBe(1);
    expect(state.campaign?.tier1EnteredAt).toBeInstanceOf(Date);
    expect(reachedInTier(1)).toEqual(["tier1-nurse"]);
    expect(reachedInTier(2)).toEqual([]);
    expect(state.activities.map((a) => a.action)).toContain("CALLOUT_STARTED");
  });

  it("is idempotent: re-running neither restarts the campaign nor re-contacts anyone", async () => {
    await startCalloutCampaign(state.shift.id);
    const firstEnteredAt = state.campaign?.tier1EnteredAt;
    const attemptCount = state.attempts.length;

    await startCalloutCampaign(state.shift.id);

    expect(state.campaign?.tier1EnteredAt).toBe(firstEnteredAt);
    expect(state.attempts.length).toBe(attemptCount);
  });
});

describe("empty tiers are skipped, not waited on", () => {
  it("starting with no tier-1 candidates widens straight to the first tier with people", async () => {
    state = createFakeState({
      staff: [staff({ id: "tier2-nurse", departmentIds: ["dept-er"] })],
    });
    holder.db = createFakeDb(state) as unknown as Record<string, unknown>;

    await startCalloutCampaign(state.shift.id);

    expect(state.campaign?.currentTier).toBe(2);
    expect(state.campaign?.status).toBe("RUNNING");
    expect(reachedInTier(2)).toEqual(["tier2-nurse"]);
  });

  it("a campaign with nobody to call anywhere ends EXHAUSTED instead of idling", async () => {
    state = createFakeState({ staff: [] });
    holder.db = createFakeDb(state) as unknown as Record<string, unknown>;

    await startCalloutCampaign(state.shift.id);

    expect(state.campaign?.status).toBe("EXHAUSTED");
    expect(state.attempts).toEqual([]);
  });
});

describe("advancing a tier", () => {
  beforeEach(async () => {
    await startCalloutCampaign(state.shift.id);
  });

  it("widens 1 -> 2 and contacts the tier-2 candidates", async () => {
    const result = await advanceCampaignTier(state.shift.id, SCHEDULER);

    expect(result).toMatchObject({ ok: true, currentTier: 2, status: "RUNNING" });
    expect(state.campaign?.tier2EnteredAt).toBeInstanceOf(Date);
    expect(reachedInTier(2)).toEqual(["tier2-nurse"]);
    expect(state.activities.map((a) => a.action)).toContain("CALLOUT_ESCALATED");
  });

  it("notifies the scheduler each time it widens", async () => {
    await advanceCampaignTier(state.shift.id, SCHEDULER);
    expect(state.notifications).toContainEqual(
      expect.objectContaining({ userId: "scheduler-1", type: "CALLOUT_ESCALATED" })
    );
  });

  it("widens 2 -> 3 and then closes as EXHAUSTED", async () => {
    await advanceCampaignTier(state.shift.id, SCHEDULER);
    await advanceCampaignTier(state.shift.id, SCHEDULER);
    expect(state.campaign?.currentTier).toBe(3);
    expect(reachedInTier(3)).toEqual(["tier3-nurse"]);

    const result = await advanceCampaignTier(state.shift.id, SCHEDULER);
    expect(result).toMatchObject({ ok: true, status: "EXHAUSTED" });
    expect(state.campaign?.endedAt).toBeInstanceOf(Date);
  });

  it("does not re-contact a tier that was already dispatched", async () => {
    await advanceCampaignTier(state.shift.id, SCHEDULER);
    const afterFirst = state.attempts.length;

    // Force the campaign back to tier 1 and advance again - the idempotency key
    // is (shift, tier, user, channel), so nobody is texted twice.
    state.campaign!.currentTier = 1;
    await advanceCampaignTier(state.shift.id, SCHEDULER);

    expect(state.attempts.length).toBe(afterFirst);
  });
});

describe("holding and resuming", () => {
  beforeEach(async () => {
    await startCalloutCampaign(state.shift.id);
  });

  it("hold pauses the campaign without changing the tier", async () => {
    const result = await holdCampaign(state.shift.id, SCHEDULER);
    expect(result).toMatchObject({ ok: true, status: "PAUSED", currentTier: 1 });
    expect(state.campaign?.endedAt).toBeNull();
  });

  it("a held campaign does not widen when the engine steps it, however late", async () => {
    await holdCampaign(state.shift.id, SCHEDULER);
    const decision = await stepCampaign(state.shift.id, new Date("2026-08-13T00:00:00Z"));

    expect(decision?.action).toBe("WAIT");
    expect(state.campaign?.currentTier).toBe(1);
    expect(reachedInTier(2)).toEqual([]);
  });

  it("resume restarts the current tier's window", async () => {
    await holdCampaign(state.shift.id, SCHEDULER);
    const before = state.campaign!.tier1EnteredAt;

    const result = await resumeCampaign(state.shift.id, SCHEDULER);

    expect(result).toMatchObject({ ok: true, status: "RUNNING" });
    expect(state.campaign!.tier1EnteredAt).not.toBe(before);
  });

  it("advancing while held lifts the hold - the scheduler is acting explicitly", async () => {
    await holdCampaign(state.shift.id, SCHEDULER);
    const result = await advanceCampaignTier(state.shift.id, SCHEDULER);
    expect(result).toMatchObject({ ok: true, status: "RUNNING", currentTier: 2 });
  });
});

describe("stopping", () => {
  beforeEach(async () => {
    await startCalloutCampaign(state.shift.id);
  });

  it("writes CANCELLED and stamps the end time", async () => {
    const result = await stopCampaign(state.shift.id, SCHEDULER);
    expect(result).toMatchObject({ ok: true, status: "CANCELLED" });
    expect(state.campaign?.endedAt).toBeInstanceOf(Date);
    expect(state.activities.map((a) => a.action)).toContain("CALLOUT_STOPPED");
  });

  it("refuses every further control action", async () => {
    await stopCampaign(state.shift.id, SCHEDULER);

    expect(await advanceCampaignTier(state.shift.id, SCHEDULER)).toEqual({
      ok: false,
      reason: "TERMINAL",
    });
    expect(await holdCampaign(state.shift.id, SCHEDULER)).toEqual({
      ok: false,
      reason: "TERMINAL",
    });
    expect(await resumeCampaign(state.shift.id, SCHEDULER)).toEqual({
      ok: false,
      reason: "TERMINAL",
    });
  });

  it("makes the engine no-op: a stopped campaign never sends more outreach", async () => {
    await stopCampaign(state.shift.id, SCHEDULER);
    const attemptCount = state.attempts.length;

    const decision = await stepCampaign(state.shift.id, new Date("2026-08-13T00:00:00Z"));

    expect(decision?.action).toBe("HALT");
    expect(state.attempts.length).toBe(attemptCount);
    expect(state.campaign?.currentTier).toBe(1);
  });
});

describe("filling", () => {
  beforeEach(async () => {
    await startCalloutCampaign(state.shift.id);
  });

  it("marks the campaign FILLED even though the shift is no longer OPEN", async () => {
    state.shift.status = "ASSIGNED";
    const result = await markCampaignFilled(state.shift.id, SCHEDULER);

    expect(result).toMatchObject({ ok: true, status: "FILLED" });
    expect(state.campaign?.filledAt).toBeInstanceOf(Date);
  });

  it("the engine closes the campaign out when it finds the shift assigned", async () => {
    state.shift.status = "ASSIGNED";
    const decision = await stepCampaign(state.shift.id, new Date("2026-08-13T00:00:00Z"));

    expect(decision?.action).toBe("FILL");
    expect(state.campaign?.status).toBe("FILLED");
  });
});

describe("the engine steps a running campaign", () => {
  it("advances once the tier-1 window has elapsed", async () => {
    await startCalloutCampaign(state.shift.id);
    state.campaign!.tier1EnteredAt = new Date("2026-08-12T09:00:00Z");

    const decision = await stepCampaign(state.shift.id, new Date("2026-08-12T09:20:00Z"));

    expect(decision?.action).toBe("ADVANCE");
    expect(state.campaign?.currentTier).toBe(2);
    expect(reachedInTier(2)).toEqual(["tier2-nurse"]);
  });

  it("raises a past-start reminder without expiring the callout", async () => {
    await startCalloutCampaign(state.shift.id);
    state.campaign!.tier1EnteredAt = new Date("2026-08-12T10:55:00Z");

    // 12:00 is after the 11:00 shift start.
    await stepCampaign(state.shift.id, new Date("2026-08-12T12:00:00Z"));

    expect(state.campaign?.pastStartReminderAt).toBeInstanceOf(Date);
    expect(state.notifications).toContainEqual(
      expect.objectContaining({ type: "CALLOUT_REMINDER", userId: "scheduler-1" })
    );
    // Not expired: the campaign is still live and has simply widened.
    expect(state.campaign?.status).toBe("RUNNING");
    expect(state.shift.status).toBe("OPEN");
  });

  it("raises the past-start reminder only once", async () => {
    await startCalloutCampaign(state.shift.id);
    state.campaign!.tier1EnteredAt = new Date("2026-08-12T10:55:00Z");

    await stepCampaign(state.shift.id, new Date("2026-08-12T12:00:00Z"));
    await stepCampaign(state.shift.id, new Date("2026-08-12T13:00:00Z"));

    const reminders = state.notifications.filter((n) => n.title === "Shift started unfilled");
    expect(reminders).toHaveLength(1);
  });
});
