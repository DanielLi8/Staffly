import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";

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
  return new Date();
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
