// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";
import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";

/**
 * F10: Twilio signatures carry no nonce, so a captured signed "YES <code>"
 * could be resent to re-create a bid the worker had since withdrawn (and an
 * IVR key-press likewise). A repeat of an already-handled MessageSid/CallSid
 * now gets the first reply back and touches nothing.
 */

const processed = vi.hoisted(() => new Map<string, { response: string | null }>());
const dbMock = vi.hoisted(() => ({
  user: { findFirst: vi.fn() },
  shift: { findUnique: vi.fn() },
  processedWebhook: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

const submitBid = vi.hoisted(() => vi.fn());
vi.mock("@/lib/outreach/accept", () => ({ submitBid }));
const recordDecline = vi.hoisted(() => vi.fn());
vi.mock("@/lib/outreach/decline", () => ({ recordDecline, outstandingSmsCallouts: vi.fn(async () => []) }));

import { POST as inboundSms } from "@/app/api/webhooks/twilio/inbound-sms/route";
import { POST as voiceResponse } from "@/app/api/webhooks/twilio/voice-response/route";

const TOKEN = "test_auth_token_1234567890";
const BASE = "http://localhost:3000";

function signed(path: string, params: Record<string, string>): Request {
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

let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  vi.clearAllMocks();
  processed.clear();
  saved = { token: process.env.TWILIO_AUTH_TOKEN, base: process.env.TWILIO_WEBHOOK_BASE_URL };
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  process.env.TWILIO_WEBHOOK_BASE_URL = BASE;

  dbMock.processedWebhook.create.mockImplementation(async ({ data }: { data: { key: string } }) => {
    if (processed.has(data.key)) {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["key"] },
      });
    }
    processed.set(data.key, { response: null });
    return { key: data.key };
  });
  dbMock.processedWebhook.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
    processed.get(where.key) ?? null
  );
  dbMock.processedWebhook.update.mockImplementation(
    async ({ where, data }: { where: { key: string }; data: { response: string } }) => {
      processed.set(where.key, { response: data.response });
      return {};
    }
  );
  dbMock.processedWebhook.delete.mockImplementation(async ({ where }: { where: { key: string } }) => {
    processed.delete(where.key);
    return {};
  });

  dbMock.user.findFirst.mockResolvedValue({ id: "worker-1" });
  dbMock.shift.findUnique.mockResolvedValue({ id: "shift-1", title: "ER RN" });
  submitBid.mockResolvedValue({ ok: true });
  recordDecline.mockResolvedValue({ ok: true });
});

afterEach(() => {
  if (saved.token === undefined) delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = saved.token;
  if (saved.base === undefined) delete process.env.TWILIO_WEBHOOK_BASE_URL;
  else process.env.TWILIO_WEBHOOK_BASE_URL = saved.base;
});

describe("inbound SMS replay (F10)", () => {
  const yes = { MessageSid: "SM0001", From: "+14165551234", Body: "YES ER4B" };

  it("records the bid once and answers a replay with the same reply", async () => {
    const first = await inboundSms(signed("/api/webhooks/twilio/inbound-sms", yes));
    const firstBody = await first.text();
    expect(first.status).toBe(200);
    expect(firstBody).toContain("<Message>");

    const replay = await inboundSms(signed("/api/webhooks/twilio/inbound-sms", yes));
    expect(replay.status).toBe(200);
    expect(await replay.text()).toBe(firstBody);
    expect(submitBid).toHaveBeenCalledTimes(1);
  });

  it("still handles a new message with the same text", async () => {
    await inboundSms(signed("/api/webhooks/twilio/inbound-sms", yes));
    await inboundSms(signed("/api/webhooks/twilio/inbound-sms", { ...yes, MessageSid: "SM0002" }));
    expect(submitBid).toHaveBeenCalledTimes(2);
  });

  it("lets Twilio's retry through when the first attempt failed", async () => {
    submitBid.mockRejectedValueOnce(new Error("db down"));
    await expect(inboundSms(signed("/api/webhooks/twilio/inbound-sms", yes))).rejects.toThrow("db down");
    const retry = await inboundSms(signed("/api/webhooks/twilio/inbound-sms", yes));
    expect(retry.status).toBe(200);
    expect(submitBid).toHaveBeenCalledTimes(2);
  });

  it("never claims a key for an unsigned request", async () => {
    const forged = new Request(`${BASE}/api/webhooks/twilio/inbound-sms`, {
      method: "POST",
      body: new URLSearchParams(yes).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "bogus" },
    });
    expect((await inboundSms(forged)).status).toBe(403);
    expect(dbMock.processedWebhook.create).not.toHaveBeenCalled();
  });
});

describe("IVR key-press replay (F10)", () => {
  const path = "/api/webhooks/twilio/voice-response?shiftId=shift-1&userId=worker-1";

  it("accepts once per call", async () => {
    const first = await voiceResponse(signed(path, { CallSid: "CA0001", Digits: "1" }));
    const replay = await voiceResponse(signed(path, { CallSid: "CA0001", Digits: "1" }));
    expect(await replay.text()).toBe(await first.text());
    expect(submitBid).toHaveBeenCalledTimes(1);
  });
});
