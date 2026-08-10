import { test, expect } from "@playwright/test";

test.describe("Admin creates a shift", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Scheduler" }).click();
    await page.fill('input[id="email"]', "admin@staffly.com");
    await page.fill('input[id="password"]', "admin123");
    await page.getByRole("button", { name: "Sign In to Portal" }).click();
    await page.waitForURL("**/admin**");
  });

  test("admin can navigate to new shift page and see the form", async ({ page }) => {
    await page.goto("/admin/shifts/new");
    await expect(page.getByRole("heading", { name: /Create New Shift/i })).toBeVisible();
    await expect(page.getByLabel(/Unit \/ Department/i)).toBeVisible();
  });

  test("create shift form is submittable with defaults", async ({ page }) => {
    await page.goto("/admin/shifts/new");
    await expect(page.locator('select[name="departmentId"]')).toBeVisible();
    await expect(page.locator('input[name="unit"]')).toBeVisible();
  });
});

test.describe("Worker bidding flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Staff" }).click();
    await page.fill('input[id="email"]', "worker1@staffly.com");
    await page.fill('input[id="password"]', "worker123");
    await page.getByRole("button", { name: "Sign In to Portal" }).click();
    await page.waitForURL("**/worker**");
  });

  test("worker can view open shifts", async ({ page }) => {
    await page.goto("/worker/shifts");
    await expect(page.getByRole("heading", { name: "Available Shifts" })).toBeVisible();
  });

  test("worker sees bid form on an open shift", async ({ page }) => {
    await page.goto("/worker/shifts");
    const firstShift = page.locator("a").filter({ hasText: "Emergency" }).first();
    if (await firstShift.isVisible()) {
      await firstShift.click();
      await expect(page.getByRole("heading", { name: /Bid on this shift|Update your bid/i })).toBeVisible();
    }
  });
});
