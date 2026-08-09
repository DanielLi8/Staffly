-- Phase 4: tiered escalation cascade + live fill dashboard.

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('RUNNING', 'PAUSED', 'CANCELLED', 'FILLED', 'EXHAUSTED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CALLOUT_ESCALATED';
ALTER TYPE "NotificationType" ADD VALUE 'CALLOUT_REMINDER';

-- AlterTable
-- tier 0 = untiered outreach (everything recorded before this phase).
ALTER TABLE "OutreachAttempt" ADD COLUMN     "tier" INTEGER NOT NULL DEFAULT 0;

-- The new uniqueness below is the cascade's idempotency key. Pre-existing rows
-- were written without it, so collapse any (shift, tier, user, channel) group
-- down to its most recent attempt before the index is created.
DELETE FROM "OutreachAttempt" a
USING "OutreachAttempt" b
WHERE a."shiftId" = b."shiftId"
  AND a."tier" = b."tier"
  AND a."userId" = b."userId"
  AND a."channel" = b."channel"
  AND (a."createdAt", a."id") < (b."createdAt", b."id");

-- CreateTable
CREATE TABLE "CalloutCampaign" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "currentTier" INTEGER NOT NULL DEFAULT 1,
    "status" "CampaignStatus" NOT NULL DEFAULT 'RUNNING',
    "tier1WindowMinutes" INTEGER NOT NULL DEFAULT 15,
    "tier2WindowMinutes" INTEGER NOT NULL DEFAULT 20,
    "tier3WindowMinutes" INTEGER NOT NULL DEFAULT 30,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tier1EnteredAt" TIMESTAMP(3),
    "tier2EnteredAt" TIMESTAMP(3),
    "tier3EnteredAt" TIMESTAMP(3),
    "filledAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "pastStartReminderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalloutCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalloutCampaign_shiftId_key" ON "CalloutCampaign"("shiftId");

-- CreateIndex
CREATE INDEX "CalloutCampaign_status_idx" ON "CalloutCampaign"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachAttempt_shiftId_tier_userId_channel_key" ON "OutreachAttempt"("shiftId", "tier", "userId", "channel");

-- AddForeignKey
ALTER TABLE "CalloutCampaign" ADD CONSTRAINT "CalloutCampaign_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
