-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "smsCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Shift_smsCode_key" ON "Shift"("smsCode");
