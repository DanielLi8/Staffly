import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeDb, createFakeState, type FakeStaff, type FakeState } from "./fake-db";

/**
 * HARD CONSTRAINT: the demo must work with NO Inngest account.
 *
 * With INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY unset, posting a shift must still
 * open the callout and fire tier-1 outreach, and a scheduler must still be able
 * to advance, hold, and stop the cascade by hand. Only the AUTOMATIC timed
 * escalation is lost.
 */

const holder = vi.hoisted(() => ({ db: null as unknown as Record<string, unknown> }));
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    { get: (_target, prop: string) => (holder.db as Record<string, unknown>)[prop] }
  ),
}));

// The shift server action pulls in Next.js request-scoped helpers and the
// session; stub them so `createShift` itself can be exercised.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn().mockResolvedValue({ user: { id: "scheduler-1", role: "SCHEDULER" } }),
}));

import { createShift } from "@/app/actions/shifts";
import {
  advanceCampaignTier,
  holdCampaign,
  startCalloutCampaign,
  stopCampaign,
} from "@/lib/callout/campaign";
import { isInngestConfigured, sendCalloutEvent } from "@/lib/inngest/client";

const INNGEST_KEYS = ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"];

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

const POOL: FakeStaff[] = [
  staff({
    id: "tier1-nurse",
    departmentIds: ["dept-er"],
    availabilities: [{ startsAt: SHIFT_START, endsAt: SHIFT_END, status: "AVAILABLE" }],
  }),
  staff({ id: "tier2-nurse", departmentIds: ["dept-er"] }),
  staff({ id: "tier3-nurse", departmentIds: ["dept-icu"] }),
];

let state: FakeState;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  saved = {};
  for (const key of INNGEST_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  state = createFakeState({ staff: POOL });
  holder.db = createFakeDb(state) as unknown as Record<string, unknown>;
});

afterEach(() => {
  for (const key of INNGEST_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("Inngest config detection without credentials", () => {
  it("reports not configured", () => {
    expect(isInngestConfigured()).toBe(false);
  });

  it("publishing an event is a silent no-op rather than an error", async () => {
    await expect(
      sendCalloutEvent("callout/started", { shiftId: "shift-1", campaignId: "campaign-1" })
    ).resolves.toEqual({ sent: false });
  });
});

describe("posting a shift with no Inngest account", () => {
  it("creates the shift, opens the campaign, and fires tier-1 outreach", async () => {
    await createShift({
      unit: "4B",
      departmentId: "dept-er",
      roleNeeded: "Registered Nurse",
      location: "St. Michael's Hospital",
      startsAt: SHIFT_START,
      endsAt: SHIFT_END,
      bidDeadlineAt: new Date("2026-08-12T05:00:00Z"),
    });

    expect(state.shift.roleNeeded).toBe("Registered Nurse");
    expect(state.campaign).not.toBeNull();
    expect(state.campaign?.status).toBe("RUNNING");
    expect(state.campaign?.currentTier).toBe(1);

    // Tier 1 was actually reached, on the credential-free channels.
    const tier1 = state.attempts.filter((a) => a.tier === 1);
    expect(tier1.map((a) => a.userId)).toEqual(["tier1-nurse"]);
    expect(tier1.map((a) => a.channel).sort()).toEqual(["IN_APP"]);

    // Nobody outside tier 1 was contacted yet.
    expect(state.attempts.filter((a) => a.tier !== 1)).toEqual([]);

    expect(redirectMock).toHaveBeenCalledWith(`/admin/shifts/${state.shift.id}`);
  });
});

describe("manual cascade control with no Inngest account", () => {
  beforeEach(async () => {
    await startCalloutCampaign(state.shift.id);
  });

  it("advance works and reaches the next tier", async () => {
    const result = await advanceCampaignTier(state.shift.id, { actorId: "scheduler-1" });
    expect(result).toMatchObject({ ok: true, currentTier: 2 });
    expect(state.attempts.some((a) => a.tier === 2 && a.userId === "tier2-nurse")).toBe(true);
  });

  it("hold works", async () => {
    expect(await holdCampaign(state.shift.id, { actorId: "scheduler-1" })).toMatchObject({
      ok: true,
      status: "PAUSED",
    });
  });

  it("stop works and is authoritative", async () => {
    expect(await stopCampaign(state.shift.id, { actorId: "scheduler-1" })).toMatchObject({
      ok: true,
      status: "CANCELLED",
    });
    expect(await advanceCampaignTier(state.shift.id, { actorId: "scheduler-1" })).toEqual({
      ok: false,
      reason: "TERMINAL",
    });
  });

  it("drives the whole cascade to exhaustion by hand", async () => {
    const actor = { actorId: "scheduler-1" };
    await advanceCampaignTier(state.shift.id, actor);
    await advanceCampaignTier(state.shift.id, actor);
    const final = await advanceCampaignTier(state.shift.id, actor);

    expect(final).toMatchObject({ ok: true, status: "EXHAUSTED" });
    expect(
      Array.from(new Set(state.attempts.map((a) => a.tier))).sort()
    ).toEqual([1, 2, 3]);
  });
});
