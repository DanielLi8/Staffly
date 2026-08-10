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
  return new Intl.DateTimeFormat("en-US", {
    timeZone: HOSPITAL_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12,
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
