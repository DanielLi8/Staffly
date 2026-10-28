-- CreateEnum
CREATE TYPE "StaffingRole" AS ENUM ('RN', 'RPN', 'PSW');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT');

-- CreateEnum
CREATE TYPE "ShiftPattern" AS ENUM ('EIGHT_HOUR', 'TWELVE_HOUR');

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "location" TEXT,
ADD COLUMN     "shiftPattern" "ShiftPattern" NOT NULL DEFAULT 'EIGHT_HOUR',
ADD COLUMN     "unitLabel" TEXT;

-- CreateTable
CREATE TABLE "ShiftTemplate" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "pattern" "ShiftPattern" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "leadRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingTarget" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "dayOfWeek" "DayOfWeek" NOT NULL,
    "role" "StaffingRole" NOT NULL,
    "count" INTEGER NOT NULL,
    "setById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffingTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingTargetOverride" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "role" "StaffingRole" NOT NULL,
    "count" INTEGER NOT NULL,
    "reason" TEXT,
    "setById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffingTargetOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShiftTemplate_departmentId_code_key" ON "ShiftTemplate"("departmentId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "StaffingTarget_templateId_dayOfWeek_role_key" ON "StaffingTarget"("templateId", "dayOfWeek", "role");

-- CreateIndex
CREATE INDEX "StaffingTargetOverride_date_idx" ON "StaffingTargetOverride"("date");

-- CreateIndex
CREATE UNIQUE INDEX "StaffingTargetOverride_templateId_date_role_key" ON "StaffingTargetOverride"("templateId", "date", "role");

-- AddForeignKey
ALTER TABLE "ShiftTemplate" ADD CONSTRAINT "ShiftTemplate_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingTarget" ADD CONSTRAINT "StaffingTarget_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ShiftTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingTarget" ADD CONSTRAINT "StaffingTarget_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingTargetOverride" ADD CONSTRAINT "StaffingTargetOverride_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ShiftTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingTargetOverride" ADD CONSTRAINT "StaffingTargetOverride_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Default shift definitions for every existing department (captain decision
-- shift-hours-default): 8 h Day 07-15 / Evening 15-23 / Night 23-07, which
-- `Department.shiftPattern` selects by default, plus the 12 h Day 07-19 /
-- Night 19-07 set a department can switch to. Minutes are hospital-clock;
-- an end at or before the start ends the next morning.
INSERT INTO "ShiftTemplate" ("id", "departmentId", "pattern", "code", "label", "startMinute", "endMinute", "sortOrder", "updatedAt")
SELECT 'tpl_' || md5(d."id" || ':' || t.code), d."id", t.pattern::"ShiftPattern", t.code, t.label, t.start_minute, t.end_minute, t.sort_order, CURRENT_TIMESTAMP
FROM "Department" d
CROSS JOIN (VALUES
  ('EIGHT_HOUR', 'D', 'Day', 420, 900, 0),
  ('EIGHT_HOUR', 'E', 'Evening', 900, 1380, 1),
  ('EIGHT_HOUR', 'N', 'Night', 1380, 420, 2),
  ('TWELVE_HOUR', 'D12', 'Day', 420, 1140, 0),
  ('TWELVE_HOUR', 'N12', 'Night', 1140, 420, 1)
) AS t(pattern, code, label, start_minute, end_minute, sort_order);
