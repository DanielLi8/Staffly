import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { isVerifiedPhoneConflict, isVerifiedPhoneTaken } from "@/lib/phone-ownership";
import { clearLoginFailures, isLoginThrottled, recordLoginFailure } from "@/lib/login-throttle";
import { handleWebhookOnce } from "@/lib/outreach/webhook-dedupe";
import { LOGIN_LIMITS } from "@/lib/throttle/policy";
import { throttleBucket } from "@/lib/throttle/store";

/**
 * The security-review fixes that live in the schema, against real Postgres:
 * the partial unique index on verified phones (F11), the shared login
 * throttle table (F7) and the webhook de-duplication table (F10).
 *
 * Runs only via `pnpm test:db`, against a SEEDED, DISPOSABLE database. It
 * restores the two users' phones and deletes the rows it wrote.
 */

const PHONE = "+15005550199";
const EMAIL = `throttle-db-test-${Date.now()}@staffly.test`;
const IP = "203.0.113.250";
const WEBHOOK_KEY = `sms:SM-db-test-${Date.now()}`;

let a: { id: string; phone: string | null; phoneVerifiedAt: Date | null };
let b: { id: string; phone: string | null; phoneVerifiedAt: Date | null };

beforeAll(async () => {
  const select = { id: true, phone: true, phoneVerifiedAt: true } as const;
  a = await db.user.findUniqueOrThrow({ where: { email: "worker1@staffly.com" }, select });
  b = await db.user.findUniqueOrThrow({ where: { email: "worker2@staffly.com" }, select });
});

afterAll(async () => {
  await db.user.update({ where: { id: b.id }, data: { phone: b.phone, phoneVerifiedAt: b.phoneVerifiedAt } });
  await db.user.update({ where: { id: a.id }, data: { phone: a.phone, phoneVerifiedAt: a.phoneVerifiedAt } });
  await clearLoginFailures(EMAIL, IP);
  await db.throttleEvent.deleteMany({ where: { bucket: throttleBucket("login:ip", IP) } });
  await db.processedWebhook.deleteMany({ where: { key: WEBHOOK_KEY } });
  await db.$disconnect();
});

describe("one person per verified phone (F11)", () => {
  it("rejects a second verified holder but allows an unverified one", async () => {
    await db.user.update({ where: { id: a.id }, data: { phone: PHONE, phoneVerifiedAt: new Date() } });
    expect(await isVerifiedPhoneTaken(PHONE, b.id)).toBe(true);
    expect(await isVerifiedPhoneTaken(PHONE, a.id)).toBe(false);

    // Typing the number (unverified) is fine; verifying it is not.
    await db.user.update({ where: { id: b.id }, data: { phone: PHONE, phoneVerifiedAt: null } });
    const err = await db.user
      .update({ where: { id: b.id }, data: { phoneVerifiedAt: new Date() } })
      .then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
    expect(isVerifiedPhoneConflict(err)).toBe(true);
  });
});

describe("login throttle in Postgres (F7)", () => {
  it("throttles after the limit and clears on success", async () => {
    for (let i = 0; i < LOGIN_LIMITS.accountAndIp.max; i++) {
      expect(await isLoginThrottled(EMAIL, IP)).toBe(false);
      await recordLoginFailure(EMAIL, IP);
    }
    expect(await isLoginThrottled(EMAIL.toUpperCase(), IP)).toBe(true);
    await clearLoginFailures(EMAIL, IP);
    expect(await isLoginThrottled(EMAIL, IP)).toBe(false);
  });
});

describe("webhook de-duplication (F10)", () => {
  it("handles a provider id once and replays the stored response", async () => {
    let calls = 0;
    const handle = async () => `<Response><Message>reply ${++calls}</Message></Response>`;
    const [first, concurrent] = await Promise.all([
      handleWebhookOnce(WEBHOOK_KEY, handle),
      handleWebhookOnce(WEBHOOK_KEY, handle),
    ]);
    expect(calls).toBe(1);
    expect([first, concurrent]).toContain("<Response><Message>reply 1</Message></Response>");
    expect(await handleWebhookOnce(WEBHOOK_KEY, handle)).toBe("<Response><Message>reply 1</Message></Response>");
    expect(calls).toBe(1);
  });
});
