-- CreateEnum
CREATE TYPE "ShiftSwapKind" AS ENUM ('SWAP', 'GIVEAWAY');

-- CreateEnum
CREATE TYPE "ShiftSwapStatus" AS ENUM ('PENDING_ACCEPT', 'ACCEPTED', 'REJECTED', 'PENDING_APPROVAL', 'APPROVED', 'DENIED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ShiftSwapRequest" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "giveShiftId" TEXT NOT NULL,
    "kind" "ShiftSwapKind" NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "receiveShiftId" TEXT,
    "status" "ShiftSwapStatus" NOT NULL DEFAULT 'PENDING_ACCEPT',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftSwapRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_requesterId_idx" ON "ShiftSwapRequest"("requesterId");

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_targetUserId_idx" ON "ShiftSwapRequest"("targetUserId");

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_giveShiftId_idx" ON "ShiftSwapRequest"("giveShiftId");

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_receiveShiftId_idx" ON "ShiftSwapRequest"("receiveShiftId");

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_status_idx" ON "ShiftSwapRequest"("status");

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_giveShiftId_fkey" FOREIGN KEY ("giveShiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_receiveShiftId_fkey" FOREIGN KEY ("receiveShiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
