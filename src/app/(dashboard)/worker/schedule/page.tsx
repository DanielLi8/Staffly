import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { cn } from "@/lib/utils";

export const metadata = { title: "Your Schedule – Staffly" };

type ScheduleView = "day" | "week" | "month";

function parseView(v: string | undefined): ScheduleView {
  if (v === "day" || v === "month") return v;
  return "week";
}

function scheduleHref(date: Date, view: ScheduleView) {
  return `/worker/schedule?date=${format(date, "yyyy-MM-dd")}&view=${view}`;
}

function primaryHeading(anchor: Date, view: ScheduleView, weekStart: Date, weekEnd: Date): string {
  if (view === "day") return format(anchor, "EEEE, MMMM d, yyyy");
  if (view === "month") return format(anchor, "MMMM yyyy");
  if (isSameMonth(weekStart, weekEnd)) {
    return `${format(weekStart, "MMMM d")}–${format(weekEnd, "d, yyyy")}`;
  }
  return `${format(weekStart, "MMM d, yyyy")} – ${format(weekEnd, "MMM d, yyyy")}`;
}

export default async function WorkerSchedulePage({
  searchParams,
}: {
  searchParams: { week?: string; date?: string; view?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const raw = searchParams.date ?? searchParams.week;
  let anchor = new Date();
  if (raw) {
    const parsed = parseISO(raw);
    if (isValid(parsed)) anchor = parsed;
  }

  const view = parseView(searchParams.view);

  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(anchor, { weekStartsOn: 1 });
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);

  let rangeStart: Date;
  let rangeEnd: Date;
  if (view === "day") {
    rangeStart = startOfDay(anchor);
    rangeEnd = endOfDay(anchor);
  } else if (view === "week") {
    rangeStart = weekStart;
    rangeEnd = weekEnd;
  } else {
    rangeStart = monthStart;
    rangeEnd = monthEnd;
  }

  const shifts = await db.shift.findMany({
    where: {
      assignedWorkerId: session.user.id,
      startsAt: { gte: rangeStart, lte: rangeEnd },
    },
    include: { department: { select: { name: true, code: true } } },
    orderBy: { startsAt: "asc" },
  });

  const hours = shifts.reduce(
    (acc, s) => acc + (s.endsAt.getTime() - s.startsAt.getTime()) / 3_600_000,
    0
  );

  const prevDate =
    view === "day" ? subDays(anchor, 1) : view === "week" ? subWeeks(anchor, 1) : subMonths(anchor, 1);
  const nextDate =
    view === "day" ? addDays(anchor, 1) : view === "week" ? addWeeks(anchor, 1) : addMonths(anchor, 1);

  const today = new Date();

  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const monthGridDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="page-title text-3xl">Your Schedule</h1>
          <p className="text-sm text-neutral-500 mt-2">Review your assigned clinical rotations.</p>
        </div>

        <div className="space-y-3">
          <div>
            <h2 className="text-2xl font-semibold text-neutral-900 tracking-tight">
              {primaryHeading(anchor, view, weekStart, weekEnd)}
            </h2>
          </div>

          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
            <div className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-1 py-1 self-start">
              <Link
                href={scheduleHref(prevDate, view)}
                className="p-2 rounded-full hover:bg-neutral-100 text-neutral-700"
                aria-label={view === "month" ? "Previous month" : view === "week" ? "Previous week" : "Previous day"}
              >
                <ChevronLeft className="w-4 h-4" />
              </Link>
              <Link
                href={scheduleHref(nextDate, view)}
                className="p-2 rounded-full hover:bg-neutral-100 text-neutral-700"
                aria-label={view === "month" ? "Next month" : view === "week" ? "Next week" : "Next day"}
              >
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            <Link
              href={scheduleHref(today, view)}
              className="h-10 px-4 inline-flex items-center justify-center rounded-full border border-neutral-200 bg-white text-sm font-medium text-neutral-800 hover:bg-neutral-50 self-start"
            >
              Today
            </Link>

            <div
              className="inline-flex rounded-full border border-neutral-200 p-0.5 bg-neutral-100 gap-0.5 self-start max-w-full overflow-x-auto"
              role="group"
              aria-label="Calendar view"
            >
              {(
                [
                  ["day", "Day"],
                  ["week", "Week"],
                  ["month", "Month"],
                ] as const
              ).map(([v, label]) => (
                <Link
                  key={v}
                  href={scheduleHref(anchor, v)}
                  className={cn(
                    "px-3 sm:px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors",
                    view === v ? "bg-white text-primary-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"
                  )}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-gradient-to-br from-primary-900 to-primary-950 text-white p-4 lg:p-5 max-w-sm shadow-sm">
        <p className="text-xs font-medium text-primary-200">
          {view === "day" ? "This day" : view === "week" ? "This week" : "This month"}
        </p>
        <p className="text-3xl font-bold mt-1 tabular-nums">{hours.toFixed(1)} hours</p>
        <p className="text-sm text-primary-200/90 mt-1">Scheduled</p>
      </div>

      {view === "day" && (
        <div className="card-base p-4 sm:p-6">
          <DayShiftList shifts={shifts} day={anchor} />
        </div>
      )}

      {view === "week" && (
        <div className="card-base overflow-x-auto">
          <div className="min-w-[720px] grid grid-cols-7 border-b border-neutral-200">
            {weekDays.map((d) => {
              const active = isSameDay(d, today);
              return (
                <div
                  key={d.toISOString()}
                  className={cn(
                    "px-2 py-3 text-center text-xs border-r border-neutral-100 last:border-r-0",
                    active && "bg-primary-50"
                  )}
                >
                  <p className="font-bold text-neutral-400 uppercase">{format(d, "EEE")}</p>
                  <p className={cn("text-lg font-semibold mt-1 tabular-nums", active ? "text-primary-800" : "text-neutral-900")}>
                    {format(d, "d")}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-7 min-h-[280px] divide-x divide-neutral-100">
            {weekDays.map((d) => {
              const dayShifts = shifts.filter((s) => isSameDay(s.startsAt, d));
              return (
                <div key={d.toISOString()} className="p-2 space-y-2 bg-neutral-50/30 min-h-[200px]">
                  {dayShifts.map((s) => (
                    <ShiftBlock key={s.id} shift={s} />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "month" && (
        <div className="card-base overflow-x-auto">
          <div className="min-w-[320px] sm:min-w-full grid grid-cols-7 border-b border-neutral-200 bg-neutral-50/80">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
              <div key={label} className="px-1 py-2 text-center text-[10px] sm:text-xs font-bold text-neutral-400 uppercase">
                {label}
              </div>
            ))}
          </div>
          <div className="min-w-[320px] sm:min-w-full grid grid-cols-7 auto-rows-fr divide-x divide-y divide-neutral-100 border-b border-neutral-200">
            {monthGridDays.map((d) => {
              const inMonth = isSameMonth(d, anchor);
              const isToday = isSameDay(d, today);
              const dayShifts = shifts.filter((s) => isSameDay(s.startsAt, d));
              return (
                <div
                  key={d.toISOString()}
                  className={cn(
                    "min-h-[88px] sm:min-h-[112px] p-1 sm:p-2 flex flex-col gap-1",
                    !inMonth && "bg-neutral-50/60 text-neutral-400",
                    inMonth && "bg-white",
                    isToday && "ring-1 ring-inset ring-primary-300 bg-primary-50/40"
                  )}
                >
                  <p
                    className={cn(
                      "text-[11px] sm:text-sm font-semibold tabular-nums shrink-0",
                      isToday ? "text-primary-800" : inMonth ? "text-neutral-900" : "text-neutral-400"
                    )}
                  >
                    {format(d, "d")}
                  </p>
                  <div className="space-y-1 overflow-y-auto max-h-[72px] sm:max-h-[96px]">
                    {dayShifts.map((s) => (
                      <ShiftBlock key={s.id} shift={s} compact />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ShiftBlock({
  shift,
  compact,
}: {
  shift: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    department: { name: string; code: string };
    roleNeeded: string;
  };
  compact?: boolean;
}) {
  const done = shift.endsAt < new Date();
  const confirmed = shift.startsAt <= new Date() && shift.endsAt >= new Date();
  return (
    <div
      className={cn(
        "rounded-md border text-left w-full",
        compact ? "p-1 sm:p-1.5 text-[9px] sm:text-[10px]" : "rounded-lg p-2 text-[11px]",
        done && "bg-neutral-100 border-neutral-200 text-neutral-700",
        confirmed && "bg-primary-700 border-primary-800 text-white",
        !done && !confirmed && "bg-white border-neutral-200 text-neutral-800"
      )}
    >
      <p className="font-bold uppercase tracking-wide opacity-80 leading-tight">
        {done ? "Done" : confirmed ? "Now" : "Assigned"}
      </p>
      <p className={cn("font-semibold mt-0.5 leading-tight", compact && "line-clamp-2")}>{shift.department.name}</p>
      {!compact && <p className="opacity-90">{shift.roleNeeded}</p>}
      <p className="mt-0.5 opacity-90 tabular-nums">
        {format(shift.startsAt, "HH:mm")}–{format(shift.endsAt, "HH:mm")}
      </p>
    </div>
  );
}

function DayShiftList({
  shifts,
  day,
}: {
  shifts: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    department: { name: string; code: string };
    roleNeeded: string;
  }[];
  day: Date;
}) {
  if (shifts.length === 0) {
    return (
      <p className="text-sm text-neutral-500 py-8 text-center">
        No shifts assigned on {format(day, "MMMM d, yyyy")}.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {shifts.map((s) => (
        <li key={s.id}>
          <ShiftBlock shift={s} />
        </li>
      ))}
    </ul>
  );
}
