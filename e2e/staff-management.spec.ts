import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * The Staff page (/admin/workers): editing a person's position and department
 * memberships (any ADMIN), and adding / deactivating / reactivating an account
 * (only an admin `canManageStaffAccounts` allows - the server must run with
 * STAFF_ACCOUNT_MANAGERS including admin@staffly.com, as CI does).
 */

const ADMIN = { email: "admin@staffly.com", password: "admin123" };

async function signIn(browser: Browser, portal: "Admin" | "Staff", creds: { email: string; password: string }): Promise<Page> {
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

function staffRow(page: Page, name: string) {
  return page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
}

test("an admin edits a staff member's position and department membership", async ({ browser }) => {
  test.setTimeout(90_000);
  const admin = await signIn(browser, "Admin", ADMIN);

  await admin.goto("/admin/workers");
  await expect(admin.getByRole("heading", { name: "Staff", level: 1 })).toBeVisible();
  const priyaRow = staffRow(admin, "Priya Sharma");
  await expect(priyaRow.locator('abbr[title="Registered Nurse"]')).toHaveText("RN");
  await expect(priyaRow).toContainText("Intensive Care Unit");
  await priyaRow.getByRole("link", { name: "Priya Sharma" }).click();
  await admin.waitForURL(/\/admin\/workers\/(?!new)[^/]+$/);
  const recordUrl = admin.url();

  // Position from the canonical list, a new membership with a roster title,
  // and a changed title on the existing one - all in one save.
  await admin.getByLabel("Position").selectOption({ label: "Registered Practical Nurse (RPN)" });
  await admin.getByLabel("Add to department").selectOption({ label: "Medical/Surgical (MED)" });
  await admin.getByRole("button", { name: "Add", exact: true }).click();
  await admin.getByLabel("Roster title in Medical/Surgical").fill("Float RPN");
  await admin.getByLabel("Roster title in Intensive Care Unit").fill("Charge RPN");
  await admin.getByRole("button", { name: "Save changes" }).click();
  await expect(admin.getByText("Changes saved")).toBeVisible();

  // Survives a reload, and the Staff list shows it.
  await admin.reload();
  await expect(admin.getByLabel("Position")).toHaveValue("Registered Practical Nurse");
  await expect(admin.getByLabel("Roster title in Medical/Surgical")).toHaveValue("Float RPN");
  await expect(admin.getByLabel("Roster title in Intensive Care Unit")).toHaveValue("Charge RPN");
  await admin.goto("/admin/workers");
  await expect(staffRow(admin, "Priya Sharma").locator('abbr[title="Registered Practical Nurse"]')).toHaveText("RPN");
  await expect(staffRow(admin, "Priya Sharma")).toContainText("Float RPN");

  // A bad roster title is refused inline, never saved.
  await admin.goto(recordUrl);
  await admin.getByLabel("Roster title in Medical/Surgical").fill("");
  await admin.getByRole("button", { name: "Save changes" }).click();
  await expect(admin.getByText("Add a roster title, e.g. RN or Lead RN")).toBeVisible();

  // Restore the seed so other specs see Priya as an ICU RN.
  await admin.reload();
  await admin.getByLabel("Position").selectOption({ label: "Registered Nurse (RN)" });
  await admin.getByRole("button", { name: "Remove from Medical/Surgical" }).click();
  await admin.getByLabel("Roster title in Intensive Care Unit").fill("RN");
  await admin.getByRole("button", { name: "Save changes" }).click();
  await expect(admin.getByText("Changes saved")).toBeVisible();
  await admin.reload();
  await expect(admin.getByLabel("Position")).toHaveValue("Registered Nurse");
  await expect(admin.getByLabel("Roster title in Medical/Surgical")).toHaveCount(0);
});

test("a staff account manager adds, deactivates and reactivates a new hire", async ({ browser }) => {
  test.setTimeout(90_000);
  const admin = await signIn(browser, "Admin", ADMIN);
  const stamp = Date.now();
  const email = `e2e.newhire.${stamp}@staffly.test`;
  const name = `Jordan Lee ${stamp}`;

  await admin.goto("/admin/workers");
  await admin.getByRole("link", { name: "Add staff" }).click();
  await admin.waitForURL("**/admin/workers/new");
  await admin.getByLabel("Full name").fill(name);
  await admin.getByLabel("Work email").fill(email);
  await admin.getByLabel("Position").selectOption({ label: "Personal Support Worker (PSW)" });
  await admin.getByLabel("Add to department").selectOption({ label: "Emergency Department (ER)" });
  await admin.getByRole("button", { name: "Add", exact: true }).click();
  await expect(admin.getByLabel("Roster title in Emergency Department")).toHaveValue("PSW");
  await admin.getByRole("button", { name: "Add staff member" }).click();

  await admin.waitForURL(/\/admin\/workers\/(?!new)[^/?]+\?added=1$/);
  await expect(admin.getByText(`${name} was added.`)).toBeVisible();
  const account = admin.getByRole("region", { name: "Account" });
  await expect(account).toContainText("Pending");

  // The same email again is a typed, inline failure.
  await admin.goto("/admin/workers/new");
  await admin.getByLabel("Full name").fill(name);
  await admin.getByLabel("Work email").fill(email.toUpperCase());
  await admin.getByLabel("Position").selectOption({ label: "Personal Support Worker (PSW)" });
  await admin.getByRole("button", { name: "Add staff member" }).click();
  await expect(admin.getByText("Someone already has this email")).toBeVisible();
  await admin.goBack();
  await admin.goBack();

  // Deactivate: no upcoming shifts, so it goes through.
  await admin.getByRole("button", { name: "Deactivate…" }).click();
  const dialog = admin.getByRole("dialog", { name: `Deactivate ${name}?` });
  await dialog.getByLabel("Reason").selectOption("End of contract");
  await dialog.getByRole("button", { name: "Deactivate" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(account).toContainText("Deactivated");
  await expect(account).toContainText("End of contract");

  await admin.goto("/admin/workers");
  await expect(staffRow(admin, name)).toHaveCount(0);
  await admin.getByRole("button", { name: /^Deactivated/ }).click();
  await staffRow(admin, name).getByRole("link", { name }).click();
  await admin.getByRole("button", { name: "Reactivate" }).click();
  await expect(account).toContainText("Pending");
});

test("deactivation is refused while the person still has an upcoming shift", async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = await signIn(browser, "Admin", ADMIN);

  // Give Thomas Nguyen (ER PSW) an upcoming assigned shift: post, bid, award.
  await admin.goto("/admin/shifts/new");
  await admin.selectOption("#departmentId", { label: "Emergency Department (ER)" });
  await admin.selectOption("#roleNeeded", "Personal Support Worker (PSW)");
  await admin.fill("#unit", "4B");
  await admin.fill("#location", "E2E staff page - deactivation block");
  await admin.getByRole("button", { name: "Submit Shift" }).click();
  await admin.waitForURL(/\/admin\/shifts\/(?!new)[^/]+$/);
  const shiftUrl = admin.url();

  const thomas = await signIn(browser, "Staff", { email: "worker4@staffly.com", password: "worker123" });
  await thomas.goto(shiftUrl.replace("/admin/", "/worker/"));
  await thomas.getByRole("button", { name: "Bid for Shift" }).click();
  await thomas.getByRole("button", { name: "Submit bid" }).click();
  await expect(thomas.getByRole("button", { name: "Submit bid" })).toHaveCount(0);

  await admin.reload();
  await admin.getByRole("button", { name: "Select" }).click();
  await admin.getByRole("button", { name: "Confirm" }).click();
  await expect(admin.getByText("Thomas Nguyen").first()).toBeVisible();
  await expect(admin.getByRole("button", { name: "Select" })).toHaveCount(0);

  await admin.goto("/admin/workers");
  await staffRow(admin, "Thomas Nguyen").getByRole("link", { name: "Thomas Nguyen" }).click();
  await expect(admin.getByRole("heading", { name: "Thomas Nguyen", level: 1 })).toBeVisible();
  await admin.getByRole("button", { name: "Deactivate…" }).click();
  const dialog = admin.getByRole("dialog", { name: "Deactivate Thomas Nguyen?" });
  await expect(dialog.getByRole("alert")).toContainText(/still has \d+ upcoming shifts?/);
  await expect(dialog.getByRole("link", { name: /.+/ }).first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close" }).last().click();
  await expect(dialog).toHaveCount(0);
  await expect(admin.getByRole("region", { name: "Account" })).toContainText("Active");

  // Leave no assigned shift behind for other specs.
  await admin.goto(shiftUrl);
  await admin.getByRole("button", { name: "Cancel Shift" }).click();
  await admin.getByRole("button", { name: "Yes, Cancel" }).click();
  await expect(admin.getByRole("button", { name: "Yes, Cancel" })).toHaveCount(0);
});
