// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";
import type { CampaignStatus, ShiftStatus } from "@prisma/client";
import { createFakeDb, createFakeState, type FakeStaff, type FakeState } from "./fake-db";

/**
 * Bidding outlives outreach. The captain's scenario: advance a callout to tier
 * 3, press "Stop outreach" - and people must still be able to bid, on every
 * channel, until the shift is awarded or cancelled. The same holds when the
 * tiers simply run out (engine exhaustion, or "Close as exhausted").
 *
 * This pins it: `bidAcceptance` is gated on the shift alone, never on the
 * campaign, and an award after outreach has ended still closes the campaign out
 * as FILLED.
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

// A stand-in Twilio client: outreach "sends" are recorded, never leave the process.
const twilioSends = vi.hoisted(() => ({
  messages: { create: vi.fn().mockResolvedValue({ sid: "SM-stub" }) },
  calls: { create: vi.fn().mockResolvedValue({ sid: "CA-stub" }) },
}));
vi.mock("@/lib/outreach/twilio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/outreach/twilio")>()),
  getTwilioClient: () => twilioSends,
  twilioConfig: () => ({ fromNumber: "+15550000000" }),
}));

vi.mock("@/lib/inngest/client", () => ({
  isInngestConfigured: () => false,
  sendCalloutEvent: vi.fn().mockResolvedValue({ sent: false }),
}));

import {
  advanceCampaignTier,
  markCampaignFilled,
  startCalloutCampaign,
  stepCampaign,
  stopCampaign,
} from "@/lib/callout/campaign";
import { submitBid, type BidSource } from "@/lib/outreach/accept";
import { bidAcceptance } from "@/lib/shifts/bid-window";
import { POST as inboundSmsPost } from "@/app/api/webhooks/twilio/inbound-sms/route";
import { POST as voiceResponsePost } from "@/app/api/webhooks/twilio/voice-response/route";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

// Relative to now, never fixed dates: the bid window closes when the shift ends.
const SHIFT_START = new Date(Date.now() + 24 * HOUR_MS);
const SHIFT_END = new Date(SHIFT_START.getTime() + 12 * HOUR_MS);

function staff(overrides: Partial<FakeStaff> & { id: string }): FakeStaff {
  return {
    name: overrides.id,
    email: `${overrides.id}@example.com`,
    phone: null,
    phoneVerifiedAt: null,
    position: "Registered Nurse",
    seniorityRank: null,
    hireDate: null,
    departmentIds: [],
    availabilities: [],
    ...overrides,
  };
}

const VERIFIED = new Date(Date.now() - 30 * 24 * HOUR_MS);

/** One person per tier; the tier-1 and tier-3 nurses have verified phones. */
const POOL: FakeStaff[] = [
  staff({
    id: "tier1-nurse",
    name: "Maria Santos",
    phone: "+14165550101",
    phoneVerifiedAt: VERIFIED,
    departmentIds: ["dept-er"],
    availabilities: [{ startsAt: SHIFT_START, endsAt: SHIFT_END, status: "AVAILABLE" }],
  }),
  staff({ id: "tier2-nurse", name: "Tom Lee", departmentIds: ["dept-er"] }),
  staff({
    id: "tier3-nurse",
    name: "David Kim",
    phone: "+14165550103",
    phoneVerifiedAt: VERIFIED,
    departmentIds: ["dept-icu"],
  }),
];

const SCHEDULER = { actorId: "scheduler-1" };
const ADMINS = ["scheduler-1", "admin-2"];

let state: FakeState;

beforeEach(() => {
  vi.clearAllMocks();
  state = createFakeState({
    staff: POOL,
    admins: ADMINS,
    shift: { startsAt: SHIFT_START, endsAt: SHIFT_END },
  });
  holder.db = createFakeDb(state) as unknown as Record<string, unknown>;
});

/** Post, then advance to tier 3 and press "Stop outreach" - the captain's flow. */
async function stopAtTier3(): Promise<void> {
  await startCalloutCampaign(state.shift.id);
  await advanceCampaignTier(state.shift.id, SCHEDULER);
  await advanceCampaignTier(state.shift.id, SCHEDULER);
  expect(state.campaign?.currentTier).toBe(3);
  const stopped = await stopCampaign(state.shift.id, SCHEDULER);
  expect(stopped).toMatchObject({ ok: true, status: "CANCELLED" });
}

/** Run the engine past the tier-3 window, letting the tiers run out on their own. */
async function exhaustByEngine(): Promise<void> {
  await startCalloutCampaign(state.shift.id);
  let now = Date.now();
  for (let step = 0; step < 6 && state.campaign?.status === "RUNNING"; step++) {
    now += 31 * MINUTE_MS; // longer than any tier's window
    await stepCampaign(state.shift.id, new Date(now));
  }
  expect(state.campaign?.status).toBe("EXHAUSTED");
}

/** "Close as exhausted" - the Advance button's label at tier 3. */
async function closeAsExhausted(): Promise<void> {
  await startCalloutCampaign(state.shift.id);
  await advanceCampaignTier(state.shift.id, SCHEDULER);
  await advanceCampaignTier(state.shift.id, SCHEDULER);
  const closed = await advanceCampaignTier(state.shift.id, SCHEDULER);
  expect(closed).toMatchObject({ ok: true, status: "EXHAUSTED" });
}

const SOURCES: BidSource[] = ["IN_APP", "SMS", "VOICE"];

describe("bidAcceptance - when a shift takes bids", () => {
  const now = new Date();
  const future = { startsAt: new Date(now.getTime() + HOUR_MS), endsAt: new Date(now.getTime() + 9 * HOUR_MS) };
  const underway = { startsAt: new Date(now.getTime() - HOUR_MS), endsAt: new Date(now.getTime() + 7 * HOUR_MS) };
  const over = { startsAt: new Date(now.getTime() - 9 * HOUR_MS), endsAt: new Date(now.getTime() - HOUR_MS) };

  it.each<[string, ShiftStatus, { endsAt: Date }, ReturnType<typeof bidAcceptance>]>([
    ["open, not started", "OPEN", future, { open: true }],
    ["open, already started (no deadline, no auto-expiry)", "OPEN", underway, { open: true }],
    ["open, but the shift is over", "OPEN", over, { open: false, reason: "SHIFT_ENDED" }],
    ["awarded", "ASSIGNED", future, { open: false, reason: "SHIFT_CLOSED" }],
    ["cancelled", "CANCELLED", future, { open: false, reason: "SHIFT_CLOSED" }],
    ["closed", "CLOSED", future, { open: false, reason: "SHIFT_CLOSED" }],
  ])("%s", (_label, status, times, expected) => {
    expect(bidAcceptance({ status, endsAt: times.endsAt }, now)).toEqual(expected);
  });

  it.each<CampaignStatus>(["RUNNING", "PAUSED", "CANCELLED", "EXHAUSTED", "FILLED"])(
    "ignores the campaign status (%s)",
    (campaignStatus) => {
      const shift = { status: "OPEN" as const, endsAt: future.endsAt, campaign: { status: campaignStatus } };
      expect(bidAcceptance(shift, now)).toEqual({ open: true });
    }
  );
});

describe.each([
  ["after Stop outreach at tier 3", stopAtTier3, "CANCELLED"],
  ["after the engine exhausts every tier", exhaustByEngine, "EXHAUSTED"],
  ["after Close as exhausted", closeAsExhausted, "EXHAUSTED"],
] as const)("bidding %s", (_label, endOutreach, endedStatus) => {
  it.each(SOURCES)("accepts a %s bid as PENDING", async (source) => {
    await endOutreach();
    expect(state.campaign?.status).toBe(endedStatus);
    expect(state.shift.status).toBe("OPEN");

    const result = await submitBid({
      shiftId: state.shift.id,
      workerId: "tier3-nurse",
      scope: "FULL",
      source,
    });

    expect(result.ok).toBe(true);
    expect(state.bids).toEqual([
      expect.objectContaining({ shiftId: state.shift.id, workerId: "tier3-nurse", status: "PENDING" }),
    ]);
  });

  it("notifies every admin, marking the bid as arriving after outreach ended", async () => {
    await endOutreach();
    state.notifications.length = 0;

    await submitBid({ shiftId: state.shift.id, workerId: "tier3-nurse", scope: "FULL", source: "SMS" });

    const bidNotices = state.notifications.filter((n) => n.type === "BID_SUBMITTED");
    expect(bidNotices.map((n) => n.userId)).toEqual(ADMINS);
    for (const notice of bidNotices) {
      expect(notice.message).toBe(`David Kim bid on ${state.shift.title} by text (outreach had ended).`);
    }
  });

  it("closes once the shift is awarded", async () => {
    await endOutreach();
    state.shift.status = "ASSIGNED";
    const result = await submitBid({
      shiftId: state.shift.id,
      workerId: "tier3-nurse",
      scope: "FULL",
      source: "IN_APP",
    });
    expect(result).toEqual({ ok: false, reason: "SHIFT_CLOSED" });
    expect(state.bids).toEqual([]);
  });

  it("an award moves the ended campaign to FILLED, keeping when outreach ended", async () => {
    await endOutreach();
    const endedAt = state.campaign?.endedAt;
    expect(endedAt).toBeInstanceOf(Date);

    await submitBid({ shiftId: state.shift.id, workerId: "tier3-nurse", scope: "FULL", source: "IN_APP" });
    state.shift.status = "ASSIGNED"; // what assignWorker writes before closing the campaign
    const filled = await markCampaignFilled(state.shift.id, SCHEDULER);

    expect(filled).toMatchObject({ ok: true, status: "FILLED" });
    expect(state.campaign?.status).toBe("FILLED");
    expect(state.campaign?.filledAt).toBeInstanceOf(Date);
    expect(state.campaign?.endedAt).toBe(endedAt);
    expect(state.activities.at(-1)).toMatchObject({
      action: "CALLOUT_FILLED",
      details: "Shift filled from a bid received after outreach had ended; callout closed.",
    });
  });
});

describe("markCampaignFilled", () => {
  it("stamps endedAt with the fill when outreach was still running", async () => {
    await startCalloutCampaign(state.shift.id);
    state.shift.status = "ASSIGNED";

    await markCampaignFilled(state.shift.id, SCHEDULER);

    expect(state.campaign?.status).toBe("FILLED");
    expect(state.campaign?.filledAt).toBeInstanceOf(Date);
    expect(state.campaign?.endedAt).toEqual(state.campaign?.filledAt);
  });

  it("is a no-op the second time - a campaign is filled once", async () => {
    await stopAtTier3();
    state.shift.status = "ASSIGNED";
    await markCampaignFilled(state.shift.id, SCHEDULER);
    const filledAt = state.campaign?.filledAt;
    const activityCount = state.activities.length;

    const again = await markCampaignFilled(state.shift.id, SCHEDULER);

    expect(again).toEqual({ ok: false, reason: "TERMINAL" });
    expect(state.campaign?.filledAt).toBe(filledAt);
    expect(state.activities).toHaveLength(activityCount);
  });
});

/* ------------------------------------------------- the real webhook routes */

const TOKEN = "test_auth_token_1234567890";
const BASE = "http://localhost:3000";
let savedEnv: Record<string, string | undefined>;

function signedRequest(path: string, params: Record<string, string>): Request {
  const url = `${BASE}${path}`;
  return new Request(url, {
    method: "POST",
    body: new URLSearchParams(params).toString(),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": getExpectedTwilioSignature(TOKEN, url, params),
    },
  });
}

describe("Twilio replies after Stop outreach", () => {
  beforeEach(() => {
    savedEnv = {
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
      TWILIO_WEBHOOK_BASE_URL: process.env.TWILIO_WEBHOOK_BASE_URL,
    };
    process.env.TWILIO_AUTH_TOKEN = TOKEN;
    process.env.TWILIO_WEBHOOK_BASE_URL = BASE;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("an inbound SMS reply to earlier outreach still becomes a bid", async () => {
    await stopAtTier3();
    // Outreach did go out before the stop: a text to Maria and one to David.
    expect(twilioSends.messages.create).toHaveBeenCalledTimes(2);

    const res = await inboundSmsPost(
      signedRequest("/api/webhooks/twilio/inbound-sms", {
        From: "+14165550101",
        Body: `YES ${state.shift.smsCode}`,
        MessageSid: "SM-after-stop",
      })
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Your bid for");
    expect(state.bids).toEqual([
      expect.objectContaining({ workerId: "tier1-nurse", status: "PENDING" }),
    ]);
    // The reply is recorded against the original text, and nothing new is sent.
    expect(state.attempts.find((a) => a.userId === "tier1-nurse" && a.channel === "SMS")).toMatchObject({
      response: "ACCEPTED",
    });
    expect(twilioSends.messages.create).toHaveBeenCalledTimes(2);
    expect(twilioSends.calls.create).toHaveBeenCalledTimes(2);
  });

  it("an IVR key-press on an earlier call still becomes a bid", async () => {
    await stopAtTier3();

    const res = await voiceResponsePost(
      signedRequest(
        `/api/webhooks/twilio/voice-response?shiftId=${state.shift.id}&userId=tier3-nurse`,
        { Digits: "1", CallSid: "CA-after-stop" }
      )
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Your bid has been recorded");
    expect(state.bids).toEqual([
      expect.objectContaining({ workerId: "tier3-nurse", status: "PENDING" }),
    ]);
  });
});
