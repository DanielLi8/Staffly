-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "iconKey" TEXT NOT NULL DEFAULT 'star',
    "wing" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateTable
CREATE TABLE "DepartmentMembership" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "DepartmentMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DepartmentMembership_departmentId_userId_key" ON "DepartmentMembership"("departmentId", "userId");
CREATE INDEX "DepartmentMembership_userId_idx" ON "DepartmentMembership"("userId");

-- AlterTable
ALTER TABLE "User" ADD COLUMN "image" TEXT;

-- AlterTable
ALTER TABLE "ShiftBid" ADD COLUMN "hourlyRate" DECIMAL(10,2);

-- Seed canonical departments (IDs stable for FK migration)
INSERT INTO "Department" ("id", "name", "code", "iconKey", "wing", "sortOrder") VALUES
('clDept_emergency', 'Emergency Department', 'ER', 'star', 'HOSPITAL WING A', 0),
('clDept_icu', 'Intensive Care Unit', 'ICU', 'activity', 'HOSPITAL WING A', 1),
('clDept_med', 'Medical/Surgical', 'MED', 'cross', 'HOSPITAL WING A', 2),
('clDept_ped', 'Pediatrics', 'PED', 'heart', 'HOSPITAL WING A', 3),
('clDept_surg', 'Surgery', 'SURG', 'scalpel', 'HOSPITAL WING A', 4),
('clDept_rad', 'Radiology', 'RAD', 'scan', 'HOSPITAL WING A', 5);

ALTER TABLE "Shift" ADD COLUMN "departmentId" TEXT;

UPDATE "Shift" SET "departmentId" = CASE TRIM("department")
  WHEN 'Emergency' THEN 'clDept_emergency'
  WHEN 'ICU' THEN 'clDept_icu'
  WHEN 'Medical/Surgical' THEN 'clDept_med'
  ELSE 'clDept_emergency'
END;

ALTER TABLE "Shift" ALTER COLUMN "departmentId" SET NOT NULL;

ALTER TABLE "Shift" DROP COLUMN "department";

-- AddForeignKey
ALTER TABLE "DepartmentMembership" ADD CONSTRAINT "DepartmentMembership_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DepartmentMembership" ADD CONSTRAINT "DepartmentMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Shift_departmentId_idx" ON "Shift"("departmentId");
CREATE INDEX "Shift_startsAt_idx" ON "Shift"("startsAt");
