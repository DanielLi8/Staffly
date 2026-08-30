"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format, isSameDay, isSameMonth } from "date-fns";
import { Check, X } from "lucide-react";
import { cn, formatShiftRange } from "@/lib/utils";
import { parseTimeInput } from "@/lib/shifts/time";
import { saveAvailability } from "@/app/actions/availability";
import type { AvailabilityDTO } from "@/lib/availability/types";
import { ShiftBlock, type PersonalScheduleShift } from "@/features/schedule/shift-block";

/**
 * The tap-select + floating-action-bar availability editor, combined with
 * drag-select for contiguous ranges (Option A + Option C from the
 * captain-reviewed Lavish comparison). Lives only in the month view of
 * `/worker/schedule` - `PersonalScheduleCalendar` renders this instead of
 * its plain month grid only when `editableAvailability` is passed, which
 * only that page does.
 *
 * Selection model: a plain click (mouse down + up on the same day, no drag)
 * toggles that single day - this is how a day gets removed from a
 * drag-built range, and how a scattered multi-select gets built one day at
 * a time. A drag (mouse down, move to a different day, release) always adds
 * every day in the dragged range to the selection, rather than toggling, so
 * dragging back over already-selected days never removes them.
 */
export function AvailabilityMonthGrid({
  monthGridDays,
  anchor,
  shifts,
  availability,
}: {
  monthGridDays: Date[];
  anchor: Date;
  shifts: PersonalScheduleShift[];
  availability: AvailabilityDTO[];
}) {
  const router = useRouter();
  const today = new Date();
  const dayKeys = monthGridDays.map((d) => format(d, "yyyy-MM-dd"));

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewRange, setPreviewRange] = useState<[number, number] | null>(null);
  const [mode, setMode] = useState<"idle" | "time-picker">("idle");
  const [from, setFrom] = useState("7:00 AM");
  const [to, setTo] = useState("3:00 PM");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Plain refs, not state: a mousedown immediately followed by a mouseup (a
  // click, with no repaint in between) must not read a stale pre-mousedown
  // value here. State updates only take effect on the next render, which is
  // not guaranteed to have happened yet by the time the paired mouseup
  // handler runs; a ref is always current.
  const dragAnchorIndexRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);

  useEffect(() => {
    function endDrag() {
      if (dragAnchorIndexRef.current !== null && dragMovedRef.current) {
        setPreviewRange((range) => {
          if (range) {
            const [lo, hi] = range;
            setSelected((prev) => {
              const next = new Set(prev);
              for (let i = lo; i <= hi; i++) next.add(dayKeys[i]);
              return next;
            });
          }
          return null;
        });
      } else {
        setPreviewRange(null);
      }
      dragAnchorIndexRef.current = null;
      dragMovedRef.current = false;
    }
    window.addEventListener("mouseup", endDrag);
    return () => window.removeEventListener("mouseup", endDrag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    };
  }, []);

  function showFeedback(next: { type: "success" | "error"; message: string }) {
    setFeedback(next);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 5000);
  }

  function handleMouseDown(index: number) {
    dragAnchorIndexRef.current = index;
    dragMovedRef.current = false;
    setPreviewRange([index, index]);
  }

  function handleMouseEnter(index: number) {
    if (dragAnchorIndexRef.current === null) return;
    if (index !== dragAnchorIndexRef.current) dragMovedRef.current = true;
    setPreviewRange([Math.min(dragAnchorIndexRef.current, index), Math.max(dragAnchorIndexRef.current, index)]);
  }

  function handleMouseUp(index: number) {
    // A plain click (no movement) toggles just this one day - handled here
    // rather than in the window "mouseup" listener because that listener
    // resets drag state before it can tell "no movement" apart from "a
    // one-day drag", and because it fires for mouseups anywhere on the page.
    if (dragAnchorIndexRef.current === index && !dragMovedRef.current) {
      const key = dayKeys[index];
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    }
  }

  function clearSelection() {
    setSelected(new Set());
    setMode("idle");
  }

  async function handleMarkUnavailable() {
    setSaving(true);
    const result = await saveAvailability({ dates: Array.from(selected), status: "UNAVAILABLE" });
    setSaving(false);
    if (result.ok) {
      showFeedback({ type: "success", message: `Marked ${result.count} day(s) unavailable.` });
      clearSelection();
      router.refresh();
    } else {
      showFeedback({ type: "error", message: result.error });
    }
  }

  async function handleSaveAvailableTime() {
    setSaving(true);
    const result = await saveAvailability({ dates: Array.from(selected), status: "AVAILABLE", from, to });
    setSaving(false);
    if (result.ok) {
      showFeedback({ type: "success", message: `Availability saved for ${result.count} day(s).` });
      clearSelection();
      router.refresh();
    } else {
      showFeedback({ type: "error", message: result.error });
    }
  }

  return (
    <div className="space-y-3">
      {feedback && (
        <div
          className={cn(
            "rounded-lg px-4 py-2.5 text-sm font-medium",
            feedback.type === "success" ? "bg-emerald-50 text-emerald-800" : "bg-accent-50 text-accent"
          )}
        >
          {feedback.message}
        </div>
      )}

      <div className="card-base overflow-x-auto select-none">
        <div className="min-w-[320px] sm:min-w-full grid grid-cols-7 border-b border-neutral-200 bg-neutral-50/80">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
            <div key={label} className="px-1 py-2 text-center text-[10px] sm:text-xs font-bold text-neutral-400 uppercase">
              {label}
            </div>
          ))}
        </div>
        <div className="min-w-[320px] sm:min-w-full grid grid-cols-7 auto-rows-fr divide-x divide-y divide-neutral-100 border-b border-neutral-200">
          {monthGridDays.map((d, index) => {
            const inMonth = isSameMonth(d, anchor);
            const isToday = isSameDay(d, today);
            const dayShifts = shifts.filter((s) => isSameDay(s.startsAt, d));
            const dayAvailability = availability.find((a) => isSameDay(a.startsAt, d));
            const key = dayKeys[index];
            const isSelected = selected.has(key);
            const inPreview = previewRange !== null && index >= previewRange[0] && index <= previewRange[1];

            return (
              <div
                key={d.toISOString()}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`${format(d, "EEEE, MMMM d")}${isSelected ? ", selected" : ""}`}
                onMouseDown={() => handleMouseDown(index)}
                onMouseEnter={() => handleMouseEnter(index)}
                onMouseUp={() => handleMouseUp(index)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    });
                  }
                }}
                className={cn(
                  "min-h-[88px] sm:min-h-[112px] p-1 sm:p-2 flex flex-col gap-1 cursor-pointer transition-colors",
                  !inMonth && "bg-neutral-50/60 text-neutral-400",
                  inMonth && "bg-white",
                  isToday && !isSelected && "ring-1 ring-inset ring-primary-300 bg-primary-50/40",
                  (isSelected || inPreview) && "bg-primary-50 ring-2 ring-inset ring-primary-500"
                )}
              >
                <div className="flex items-center justify-between shrink-0">
                  <p
                    className={cn(
                      "text-[11px] sm:text-sm font-semibold tabular-nums",
                      isToday ? "text-primary-800" : inMonth ? "text-neutral-900" : "text-neutral-400"
                    )}
                  >
                    {format(d, "d")}
                  </p>
                  {isSelected && (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary-700 text-white">
                      <Check className="h-2.5 w-2.5" aria-hidden />
                    </span>
                  )}
                </div>

                {dayAvailability && <AvailabilityTag availability={dayAvailability} />}

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

      {selected.size > 0 && (
        <div className="sticky bottom-4 z-10 rounded-xl bg-primary-800 text-white shadow-lg p-3 sm:p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">{selected.size} day{selected.size === 1 ? "" : "s"} selected</span>
            <button
              type="button"
              onClick={clearSelection}
              className="text-primary-200 hover:text-white"
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {mode === "idle" && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMode("time-picker")}
                disabled={saving}
                className="h-9 px-3 rounded-md bg-white text-primary-800 text-sm font-semibold hover:bg-primary-50 disabled:opacity-50"
              >
                Set available time
              </button>
              <button
                type="button"
                onClick={handleMarkUnavailable}
                disabled={saving}
                className="h-9 px-3 rounded-md bg-white/10 border border-white/30 text-white text-sm font-semibold hover:bg-white/20 disabled:opacity-50"
              >
                Mark unavailable
              </button>
            </div>
          )}

          {mode === "time-picker" && (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-primary-200 mb-1" htmlFor="avail-from">
                  From
                </label>
                <input
                  id="avail-from"
                  type="text"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  placeholder="7:00 AM"
                  className="h-9 w-28 rounded-md border border-white/30 bg-white/10 px-2 text-sm text-white placeholder:text-primary-300 focus:outline-none focus:ring-2 focus:ring-white/50"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-primary-200 mb-1" htmlFor="avail-to">
                  To
                </label>
                <input
                  id="avail-to"
                  type="text"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="3:00 PM"
                  className="h-9 w-28 rounded-md border border-white/30 bg-white/10 px-2 text-sm text-white placeholder:text-primary-300 focus:outline-none focus:ring-2 focus:ring-white/50"
                />
              </div>
              <button
                type="button"
                onClick={handleSaveAvailableTime}
                disabled={saving || !parseTimeInput(from) || !parseTimeInput(to)}
                className="h-9 px-3 rounded-md bg-white text-primary-800 text-sm font-semibold hover:bg-primary-50 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setMode("idle")}
                disabled={saving}
                className="h-9 px-3 rounded-md text-primary-200 text-sm hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AvailabilityTag({ availability }: { availability: AvailabilityDTO }) {
  if (availability.status === "UNAVAILABLE") {
    return (
      <p className="shrink-0 rounded px-1 py-0.5 text-[9px] sm:text-[10px] font-bold bg-accent-50 text-accent w-fit">
        Unavailable
      </p>
    );
  }
  if (availability.status === "AVAILABLE") {
    return (
      <p className="shrink-0 rounded px-1 py-0.5 text-[9px] sm:text-[10px] font-bold bg-emerald-50 text-emerald-700 w-fit">
        {formatShiftRange(availability.startsAt, availability.endsAt)}
      </p>
    );
  }
  return (
    <p className="shrink-0 rounded px-1 py-0.5 text-[9px] sm:text-[10px] font-bold bg-neutral-100 text-neutral-500 w-fit">
      Tentative
    </p>
  );
}
