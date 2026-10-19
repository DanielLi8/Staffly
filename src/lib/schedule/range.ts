import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { addDaysToKey, dayKeyToLocalDate, hospitalDate, hospitalInstant } from "@/lib/timezone";

export type ScheduleView = "day" | "week" | "month";

export function parseScheduleView(v: string | undefined): ScheduleView {
  if (v === "day" || v === "month") return v;
  return "week";
}

export function parseScheduleAnchor(raw: string | undefined): Date {
  if (raw) {
    const parsed = parseISO(raw);
    if (isValid(parsed)) return parsed;
  }
  // "Today" is the hospital's today, not the server's (Vercel runs in UTC, so
  // after 8 PM in the hospital the server clock is already on tomorrow).
  return dayKeyToLocalDate(hospitalDate(new Date()));
}

export interface ScheduleRange {
  /** Start of the queried window (inclusive). */
  rangeStart: Date;
  /** End of the queried window (EXCLUSIVE) - matches `locationScheduleShiftWhere`'s `{ gte, lt }` shape. */
  rangeEnd: Date;
  weekStart: Date;
  weekEnd: Date;
  weekDays: Date[];
  monthStart: Date;
  monthEnd: Date;
  prevDate: Date;
  nextDate: Date;
}

/**
 * Shared view/anchor -> date-range resolution for every schedule page (the
 * personal calendar and the Location Schedule grid alike). `rangeEnd` is
 * always exclusive so callers can hand it straight to `locationScheduleShiftWhere`
 * or use it as `lt` in any other Prisma query, rather than juggling an
 * inclusive `endOf*` boundary per call site.
 */
export function resolveScheduleRange(view: ScheduleView, anchor: Date): ScheduleRange {
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(anchor, { weekStartsOn: 1 });
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);

  let rangeStart: Date;
  let rangeEnd: Date;
  if (view === "day") {
    rangeStart = startOfDay(anchor);
    rangeEnd = addDays(rangeStart, 1);
  } else if (view === "week") {
    rangeStart = weekStart;
    rangeEnd = addDays(weekStart, 7);
  } else {
    rangeStart = monthStart;
    rangeEnd = addMonths(monthStart, 1);
  }

  const prevDate = view === "day" ? subDays(anchor, 1) : view === "week" ? subWeeks(anchor, 1) : subMonths(anchor, 1);
  const nextDate = view === "day" ? addDays(anchor, 1) : view === "week" ? addWeeks(anchor, 1) : addMonths(anchor, 1);

  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  return { rangeStart, rangeEnd, weekStart, weekEnd, weekDays, monthStart, monthEnd, prevDate, nextDate };
}

export interface ScheduleDays {
  /** Hospital day keys (`yyyy-MM-dd`) the view draws, in order. */
  dayKeys: string[];
  /** Hospital midnight starting the first day (inclusive). */
  rangeStart: Date;
  /** Hospital midnight after the last day (EXCLUSIVE). */
  rangeEnd: Date;
}

/**
 * The days a personal schedule view draws - one day, a Mon-Sun week, or the
 * whole Monday-first weeks around a month - plus the instant window covering
 * them. Query with OVERLAP (`startsAt < rangeEnd AND endsAt > rangeStart`),
 * not `startsAt` alone, so a night shift that began the evening before the
 * first day still draws its morning half.
 */
export function resolveScheduleDays(view: ScheduleView, anchor: Date): ScheduleDays {
  const { weekDays, monthStart, monthEnd } = resolveScheduleRange(view, anchor);
  const days =
    view === "day"
      ? [anchor]
      : view === "week"
        ? weekDays
        : eachDayOfInterval({
            start: startOfWeek(monthStart, { weekStartsOn: 1 }),
            end: endOfWeek(monthEnd, { weekStartsOn: 1 }),
          });
  const dayKeys = days.map((d) => format(d, "yyyy-MM-dd"));
  return {
    dayKeys,
    rangeStart: hospitalInstant(dayKeys[0], 0),
    rangeEnd: hospitalInstant(addDaysToKey(dayKeys[dayKeys.length - 1], 1), 0),
  };
}
