"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { dayKeyToLocalDate, hospitalDate, hospitalTime } from "@/lib/timezone";
import { MINUTES_PER_DAY, segmentsByDay } from "@/lib/schedule/time-grid";
import type { AvailabilityDTO } from "@/lib/availability/types";
import type { PersonalScheduleShift } from "./shift-block";
import { AVAILABILITY_BAR, ConflictBadge, conflictsFor, shiftToneClass, useHospitalNow } from "./schedule-visuals";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CELL_SHIFT_CAP = 3;
/** Below `sm` a month cell is ~50px wide: room for one chip (Day details has the rest). */
const CELL_SHIFT_CAP_PHONE = 1;

/**
 * Month view: a calendar of compact plum shift chips (shown on the day each
 * shift starts) with a thin proportional availability bar per day. Same
 * props contract as `ScheduleTimeGrid`. With `onDayRange`, a mouse drag across
 * cells picks a whole run of days at once (the availability editor's range
 * pick); touch and keyboard use plain taps.
 */
export function ScheduleMonthGrid({
  dayKeys,
  monthKey,
  todayKey,
  shifts,
  availability,
  focusedDayKey,
  markedDayKeys,
  onDaySelect,
  onDayRange,
  shiftHrefBase,
  label,
}: {
  /** Whole weeks, Monday first. */
  dayKeys: string[];
  /** `yyyy-MM` of the month being shown; other days are dimmed. */
  monthKey: string;
  todayKey: string;
  shifts: PersonalScheduleShift[];
  availability?: AvailabilityDTO[];
  focusedDayKey?: string | null;
  markedDayKeys?: ReadonlySet<string>;
  onDaySelect?: (dayKey: string) => void;
  onDayRange?: (dayKeys: string[]) => void;
  /** Makes each shift a link to `${shiftHrefBase}${shift.id}` (admin). A string, not a function, so a server page can pass it. */
  shiftHrefBase?: string;
  label: string;
}) {
  const clock = useHospitalNow();
  const availabilitySegments = useMemo(
    () => (availability ? segmentsByDay(availability, dayKeys) : null),
    [availability, dayKeys]
  );
  const conflicts = useMemo(() => conflictsFor(shifts, availability), [shifts, availability]);
  const shiftsByStartDay = useMemo(() => {
    const map = new Map<string, PersonalScheduleShift[]>();
    for (const shift of shifts) {
      const key = hospitalDate(shift.startsAt);
      map.set(key, [...(map.get(key) ?? []), shift]);
    }
    return map;
  }, [shifts]);

  // Drag-to-range lives in refs, not state: a mousedown immediately followed
  // by a mouseup (a click, no repaint in between) must not read a stale value.
  // `preview` state only paints the highlight.
  const dragAnchor = useRef<number | null>(null);
  const dragRange = useRef<[number, number] | null>(null);
  const suppressClick = useRef(false);
  const onDayRangeRef = useRef(onDayRange);
  onDayRangeRef.current = onDayRange;
  const dayKeysRef = useRef(dayKeys);
  dayKeysRef.current = dayKeys;
  const [preview, setPreview] = useState<[number, number] | null>(null);
  const dragEnabled = Boolean(onDayRange);

  useEffect(() => {
    if (!dragEnabled) return;
    function endDrag() {
      const range = dragRange.current;
      if (dragAnchor.current !== null && range && range[0] !== range[1]) {
        // A drag's mouseup lands on a different cell, so the browser fires no
        // click on the starting button; this only guards the rare same-cell case.
        suppressClick.current = true;
        onDayRangeRef.current?.(dayKeysRef.current.slice(range[0], range[1] + 1));
      }
      dragAnchor.current = null;
      dragRange.current = null;
      setPreview(null);
    }
    window.addEventListener("mouseup", endDrag);
    return () => window.removeEventListener("mouseup", endDrag);
  }, [dragEnabled]);

  return (
    <div className="card-base overflow-hidden select-none" role="region" aria-label={label}>
      <div className="grid grid-cols-7 border-b border-neutral-200 bg-neutral-50/80" aria-hidden>
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="py-2 text-center text-2xs sm:text-xs font-bold uppercase tracking-wide text-neutral-600">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-neutral-100">
        {dayKeys.map((key, index) => {
          const day = dayKeyToLocalDate(key);
          const inMonth = key.startsWith(monthKey);
          const isToday = key === todayKey;
          const focused = key === focusedDayKey;
          const marked = markedDayKeys?.has(key) ?? false;
          const inPreview = preview !== null && index >= preview[0] && index <= preview[1];
          const dayShifts = shiftsByStartDay.get(key) ?? [];
          const dayConflict = dayShifts.some((s) => conflicts.has(s.id));
          const name = `${format(day, "EEEE, MMMM d")}${isToday ? ", today" : ""}${
            dayShifts.length ? `, ${dayShifts.length} shift${dayShifts.length > 1 ? "s" : ""}` : ""
          }${dayConflict ? ", a shift conflicts with your availability" : ""}${marked ? ", will change" : ""}`;

          return (
            <div
              key={key}
              onMouseDown={
                dragEnabled
                  ? (e) => {
                      if (e.button !== 0) return;
                      suppressClick.current = false;
                      dragAnchor.current = index;
                      dragRange.current = [index, index];
                    }
                  : undefined
              }
              onMouseEnter={
                dragEnabled
                  ? () => {
                      if (dragAnchor.current === null) return;
                      const range: [number, number] = [Math.min(dragAnchor.current, index), Math.max(dragAnchor.current, index)];
                      dragRange.current = range;
                      setPreview(range);
                    }
                  : undefined
              }
              className={cn(
                "relative min-h-[88px] sm:min-h-[112px] min-w-0 p-1 sm:p-1.5 flex flex-col gap-1",
                inMonth ? "bg-white" : "bg-neutral-50",
                isToday && "bg-primary-50/60",
                (marked || inPreview) && "bg-primary-100",
                focused && "ring-2 ring-inset ring-primary-700"
              )}
            >
              <button
                type="button"
                disabled={!onDaySelect}
                aria-label={name}
                aria-pressed={onDaySelect ? (markedDayKeys ? marked : focused) : undefined}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  onDaySelect?.(key);
                }}
                className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 disabled:cursor-default"
              />
              <div className="pointer-events-none relative flex items-center justify-between" aria-hidden>
                <span
                  className={cn(
                    "text-xs sm:text-sm font-semibold tabular-nums",
                    isToday
                      ? "flex h-6 w-6 items-center justify-center rounded-full bg-primary-700 text-white"
                      : inMonth
                        ? "text-neutral-900"
                        : "text-neutral-500"
                  )}
                >
                  {format(day, "d")}
                </span>
                {marked && (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary-700 text-white">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                )}
              </div>

              {availabilitySegments && (
                <div
                  className="pointer-events-none relative h-1.5 w-full shrink-0 overflow-hidden rounded-full bg-neutral-100"
                  aria-hidden
                >
                  {availabilitySegments.get(key)?.map((segment, i) =>
                    AVAILABILITY_BAR[segment.item.status] ? (
                      <span
                        key={`${segment.item.id}-${i}`}
                        className={cn("absolute inset-y-0", AVAILABILITY_BAR[segment.item.status])}
                        style={{
                          left: `${(segment.startMinute / MINUTES_PER_DAY) * 100}%`,
                          width: `${((segment.endMinute - segment.startMinute) / MINUTES_PER_DAY) * 100}%`,
                        }}
                      />
                    ) : null
                  )}
                </div>
              )}

              <div className="pointer-events-none relative space-y-0.5" aria-hidden={!shiftHrefBase}>
                {dayShifts.slice(0, CELL_SHIFT_CAP).map((shift, i) => {
                  const conflict = conflicts.get(shift.id);
                  // Times only (the department is in Day details and the title),
                  // and the end time only where a cell is wide enough (xl) - a
                  // clipped "07:00–19:0" is worse than a clean "07:00".
                  const chip = (
                    <>
                      <span className="whitespace-nowrap">
                        {hospitalTime(shift.startsAt, false)}
                        <span className="hidden xl:inline">–{hospitalTime(shift.endsAt, false)}</span>
                      </span>
                      {/* Below sm the chip only fits the start time; the amber ring carries the conflict. */}
                      {conflict && <ConflictBadge className="ml-auto hidden sm:inline-flex" />}
                    </>
                  );
                  const chipClass = cn(
                    "flex flex-wrap items-center gap-0.5 overflow-hidden rounded border px-0.5 sm:px-1 py-0.5 text-2xs font-semibold leading-tight tracking-tight tabular-nums",
                    i >= CELL_SHIFT_CAP_PHONE && "hidden sm:flex",
                    shiftToneClass(shift, clock?.now ?? null),
                    conflict && "ring-2 ring-amber-400 sm:ring-1"
                  );
                  return shiftHrefBase ? (
                    <Link
                      key={shift.id}
                      href={`${shiftHrefBase}${shift.id}`}
                      title={`${shift.department.name} · ${shift.roleNeeded}`}
                      className={cn(chipClass, "pointer-events-auto")}
                    >
                      {chip}
                    </Link>
                  ) : (
                    <div key={shift.id} className={chipClass} title={`${shift.department.name} · ${shift.roleNeeded}`}>
                      {chip}
                    </div>
                  );
                })}
                {dayShifts.length > CELL_SHIFT_CAP_PHONE && (
                  <p className="text-2xs font-semibold text-neutral-600 sm:hidden">+{dayShifts.length - CELL_SHIFT_CAP_PHONE}</p>
                )}
                {dayShifts.length > CELL_SHIFT_CAP && (
                  <p className="hidden text-xs font-semibold text-neutral-600 sm:block">+{dayShifts.length - CELL_SHIFT_CAP} more</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
