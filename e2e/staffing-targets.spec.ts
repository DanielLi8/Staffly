import { test, expect, type Page } from "@playwright/test";

/**
 * The staffing targets page, end to end: an admin opens Medical/Surgical from
 * the Staffing Targets list, raises the weekday Day RN number, saves, and sees
 * it persist across a reload with a "who and when" line in the change history;
 * then sets and removes a one-date override. Every change is put back so the
 * spec can rerun against the same seeded database.
 */

const ADMIN = { email: "admin@staffly.com", password: "admin123", name: "Sarah Chen" };

async function signInAdmin(page: Page) {
  await page.goto("/login");
  await page.getByRole("radio", { name: "Admin" }).click();
  await page.fill('input[id="email"]', ADMIN.email);
  await page.fill('input[id="password"]', ADMIN.password);
  await page.getByRole("button", { name: "Sign In to Portal" }).click();
  await page.waitForURL("**/admin**");
}

function hospitalKey(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

test("an admin edits a weekday target and a one-date override", async ({ page }) => {
  test.setTimeout(120_000);
  await signInAdmin(page);

  await page.goto("/admin/staffing-targets");
  await page.getByRole("link", { name: /Medical\/Surgical/ }).click();
  await expect(page.getByRole("heading", { name: "Medical/Surgical staffing" })).toBeVisible();

  const dayRnWeekdays = page.getByRole("textbox", { name: "Day RN, weekdays", exact: true });
  const before = Number(await dayRnWeekdays.inputValue());

  await page.getByRole("button", { name: "Increase Day RN, weekdays" }).click();
  await expect(dayRnWeekdays).toHaveValue(String(before + 1));
  await expect(page.getByText("1 unsaved change")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Saved 1 change.");

  await page.reload();
  await expect(dayRnWeekdays).toHaveValue(String(before + 1));
  const history = page.getByRole("region", { name: "Change history" });
  await expect(history.getByText(`Day RN, Weekdays: ${before} → ${before + 1}`).first()).toBeVisible();
  await expect(history.getByText(ADMIN.name).first()).toBeVisible();

  // One-date override, three weeks out so it never collides with the seed's.
  const date = hospitalKey(21);
  await page.fill("#override-date", date);
  await page.selectOption("#override-shift", { label: "Night" });
  await page.selectOption("#override-role", "PSW");
  const number = page.getByRole("textbox", { name: "Number needed on that date" });
  const usual = Number(await number.inputValue());
  await page.getByRole("button", { name: "Increase Number needed on that date" }).click();
  await page.fill("#override-reason", "E2E census spike");
  await page.getByRole("button", { name: "Set for this date" }).click();
  await expect(page.getByRole("status")).toContainText(`set to ${usual + 1}`);

  const overrides = page.getByRole("region", { name: "Date overrides" });
  const row = overrides.getByRole("listitem").filter({ hasText: "E2E census spike" });
  await expect(row).toContainText(`Night PSW`);
  await expect(row).toContainText(`(usually ${usual})`);

  // Put everything back.
  await row.getByRole("button", { name: /Remove override/ }).click();
  await expect(page.getByRole("status")).toContainText(`back to the usual ${usual}`);
  await expect(row).toHaveCount(0);

  await page.getByRole("button", { name: "Decrease Day RN, weekdays" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Saved 1 change.");
  await expect(dayRnWeekdays).toHaveValue(String(before));
});
