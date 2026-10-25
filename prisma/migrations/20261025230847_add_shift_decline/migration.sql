-- CreateTable
CREATE TABLE "ShiftDecline" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "Channel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftDecline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftDecline_shiftId_idx" ON "ShiftDecline"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftDecline_shiftId_userId_key" ON "ShiftDecline"("shiftId", "userId");

-- AddForeignKey
ALTER TABLE "ShiftDecline" ADD CONSTRAINT "ShiftDecline_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftDecline" ADD CONSTRAINT "ShiftDecline_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
