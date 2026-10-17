"use client";

import { useMemo } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { addDaysToKey, dayKeyToLocalDate, hospitalTime } from "@/lib/timezone";
import { layoutLanes, MINUTES_PER_DAY, segmentsByDay, type LaidOutSegment } from "@/lib/schedule/time-grid";
import { CONFLICT_LABELS, type ShiftAvailabilityConflict } from "@/lib/availability/conflicts";
import type { AvailabilityDTO } from "@/lib/availability/types";
import type { PersonalScheduleShift } from "./shift-block";
import { AVAILABILITY_TINT, ConflictBadge, conflictsFor, shiftToneClass, useHospitalNow } from "./schedule-visuals";

const AXIS_HOURS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];
const HOUR_LINES = Array.from({ length: 23 }, (_, i) => i + 1);

function pct(minute: number): string {
  return `${(minute / MINUTES_PER_DAY) * 100}%`;
}

/**
 * One person's schedule on a real 24-hour axis - a single day or a 7-day
 * week. Shifts are blocks at their actual start/end (an overnight shift is
 * split across the two columns it touches, see `src/lib/schedule/time-grid.ts`);
 * availability is the background tint behind them; a shift that falls outside
 * that availability gets the amber conflict ring.
 *
 * Everything is a prop, so any page can render anyone's schedule: the worker's
 * own `/worker/schedule` (with `onDaySelect` driving the day panel and the
 * availability editor) and the admin person view (`shiftHrefBase` makes blocks
 * links). Day columns are hospital day keys; nothing here reads the
 * browser's TZ.
 */
export function ScheduleTimeGrid({
  dayKeys,
  todayKey,
  shifts,
  availability,
  focusedDayKey,
  markedDayKeys,
  onDaySelect,
  shiftHrefBase,
  label,
}: {
  dayKeys: string[];
  todayKey: string;
  shifts: PersonalScheduleShift[];
  /** Omit to draw shifts only (no tint, no conflict checks). */
  availability?: AvailabilityDTO[];
  focusedDayKey?: string | null;
  /** Days the availability editor is about to change - highlighted so it's obvious before saving. */
  markedDayKeys?: ReadonlySet<string>;
  onDaySelect?: (dayKey: string) => void;
  /** Makes each shift a link to `${shiftHrefBase}${shift.id}` (admin). A string, not a function, so a server page can pass it. */
  shiftHrefBase?: string;
  label: string;
}) {
  const clock = useHospitalNow();
  const isDay = dayKeys.length === 1;
  const gridCols = isDay
    ? "grid-cols-[2.25rem_minmax(0,1fr)] sm:grid-cols-[3.25rem_minmax(0,1fr)]"
    : "grid-cols-[2.25rem_repeat(7,minmax(0,1fr))] sm:grid-cols-[3.25rem_repeat(7,minmax(0,1fr))]";

  const shiftSegments = useMemo(() => segmentsByDay(shifts, dayKeys), [shifts, dayKeys]);
  const availabilitySegments = useMemo(
    () => (availability ? segmentsByDay(availability, dayKeys) : null),
    [availability, dayKeys]
  );
  const conflicts = useMemo(() => conflictsFor(shifts, availability), [shifts, availability]);

  return (
    <div className="card-base overflow-hidden" role="region" aria-label={label}>
      <div className={cn("grid border-b border-neutral-200", gridCols)}>
        <div aria-hidden />
        {dayKeys.map((key) => {
          const day = dayKeyToLocalDate(key);
          const isToday = key === todayKey;
          const focused = key === focusedDayKey;
          const marked = markedDayKeys?.has(key) ?? false;
          const content = (
            <>
              <span
                className={cn(
                  "text-2xs sm:text-xs font-bold uppercase tracking-wide",
                  isToday ? "text-primary-800" : "text-neutral-600"
                )}
              >
                {isDay ? format(day, "EEEE") : format(day, "EEE")}
              </span>
              <span
                className={cn(
                  "mt-0.5 text-base sm:text-lg font-semibold tabular-nums leading-none",
                  isToday ? "text-primary-800" : "text-neutral-900"
                )}
              >
                {isDay ? format(day, "MMMM d") : format(day, "d")}
              </span>
              {marked && (
                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary-700 text-white">
                  <Check className="h-2.5 w-2.5" aria-hidden />
                </span>
              )}
              {focused && !isDay && (
                <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary-700" aria-hidden />
              )}
            </>
          );
          const headerClass = cn(
            "relative flex min-w-0 flex-col items-center py-2 border-l border-neutral-100",
            isToday && "bg-primary-50",
            marked && "bg-primary-100"
          );
          const name = `${format(day, "EEEE, MMMM d")}${isToday ? ", today" : ""}${marked ? ", will change" : ""}`;
          return onDaySelect ? (
            <button
              key={key}
              type="button"
              onClick={() => onDaySelect(key)}
              aria-label={name}
              aria-pressed={markedDayKeys ? marked : focused}
              className={cn(
                headerClass,
                "transition-colors hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
              )}
            >
              {content}
            </button>
          ) : (
            <div key={key} className={headerClass} aria-label={name}>
              {content}
            </div>
          );
        })}
      </div>

      <div className={cn("relative grid h-[528px] sm:h-[672px]", gridCols)}>
        <div className="relative" aria-hidden>
          {AXIS_HOURS.map((h) => (
            <span
              key={h}
              className={cn(
                "absolute right-1 sm:right-2 text-2xs sm:text-xs tabular-nums text-neutral-500 leading-none",
                h !== 0 && "-translate-y-1/2"
              )}
              style={{ top: h === 0 ? "2px" : pct(h * 60) }}
            >
              <span className="sm:hidden">{String(h).padStart(2, "0")}</span>
              <span className="hidden sm:inline">{String(h).padStart(2, "0")}:00</span>
            </span>
          ))}
        </div>

        {dayKeys.map((key) => {
          const marked = markedDayKeys?.has(key) ?? false;
          return (
            <div
              key={key}
              onClick={onDaySelect ? () => onDaySelect(key) : undefined}
              className={cn(
                "relative min-w-0 border-l border-neutral-100 [--block-inset-l:3px] [--block-inset-r:1px] sm:[--block-inset-l:10px] sm:[--block-inset-r:4px]",
                key === todayKey && "bg-primary-50/40",
                marked && "bg-primary-50",
                onDaySelect && "cursor-pointer"
              )}
            >
              {HOUR_LINES.map((h) => (
                <span
                  key={h}
                  aria-hidden
                  className={cn("absolute inset-x-0 border-t", h % 6 === 0 ? "border-neutral-200" : "border-neutral-100")}
                  style={{ top: pct(h * 60) }}
                />
              ))}

              {availabilitySegments?.get(key)?.map((segment, i) =>
                AVAILABILITY_TINT[segment.item.status] ? (
                  <span
                    key={`${segment.item.id}-${i}`}
                    aria-hidden
                    className={cn("absolute inset-x-0", AVAILABILITY_TINT[segment.item.status])}
                    style={{ top: pct(segment.startMinute), height: pct(segment.endMinute - segment.startMinute) }}
                  />
                ) : null
              )}

              {layoutLanes(shiftSegments.get(key) ?? []).map((segment) => (
                <ShiftSegmentBlock
                  key={segment.item.id}
                  segment={segment}
                  wide={isDay}
                  now={clock?.now ?? null}
                  conflict={conflicts.get(segment.item.id) ?? null}
                  href={shiftHrefBase ? `${shiftHrefBase}${segment.item.id}` : undefined}
                />
              ))}

              {clock && clock.dayKey === key && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-primary-500"
                  style={{ top: pct(clock.minute) }}
                >
                  <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-primary-500" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShiftSegmentBlock({
  segment,
  wide,
  now,
  conflict,
  href,
}: {
  segment: LaidOutSegment<PersonalScheduleShift>;
  wide: boolean;
  now: Date | null;
  conflict: ShiftAvailabilityConflict | null;
  href?: string;
}) {
  const shift = segment.item;
  const start = hospitalTime(shift.startsAt, false);
  const end = hospitalTime(shift.endsAt, false);
  const laneWidth = 100 / segment.laneCount;
  const startedOn = format(dayKeyToLocalDate(addDaysToKey(segment.dayKey, -1)), "EEE");
  const description = `${shift.department.name}, ${shift.roleNeeded}, ${start} to ${end}${
    segment.continuesFromPreviousDay ? `, started ${startedOn}` : ""
  }${conflict ? `. ${CONFLICT_LABELS[conflict]}` : ""}`;

  const className = cn(
    "absolute z-[1] block overflow-hidden rounded-md border px-0.5 sm:px-1.5 py-0.5 text-left shadow-sm",
    shiftToneClass(shift, now),
    segment.continuesFromPreviousDay && "rounded-t-none border-t-0",
    segment.continuesToNextDay && "rounded-b-none border-b-0",
    conflict && "ring-2 ring-amber-400 ring-offset-1 ring-offset-white",
    href && "hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
  );
  const style = {
    top: pct(segment.startMinute),
    height: pct(segment.endMinute - segment.startMinute),
    // The inset leaves a strip of the availability tint visible beside the block.
    left: `calc(${segment.lane * laneWidth}% + var(--block-inset-l))`,
    width: `calc(${laneWidth}% - var(--block-inset-l) - var(--block-inset-r))`,
  };

  const body = (
    <>
      <span className="sr-only">{description}</span>
      <span aria-hidden className="block">
        {wide ? (
          <span className="block text-sm font-semibold tabular-nums leading-tight">
            {start} – {end}
            {segment.continuesFromPreviousDay && (
              <span className="ml-1.5 text-xs font-medium opacity-80">from {startedOn}</span>
            )}
            {segment.continuesToNextDay && (
              <span className="ml-1.5 text-xs font-medium opacity-80">
                ends {format(dayKeyToLocalDate(addDaysToKey(segment.dayKey, 1)), "EEE")}
              </span>
            )}
          </span>
        ) : (
          <span className="block text-2xs sm:text-xs font-semibold tabular-nums leading-tight">
            <span className="sm:hidden">
              {start}
              <br />
              {end}
            </span>
            <span className="hidden sm:inline">
              {start}–{end}
            </span>
          </span>
        )}
        <span
          className={cn(
            "flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 leading-tight",
            wide ? "text-sm" : "text-2xs sm:text-xs"
          )}
        >
          <span className={cn("opacity-90", wide ? "min-w-0 truncate" : "shrink-0")}>
            {wide ? `${shift.department.name}${shift.unit ? ` · Unit ${shift.unit}` : ""}` : shift.department.code}
          </span>
          {/* In flow, never over the times: a 46px phone column has no spare corner. */}
          {conflict && <ConflictBadge />}
        </span>
        {wide && <span className="block truncate text-sm leading-tight opacity-90">{shift.roleNeeded}</span>}
      </span>
    </>
  );

  return href ? (
    <Link href={href} className={className} style={style} onClick={(e) => e.stopPropagation()}>
      {body}
    </Link>
  ) : (
    <div className={className} style={style}>
      {body}
    </div>
  );
}
