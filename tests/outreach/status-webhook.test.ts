// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";
import { mapTwilioStatus } from "@/lib/outreach/status";

const dbMock = vi.hoisted(() => ({
  outreachAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

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

function signedRequest(params: Record<string, string>): Request {
  const signature = getExpectedTwilioSignature(TOKEN, URL_STR, params);
  return new Request(URL_STR, {
    method: "POST",
    body: new URLSearchParams(params).toString(),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
  });
}

describe("mapTwilioStatus", () => {
  it("maps SMS lifecycle statuses", () => {
    expect(mapTwilioStatus("queued")).toBe("QUEUED");
    expect(mapTwilioStatus("sent")).toBe("SENT");
    expect(mapTwilioStatus("delivered")).toBe("DELIVERED");
    expect(mapTwilioStatus("failed")).toBe("FAILED");
    expect(mapTwilioStatus("undelivered")).toBe("FAILED");
  });

  it("maps voice lifecycle statuses", () => {
    expect(mapTwilioStatus("initiated")).toBe("QUEUED");
    expect(mapTwilioStatus("ringing")).toBe("QUEUED");
    expect(mapTwilioStatus("in-progress")).toBe("ANSWERED");
    expect(mapTwilioStatus("answered")).toBe("ANSWERED");
    expect(mapTwilioStatus("completed")).toBe("DELIVERED");
    expect(mapTwilioStatus("no-answer")).toBe("FAILED");
  });

  it("is case-insensitive and ignores unknown statuses", () => {
    expect(mapTwilioStatus("DELIVERED")).toBe("DELIVERED");
    expect(mapTwilioStatus("something-else")).toBeNull();
    expect(mapTwilioStatus(undefined)).toBeNull();
  });
});

describe("delivery-status webhook updates OutreachAttempt by providerMessageId", () => {
  it("updates the SMS attempt keyed by MessageSid", async () => {
    const res = await statusPost(
      signedRequest({ MessageSid: "SMabc123", MessageStatus: "delivered" })
    );
    expect(res.status).toBe(204);
    expect(dbMock.outreachAttempt.updateMany).toHaveBeenCalledWith({
      where: { providerMessageId: "SMabc123" },
      data: { status: "DELIVERED" },
    });
  });

  it("updates the voice attempt keyed by CallSid", async () => {
    await statusPost(signedRequest({ CallSid: "CAxyz789", CallStatus: "completed" }));
    expect(dbMock.outreachAttempt.updateMany).toHaveBeenCalledWith({
      where: { providerMessageId: "CAxyz789" },
      data: { status: "DELIVERED" },
    });
  });

  it("does not write for an untracked status", async () => {
    const res = await statusPost(
      signedRequest({ MessageSid: "SMabc123", MessageStatus: "receiving" })
    );
    expect(res.status).toBe(204);
    expect(dbMock.outreachAttempt.updateMany).not.toHaveBeenCalled();
  });
});
