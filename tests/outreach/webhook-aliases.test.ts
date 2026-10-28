// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";

/**
 * SMS webhooks moved to /api/webhooks/telephony/*; the old /api/webhooks/twilio/*
 * paths stay for one release as thin aliases. Each path verifies against its
 * own URL, i.e. the one the provider actually signed.
 */
const dbMock = vi.hoisted(() => ({
  outreachAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  user: { findFirst: vi.fn().mockResolvedValue(null) },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import * as telephonyStatus from "@/app/api/webhooks/telephony/status/route";
import * as telephonyInbound from "@/app/api/webhooks/telephony/inbound-sms/route";
import * as twilioStatus from "@/app/api/webhooks/twilio/status/route";
import * as twilioInbound from "@/app/api/webhooks/twilio/inbound-sms/route";

const TOKEN = "test_auth_token_1234567890";
const BASE = "http://localhost:3000";
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = {
    TELEPHONY_PROVIDER: process.env.TELEPHONY_PROVIDER,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_WEBHOOK_BASE_URL: process.env.TWILIO_WEBHOOK_BASE_URL,
  };
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

function request(path: string, params: Record<string, string>, signedPath = path): Request {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    body: new URLSearchParams(params).toString(),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": getExpectedTwilioSignature(TOKEN, `${BASE}${signedPath}`, params),
    },
  });
}

const STATUS = { MessageSid: "SM123", MessageStatus: "delivered" };
const INBOUND = { From: "+14165559999", Body: "YES ER4B" };

describe("twilio webhook paths are aliases of the telephony routes", () => {
  it("export the very same handlers, on the Node runtime", () => {
    expect(twilioStatus.POST).toBe(telephonyStatus.POST);
    expect(twilioInbound.POST).toBe(telephonyInbound.POST);
    expect(twilioStatus.runtime).toBe("nodejs");
    expect(twilioInbound.runtime).toBe("nodejs");
  });

  it.each(["/api/webhooks/telephony/status", "/api/webhooks/twilio/status"])(
    "%s accepts a status callback signed for it",
    async (path) => {
      const res = await twilioStatus.POST(request(path, STATUS));
      expect(res.status).toBe(204);
      expect(dbMock.outreachAttempt.updateMany).toHaveBeenCalledWith({
        where: { providerMessageId: "SM123" },
        data: { status: "DELIVERED" },
      });
    }
  );

  it.each(["/api/webhooks/telephony/inbound-sms", "/api/webhooks/twilio/inbound-sms"])(
    "%s answers an inbound SMS signed for it",
    async (path) => {
      const res = await telephonyInbound.POST(request(path, INBOUND));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/xml");
      expect(dbMock.user.findFirst).toHaveBeenCalledTimes(1);
    }
  );

  it("rejects a signature made for the other path (the URL is part of what is signed)", async () => {
    const res = await twilioStatus.POST(
      request("/api/webhooks/twilio/status", STATUS, "/api/webhooks/telephony/status")
    );
    expect(res.status).toBe(403);
    expect(dbMock.outreachAttempt.updateMany).not.toHaveBeenCalled();
  });
});
