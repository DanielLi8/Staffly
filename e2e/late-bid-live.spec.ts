import { test, expect, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import twilio from "twilio";

/**
 * The captain's scenario, executable: an admin posts a shift, walks the callout
 * to tier 3 and stops outreach, then bids keep arriving - one in-app, one by SMS
 * reply. The admin's already-open shift page must show each bid within a few
 * seconds WITHOUT a reload (it used to stay at "Bidders (0)" until a refresh).
 *
 * Runs with no Inngest keys (CI has none), so posting dispatches tier 1 at
 * once. The SMS leg needs TWILIO_AUTH_TOKEN set (to any value) in both this
 * process and the app server so the webhook signature can be produced here and
 * verified there; no SMS is ever sent (no account SID / from number).
 */

const ADMIN = { email: "admin@staffly.com", password: "admin123" };
// David Kim, ICU RN: reached only in tier 3 for an ER shift.
const IN_APP_BIDDER = { email: "worker2@staffly.com", password: "worker123", name: "David Kim" };
// Maria Santos, ER RN, with a verified phone in the seed.
const SMS_BIDDER = { phone: "+14165550101", name: "Maria Santos" };

const LIVE_TIMEOUT = 10_000;

async function signIn(
  browser: Browser,
  portal: "Admin" | "Staff",
  creds: { email: string; password: string }
): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByRole("radio", { name: portal }).click();
  await page.fill('input[id="email"]', creds.email);
  await page.fill('input[id="password"]', creds.password);
  await page.getByRole("button", { name: "Sign In to Portal" }).click();
  await page.waitForURL(portal === "Admin" ? "**/admin**" : "**/worker**");
  return page;
}

test.describe("Late bids reach an open admin shift page live", () => {
  const prisma = new PrismaClient();

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("bids after Stop appear without a reload (in-app, then SMS)", async ({
    browser,
    request,
    baseURL,
  }) => {
    // Two sign-ins, a posted shift and a tier walk, plus up to 2 x 10s live waits;
    // a cold `next dev` compiles each page on first hit, which dominates in CI.
    test.setTimeout(180_000);
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    expect(authToken, "TWILIO_AUTH_TOKEN must be set for the signed SMS webhook leg").toBeTruthy();

    /* --- admin posts a shift -------------------------------------------- */
    const admin = await signIn(browser, "Admin", ADMIN);
    await admin.goto("/admin/shifts/new");
    await admin.selectOption("#departmentId", { label: "Emergency Department (ER)" });
    await admin.selectOption("#roleNeeded", "Registered Nurse (RN)");
    await admin.fill("#unit", "4B");
    await admin.fill("#location", "E2E late bid - Nurse Station 2");
    await admin.getByRole("button", { name: "Submit Shift" }).click();
    await admin.waitForURL(/\/admin\/shifts\/(?!new)[^/]+$/);
    const shiftId = new URL(admin.url()).pathname.split("/").pop()!;

    /* --- advance to tier 3, then stop outreach ---------------------------- */
    const tierLabel = admin.getByText(/Tier \d of 3/);
    const currentTier = async () => Number(/Tier (\d)/.exec((await tierLabel.textContent()) ?? "")?.[1]);
    // Empty tiers are skipped, so the number of clicks to reach tier 3 varies.
    for (let tier = await currentTier(); tier < 3; tier = await currentTier()) {
      await admin.getByRole("button", { name: /^Advance to tier \d$/ }).click();
      await expect.poll(currentTier).toBeGreaterThan(tier);
    }
    const exhaust = admin.getByRole("button", { name: "Close as exhausted" });
    await expect(exhaust).toBeVisible();

    // Labels tolerate the "Stop" -> "Stop outreach" copy change.
    await admin.getByRole("button", { name: /^Stop( outreach)?$/ }).click();
    await expect(admin.getByText(/Stop the cascade\?|Stop texting and calling\?/)).toBeVisible();
    await admin.getByRole("button", { name: /^(Confirm stop|Stop outreach)$/ }).click();
    await expect(exhaust).toHaveCount(0);
    await expect(admin.getByText(/^(Cancelled|Outreach stopped)$/i).first()).toBeVisible();
    await expect(admin.getByText("Bidders (0)")).toBeVisible();

    // A marker that only survives if the page is never reloaded.
    await admin.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });

    /* --- a STAFF member bids in-app after Stop ---------------------------- */
    const worker = await signIn(browser, "Staff", IN_APP_BIDDER);
    await worker.goto(`/worker/shifts/${shiftId}`);
    await worker.getByRole("button", { name: "Bid for Shift" }).click();
    await worker.getByRole("button", { name: "Submit bid" }).click();
    await expect(worker.getByText("Your bid was submitted")).toBeVisible();

    await expect(admin.getByText("Bidders (1)")).toBeVisible({ timeout: LIVE_TIMEOUT });
    await expect(admin.getByRole("status").filter({ hasText: `New bid from ${IN_APP_BIDDER.name}` })).toHaveCount(1);

    /* --- a signed inbound SMS reply after Stop ---------------------------- */
    const shift = await prisma.shift.findUniqueOrThrow({
      where: { id: shiftId },
      select: { smsCode: true },
    });
    expect(shift.smsCode).toBeTruthy();

    const webhookUrl = `${baseURL}/api/webhooks/twilio/inbound-sms`;
    const params = { From: SMS_BIDDER.phone, Body: `YES ${shift.smsCode}` };
    const signature = twilio.getExpectedTwilioSignature(authToken!, webhookUrl, params);
    const sms = await request.post(webhookUrl, {
      form: params,
      headers: { "X-Twilio-Signature": signature },
    });
    expect(sms.status()).toBe(200);
    expect(await sms.text()).toContain("Thanks! Your bid");

    await expect(admin.getByText("Bidders (2)")).toBeVisible({ timeout: LIVE_TIMEOUT });
    await expect(admin.getByRole("status").filter({ hasText: `New bid from ${SMS_BIDDER.name}` })).toHaveCount(1);

    expect(await admin.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(
      true
    );
  });
});
