export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

type Entry = { failures: number; firstFailureAt: number };

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();

  isAllowed(key: string, now = Date.now()): boolean {
    const entry = this.entries.get(key);
    if (!entry || now - entry.firstFailureAt >= LOGIN_WINDOW_MS) return true;
    return entry.failures < LOGIN_MAX_FAILURES;
  }

  recordFailure(key: string, now = Date.now()): void {
    const entry = this.entries.get(key);
    if (!entry || now - entry.firstFailureAt >= LOGIN_WINDOW_MS) {
      this.entries.set(key, { failures: 1, firstFailureAt: now });
    } else {
      entry.failures += 1;
    }
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}

export const loginThrottle = new LoginThrottle();
