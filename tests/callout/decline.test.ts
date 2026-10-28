// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";
import { createFakeDb, createFakeState, type FakeStaff, type FakeState } from "./fake-db";

/**
 * The single decline path (`recordDecline`): an SMS "NO", IVR key 2 and the
 * in-app Decline button all record the same thing, and a decline stops further
 * outreach to that worker for that shift.
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

import { advanceCampaignTier, startCalloutCampaign } from "@/lib/callout/campaign";
import { submitBid } from "@/lib/outreach/accept";
import { recordDecline } from "@/lib/outreach/decline";
import { isGsm7, smsEncoding } from "@/lib/outreach/gsm7";
import { POST as inboundSmsPost } from "@/app/api/webhooks/twilio/inbound-sms/route";
import { POST as voiceResponsePost } from "@/app/api/webhooks/twilio/voice-response/route";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

// Relative to now, never fixed dates: the bid window closes when the shift ends.
const SHIFT_START = new Date(Date.now() + 24 * HOUR_MS);
const SHIFT_END = new Date(SHIFT_START.getTime() + 12 * HOUR_MS);
const VERIFIED = new Date(Date.now() - 30 * 24 * HOUR_MS);

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

/** A tier-1 and a tier-3 nurse, both with verified phones. */
const POOL: FakeStaff[] = [
  staff({
    id: "tier1-nurse",
    name: "Maria Santos",
    phone: "+14165550101",
    phoneVerifiedAt: VERIFIED,
    departmentIds: ["dept-er"],
    availabilities: [{ startsAt: SHIFT_START, endsAt: SHIFT_END, status: "AVAILABLE" }],
  }),
  staff({
    id: "tier3-nurse",
    name: "David Kim",
    phone: "+14165550103",
    phoneVerifiedAt: VERIFIED,
    departmentIds: ["dept-icu"],
  }),
];

const SCHEDULER = { actorId: "scheduler-1" };

let state: FakeState;

beforeEach(() => {
  vi.clearAllMocks();
  state = createFakeState({
    staff: POOL,
    shift: { startsAt: SHIFT_START, endsAt: SHIFT_END },
  });
  holder.db = createFakeDb(state) as unknown as Record<string, unknown>;
});

const textsTo = (phone: string) =>
  twilioSends.messages.create.mock.calls.filter(([arg]) => arg.to === phone).length;
const callsTo = (phone: string) =>
  twilioSends.calls.create.mock.calls.filter(([arg]) => arg.to === phone).length;

describe("recordDecline", () => {
  it.each(["IN_APP", "SMS", "VOICE"] as const)("records a %s decline", async (source) => {
    await startCalloutCampaign(state.shift.id);

    const result = await recordDecline({ shiftId: state.shift.id, workerId: "tier1-nurse", source });

    expect(result).toMatchObject({ ok: true, withdrewBid: false });
    expect(state.declines).toEqual([{ shiftId: state.shift.id, userId: "tier1-nurse", source }]);
    // The attempt on the channel it came in on reads DECLINED; others don't.
    for (const attempt of state.attempts.filter((a) => a.userId === "tier1-nurse")) {
      expect(attempt.response).toBe(attempt.channel === source ? "DECLINED" : null);
    }
  });

  it("withdraws a pending bid - the latest answer wins", async () => {
    await submitBid({ shiftId: state.shift.id, workerId: "tier1-nurse", scope: "FULL", source: "IN_APP" });
    expect(state.bids).toHaveLength(1);

    const result = await recordDecline({ shiftId: state.shift.id, workerId: "tier1-nurse", source: "SMS" });

    expect(result).toMatchObject({ ok: true, withdrewBid: true });
    expect(state.bids).toEqual([]);
  });

  it("a later bid takes the decline back", async () => {
    await recordDecline({ shiftId: state.shift.id, workerId: "tier1-nurse", source: "IN_APP" });
    await submitBid({ shiftId: state.shift.id, workerId: "tier1-nurse", scope: "FULL", source: "IN_APP" });
    expect(state.declines).toEqual([]);
    expect(state.bids).toHaveLength(1);
  });

  it("never undoes a processed bid", async () => {
    state.bids.push({
      shiftId: state.shift.id,
      workerId: "tier1-nurse",
      note: null,
      durationScope: "FULL",
      partialStartsAt: null,
      partialEndsAt: null,
      status: "SELECTED",
    });
    const result = await recordDecline({ shiftId: state.shift.id, workerId: "tier1-nurse", source: "IN_APP" });
    expect(result).toEqual({ ok: false, reason: "BID_PROCESSED" });
    expect(state.bids).toHaveLength(1);
    expect(state.declines).toEqual([]);
  });

  it("refuses once the shift no longer takes bids", async () => {
    state.shift.status = "ASSIGNED";
    const result = await recordDecline({ shiftId: state.shift.id, workerId: "tier1-nurse", source: "SMS" });
    expect(result).toEqual({ ok: false, reason: "SHIFT_CLOSED" });
    expect(state.declines).toEqual([]);
  });
});

describe("a decline stops further outreach", () => {
  it("someone who declined in the app is never texted or called when their tier opens", async () => {
    await startCalloutCampaign(state.shift.id);
    expect(textsTo("+14165550101")).toBe(1);

    // David (tier 3) sees the open shift in the app and declines before tier 3.
    await recordDecline({ shiftId: state.shift.id, workerId: "tier3-nurse", source: "IN_APP" });
    await advanceCampaignTier(state.shift.id, SCHEDULER);
    await advanceCampaignTier(state.shift.id, SCHEDULER);
    expect(state.campaign?.currentTier).toBe(3);

    expect(textsTo("+14165550103")).toBe(0);
    expect(callsTo("+14165550103")).toBe(0);
    expect(state.attempts.filter((a) => a.userId === "tier3-nurse")).toEqual([]);
  });

  it("an undeclined tier-3 nurse is still reached (control)", async () => {
    await startCalloutCampaign(state.shift.id);
    await advanceCampaignTier(state.shift.id, SCHEDULER);
    await advanceCampaignTier(state.shift.id, SCHEDULER);
    expect(textsTo("+14165550103")).toBe(1);
    expect(callsTo("+14165550103")).toBe(1);
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

// Every real inbound text has its own MessageSid; a repeated one is a replay.
let messageSeq = 0;

async function textIn(from: string, body: string): Promise<string> {
  const res = await inboundSmsPost(
    signedRequest("/api/webhooks/twilio/inbound-sms", { From: from, Body: body, MessageSid: `SM-in-${++messageSeq}` })
  );
  expect(res.status).toBe(200);
  const xml = await res.text();
  const reply = xml.match(/<Message>([\s\S]*)<\/Message>/)?.[1] ?? "";
  return reply.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

describe("SMS and IVR declines", () => {
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

  it.each(["NO ER4B", "n er4b", "Decline ER4B"])("%s declines and confirms in one GSM-7 segment", async (body) => {
    await startCalloutCampaign(state.shift.id);

    const reply = await textIn("+14165550101", body);

    expect(reply).toBe(`Got it - you declined ${state.shift.title.replace("–", "-")}. We won't contact you again about it.`);
    expect(isGsm7(reply)).toBe(true);
    expect(smsEncoding(reply).segments).toBe(1);
    expect(state.declines).toEqual([{ shiftId: state.shift.id, userId: "tier1-nurse", source: "SMS" }]);
    expect(state.attempts.find((a) => a.userId === "tier1-nurse" && a.channel === "SMS")).toMatchObject({
      response: "DECLINED",
    });
    expect(state.bids).toEqual([]);
  });

  it("a bare NO declines the worker's one outstanding callout", async () => {
    await startCalloutCampaign(state.shift.id);
    const reply = await textIn("+14165550101", "no");
    expect(reply).toContain("you declined");
    expect(state.declines).toHaveLength(1);
  });

  it("NO THANKS reads as a bare decline, not an unknown code", async () => {
    await startCalloutCampaign(state.shift.id);
    const reply = await textIn("+14165550101", "No thanks");
    expect(reply).toContain("you declined");
    expect(state.declines).toHaveLength(1);
  });

  it("a bare NO with nothing outstanding says so and records nothing", async () => {
    await startCalloutCampaign(state.shift.id);
    // David was never texted (tier 3 hasn't opened).
    const reply = await textIn("+14165550103", "NO");
    expect(reply).toBe("You have no open callout to decline. Thanks for replying.");
    expect(state.declines).toEqual([]);
  });

  it("a second bare NO finds nothing left to decline", async () => {
    await startCalloutCampaign(state.shift.id);
    await textIn("+14165550101", "NO");
    const reply = await textIn("+14165550101", "NO");
    expect(reply).toBe("You have no open callout to decline. Thanks for replying.");
  });

  it("an accept still works after the decline keyword was added", async () => {
    await startCalloutCampaign(state.shift.id);
    const reply = await textIn("+14165550101", "YES ER4B");
    expect(reply).toContain("Your bid for");
    expect(state.bids).toHaveLength(1);
    expect(state.declines).toEqual([]);
  });

  it("IVR key 2 records the same decline", async () => {
    await startCalloutCampaign(state.shift.id);
    const path = `/api/webhooks/twilio/voice-response?shiftId=${state.shift.id}&userId=tier1-nurse`;
    const res = await voiceResponsePost(signedRequest(path, { Digits: "2", CallSid: "CA-1" }));
    expect(await res.text()).toContain("You have declined this shift.");
    expect(state.declines).toEqual([{ shiftId: state.shift.id, userId: "tier1-nurse", source: "VOICE" }]);
    expect(state.attempts.find((a) => a.userId === "tier1-nurse" && a.channel === "VOICE")).toMatchObject({
      response: "DECLINED",
    });
  });
});
