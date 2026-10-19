"use client";

import { forwardRef } from "react";
import { format } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { addDaysToKey, dayKeyToLocalDate, hospitalMinutesOfDay, hospitalTime } from "@/lib/timezone";
import { MINUTES_PER_DAY, minuteLabel, splitIntoDaySegments } from "@/lib/schedule/time-grid";
import { CONFLICT_LABELS, shiftAvailabilityConflict } from "@/lib/availability/conflicts";
import type { AvailabilityDTO } from "@/lib/availability/types";
import type { PersonalScheduleShift } from "@/features/schedule/shift-block";
import { useHospitalNow } from "@/features/schedule/schedule-visuals";

const STATUS_LABELS: Record<AvailabilityDTO["status"], string> = {
  AVAILABLE: "Available",
  UNAVAILABLE: "Not available",
  TENTATIVE: "Tentative",
};

const BAR_TINT: Record<AvailabilityDTO["status"], string> = {
  AVAILABLE: "bg-emerald-200",
  UNAVAILABLE: "bg-unavailable-strong",
  TENTATIVE: "",
};

const SWATCH: Record<AvailabilityDTO["status"], string> = {
  AVAILABLE: "bg-emerald-200 border-emerald-300",
  UNAVAILABLE: "bg-unavailable-strong border-neutral-300",
  TENTATIVE: "bg-white border-neutral-300",
};

function pct(minute: number) {
  return `${(minute / MINUTES_PER_DAY) * 100}%`;
}

function weekday(dayKey: string) {
  return format(dayKeyToLocalDate(dayKey), "EEE");
}

/**
 * "07:00 – 19:00" from the segment's own clock minutes (so a row ending at
 * midnight reads 24:00), naming the other day when a range crosses midnight.
 */
function rangeText(
  item: { startsAt: Date; endsAt: Date },
  dayKey: string,
  segment: { startMinute: number; endMinute: number; continuesFromPreviousDay: boolean; continuesToNextDay: boolean }
) {
  const start = segment.continuesFromPreviousDay
    ? `${hospitalTime(item.startsAt, false)} ${weekday(addDaysToKey(dayKey, -1))}`
    : minuteLabel(segment.startMinute);
  const end = segment.continuesToNextDay
    ? `${minuteLabel(hospitalMinutesOfDay(item.endsAt))} ${weekday(addDaysToKey(dayKey, 1))}`
    : minuteLabel(segment.endMinute);
  return `${start} – ${end}`;
}

/**
 * The right-hand panel when nothing is being edited: one day's availability
 * as a 24-hour bar with the shift drawn over it, in plain words, plus the
 * amber notice when a shift falls outside it. It deliberately does not
 * repeat the shift card the grid already shows - the shift appears only as
 * the plum mark on the bar and a one-line key under it.
 */
export const DayDetailsPanel = forwardRef<
  HTMLDivElement,
  {
    dayKey: string;
    todayKey: string;
    shifts: PersonalScheduleShift[];
    availability: AvailabilityDTO[];
    onSetAvailability: () => void;
  }
>(function DayDetailsPanel({ dayKey, todayKey, shifts, availability, onSetAvailability }, ref) {
  const clock = useHospitalNow();
  const day = dayKeyToLocalDate(dayKey);
  const availabilitySegments = availability.flatMap((a) => splitIntoDaySegments(a, [dayKey]));
  const shiftSegments = shifts.flatMap((s) => splitIntoDaySegments(s, [dayKey]));
  availabilitySegments.sort((a, b) => a.startMinute - b.startMinute);
  shiftSegments.sort((a, b) => a.startMinute - b.startMinute);
  const conflicts = shiftSegments
    .map((segment) => ({ segment, conflict: shiftAvailabilityConflict(segment.item, availability) }))
    .filter((c) => c.conflict !== null);
  const conflictIds = new Set(conflicts.map((c) => c.segment.item.id));
  const nothing = shiftSegments.length === 0 && availabilitySegments.length === 0;

  return (
    <section
      ref={ref}
      aria-labelledby="day-details-heading"
      className="card-base flex flex-col md:min-h-[560px] scroll-mt-20"
    >
      <div className="border-b border-neutral-200 px-4 py-3">
        <p className="text-sm font-semibold text-neutral-600">Day details</p>
        <h2 id="day-details-heading" className="mt-0.5 flex items-center gap-2 text-lg font-semibold text-neutral-900">
          {format(day, "EEEE, MMMM d")}
          {dayKey === todayKey && (
            <span className="rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-xs font-semibold text-primary-800">
              Today
            </span>
          )}
        </h2>
      </div>

      <div className="flex-1 space-y-5 p-4">
        <div>
          <p className="text-sm font-semibold text-neutral-700">Your availability</p>
          <div className="relative mt-2 h-8 overflow-hidden rounded-md bg-neutral-100" aria-hidden>
            {availabilitySegments.map((s, i) =>
              BAR_TINT[s.item.status] ? (
                <span
                  key={`${s.item.id}-${i}`}
                  className={cn("absolute inset-y-0", BAR_TINT[s.item.status])}
                  style={{ left: pct(s.startMinute), width: pct(s.endMinute - s.startMinute) }}
                />
              ) : null
            )}
            {shiftSegments.map((s) => (
              <span
                key={s.item.id}
                className={cn(
                  "absolute top-2 bottom-2 rounded-sm",
                  clock && s.item.endsAt <= clock.now ? "bg-primary-300" : "bg-primary-700",
                  conflictIds.has(s.item.id) && "ring-2 ring-amber-400"
                )}
                style={{ left: pct(s.startMinute), width: pct(s.endMinute - s.startMinute) }}
              />
            ))}
            {[6, 12, 18].map((h) => (
              <span key={h} className="absolute inset-y-0 border-l border-white/80" style={{ left: pct(h * 60) }} />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs tabular-nums text-neutral-500" aria-hidden>
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </div>

          <ul className="mt-3 space-y-1.5 text-base text-neutral-800">
            {availabilitySegments.map((s, i) => (
              <li key={`${s.item.id}-${i}`} className="flex items-center gap-2">
                <span className={cn("h-3.5 w-3.5 shrink-0 rounded-sm border", SWATCH[s.item.status])} aria-hidden />
                <span>
                  {STATUS_LABELS[s.item.status]} <span className="tabular-nums">{rangeText(s.item, dayKey, s)}</span>
                </span>
              </li>
            ))}
            {shiftSegments.map((s) => (
              <li key={s.item.id} className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 shrink-0 rounded-sm border border-primary-800 bg-primary-700" aria-hidden />
                <span>
                  Your shift <span className="tabular-nums">{rangeText(s.item, dayKey, s)}</span>
                  <span className="text-neutral-600"> · {s.item.department.code}</span>
                </span>
              </li>
            ))}
          </ul>
          {availabilitySegments.length === 0 && !nothing && (
            <p className="mt-2 text-base text-neutral-600">No availability set for this day.</p>
          )}
          {nothing && <p className="mt-3 text-base text-neutral-600">Nothing scheduled and no availability set.</p>}
        </div>

        {conflicts.map(({ segment, conflict }) => (
          <div
            key={segment.item.id}
            className="flex gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-base text-amber-900"
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden />
            <p>
              <span className="font-semibold">{CONFLICT_LABELS[conflict!]}</span>{" "}
              <span className="tabular-nums">({rangeText(segment.item, dayKey, segment)})</span>. Update your
              availability, or use New Request to swap or give the shift away.
            </p>
          </div>
        ))}
      </div>

      <div className="border-t border-neutral-200 p-4">
        <button
          type="button"
          onClick={onSetAvailability}
          className="h-11 w-full rounded-md bg-primary-700 text-base font-semibold text-white transition-colors hover:bg-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          Set availability
        </button>
      </div>
    </section>
  );
});
