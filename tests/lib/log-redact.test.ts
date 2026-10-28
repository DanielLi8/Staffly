import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { describeError, maskEmail, maskPhone, redactContactDetails } from "@/lib/log-redact";

/**
 * F12: Twilio REST exceptions name the destination number in their message,
 * and the outreach code logged them whole - so Vercel's log retention held
 * staff phone numbers. Errors are now logged as name/code/status plus a masked
 * message.
 */

const create = vi.hoisted(() => vi.fn());
vi.mock("@/lib/outreach/twilio", () => ({
  getTwilioClient: () => ({ messages: { create }, calls: { create } }),
  twilioConfig: () => ({ fromNumber: "+15005550006" }),
}));

import { smsChannel } from "@/lib/outreach/sms";
import { voiceChannel } from "@/lib/outreach/voice";

/** What Twilio's RestException looks like when the "To" number is bad. */
function twilioError(): Error {
  return Object.assign(new Error("The 'To' number +14165551234 is not a valid phone number."), {
    name: "RestException",
    status: 400,
    code: 21211,
    moreInfo: "https://www.twilio.com/docs/errors/21211",
    details: { to: "+14165551234" },
  });
}

const ctx = {
  appUrl: "http://localhost:3000",
  shift: {
    id: "shift-1",
    title: "ER RN",
    unit: "4B",
    roleNeeded: "Registered Nurse",
    departmentName: "Emergency",
    startsAt: new Date("2030-01-01T07:00:00Z"),
    endsAt: new Date("2030-01-01T15:00:00Z"),
    smsCode: "ER4B",
  },
  recipient: {
    id: "worker-1",
    name: "Maria Santos",
    email: "maria.santos@staffly.com",
    phone: "+14165551234",
    phoneVerifiedAt: new Date(),
  },
};

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  create.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

function logged(): string {
  return JSON.stringify(errorSpy.mock.calls, (_k, v) => (v instanceof Error ? { ...v, message: v.message } : v));
}

describe("phone numbers stay out of logs (F12)", () => {
  it.each([
    ["SMS", smsChannel],
    ["voice", voiceChannel],
  ])("a failed %s send logs the error code, not the number", async (_label, channel) => {
    create.mockRejectedValueOnce(twilioError());
    const result = await channel.send(ctx as never);
    expect(result.status).toBe("FAILED");
    expect(errorSpy).toHaveBeenCalled();
    expect(logged()).not.toContain("4165551234");
    expect(logged()).toContain("code=21211");
  });
});

describe("log-redact helpers", () => {
  it("masks phones and emails", () => {
    expect(maskPhone("+14165551234")).toBe("+*********34");
    expect(maskEmail("maria.santos@staffly.com")).toBe("m***@staffly.com");
    expect(redactContactDetails("to (416) 555-1234 or maria@x.org failed")).toBe(
      "to (********34 or m***@x.org failed"
    );
  });

  it("describes an error by name, code and status with a masked message", () => {
    expect(describeError(twilioError())).toBe(
      "RestException code=21211 status=400: The 'To' number +*********34 is not a valid phone number."
    );
    expect(describeError("plain +14165551234")).toBe("plain +*********34");
  });
});
