import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import twilio from "twilio";

/**
 * Sessions and revocation, end to end (security review F2, captain decision
 * `session-lifetime-policy`): a session lasts 12 hours, or 7 days with
 * "remember me"; a demoted or deactivated user is cut off on the next request;
 * a deactivated user cannot bid by SMS.
 *
 * Uses its own throwaway accounts (never the shared demo users, which other
 * specs sign in as concurrently). The SMS leg needs TWILIO_AUTH_TOKEN set (to
 * any value) in both this process and the app server; no SMS is ever sent.
 */

const PASSWORD = "session-e2e-pass";
const RUN = Date.now().toString(36);
const SESSION_COOKIE = "next-auth.session-token";
const HOUR = 60 * 60;

const prisma = new PrismaClient();
const createdIds: string[] = [];

async function createAccount(role: Role, extra: { phone?: string } = {}) {
  const user = await prisma.user.create({
    data: {
      name: `Session E2E ${role} ${RUN}`,
      email: `session-e2e-${role.toLowerCase()}-${RUN}-${createdIds.length}@staffly.test`,
      password: await bcrypt.hash(PASSWORD, 4),
      role,
      // No position: matches no shift, so the other specs' concurrent callouts
      // never page these throwaway accounts.
      position: null,
      ...(extra.phone ? { phone: extra.phone, phoneVerifiedAt: new Date() } : {}),
    },
  });
  createdIds.push(user.id);
  return user;
}

async function signIn(
  browser: Browser,
  user: { email: string; role: Role },
  remember: boolean
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByRole("radio", { name: user.role === "ADMIN" ? "Admin" : "Staff" }).click();
  await page.fill('input[id="email"]', user.email);
  await page.fill('input[id="password"]', PASSWORD);
  if (remember) await page.getByLabel("Remember me for 7 days").check();
  await page.getByRole("button", { name: "Sign In to Portal" }).click();
  await page.waitForURL(user.role === "ADMIN" ? "**/admin**" : "**/worker**");
  return { context, page };
}

async function sessionCookie(context: BrowserContext) {
  return (await context.cookies()).find((c) => c.name === SESSION_COOKIE);
}

test.describe("Sessions and revocation", () => {
  test.afterAll(async () => {
    await prisma.shiftBid.deleteMany({ where: { workerId: { in: createdIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: createdIds } } });
    await prisma.outreachAttempt.deleteMany({ where: { userId: { in: createdIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.$disconnect();
  });

  test("without remember me the session lasts 12 hours; with it, 7 days", async ({ browser }) => {
    test.setTimeout(120_000);
    const worker = await createAccount("STAFF");

    for (const [remember, hours] of [
      [false, 12],
      [true, 7 * 24],
    ] as const) {
      const { context, page } = await signIn(browser, worker, remember);
      const cookie = await sessionCookie(context);
      expect(cookie, "session cookie set").toBeTruthy();
      const lifetime = cookie!.expires - Date.now() / 1000;
      expect(lifetime).toBeGreaterThan(hours * HOUR - 120);
      expect(lifetime).toBeLessThanOrEqual(hours * HOUR + 5);

      // A later request refreshes the cookie but never extends it.
      await page.goto("/worker/schedule");
      await expect(page).toHaveURL(/\/worker\/schedule/);
      const refreshed = await sessionCookie(context);
      expect(refreshed!.expires).toBeLessThanOrEqual(cookie!.expires + 1);
      await context.close();
    }
  });

  test("a demoted admin is rejected on the next request", async ({ browser }) => {
    test.setTimeout(90_000);
    const admin = await createAccount("ADMIN");
    const { context, page } = await signIn(browser, admin, true);
    await page.goto("/admin/workers");
    await expect(page).toHaveURL(/\/admin\/workers/);

    await prisma.user.update({ where: { id: admin.id }, data: { role: "STAFF" } });

    await page.goto("/admin/workers");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: "Sign In to Portal" })).toBeVisible();
    // Nothing on the old cookie works any more, including the APIs.
    const notifications = await page.request.get("/api/notifications");
    expect(notifications.status()).toBe(401);
    await context.close();
  });

  test("a deactivated worker is signed out on the next request and cannot bid by SMS", async ({
    browser,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    expect(authToken, "TWILIO_AUTH_TOKEN must be set for the signed SMS webhook leg").toBeTruthy();

    const phone = `+1416555${String(Date.now() % 10_000).padStart(4, "0")}`;
    const worker = await createAccount("STAFF", { phone });
    const { context, page } = await signIn(browser, worker, false);
    await expect(page).toHaveURL(/\/worker/);

    await prisma.user.update({ where: { id: worker.id }, data: { deactivatedAt: new Date() } });

    await page.goto("/worker/schedule");
    await expect(page).toHaveURL(/\/login/);
    // The login page's session check clears the dead cookie.
    await expect.poll(async () => (await sessionCookie(context))?.value ?? "").toBe("");

    // Signing in again is refused with the generic message.
    await page.getByRole("radio", { name: "Staff" }).click();
    await page.fill('input[id="email"]', worker.email);
    await page.fill('input[id="password"]', PASSWORD);
    await page.getByRole("button", { name: "Sign In to Portal" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Invalid credentials" })).toBeVisible();
    await context.close();

    // A "YES <code>" from the deactivated worker's verified phone is refused.
    const shift = await prisma.shift.findFirst({
      where: { status: "OPEN", smsCode: { not: null }, endsAt: { gt: new Date() } },
      select: { id: true, smsCode: true },
    });
    expect(shift, "seed has an open shift with an SMS code").toBeTruthy();
    const webhookUrl = `${baseURL}/api/webhooks/twilio/inbound-sms`;
    const params = { From: phone, Body: `YES ${shift!.smsCode}` };
    const sms = await request.post(webhookUrl, {
      form: params,
      headers: { "X-Twilio-Signature": twilio.getExpectedTwilioSignature(authToken!, webhookUrl, params) },
    });
    expect(sms.status()).toBe(200);
    expect(await sms.text()).toMatch(/couldn(&apos;|')t match your number/);
    expect(await prisma.shiftBid.count({ where: { workerId: worker.id } })).toBe(0);
  });
});
