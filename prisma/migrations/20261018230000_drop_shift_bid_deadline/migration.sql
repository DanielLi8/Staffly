-- Bidding now stays open until a shift is awarded, cancelled, or over - even
-- after its start time - so the per-shift bid deadline no longer gates
-- anything (src/lib/shifts/bid-window.ts). Dropped rather than left as a dead
-- column so nothing can start reading it again by accident.
ALTER TABLE "Shift" DROP COLUMN "bidDeadlineAt";
