-- Remove the UNIT_CLERK role entirely (product decision: "we don't need a clerk
-- view, all we need is staff and scheduler"). This is a REMOVAL, not a rename:
-- Postgres has no safe `ALTER TYPE ... DROP VALUE`, so the enum must be
-- recreated without it. See CLAUDE.md "Roles & access control".
--
-- ============================================================================
-- DATA LOSS WARNING FOR REVIEWERS APPLYING THIS TO A REAL DATABASE:
-- Step 1 below permanently DELETEs every User row with role = 'UNIT_CLERK'.
-- In the current seed data that is exactly one row: clerk@staffly.com
-- (Grace Adebayo). There is no replacement role to migrate these users to -
-- the captain's direction is that this role is eliminated with no mapping.
-- If your database has UNIT_CLERK users you need to keep (e.g. re-issued as
-- STAFF or ADMIN), reassign their `role` BEFORE running this migration -
-- once it runs, those rows are gone.
-- ============================================================================

-- Step 1: remove any UNIT_CLERK user rows so none remain for the enum swap
-- below. Dependent rows the User table cascades on (Account, Session,
-- DepartmentMembership, Availability) are deleted automatically; a
-- UNIT_CLERK with ShiftBid/Shift/ShiftActivity/OutreachAttempt rows (not
-- expected - a read-only role never creates them) would abort this DELETE
-- with a foreign key violation instead of silently losing that data.
DELETE FROM "User" WHERE "role" = 'UNIT_CLERK';

-- Step 2: drop the column that only ever existed to scope a UNIT_CLERK to one
-- department.
ALTER TABLE "User" DROP CONSTRAINT "User_clerkDepartmentId_fkey";
DROP INDEX "User_clerkDepartmentId_idx";
ALTER TABLE "User" DROP COLUMN "clerkDepartmentId";

-- Step 3: recreate the Role enum without UNIT_CLERK (Postgres has no
-- `ALTER TYPE ... DROP VALUE`).
CREATE TYPE "Role_new" AS ENUM ('STAFF', 'ADMIN');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'STAFF';
DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";
