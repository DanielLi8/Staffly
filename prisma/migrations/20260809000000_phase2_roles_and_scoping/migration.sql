-- Phase 2: three roles + per-department access control.
--
-- Rework the Role enum from (ADMIN, WORKER) to (STAFF, SCHEDULER, UNIT_CLERK),
-- mapping existing rows ADMIN -> SCHEDULER and WORKER -> STAFF, then add the
-- nullable clerkDepartmentId FK that scopes a UNIT_CLERK to one department.

-- Swap the enum type while preserving data via an explicit value mapping.
ALTER TYPE "Role" RENAME TO "Role_old";

CREATE TYPE "Role" AS ENUM ('STAFF', 'SCHEDULER', 'UNIT_CLERK');

ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING (
  CASE "role"::text
    WHEN 'ADMIN' THEN 'SCHEDULER'
    WHEN 'WORKER' THEN 'STAFF'
  END
)::"Role";

ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'STAFF';

DROP TYPE "Role_old";

-- Per-department scope for unit clerks.
ALTER TABLE "User" ADD COLUMN "clerkDepartmentId" TEXT;

ALTER TABLE "User" ADD CONSTRAINT "User_clerkDepartmentId_fkey" FOREIGN KEY ("clerkDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_clerkDepartmentId_idx" ON "User"("clerkDepartmentId");
