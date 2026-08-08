import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Hard constraint: with NO Twilio env vars the app must keep working. SMS/voice
 * sends are skipped (no throw, no network) while email + in-app still fire.
 */
const dbMock = vi.hoisted(() => ({
  notification: { create: vi.fn().mockResolvedValue({}) },
  outreachAttempt: { create: vi.fn().mockResolvedValue({}) },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import { isTwilioConfigured, isVerifyConfigured, getTwilioClient } from "@/lib/outreach/twilio";
import { smsChannel } from "@/lib/outreach/sms";
import { voiceChannel } from "@/lib/outreach/voice";
import { dispatchOutreach } from "@/lib/outreach";
import type { OutreachContext } from "@/lib/outreach/types";

const TWILIO_KEYS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "TWILIO_VERIFY_SERVICE_SID",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  saved = {};
  for (const k of TWILIO_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of TWILIO_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const ctx: OutreachContext = {
  appUrl: "http://localhost:3000",
  shift: {
    id: "shift-1",
    title: "Emergency (ER) – Registered Nurse",
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

describe("Twilio config detection without credentials", () => {
  it("reports not configured and returns a null client", () => {
    expect(isTwilioConfigured()).toBe(false);
    expect(isVerifyConfigured()).toBe(false);
    expect(getTwilioClient()).toBeNull();
  });
});

describe("SMS/voice channels skip without credentials", () => {
  it("smsChannel.send returns skipped without throwing", async () => {
    const result = await smsChannel.send(ctx);
    expect(result.skipped).toBe(true);
    expect(result.providerMessageId).toBeNull();
  });

  it("voiceChannel.send returns skipped without throwing", async () => {
    const result = await voiceChannel.send(ctx);
    expect(result.skipped).toBe(true);
    expect(result.providerMessageId).toBeNull();
  });
});

describe("dispatchOutreach without credentials", () => {
  it("still records email + in-app, and records SMS/voice as skipped QUEUED", async () => {
    await dispatchOutreach(ctx.shift, [ctx.recipient]);

    // In-app notification still written.
    expect(dbMock.notification.create).toHaveBeenCalledTimes(1);

    // One OutreachAttempt per applicable channel (verified phone => all four).
    const rows = dbMock.outreachAttempt.create.mock.calls.map((c) => c[0].data);
    const byChannel = Object.fromEntries(rows.map((r) => [r.channel, r]));

    expect(byChannel.IN_APP.status).toBe("DELIVERED");
    expect(byChannel.EMAIL.status).toBe("SENT");
    // Skipped sends are recorded QUEUED with no provider id.
    expect(byChannel.SMS.status).toBe("QUEUED");
    expect(byChannel.SMS.providerMessageId).toBeNull();
    expect(byChannel.VOICE.status).toBe("QUEUED");
  });

  it("only records email + in-app for a recipient with an unverified phone", async () => {
    const unverified = {
      ...ctx.recipient,
      id: "worker-2",
      phone: "+14165550999",
      phoneVerifiedAt: null,
    };
    await dispatchOutreach(ctx.shift, [unverified]);
    const channels = dbMock.outreachAttempt.create.mock.calls.map((c) => c[0].data.channel).sort();
    expect(channels).toEqual(["EMAIL", "IN_APP"]);
  });
});
