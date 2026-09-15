-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isTeamLead" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: "Lead RN" has never been a value of User.position (position stays
-- the base clinical position, e.g. "Registered Nurse") - the only place a lead
-- designation was ever recorded is the free-text DepartmentMembership.title
-- roster label (e.g. "Lead RN", "Team Lead"). Promote anyone whose title
-- signals that into the new tag so no existing lead designation is lost. The
-- title itself is left untouched: it is a legitimate per-department roster
-- label independent of this account-level tag, not something being replaced.
UPDATE "User"
SET "isTeamLead" = true
WHERE "id" IN (
  SELECT DISTINCT "userId"
  FROM "DepartmentMembership"
  WHERE "title" ILIKE '%lead%'
);
