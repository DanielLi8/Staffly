import { eachDayOfInterval, endOfWeek, format, isSameDay, isSameMonth, startOfWeek } from "date-fns";
import { cn } from "@/lib/utils";
import { resolveScheduleRange, type ScheduleView } from "@/lib/schedule/range";
import type { AvailabilityDTO } from "@/lib/availability/types";
import { CalendarNav, primaryScheduleHeading } from "./calendar-nav";
import { AvailabilityEditor } from "@/features/availability/availability-editor";
import { ShiftBlock, type PersonalScheduleShift } from "./shift-block";

export type { PersonalScheduleShift };

/**
 * The day/week/month personal calendar - one person's own assigned shifts.
 * Originally `worker/schedule/page.tsx`'s entire render body; pulled out so
 * the STAFF self-service page and the admin "staff" search result mode
 * (`/admin/schedule?type=staff&id=...`) share one implementation instead of
 * two copies of the same grid. The caller fetches `shifts` and supplies
 * `hrefFor` so this component stays agnostic of which route it's rendered
 * under. `shiftHref` is separate and optional: when omitted (the
 * `/worker/schedule` default), shift blocks stay plain, non-interactive
 * divs, preserving STAFF's existing read-only view of their own shifts; the
 * admin "staff" search result mode passes it so a scheduler can click through
 * to `/admin/shifts/[id]` to act on (e.g. cancel) the shift.
 */
export function PersonalScheduleCalendar({
  title,
  subtitle,
  shifts,
  anchor,
  view,
  hrefFor,
  shiftHref,
  editableAvailability,
}: {
  title: string;
  subtitle: string;
  shifts: PersonalScheduleShift[];
  anchor: Date;
  view: ScheduleView;
  hrefFor: (date: Date, view: ScheduleView) => string;
  shiftHref?: (shift: PersonalScheduleShift) => string;
  /**
   * Swaps all three views (day/week/month) for the STAFF self-service
   * availability editor (`AvailabilityEditor`) - `/worker/schedule` only,
   * never passed by the admin "staff" search result mode, which stays a
   * read-only view of someone else's shifts.
   */
  editableAvailability?: { availability: AvailabilityDTO[] };
}) {
  const { weekStart, weekEnd, weekDays, monthStart, monthEnd, prevDate, nextDate } = resolveScheduleRange(view, anchor);
  const today = new Date();

  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const monthGridDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="page-title text-3xl">{title}</h1>
          <p className="text-sm text-neutral-500 mt-2">{subtitle}</p>
        </div>

        <CalendarNav
          heading={primaryScheduleHeading(anchor, view, weekStart, weekEnd)}
          anchor={anchor}
          view={view}
          prevDate={prevDate}
          nextDate={nextDate}
          today={today}
          hrefFor={hrefFor}
        />
      </div>

      {editableAvailability ? (
        <AvailabilityEditor
          view={view}
          anchor={anchor}
          weekDays={weekDays}
          monthGridDays={monthGridDays}
          shifts={shifts}
          availability={editableAvailability.availability}
        />
      ) : (
        <>
          {view === "day" && (
            <div className="card-base p-4 sm:p-6">
              <DayShiftList shifts={shifts} day={anchor} shiftHref={shiftHref} />
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
                        <ShiftBlock key={s.id} shift={s} href={shiftHref?.(s)} />
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
                          <ShiftBlock key={s.id} shift={s} compact href={shiftHref?.(s)} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DayShiftList({
  shifts,
  day,
  shiftHref,
}: {
  shifts: PersonalScheduleShift[];
  day: Date;
  shiftHref?: (shift: PersonalScheduleShift) => string;
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
          <ShiftBlock shift={s} href={shiftHref?.(s)} />
        </li>
      ))}
    </ul>
  );
}
