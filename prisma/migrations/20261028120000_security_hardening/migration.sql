-- Security hardening (review findings F6, F7, F10, F11).

-- F11: a verified phone number belongs to exactly one person - it is how an
-- inbound SMS finds its sender. Prisma can't express a partial unique index,
-- so it lives only here (Prisma's diff ignores it; don't drop it). Any
-- existing duplicates keep their number but all except the earliest-verified
-- holder lose the verification, so they re-verify and land on a clear error.
UPDATE "User" u
SET "phoneVerifiedAt" = NULL
WHERE u."phoneVerifiedAt" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "User" o
    WHERE o."phone" = u."phone"
      AND o."phoneVerifiedAt" IS NOT NULL
      AND (o."phoneVerifiedAt", o."id") < (u."phoneVerifiedAt", u."id")
  );

CREATE UNIQUE INDEX "User_verified_phone_key" ON "User"("phone") WHERE "phoneVerifiedAt" IS NOT NULL;

-- F6/F7: rate-limited events (failed logins, verification-code sends),
-- counted over sliding windows by src/lib/throttle/. Shared by every server
-- instance, unlike the old in-memory counter.
CREATE TABLE "ThrottleEvent" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThrottleEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ThrottleEvent_bucket_createdAt_idx" ON "ThrottleEvent"("bucket", "createdAt");
CREATE INDEX "ThrottleEvent_createdAt_idx" ON "ThrottleEvent"("createdAt");

-- F10: inbound Twilio webhooks already handled, keyed by provider id.
CREATE TABLE "ProcessedWebhook" (
    "key" TEXT NOT NULL,
    "response" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhook_pkey" PRIMARY KEY ("key")
);
