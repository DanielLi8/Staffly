-- AlterTable
ALTER TABLE "Hospital" ADD COLUMN     "minRestHours" INTEGER;

-- CreateIndex
CREATE INDEX "Shift_assignedWorkerId_startsAt_idx" ON "Shift"("assignedWorkerId", "startsAt");
