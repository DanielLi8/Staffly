import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * The in-app Decline button, end to end: a STAFF member declines an open shift
 * from its detail page, and the admin's already-open shift page shows the
 * decline in the outreach log without a reload. Same single decline path as an
 * SMS "NO" or IVR key 2 (src/lib/outreach/decline.ts).
 */

const ADMIN = { email: "admin@staffly.com", password: "admin123" };
// David Kim, ICU RN: tier 3 for an ER shift, so not contacted when it posts.
const WORKER = { email: "worker2@staffly.com", password: "worker123", name: "David Kim" };

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

test("a worker's in-app decline shows on the admin shift page", async ({ browser }) => {
  test.setTimeout(120_000);

  const admin = await signIn(browser, "Admin", ADMIN);
  await admin.goto("/admin/shifts/new");
  await admin.selectOption("#departmentId", { label: "Emergency Department (ER)" });
  await admin.selectOption("#roleNeeded", "Registered Nurse (RN)");
  await admin.fill("#unit", "4B");
  await admin.fill("#location", "E2E decline - Nurse Station 3");
  await admin.getByRole("button", { name: "Submit Shift" }).click();
  await admin.waitForURL(/\/admin\/shifts\/(?!new)[^/]+$/);
  const shiftId = new URL(admin.url()).pathname.split("/").pop()!;
  const outreachLog = admin.getByRole("table");

  await admin.evaluate(() => {
    (window as unknown as { __noReload: boolean }).__noReload = true;
  });

  const worker = await signIn(browser, "Staff", WORKER);
  await worker.goto(`/worker/shifts/${shiftId}`);
  await expect(worker.getByRole("button", { name: "Bid for Shift" })).toBeVisible();
  await worker.getByRole("button", { name: "Decline" }).click();
  await expect(worker.getByText("You declined this shift.")).toBeVisible();
  await expect(worker.getByRole("button", { name: "Decline" })).toHaveCount(0);
  // Changing their mind is still possible.
  await expect(worker.getByRole("button", { name: "Bid for Shift" })).toBeVisible();

  const row = outreachLog.getByRole("row").filter({ hasText: WORKER.name });
  await expect(row).toBeVisible({ timeout: LIVE_TIMEOUT });
  await expect(row).toContainText("Not contacted");
  await expect(row).toContainText("Declined");
  await expect(row).toContainText("in app");
  expect(await admin.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);

  // The available-shifts list marks it too.
  await worker.goto("/worker/shifts");
  await expect(worker.locator(`a[href="/worker/shifts/${shiftId}"]`)).toContainText("You declined");
});
