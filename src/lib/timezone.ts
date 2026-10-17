/** Hospital scheduling timezone. Keep this explicit; do not rely on process TZ. */
export const HOSPITAL_TIME_ZONE = "America/New_York";

const parts = (date: Date | string) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: HOSPITAL_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(date))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value])
  ) as Record<string, string>;

export function hospitalDate(date: Date | string): string {
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

export function hospitalTime(date: Date | string, hour12 = true): string {
  // 24h uses an explicit h23 cycle: `hour12: false` alone lets Node's ICU pick
  // h24 and print midnight as "24:00" while browsers print "00:00", which
  // breaks hydration of any server-rendered time.
  return new Intl.DateTimeFormat("en-US", {
    timeZone: HOSPITAL_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    ...(hour12 ? { hour12: true } : { hourCycle: "h23" as const }),
  }).format(new Date(date));
}

export function hospitalDateTime(date: Date | string): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: HOSPITAL_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
  return `${formatted} · ${hospitalTime(date)}`;
}

export function hospitalDateLong(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: HOSPITAL_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

export function hospitalCalendarDay(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: HOSPITAL_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(date));
}

export function hospitalDateYear(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: HOSPITAL_TIME_ZONE, month: "long", day: "numeric", year: "numeric" }).format(new Date(date));
}

export function hospitalMonthDay(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: HOSPITAL_TIME_ZONE, month: "short", day: "numeric" }).format(new Date(date));
}

export function hospitalMonthYear(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: HOSPITAL_TIME_ZONE, month: "long", year: "numeric" }).format(new Date(date));
}

export function hospitalTimeWithSeconds(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: HOSPITAL_TIME_ZONE, hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }).format(new Date(date));
}

export function hospitalWeekday(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: HOSPITAL_TIME_ZONE, weekday: "short" }).format(new Date(date));
}

export function hospitalDay(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: HOSPITAL_TIME_ZONE, day: "numeric" }).format(new Date(date));
}

// ---------------------------------------------------------------------------
// Hospital calendar-day math for the schedule time grid and availability.
//
// A "day key" is a hospital-timezone calendar date as `yyyy-MM-dd`. Grids are
// built from day keys and every instant is placed on them through the
// hospital clock, so a shift's position never depends on the server's or the
// browser's own TZ (Vercel runs in UTC).
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;

const wallClockFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: HOSPITAL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function wallClock(instant: Date) {
  const p = Object.fromEntries(
    wallClockFormat
      .formatToParts(instant)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)])
  ) as Record<"year" | "month" | "day" | "hour" | "minute", number>;
  return p;
}

/** Hospital UTC offset (ms) in effect at `instant`. */
function hospitalOffsetMs(instant: Date): number {
  const floored = Math.floor(instant.getTime() / MINUTE_MS) * MINUTE_MS;
  const w = wallClock(new Date(floored));
  return Date.UTC(w.year, w.month - 1, w.day, w.hour % 24, w.minute) - floored;
}

/** Minutes since hospital-local midnight (0-1439). */
export function hospitalMinutesOfDay(date: Date | string): number {
  const w = wallClock(new Date(date));
  return (w.hour % 24) * 60 + w.minute;
}

/**
 * The instant at which the hospital clock reads `minutes` past midnight on
 * `dayKey`. `minutes` may run past 1440 (into the next day), so an overnight
 * block like 19:00-07:00 is `(key, 1140)` to `(key, 1440 + 420)`. Wall times
 * skipped by a DST jump resolve to the instant just after it.
 */
export function hospitalInstant(dayKey: string, minutes = 0): Date {
  const [y, m, d] = dayKey.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  const first = wall - hospitalOffsetMs(new Date(wall));
  return new Date(wall - hospitalOffsetMs(new Date(first)));
}

/** `dayKey` shifted by `days` calendar days. */
export function addDaysToKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** Every day key from `fromKey` to `toKey`, both inclusive (empty if reversed). */
export function dayKeysBetween(fromKey: string, toKey: string): string[] {
  const keys: string[] = [];
  for (let key = fromKey; key <= toKey; key = addDaysToKey(key, 1)) keys.push(key);
  return keys;
}

/**
 * A local-midnight `Date` for a day key, for date-fns formatting only
 * ("Mon", "Oct 19"). Never use it as an instant.
 */
export function dayKeyToLocalDate(dayKey: string): Date {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, m - 1, d);
}
