import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Voice/IVR calls are off (captain decision 2026-10-25: callouts go by SMS and
 * in-app only). VOICE_CHANNEL_ENABLED is the one switch: with it off, nobody is
 * dialled - even with Twilio fully configured - and the fill dashboard hides
 * voice attempts, the same way EMAIL_CHANNEL_ENABLED handles email.
 */
const dbMock = vi.hoisted(() => ({
  notification: { create: vi.fn().mockResolvedValue({}) },
  outreachAttempt: {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

const twilioSends = vi.hoisted(() => ({
  messages: { create: vi.fn().mockResolvedValue({ sid: "SM-stub" }) },
  calls: { create: vi.fn().mockResolvedValue({ sid: "CA-stub" }) },
}));
vi.mock("@/lib/outreach/twilio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/outreach/twilio")>()),
  getTwilioClient: () => twilioSends,
  twilioConfig: () => ({ fromNumber: "+15550000000" }),
}));

import { dispatchOutreach, isChannelShown, VOICE_CHANNEL_ENABLED } from "@/lib/outreach";
import type { OutreachRecipient, OutreachShift } from "@/lib/outreach/types";

const shift: OutreachShift = {
  id: "shift-1",
  title: "Emergency (ER) - Registered Nurse",
  unit: "4B",
  roleNeeded: "Registered Nurse",
  departmentName: "Emergency",
  startsAt: new Date("2026-08-10T07:00:00Z"),
  endsAt: new Date("2026-08-10T15:00:00Z"),
  smsCode: "ER4B",
};

const verified: OutreachRecipient = {
  id: "worker-1",
  name: "Maria Santos",
  email: "maria@example.com",
  phone: "+14165550101",
  phoneVerifiedAt: new Date("2026-07-01"),
};

beforeEach(() => vi.clearAllMocks());

describe("voice outreach is switched off", () => {
  it("is off by the single flag", () => {
    expect(VOICE_CHANNEL_ENABLED).toBe(false);
  });

  it("texts a verified phone but never places a call, even with Twilio configured", async () => {
    await dispatchOutreach(shift, [verified], { tier: 1 });

    expect(twilioSends.messages.create).toHaveBeenCalledTimes(1);
    expect(twilioSends.calls.create).not.toHaveBeenCalled();
    const channels = dbMock.outreachAttempt.upsert.mock.calls.map((c) => c[0].create.channel).sort();
    expect(channels).toEqual(["IN_APP", "SMS"]);
  });

  it("hides voice (and email) attempts from outreach views", () => {
    expect(isChannelShown("VOICE")).toBe(false);
    expect(isChannelShown("EMAIL")).toBe(false);
    expect(isChannelShown("SMS")).toBe(true);
    expect(isChannelShown("IN_APP")).toBe(true);
  });
});
