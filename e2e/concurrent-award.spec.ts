import { test, expect, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Two admins award the same shift at the same moment, from two real browser
 * sessions. Exactly one award may land, and the other admin must see, in the
 * page, who got the shift and who awarded it - not a crash, and not a second
 * "You've Been Assigned!" going out. (R1 in the access-control plan; the full
 * race matrix is in tests/db/*.race.db.test.ts.)
 */

const SARAH = { email: "admin@staffly.com", password: "admin123", name: "Sarah Chen" };
const JAMES = { email: "admin2@staffly.com", password: "admin123", name: "James Okafor" };
const HOUR = 60 * 60 * 1000;

async function signIn(browser: Browser, creds: { email: string; password: string }): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByRole("radio", { name: "Admin" }).click();
  await page.fill('input[id="email"]', creds.email);
  await page.fill('input[id="password"]', creds.password);
  await page.getByRole("button", { name: "Sign In to Portal" }).click();
  await page.waitForURL("**/admin**");
  return page;
}

test.describe("Two admins award one shift at once", () => {
  const prisma = new PrismaClient();
  let shiftId: string | undefined;

  test.afterAll(async () => {
    if (shiftId) {
      await prisma.notification.deleteMany({ where: { shiftId } });
      await prisma.shift.delete({ where: { id: shiftId } });
    }
    await prisma.$disconnect();
  });

  test("one award lands; the other admin is told who got it", async ({ browser }) => {
    test.setTimeout(120_000);

    const [sarahUser, maria, aisha, er] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: SARAH.email } }),
      prisma.user.findUniqueOrThrow({ where: { email: "worker1@staffly.com" } }),
      prisma.user.findUniqueOrThrow({ where: { email: "worker3@staffly.com" } }),
      prisma.department.findUniqueOrThrow({ where: { code: "ER" } }),
    ]);
    const startsAt = new Date(Date.now() + 30 * HOUR);
    const shift = await prisma.shift.create({
      data: {
        title: "Emergency Department (ER) – Registered Nurse",
        unit: "4B",
        departmentId: er.id,
        roleNeeded: "Registered Nurse (RN)",
        location: "E2E concurrent award",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 12 * HOUR),
        createdById: sarahUser.id,
        bids: { create: [{ workerId: maria.id }, { workerId: aisha.id }] },
      },
    });
    shiftId = shift.id;

    const sarah = await signIn(browser, SARAH);
    const james = await signIn(browser, JAMES);
    await Promise.all([sarah.goto(`/admin/shifts/${shift.id}`), james.goto(`/admin/shifts/${shift.id}`)]);

    // Sarah picks Maria, James picks Aisha; both reach "Confirm selection?".
    // The bidder's own row: the innermost box containing their name.
    const selectFor = (page: Page, name: string) =>
      page.locator("div.rounded-lg", { hasText: name }).last().getByRole("button", { name: "Select" });
    await selectFor(sarah, maria.name).click();
    await selectFor(james, aisha.name).click();
    const sarahConfirm = sarah.getByRole("button", { name: "Confirm" });
    const jamesConfirm = james.getByRole("button", { name: "Confirm" });
    await expect(sarahConfirm).toBeVisible();
    await expect(jamesConfirm).toBeVisible();

    // Both confirm at the same moment.
    await Promise.all([sarahConfirm.click(), jamesConfirm.click()]);

    await expect
      .poll(async () => (await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).assignedWorkerId)
      .not.toBeNull();
    const after = await prisma.shift.findUniqueOrThrow({
      where: { id: shift.id },
      include: { assignedWorker: true },
    });

    expect(await prisma.shiftActivity.count({ where: { shiftId: shift.id, action: "WORKER_ASSIGNED" } })).toBe(1);
    expect(await prisma.notification.count({ where: { shiftId: shift.id, type: "BID_SELECTED" } })).toBe(1);

    const sarahWon = after.assignedWorkerId === maria.id;
    const loser = sarahWon ? james : sarah;
    const winnerAdmin = sarahWon ? SARAH : JAMES;
    await expect(
      loser
        .getByRole("alert")
        .filter({ hasText: `This shift was just awarded to ${after.assignedWorker!.name} by ${winnerAdmin.name}.` })
    ).toBeVisible();
  });
});
