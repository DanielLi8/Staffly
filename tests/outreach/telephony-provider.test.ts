// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";

/**
 * The telephony seam (src/lib/outreach/telephony): TELEPHONY_PROVIDER picks the
 * implementation, Twilio stays the default, and `none` (or a typo) is a
 * fail-closed no-op that sends nothing and rejects every webhook.
 */
const dbMock = vi.hoisted(() => ({
  outreachAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

// A stand-in Twilio client so "sends" never leave the process.
const twilioSends = vi.hoisted(() => ({
  messages: { create: vi.fn().mockResolvedValue({ sid: "SM-stub" }) },
  verify: {
    v2: {
      services: vi.fn(() => ({
        verifications: { create: vi.fn().mockResolvedValue({}) },
        verificationChecks: { create: vi.fn().mockResolvedValue({ status: "approved" }) },
      })),
    },
  },
}));
const twilioConfigured = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/outreach/twilio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/outreach/twilio")>()),
  getTwilioClient: () => (twilioConfigured.value ? twilioSends : null),
  twilioConfig: () =>
    twilioConfigured.value ? { fromNumber: "+15550000000", verifyServiceSid: "VA-stub" } : {},
  isVerifyConfigured: () => twilioConfigured.value,
}));

import { getTelephonyProvider, parseTelephonyProvider } from "@/lib/outreach/telephony";
import { noopProvider } from "@/lib/outreach/telephony/noop";
import { twilioProvider } from "@/lib/outreach/telephony/twilio";
import { smsChannel } from "@/lib/outreach/sms";
import {
  checkVerificationCode,
  isPhoneVerificationConfigured,
  sendVerificationCode,
} from "@/lib/outreach/verify";
import { POST as statusPost } from "@/app/api/webhooks/telephony/status/route";
import { POST as inboundSmsPost } from "@/app/api/webhooks/telephony/inbound-sms/route";
import type { OutreachContext } from "@/lib/outreach/types";

const TOKEN = "test_auth_token_1234567890";
const BASE = "http://localhost:3000";
const ENV_KEYS = ["TELEPHONY_PROVIDER", "TWILIO_AUTH_TOKEN", "TWILIO_WEBHOOK_BASE_URL"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  twilioConfigured.value = true;
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.TELEPHONY_PROVIDER;
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  process.env.TWILIO_WEBHOOK_BASE_URL = BASE;
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

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

const ctx: OutreachContext = {
  appUrl: BASE,
  shift: {
    id: "shift-1",
    title: "Emergency (ER) - Registered Nurse",
    unit: "4B",
    roleNeeded: "Registered Nurse",
    departmentName: "Emergency",
    startsAt: new Date("2026-08-10T07:00:00Z"),
    endsAt: new Date("2026-08-10T15:00:00Z"),
    smsCode: "ER4B",
  },
  recipient: {
    id: "worker-1",
    name: "Maria Santos",
    email: "maria@example.com",
    phone: "+14165550101",
    phoneVerifiedAt: new Date("2026-07-01"),
  },
};

describe("TELEPHONY_PROVIDER selection", () => {
  it("defaults to twilio when unset or blank", () => {
    expect(parseTelephonyProvider(undefined)).toBe("twilio");
    expect(parseTelephonyProvider("")).toBe("twilio");
    expect(parseTelephonyProvider("   ")).toBe("twilio");
    expect(getTelephonyProvider()).toBe(twilioProvider);
  });

  it("accepts the known names, case- and whitespace-insensitive", () => {
    expect(parseTelephonyProvider("twilio")).toBe("twilio");
    expect(parseTelephonyProvider(" Twilio ")).toBe("twilio");
    expect(parseTelephonyProvider("none")).toBe("none");
    expect(parseTelephonyProvider("NONE")).toBe("none");
  });

  it("does not resolve unknown or inherited-property names", () => {
    expect(parseTelephonyProvider("telnyx")).toBeNull();
    expect(parseTelephonyProvider("toString")).toBeNull();
    expect(parseTelephonyProvider("__proto__")).toBeNull();
  });

  it("selects the no-op provider for none", () => {
    process.env.TELEPHONY_PROVIDER = "none";
    expect(getTelephonyProvider()).toBe(noopProvider);
  });

  it("fails closed to the no-op provider (logged) for an unknown value", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.TELEPHONY_PROVIDER = "telnyx";
    expect(getTelephonyProvider()).toBe(noopProvider);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"telnyx"'));
    error.mockRestore();
  });
});

describe("the no-op provider", () => {
  beforeEach(() => {
    process.env.TELEPHONY_PROVIDER = "none";
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("skips SMS without touching Twilio, even when Twilio is configured", async () => {
    const result = await smsChannel.send(ctx);
    expect(result).toEqual({ status: "QUEUED", providerMessageId: null, skipped: true });
    expect(twilioSends.messages.create).not.toHaveBeenCalled();
  });

  it("reports phone verification unavailable", async () => {
    expect(isPhoneVerificationConfigured()).toBe(false);
    expect(await sendVerificationCode("+14165550101")).toEqual({ ok: false, reason: "UNAVAILABLE" });
    expect(await checkVerificationCode("+14165550101", "123456")).toEqual({
      ok: false,
      reason: "UNAVAILABLE",
    });
    expect(twilioSends.verify.v2.services).not.toHaveBeenCalled();
  });

  it("rejects a correctly Twilio-signed status webhook before any DB write", async () => {
    const res = await statusPost(
      signedRequest("/api/webhooks/telephony/status", { MessageSid: "SM1", MessageStatus: "delivered" })
    );
    expect(res.status).toBe(403);
    expect(dbMock.outreachAttempt.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a correctly Twilio-signed inbound SMS", async () => {
    const res = await inboundSmsPost(
      signedRequest("/api/webhooks/telephony/inbound-sms", { From: "+14165550101", Body: "YES ER4B" })
    );
    expect(res.status).toBe(403);
  });

  it("reads nothing from webhook params", () => {
    expect(noopProvider.normalizeStatus({ MessageSid: "SM1", MessageStatus: "delivered" })).toBeNull();
    expect(noopProvider.parseInboundSms({ From: "+1", Body: "YES" })).toEqual({ from: null, body: null });
  });
});

describe("the Twilio provider (unchanged behaviour behind the seam)", () => {
  it("sends SMS from the configured number with the telephony status callback", async () => {
    const result = await smsChannel.send(ctx);
    expect(result).toEqual({ status: "SENT", providerMessageId: "SM-stub", skipped: false });
    expect(twilioSends.messages.create).toHaveBeenCalledWith({
      to: "+14165550101",
      from: "+15550000000",
      body: expect.stringContaining("ER4B"),
      statusCallback: `${BASE}/api/webhooks/telephony/status`,
    });
  });

  it("skips SMS without credentials", async () => {
    twilioConfigured.value = false;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await smsChannel.send(ctx)).toEqual({ status: "QUEUED", providerMessageId: null, skipped: true });
  });

  it("records a failed send as FAILED", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    twilioSends.messages.create.mockRejectedValueOnce(new Error("21211 invalid number"));
    expect(await smsChannel.send(ctx)).toEqual({ status: "FAILED", providerMessageId: null, skipped: false });
  });

  it("normalizes SMS and call status params", () => {
    expect(twilioProvider.normalizeStatus({ MessageSid: "SM1", MessageStatus: "delivered" })).toEqual({
      providerMessageId: "SM1",
      status: "DELIVERED",
    });
    expect(twilioProvider.normalizeStatus({ CallSid: "CA1", CallStatus: "no-answer" })).toEqual({
      providerMessageId: "CA1",
      status: "FAILED",
    });
    expect(twilioProvider.normalizeStatus({ MessageSid: "SM1", MessageStatus: "weird" })).toBeNull();
    expect(twilioProvider.normalizeStatus({ MessageStatus: "delivered" })).toBeNull();
  });

  it("parses inbound SMS params and answers in TwiML", async () => {
    expect(twilioProvider.parseInboundSms({ From: "+14165550101", Body: "YES ER4B" })).toEqual({
      from: "+14165550101",
      body: "YES ER4B",
    });
    const reply = twilioProvider.smsReplyResponse("Thanks");
    expect(reply.headers.get("content-type")).toBe("text/xml");
    expect(await reply.text()).toContain("<Message>Thanks</Message>");
    expect(await twilioProvider.smsReplyResponse(null).text()).not.toContain("<Message>");
  });

  it("runs phone OTP through Twilio Verify", async () => {
    expect(isPhoneVerificationConfigured()).toBe(true);
    expect(await sendVerificationCode("+14165550101")).toEqual({ ok: true });
    expect(await checkVerificationCode("+14165550101", "123456")).toEqual({ ok: true, approved: true });
    expect(twilioSends.verify.v2.services).toHaveBeenCalledWith("VA-stub");
  });
});
