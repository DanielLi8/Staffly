/**
 * Pure sliding-window rate-limit policy. A limit allows at most `max` events
 * per `windowMs`; the store (`./store.ts`) supplies the count of recent events
 * per bucket, so this stays unit-testable without a database.
 */
export interface Limit {
  max: number;
  windowMs: number;
}

const MINUTE = 60 * 1000;

/** Failed sign-ins. Throttled when ANY of these is reached. */
export const LOGIN_LIMITS = {
  /** One account from one address - the ordinary guessing case. */
  accountAndIp: { max: 5, windowMs: 15 * MINUTE },
  /** One account from anywhere - guessing spread over many addresses. */
  account: { max: 20, windowMs: 15 * MINUTE },
  /**
   * One address across accounts - password spraying. High, because a whole
   * hospital can sit behind one NAT address.
   */
  ip: { max: 100, windowMs: 15 * MINUTE },
} as const satisfies Record<string, Limit>;

/** The `error` NextAuth hands the login form when sign-in is throttled. */
export const LOGIN_THROTTLED = "THROTTLED";

/** Verification-code SMS sends (each one costs money and texts a stranger if mistyped). */
export const PHONE_VERIFY_LIMITS = {
  userBurst: { max: 3, windowMs: 10 * MINUTE },
  userDaily: { max: 10, windowMs: 24 * 60 * MINUTE },
  phoneBurst: { max: 3, windowMs: 10 * MINUTE },
  phoneDaily: { max: 10, windowMs: 24 * 60 * MINUTE },
} as const satisfies Record<string, Limit>;

/** Events older than this are never counted by any limit above, so may be pruned. */
export const THROTTLE_RETENTION_MS = 24 * 60 * MINUTE;

export function isOverLimit(recentCount: number, limit: Limit): boolean {
  return recentCount >= limit.max;
}

/** Normalize an email the way sign-in compares it, so case can't buy extra attempts. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
