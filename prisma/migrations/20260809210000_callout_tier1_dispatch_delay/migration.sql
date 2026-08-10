-- Deferred opening outreach: a posted shift now waits out a short delay before
-- tier-1 SMS/voice/email goes out, so a mis-posted shift can be pulled first.

-- AlterTable
-- Non-null means "tier-1 outreach is still pending, due at this time"; it is
-- cleared the moment tier 1 is dispatched. Existing campaigns already contacted
-- their tier 1 synchronously, so NULL is the correct backfill for every row.
ALTER TABLE "CalloutCampaign" ADD COLUMN     "tier1DispatchAt" TIMESTAMP(3);
