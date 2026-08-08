// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";

// The webhook routes reach for db; mock it so a rejected signature is proven to
// never touch the DB, and a valid one is observed calling it.
const dbMock = vi.hoisted(() => ({
  outreachAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import { isValidTwilioSignature } from "@/lib/outreach/twilio";
import { POST as statusPost } from "@/app/api/webhooks/twilio/status/route";

const TOKEN = "test_auth_token_1234567890";
const URL_STR = "http://localhost:3000/api/webhooks/twilio/status";

let savedToken: string | undefined;
let savedBase: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  savedToken = process.env.TWILIO_AUTH_TOKEN;
  savedBase = process.env.TWILIO_WEBHOOK_BASE_URL;
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  process.env.TWILIO_WEBHOOK_BASE_URL = "http://localhost:3000";
});

afterEach(() => {
  if (savedToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = savedToken;
  if (savedBase === undefined) delete process.env.TWILIO_WEBHOOK_BASE_URL;
  else process.env.TWILIO_WEBHOOK_BASE_URL = savedBase;
});

function validSignatureFor(params: Record<string, string>): string {
  return getExpectedTwilioSignature(TOKEN, URL_STR, params);
}

describe("isValidTwilioSignature", () => {
  const params = { MessageSid: "SM123", MessageStatus: "delivered" };

  it("accepts a correctly computed signature", () => {
    const signature = validSignatureFor(params);
    expect(isValidTwilioSignature({ signature, url: URL_STR, params })).toBe(true);
  });

  it("rejects a tampered signature", () => {
    expect(isValidTwilioSignature({ signature: "not-a-real-signature", url: URL_STR, params })).toBe(
      false
    );
  });

  it("rejects a missing signature", () => {
    expect(isValidTwilioSignature({ signature: null, url: URL_STR, params })).toBe(false);
    expect(isValidTwilioSignature({ signature: undefined, url: URL_STR, params })).toBe(false);
  });

  it("rejects when the auth token is unset (fail closed)", () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const signature = validSignatureFor(params);
    expect(isValidTwilioSignature({ signature, url: URL_STR, params })).toBe(false);
  });

  it("rejects when params are tampered after signing", () => {
    const signature = validSignatureFor(params);
    const tampered = { ...params, MessageStatus: "failed" };
    expect(isValidTwilioSignature({ signature, url: URL_STR, params: tampered })).toBe(false);
  });
});

function formRequest(params: Record<string, string>, signature: string | null): Request {
  const body = new URLSearchParams(params).toString();
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (signature !== null) headers["x-twilio-signature"] = signature;
  return new Request(URL_STR, { method: "POST", body, headers });
}

describe("webhook route rejects on bad/missing signature before any DB write", () => {
  const params = { MessageSid: "SM123", MessageStatus: "delivered" };

  it("returns 403 and does not write when the signature is missing", async () => {
    const res = await statusPost(formRequest(params, null));
    expect(res.status).toBe(403);
    expect(dbMock.outreachAttempt.updateMany).not.toHaveBeenCalled();
  });

  it("returns 403 and does not write when the signature is wrong", async () => {
    const res = await statusPost(formRequest(params, "bogus-signature"));
    expect(res.status).toBe(403);
    expect(dbMock.outreachAttempt.updateMany).not.toHaveBeenCalled();
  });

  it("accepts a valid signature and reaches the DB", async () => {
    const res = await statusPost(formRequest(params, validSignatureFor(params)));
    expect(res.status).toBe(204);
    expect(dbMock.outreachAttempt.updateMany).toHaveBeenCalledTimes(1);
  });
});
