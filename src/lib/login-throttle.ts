import { LOGIN_LIMITS, normalizeEmail } from "./throttle/policy";
import { anyOverLimit, clearBuckets, recordEvents, throttleBucket } from "./throttle/store";

/**
 * Failed-sign-in throttle, persisted in Postgres (`ThrottleEvent`) so every
 * server instance shares it. Three limits (`LOGIN_LIMITS`): one account from
 * one address, one account from anywhere, and one address across accounts.
 */

function loginBuckets(email: string, ip: string | null | undefined) {
  const account = normalizeEmail(email);
  const address = ip || "unknown";
  return {
    accountAndIp: throttleBucket("login:account-ip", `${address}|${account}`),
    account: throttleBucket("login:account", account),
    ip: throttleBucket("login:ip", address),
  };
}

export async function isLoginThrottled(email: string, ip: string | null | undefined, now = new Date()): Promise<boolean> {
  const b = loginBuckets(email, ip);
  return anyOverLimit(
    [
      { bucket: b.accountAndIp, limit: LOGIN_LIMITS.accountAndIp },
      { bucket: b.account, limit: LOGIN_LIMITS.account },
      { bucket: b.ip, limit: LOGIN_LIMITS.ip },
    ],
    now
  );
}

export async function recordLoginFailure(email: string, ip: string | null | undefined, now = new Date()): Promise<void> {
  const b = loginBuckets(email, ip);
  await recordEvents([b.accountAndIp, b.account, b.ip], now);
}

/**
 * A successful sign-in clears that account's failures. The address's spraying
 * count stays: one right password doesn't vouch for the other accounts tried.
 */
export async function clearLoginFailures(email: string, ip: string | null | undefined): Promise<void> {
  const b = loginBuckets(email, ip);
  await clearBuckets([b.accountAndIp, b.account]);
}
