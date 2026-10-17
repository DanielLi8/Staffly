"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { hospitalDate, hospitalMinutesOfDay } from "@/lib/timezone";
import { shiftAvailabilityConflict, type ShiftAvailabilityConflict } from "@/lib/availability/conflicts";
import type { AvailabilityRowLike } from "@/lib/availability/blocks";
import type { PersonalScheduleShift } from "./shift-block";

/**
 * The schedule color language (DESIGN.md "Schedule colors"), in one place so
 * the time grid, month grid, day panel and legend can't drift apart:
 * shift = plum, available = soft emerald, not available = slate stripes,
 * conflict = amber, not set = empty.
 */
export const AVAILABILITY_TINT: Record<AvailabilityRowLike["status"], string> = {
  AVAILABLE: "bg-emerald-100",
  UNAVAILABLE: "bg-unavailable",
  // TENTATIVE counts as "nothing declared" for callouts (tiers.ts); draw it
  // as not set rather than inventing a fourth color.
  TENTATIVE: "",
};

/** Thin bars (month cells, the day panel) need the stronger variants to stay visible. */
export const AVAILABILITY_BAR: Record<AvailabilityRowLike["status"], string> = {
  AVAILABLE: "bg-emerald-300",
  UNAVAILABLE: "bg-unavailable-strong",
  TENTATIVE: "",
};

export function shiftToneClass(shift: PersonalScheduleShift, now: Date | null): string {
  const past = now !== null && shift.endsAt <= now;
  return past
    ? "bg-primary-100 text-primary-900 border-primary-200"
    : "bg-primary-700 text-white border-primary-800";
}

/** Per-shift conflict with the availability shown alongside it. */
export function conflictsFor(
  shifts: PersonalScheduleShift[],
  availability: AvailabilityRowLike[] | undefined
): Map<string, ShiftAvailabilityConflict> {
  const map = new Map<string, ShiftAvailabilityConflict>();
  if (!availability) return map;
  for (const shift of shifts) {
    const conflict = shiftAvailabilityConflict(shift, availability);
    if (conflict) map.set(shift.id, conflict);
  }
  return map;
}

export function ConflictBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-800 ring-1 ring-amber-400",
        className
      )}
      aria-hidden
    >
      <AlertTriangle className="h-2.5 w-2.5" />
    </span>
  );
}

/**
 * The hospital clock, client-side only: null during SSR and the first client
 * render (so markup matches), then the current day key + minute, refreshed
 * every minute. Drives the "now" line and past-shift dimming.
 */
export function useHospitalNow(): { now: Date; dayKey: string; minute: number } | null {
  const [state, setState] = useState<{ now: Date; dayKey: string; minute: number } | null>(null);
  useEffect(() => {
    function tick() {
      const now = new Date();
      setState({ now, dayKey: hospitalDate(now), minute: hospitalMinutesOfDay(now) });
    }
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  return state;
}
