-- Staff page (staffly-staff-mgmt-page): admin-added staff have no password until
-- they set one, accounts can be deactivated (never deleted) with a reason, and
-- an optional unique HR employee ID.
--
-- "deactivatedAt" is also added by the session-revocation migration; IF NOT
-- EXISTS keeps this one safe whichever of the two is applied first.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "deactivationReason" TEXT,
ADD COLUMN "employeeId" TEXT,
ALTER COLUMN "password" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");
