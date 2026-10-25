-- RC1 race guards. See CLAUDE.md "Concurrency guards".

-- Optimistic concurrency for shift edits: every shift write bumps it, and an
-- admin edit/cancel must carry the version its page rendered.
ALTER TABLE "Shift" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- One ACTIVE swap/giveaway request per give shift (a double tap used to create
-- two). Any duplicates already present are the bug itself: keep the most
-- advanced one (then the oldest) and cancel the rest so the index can build.
UPDATE "ShiftSwapRequest" SET "status" = 'CANCELLED', "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (
      PARTITION BY "giveShiftId"
      ORDER BY CASE "status" WHEN 'PENDING_APPROVAL' THEN 0 WHEN 'ACCEPTED' THEN 1 ELSE 2 END, "requestedAt", "id"
    ) AS rn
    FROM "ShiftSwapRequest"
    WHERE "status" IN ('PENDING_ACCEPT', 'ACCEPTED', 'PENDING_APPROVAL')
  ) ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX "ShiftSwapRequest_one_active_per_give_shift"
  ON "ShiftSwapRequest"("giveShiftId")
  WHERE "status" IN ('PENDING_ACCEPT', 'ACCEPTED', 'PENDING_APPROVAL');
