import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { createThrottleDb } from "./fake-throttle-db";

/**
 * F6: `startPhoneVerification` texted any number the caller typed, as often
 * as they liked (SMS-pumping cost, texting strangers). F11: two accounts could
 * both verify one number, so an inbound SMS could be booked to the wrong
 * person. Both are refused now, before Twilio is ever asked to send.
 */

const state = vi.hoisted(() => ({
  userId: "u1",
  // phone -> userId of a VERIFIED holder
  verified: new Map<string, string>(),
  updateError: null as unknown,
}));

const fake = vi.hoisted(() => ({ db: null as unknown as Record<string, unknown> }));
vi.mock("@/lib/db", () => ({
  get db() {
    return fake.db;
  },
}));
const throttleDb = createThrottleDb();
fake.db = {
  ...throttleDb,
  user: {
    findFirst: vi.fn(async ({ where }: { where: { phone: string; id?: { not: string } } }) => {
      const holder = state.verified.get(where.phone);
      return holder && holder !== where.id?.not ? { id: holder } : null;
    }),
    update: vi.fn(async () => {
      if (state.updateError) throw state.updateError;
      return {};
    }),
  },
};

vi.mock("@/lib/auth", () => ({
  requireAuth: async () => ({ user: { id: state.userId, role: "STAFF" } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const verify = vi.hoisted(() => ({
  sendVerificationCode: vi.fn(async () => ({ ok: true })),
  checkVerificationCode: vi.fn(async () => ({ ok: true, approved: true })),
}));
vi.mock("@/lib/outreach/verify", () => verify);

import { startPhoneVerification, confirmPhoneVerification } from "@/app/actions/profile";
import { PHONE_VERIFY_LIMITS } from "@/lib/throttle/policy";
import { PHONE_TAKEN_MESSAGE } from "@/lib/phone-ownership";

beforeEach(() => {
  throttleDb.reset();
  state.userId = "u1";
  state.verified.clear();
  state.updateError = null;
  vi.clearAllMocks();
});

describe("verification-code throttle (F6)", () => {
  it("stops sending to one account after the burst limit", async () => {
    for (let i = 0; i < PHONE_VERIFY_LIMITS.userBurst.max; i++) {
      expect(await startPhoneVerification(`+1416555000${i}`)).toEqual({ status: "sent" });
    }
    const blocked = await startPhoneVerification("+14165559999");
    expect(blocked).toMatchObject({ status: "error", message: expect.stringMatching(/too many codes/i) });
    expect(verify.sendVerificationCode).toHaveBeenCalledTimes(PHONE_VERIFY_LIMITS.userBurst.max);
  });

  it("stops texting one number however many accounts ask", async () => {
    for (let i = 0; i < PHONE_VERIFY_LIMITS.phoneBurst.max; i++) {
      state.userId = `account-${i}`;
      expect(await startPhoneVerification("+447700900123")).toEqual({ status: "sent" });
    }
    state.userId = "yet-another-account";
    expect(await startPhoneVerification("+447700900123")).toMatchObject({ status: "error" });
    expect(verify.sendVerificationCode).toHaveBeenCalledTimes(PHONE_VERIFY_LIMITS.phoneBurst.max);
  });
});

describe("one person per verified number (F11)", () => {
  it("won't text a number someone else has verified", async () => {
    state.verified.set("+14165551234", "someone-else");
    expect(await startPhoneVerification("+14165551234")).toEqual({ status: "error", message: PHONE_TAKEN_MESSAGE });
    expect(verify.sendVerificationCode).not.toHaveBeenCalled();
  });

  it("re-verifying your own number is fine", async () => {
    state.verified.set("+14165551234", "u1");
    expect(await startPhoneVerification("+14165551234")).toEqual({ status: "sent" });
  });

  it("refuses to confirm a number verified by someone else meanwhile", async () => {
    state.verified.set("+14165551234", "someone-else");
    expect(await confirmPhoneVerification("+14165551234", "123456")).toEqual({
      status: "error",
      message: PHONE_TAKEN_MESSAGE,
    });
  });

  it("turns a lost race on the unique index into the same message", async () => {
    state.updateError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["phone"] },
    });
    expect(await confirmPhoneVerification("+14165551234", "123456")).toEqual({
      status: "error",
      message: PHONE_TAKEN_MESSAGE,
    });
  });
});
