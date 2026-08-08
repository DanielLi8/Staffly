import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards the Phase 2 role migration: existing rows MUST be remapped
 * ADMIN -> SCHEDULER and WORKER -> STAFF (never dropped or defaulted), and the
 * new enum must be exactly the three Phase 2 roles.
 */
const migrationsDir = resolve(__dirname, "../../prisma/migrations");

function findPhase2Migration(): string {
  const dir = readdirSync(migrationsDir).find((d) => d.includes("phase2_roles"));
  if (!dir) throw new Error("Phase 2 role migration directory not found");
  return readFileSync(resolve(migrationsDir, dir, "migration.sql"), "utf8");
}

describe("phase 2 role migration", () => {
  const sql = findPhase2Migration();

  it("creates the new Role enum with exactly STAFF, SCHEDULER, UNIT_CLERK", () => {
    expect(sql).toMatch(
      /CREATE TYPE "Role" AS ENUM \('STAFF', 'SCHEDULER', 'UNIT_CLERK'\)/
    );
  });

  it("maps existing ADMIN rows to SCHEDULER", () => {
    expect(sql).toMatch(/WHEN 'ADMIN' THEN 'SCHEDULER'/);
  });

  it("maps existing WORKER rows to STAFF", () => {
    expect(sql).toMatch(/WHEN 'WORKER' THEN 'STAFF'/);
  });

  it("does not misroute the mapping (no ADMIN->STAFF or WORKER->SCHEDULER)", () => {
    expect(sql).not.toMatch(/WHEN 'ADMIN' THEN 'STAFF'/);
    expect(sql).not.toMatch(/WHEN 'WORKER' THEN 'SCHEDULER'/);
  });

  it("adds the nullable clerkDepartmentId FK to User", () => {
    expect(sql).toMatch(/ALTER TABLE "User" ADD COLUMN "clerkDepartmentId" TEXT/);
    expect(sql).toMatch(/"User_clerkDepartmentId_fkey".*REFERENCES "Department"\("id"\)/s);
  });
});
