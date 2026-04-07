-- CreateEnum
CREATE TYPE "BidDurationScope" AS ENUM ('FULL', 'PARTIAL');

-- AlterTable
ALTER TABLE "ShiftBid" ADD COLUMN     "durationScope" "BidDurationScope" NOT NULL DEFAULT 'FULL',
ADD COLUMN     "partialEndsAt" TIMESTAMP(3),
ADD COLUMN     "partialStartsAt" TIMESTAMP(3);
