-- Live admin shift page: delivery callbacks and replies must tick the page's
-- revision, so OutreachAttempt gets an updatedAt. Additive; the column default
-- fills existing rows, then they are backfilled to their last known change.

-- AlterTable
ALTER TABLE "OutreachAttempt" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "OutreachAttempt" SET "updatedAt" = GREATEST("createdAt", COALESCE("respondedAt", "createdAt"));

-- CreateIndex
-- The revision check counts a shift's activity rows every few seconds while
-- an admin has the page open.
CREATE INDEX "ShiftActivity_shiftId_idx" ON "ShiftActivity"("shiftId");
