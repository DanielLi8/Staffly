import { PHONE_VERIFY_LIMITS } from "./throttle/policy";
import { anyOverLimit, recordEvents, throttleBucket } from "./throttle/store";

/**
 * Verification-code sends, limited per account AND per destination number
 * (`PHONE_VERIFY_LIMITS`). Each send is a paid SMS to a number the caller
 * typed, so unlimited sends meant SMS-pumping cost and texting strangers.
 */
function verifyBuckets(userId: string, phone: string) {
  return {
    user: throttleBucket("verify:user", userId),
    phone: throttleBucket("verify:phone", phone),
  };
}

export async function isPhoneVerifyThrottled(userId: string, phone: string, now = new Date()): Promise<boolean> {
  const b = verifyBuckets(userId, phone);
  return anyOverLimit(
    [
      { bucket: b.user, limit: PHONE_VERIFY_LIMITS.userBurst },
      { bucket: b.user, limit: PHONE_VERIFY_LIMITS.userDaily },
      { bucket: b.phone, limit: PHONE_VERIFY_LIMITS.phoneBurst },
      { bucket: b.phone, limit: PHONE_VERIFY_LIMITS.phoneDaily },
    ],
    now
  );
}

export async function recordPhoneVerifySend(userId: string, phone: string, now = new Date()): Promise<void> {
  const b = verifyBuckets(userId, phone);
  await recordEvents([b.user, b.phone], now);
}
