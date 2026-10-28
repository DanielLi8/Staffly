// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";
import { createFakeDb, createFakeState, type FakeStaff, type FakeState } from "./fake-db";

/**
 * A deactivated account is cut off on every channel, not just the web session
 * (access-control gap G13): it is never called out, an SMS "YES <code>" from
 * its phone is refused, and an IVR key-press on a call placed before the
 * deactivation does not become a bid.
 */

const holder = vi.hoisted(() => ({ db: null as unknown as Record<string, unknown> }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_target, prop: string) => (holder.db as Record<string, unknown>)[prop] }),
}));

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

import { startCalloutCampaign } from "@/lib/callout/campaign";
import { submitBid } from "@/lib/outreach/accept";
import { smsReplies } from "@/lib/outreach/messages";
import { POST as inboundSmsPost } from "@/app/api/webhooks/twilio/inbound-sms/route";
import { POST as voiceResponsePost } from "@/app/api/webhooks/twilio/voice-response/route";

const HOUR_MS = 60 * 60 * 1000;
// Relative to now, never fixed dates: the bid window closes when the shift ends.
const SHIFT_START = new Date(Date.now() + 24 * HOUR_MS);
const SHIFT_END = new Date(SHIFT_START.getTime() + 12 * HOUR_MS);
const VERIFIED = new Date(Date.now() - 30 * 24 * HOUR_MS);

const TOKEN = "test_auth_token_1234567890";
const BASE = "http://localhost:3000";

function staff(overrides: Partial<FakeStaff> & { id: string }): FakeStaff {
  return {
    name: overrides.id,
    email: `${overrides.id}@example.com`,
    phone: null,
    phoneVerifiedAt: null,
    position: "Registered Nurse",
    seniorityRank: null,
    hireDate: null,
    departmentIds: ["dept-er"],
    availabilities: [{ startsAt: SHIFT_START, endsAt: SHIFT_END, status: "AVAILABLE" }],
    ...overrides,
  };
}

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

let state: FakeState;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  state = createFakeState({
    staff: [
      staff({ id: "active-nurse", phone: "+14165550101", phoneVerifiedAt: VERIFIED }),
      staff({ id: "gone-nurse", phone: "+14165550199", phoneVerifiedAt: VERIFIED, deactivatedAt: new Date() }),
    ],
    admins: ["admin-1"],
    shift: { startsAt: SHIFT_START, endsAt: SHIFT_END },
  });
  holder.db = createFakeDb(state) as unknown as Record<string, unknown>;
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

describe("a deactivated account", () => {
  it("is never called out", async () => {
    await startCalloutCampaign(state.shift.id);
    const contacted = new Set(state.attempts.map((a) => a.userId));
    expect(contacted.has("active-nurse")).toBe(true);
    expect(contacted.has("gone-nurse")).toBe(false);
  });

  it("cannot bid by SMS", async () => {
    const res = await inboundSmsPost(
      signedRequest("/api/webhooks/twilio/inbound-sms", {
        From: "+14165550199",
        Body: `YES ${state.shift.smsCode}`,
        MessageSid: "SM-deactivated",
      })
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(smsReplies.unknownSender);
    expect(state.bids).toEqual([]);
  });

  it("cannot bid by IVR, even on a call placed before deactivation", async () => {
    const res = await voiceResponsePost(
      signedRequest(`/api/webhooks/twilio/voice-response?shiftId=${state.shift.id}&userId=gone-nurse`, {
        Digits: "1",
        CallSid: "CA-deactivated",
      })
    );
    expect(await res.text()).not.toContain("Your bid has been recorded");
    expect(state.bids).toEqual([]);
  });

  it("is refused by the single accept path itself", async () => {
    const result = await submitBid({ shiftId: state.shift.id, workerId: "gone-nurse", scope: "FULL", source: "SMS" });
    expect(result).toEqual({ ok: false, reason: "ACCOUNT_DEACTIVATED" });
    expect(state.bids).toEqual([]);
  });

  it("while an active colleague's SMS bid still goes through", async () => {
    const res = await inboundSmsPost(
      signedRequest("/api/webhooks/twilio/inbound-sms", {
        From: "+14165550101",
        Body: `YES ${state.shift.smsCode}`,
        MessageSid: "SM-active",
      })
    );
    expect(await res.text()).toContain("Your bid for");
    expect(state.bids).toEqual([expect.objectContaining({ workerId: "active-nurse" })]);
  });
});
