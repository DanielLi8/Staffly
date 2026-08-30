import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFakeDb, createFakeState, type FakeStaff, type FakeState } from "./fake-db";

/**
 * The posting delay, at the service level.
 *
 * Two properties matter and both are asserted against the database state rather
 * than against a clock we control in-process:
 *   1. posting a shift contacts NOBODY - it only records when tier 1 falls due;
 *   2. anything that pulls the shift inside that window (stop, cancel, fill)
 *      means no message is ever sent, because the campaign row is re-read at
 *      dispatch time and it, not the timer, is the source of truth.
 *
 * Inngest is stubbed as CONFIGURED here: that is the deployed shape, where the
 * durable timer owns the wait. tests/callout/no-inngest.test.ts covers the
 * credential-free fallback, where posting dispatches straight away.
 */

const holder = vi.hoisted(() => ({ db: null as unknown as Record<string, unknown> }));
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    { get: (_target, prop: string) => (holder.db as Record<string, unknown>)[prop] }
  ),
}));

vi.mock("@/lib/inngest/client", () => ({
  isInngestConfigured: () => true,
  sendCalloutEvent: vi.fn().mockResolvedValue({ sent: true }),
}));

// `createShift` pulls in Next.js request-scoped helpers and the session.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn().mockResolvedValue({ user: { id: "scheduler-1", role: "ADMIN" } }),
}));

import { createShift } from "@/app/actions/shifts";
import {
  advanceCampaignTier,
  dispatchOpeningTier,
  holdCampaign,
  markCampaignFilled,
  resumeCampaign,
  startCalloutCampaign,
  stepCampaign,
  stopCampaign,
  TIER1_DISPATCH_DELAY_SECONDS,
} from "@/lib/callout/campaign";

// Computed relative to the real clock (not a fixed calendar date) so this
// suite never goes stale: a hardcoded near-future date eventually becomes a
// past date as real time passes, which fails validateShiftTimes's
// deadlineInPast/endBeforeStart checks in createShift.
const SHIFT_START = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
const SHIFT_END = new Date(SHIFT_START.getTime() + 8 * 60 * 60 * 1000);

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

const POOL: FakeStaff[] = [
  staff({
    id: "tier1-nurse",
    departmentIds: ["dept-er"],
    availabilities: [{ startsAt: SHIFT_START, endsAt: SHIFT_END, status: "AVAILABLE" }],
  }),
  staff({ id: "tier2-nurse", departmentIds: ["dept-er"] }),
  staff({ id: "tier3-nurse", departmentIds: ["dept-icu"] }),
];

const SCHEDULER = { actorId: "scheduler-1" };

let state: FakeState;

beforeEach(() => {
  vi.clearAllMocks();
  state = createFakeState({ staff: POOL, shift: { startsAt: SHIFT_START, endsAt: SHIFT_END } });
  holder.db = createFakeDb(state) as unknown as Record<string, unknown>;
});

/** When the held-back tier-1 outreach falls due. Fails loudly if it is not held. */
function dispatchDue(): Date {
  const due = state.campaign?.tier1DispatchAt;
  if (!due) throw new Error("expected tier-1 outreach to still be pending");
  return due;
}

/** A moment `seconds` either side of the dispatch deadline. */
function around(seconds: number): Date {
  return new Date(dispatchDue().getTime() + seconds * 1000);
}

describe("posting a shift holds the opening outreach", () => {
  it("opens the campaign without contacting anyone", async () => {
    await createShift({
      unit: "4B",
      departmentId: "dept-er",
      roleNeeded: "Registered Nurse",
      location: "St. Michael's Hospital",
      startsAt: SHIFT_START,
      endsAt: SHIFT_END,
      bidDeadlineAt: new Date(SHIFT_START.getTime() - 6 * 60 * 60 * 1000),
    });

    expect(state.campaign?.status).toBe("RUNNING");
    expect(state.campaign?.currentTier).toBe(1);
    // The whole point: no SMS, no call, no email, on any channel.
    expect(state.attempts).toEqual([]);
    // ...and the tier window has not started either, so nothing can escalate.
    expect(state.campaign?.tier1EnteredAt).toBeNull();
  });

  it("records the deadline in the database, roughly a minute out", async () => {
    await startCalloutCampaign(state.shift.id);

    const heldForMs = dispatchDue().getTime() - state.campaign!.startedAt.getTime();
    expect(heldForMs).toBe(TIER1_DISPATCH_DELAY_SECONDS * 1000);
    expect(TIER1_DISPATCH_DELAY_SECONDS).toBeGreaterThanOrEqual(30);
  });
});

describe("the delay elapses and the outreach goes out", () => {
  beforeEach(async () => {
    await startCalloutCampaign(state.shift.id);
  });

  it("still contacts nobody a second before the deadline", async () => {
    const decision = await stepCampaign(state.shift.id, around(-1));

    expect(decision?.action).toBe("WAIT");
    expect(state.attempts).toEqual([]);
  });

  it("dispatches tier 1 once the deadline passes", async () => {
    const decision = await stepCampaign(state.shift.id, around(0));

    expect(decision?.action).toBe("DISPATCH");
    expect(state.attempts.map((a) => a.userId)).toEqual(["tier1-nurse"]);
    expect(state.attempts.every((a) => a.tier === 1)).toBe(true);
    // The tier-1 window starts when the outreach actually went out, not at post.
    expect(state.campaign?.tier1EnteredAt).toBeInstanceOf(Date);
    expect(state.campaign?.tier1DispatchAt).toBeNull();
    expect(state.activities.map((a) => a.action)).toContain("CALLOUT_TIER1_SENT");
  });

  it("dispatches exactly once even if the engine steps again", async () => {
    const due = dispatchDue();
    await stepCampaign(state.shift.id, due);
    const enteredAt = state.campaign!.tier1EnteredAt;
    const attemptCount = state.attempts.length;

    await stepCampaign(state.shift.id, new Date(due.getTime() + 1000));

    expect(state.campaign!.tier1EnteredAt).toBe(enteredAt);
    expect(state.attempts.length).toBe(attemptCount);
  });

  it("widens straight past an empty tier 1 at dispatch time", async () => {
    state = createFakeState({
      staff: [staff({ id: "tier2-nurse", departmentIds: ["dept-er"] })],
      shift: { startsAt: SHIFT_START, endsAt: SHIFT_END },
    });
    holder.db = createFakeDb(state) as unknown as Record<string, unknown>;
    await startCalloutCampaign(state.shift.id);

    await stepCampaign(state.shift.id, around(0));

    expect(state.campaign?.currentTier).toBe(2);
    expect(state.attempts.map((a) => a.userId)).toEqual(["tier2-nurse"]);
  });
});

describe("cancelling inside the window means nobody is ever contacted", () => {
  beforeEach(async () => {
    await startCalloutCampaign(state.shift.id);
  });

  it("a stopped cascade never dispatches, however late the timer fires", async () => {
    const due = dispatchDue();
    await stopCampaign(state.shift.id, SCHEDULER);

    const decision = await stepCampaign(state.shift.id, new Date(due.getTime() + 3_600_000));

    expect(decision?.action).toBe("HALT");
    expect(state.attempts).toEqual([]);
  });

  it("a cancelled shift never dispatches", async () => {
    const due = dispatchDue();
    // What cancelShift() writes: the shift closes and the campaign follows.
    state.shift.status = "CANCELLED";
    state.campaign!.status = "CANCELLED";

    const decision = await stepCampaign(state.shift.id, new Date(due.getTime() + 1000));

    expect(decision?.action).toBe("HALT");
    expect(state.attempts).toEqual([]);
  });

  it("a shift filled inside the window never dispatches", async () => {
    const due = dispatchDue();
    state.shift.status = "ASSIGNED";
    await markCampaignFilled(state.shift.id, SCHEDULER);

    const decision = await stepCampaign(state.shift.id, new Date(due.getTime() + 1000));

    expect(decision?.action).toBe("FILL");
    expect(state.attempts).toEqual([]);
  });

  it("a direct dispatch call is refused too - the DB row is the guard, not the timer", async () => {
    await stopCampaign(state.shift.id, SCHEDULER);

    expect(await dispatchOpeningTier(state.shift.id, SCHEDULER)).toEqual({
      ok: false,
      reason: "TERMINAL",
    });
    expect(state.attempts).toEqual([]);
  });
});

describe("scheduler controls during the window", () => {
  beforeEach(async () => {
    await startCalloutCampaign(state.shift.id);
  });

  it("holding keeps the outreach held past its deadline", async () => {
    await holdCampaign(state.shift.id, SCHEDULER);

    const decision = await stepCampaign(state.shift.id, around(60));

    expect(decision?.action).toBe("WAIT");
    expect(state.attempts).toEqual([]);
    expect(state.campaign?.tier1DispatchAt).toBeInstanceOf(Date);
  });

  it("resuming restarts the delay rather than stranding the pending outreach", async () => {
    const originalDue = dispatchDue();
    await holdCampaign(state.shift.id, SCHEDULER);

    await resumeCampaign(state.shift.id, SCHEDULER);

    expect(state.campaign?.status).toBe("RUNNING");
    expect(state.campaign?.tier1EnteredAt).toBeNull();
    expect(dispatchDue().getTime()).toBeGreaterThanOrEqual(originalDue.getTime());
  });

  it("advancing inside the window sends tier 1 as well - widening means more reach, not less", async () => {
    const result = await advanceCampaignTier(state.shift.id, SCHEDULER);

    expect(result).toMatchObject({ ok: true, currentTier: 2 });
    expect(state.campaign?.tier1DispatchAt).toBeNull();
    const reached = new Set(state.attempts.map((a) => a.userId));
    expect(reached).toEqual(new Set(["tier1-nurse", "tier2-nurse"]));
  });
});
