"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format, isSameDay, isSameMonth } from "date-fns";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseTimeInput } from "@/lib/shifts/time";
import { hospitalTime } from "@/lib/timezone";
import { saveAvailability } from "@/app/actions/availability";
import type { AvailabilityDTO } from "@/lib/availability/types";
import type { ScheduleView } from "@/lib/schedule/range";
import { ShiftBlock, type PersonalScheduleShift } from "@/features/schedule/shift-block";
import { ShiftSwapPanel } from "@/features/shift-swap/shift-swap-panel";
import type { ShiftSwapKind } from "@/features/shift-swap/types";
import { NewRequestMenu, type NewRequestChoice } from "./new-request-menu";
import { ChangeAvailabilityPanel, type BlockDraft, newBlockDraft } from "./change-availability-panel";
import { DayDetailsPanel } from "./day-details-panel";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_CELL_SHIFT_CAP = 3;

/**
 * The Day/Week/Month availability editor for `/worker/schedule` - tap+drag
 * multi-select (generalized from the old month-only grid over an arbitrary
 * length `cells` array, so day view's single cell and week view's 7 columns
 * reuse the exact same drag/tap logic as month's 42 cells), a persistent
 * top-quarter color band per cell/column reflecting saved AVAILABLE /
 * UNAVAILABLE blocks that day, and a persistent right-side panel driven by
 * the toolbar's "+ New Request" menu. `PersonalScheduleCalendar` renders
 * this instead of its plain per-view grids whenever `editableAvailability`
 * is passed - only `/worker/schedule` does that.
 *
 * Selection model (unchanged from the original month grid): a plain click
 * (mouse down + up on the same cell, no drag) toggles that one day; a drag
 * always adds every day in the dragged range, so dragging back over
 * already-selected days never removes them. The drag anchor/moved flag live
 * in refs, not state, since a mousedown immediately followed by a mouseup
 * (a click, no repaint in between) must not read a stale pre-mousedown
 * value, and state updates aren't guaranteed to have flushed yet.
 */
export function AvailabilityEditor({
  view,
  anchor,
  weekDays,
  monthGridDays,
  shifts,
  availability,
}: {
  view: ScheduleView;
  anchor: Date;
  weekDays: Date[];
  monthGridDays: Date[];
  shifts: PersonalScheduleShift[];
  availability: AvailabilityDTO[];
}) {
  const router = useRouter();
  const today = new Date();

  const cells = view === "day" ? [anchor] : view === "week" ? weekDays : monthGridDays;
  const cellKeys = cells.map((d) => format(d, "yyyy-MM-dd"));

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewRange, setPreviewRange] = useState<[number, number] | null>(null);
  const [panelMode, setPanelMode] = useState<"empty" | "change-availability">("empty");
  const [swapFlow, setSwapFlow] = useState<ShiftSwapKind | null>(null);
  const [blocks, setBlocks] = useState<BlockDraft[]>([newBlockDraft()]);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Independent of `selected` (the multi-day batch-edit set) - a plain click
  // sets both, but toggling a day off `selected` keeps its Day Details shown.
  const [focusedDay, setFocusedDay] = useState<Date>(today);

  const dragAnchorIndexRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelMountedRef = useRef(false);

  useEffect(() => {
    function endDrag() {
      if (dragAnchorIndexRef.current !== null && dragMovedRef.current) {
        setPreviewRange((range) => {
          if (range) {
            const [lo, hi] = range;
            setSelected((prev) => {
              const next = new Set(prev);
              for (let i = lo; i <= hi; i++) next.add(cellKeys[i]);
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

  // Below `md` the grid and panel stack, so a tap on a day gives no visual
  // cue anything happened until the user scrolls down themselves - nudge
  // them there. Skipped on first mount so the page doesn't jump on load.
  useEffect(() => {
    if (!panelMountedRef.current) {
      panelMountedRef.current = true;
      return;
    }
    if (window.matchMedia("(max-width: 767px)").matches) {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [focusedDay, panelMode]);

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

  function toggleDay(index: number) {
    const key = cellKeys[index];
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleMouseUp(index: number) {
    if (dragAnchorIndexRef.current === index && !dragMovedRef.current) {
      toggleDay(index);
      setFocusedDay(cells[index]);
    }
  }

  function handleEditAvailability(day: Date) {
    const key = format(day, "yyyy-MM-dd");
    setSelected((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    setPanelMode("change-availability");
  }

  function handleNewRequestChoice(choice: NewRequestChoice) {
    if (choice === "change-availability") {
      setPanelMode("change-availability");
    } else if (choice === "shift-swap") {
      setSwapFlow("SWAP");
    } else if (choice === "shift-giveaway") {
      setSwapFlow("GIVEAWAY");
    }
  }

  function closePanel() {
    setPanelMode("empty");
    setBlocks([newBlockDraft()]);
    setSelected(new Set());
  }

  async function handleSubmit() {
    setSaving(true);
    const result = await saveAvailability({
      dates: Array.from(selected),
      blocks: blocks.map((b) => ({ status: b.status, from: b.from, to: b.to })),
    });
    setSaving(false);
    if (result.ok) {
      showFeedback({ type: "success", message: `Availability saved for ${result.count} day(s).` });
      closePanel();
      router.refresh();
    } else {
      showFeedback({ type: "error", message: result.error });
    }
  }

  const cellByKey = new Map(cells.map((d, i) => [cellKeys[i], d]));
  const selectedDays = Array.from(selected)
    .map((key) => cellByKey.get(key))
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => a.getTime() - b.getTime());

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

      <div className="flex items-center justify-end">
        <NewRequestMenu onChoose={handleNewRequestChoice} />
      </div>

      {swapFlow && <ShiftSwapPanel kind={swapFlow} onClose={() => setSwapFlow(null)} />}

      <div className="flex flex-col md:flex-row gap-4 items-start">
        <div className="card-base overflow-x-auto select-none flex-1 min-w-0 w-full">
          {view !== "day" && (
            <div className="min-w-[480px] sm:min-w-full grid grid-cols-7 border-b border-neutral-200 bg-neutral-50/80">
              {(view === "month"
                ? WEEKDAY_LABELS
                : weekDays.map((d) => `${format(d, "EEE")} ${format(d, "d")}`)
              ).map((label) => (
                <div key={label} className="px-1 py-2 text-center text-[10px] sm:text-xs font-bold text-neutral-400 uppercase">
                  {label}
                </div>
              ))}
            </div>
          )}

          <div
            className={cn(
              "min-w-[480px] sm:min-w-full grid divide-neutral-100 border-b border-neutral-200",
              view === "month" && "grid-cols-7 auto-rows-fr divide-x divide-y",
              view === "week" && "grid-cols-7 divide-x",
              view === "day" && "grid-cols-1"
            )}
          >
            {cells.map((d, index) => {
              const inMonth = view !== "month" || isSameMonth(d, anchor);
              const isToday = isSameDay(d, today);
              const dayShifts = shifts.filter((s) => isSameDay(s.startsAt, d));
              const dayAvailability = availability.filter((a) => isSameDay(a.startsAt, d));
              const key = cellKeys[index];
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
                      toggleDay(index);
                      setFocusedDay(d);
                    }
                  }}
                  className={cn(
                    "flex flex-col cursor-pointer transition-colors overflow-hidden",
                    view === "month" && "min-h-[96px] sm:min-h-[112px]",
                    view === "week" && "min-h-[220px] sm:min-h-[320px]",
                    view === "day" && "min-h-[360px] sm:min-h-[480px]",
                    !inMonth && "bg-neutral-50/60 text-neutral-400",
                    inMonth && "bg-white",
                    isToday && !isSelected && "ring-1 ring-inset ring-primary-300 bg-primary-50/40",
                    (isSelected || inPreview) && "bg-primary-50 ring-2 ring-inset ring-primary-500"
                  )}
                >
                  <div className="flex-1 min-h-0 flex flex-col gap-1 p-1 sm:p-2">
                    <AvailabilityBand dayAvailability={dayAvailability} />

                    <div className="flex items-center justify-between shrink-0">
                      <p
                        className={cn(
                          "text-[11px] sm:text-sm font-semibold tabular-nums",
                          isToday ? "text-primary-800" : inMonth ? "text-neutral-900" : "text-neutral-400"
                        )}
                      >
                        {view === "day" ? format(d, "EEEE, MMMM d") : format(d, "d")}
                      </p>
                      {isSelected && (
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary-700 text-white">
                          <Check className="h-2.5 w-2.5" aria-hidden />
                        </span>
                      )}
                    </div>

                    <div
                      className={cn(
                        "space-y-1 overflow-y-auto",
                        view === "month" && "max-h-[72px] sm:max-h-[96px]",
                        view === "week" && "max-h-[180px] sm:max-h-[260px]",
                        view === "day" && "max-h-[300px] sm:max-h-[400px]"
                      )}
                    >
                      {view === "day" ? (
                        <>
                          {dayShifts.map((s) => (
                            <ShiftBlock key={s.id} shift={s} />
                          ))}
                          {dayShifts.length === 0 && <p className="text-sm text-neutral-400">No shifts assigned.</p>}
                        </>
                      ) : view === "month" ? (
                        <>
                          {dayShifts.slice(0, MONTH_CELL_SHIFT_CAP).map((s) => (
                            <CompactShiftChip key={s.id} shift={s} />
                          ))}
                          {dayShifts.length > MONTH_CELL_SHIFT_CAP && (
                            <p className="text-[9px] font-semibold text-neutral-400">
                              +{dayShifts.length - MONTH_CELL_SHIFT_CAP} more
                            </p>
                          )}
                        </>
                      ) : (
                        dayShifts.map((s) => <CompactShiftChip key={s.id} shift={s} />)
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div ref={panelRef} className="w-full md:w-80 shrink-0">
          {panelMode === "empty" ? (
            <DayDetailsPanel
              day={focusedDay}
              shifts={shifts.filter((s) => isSameDay(s.startsAt, focusedDay))}
              availability={availability.filter((a) => isSameDay(a.startsAt, focusedDay))}
              onEditAvailability={() => handleEditAvailability(focusedDay)}
            />
          ) : (
            <ChangeAvailabilityPanel
              selectedDays={selectedDays}
              blocks={blocks}
              setBlocks={setBlocks}
              saving={saving}
              onSubmit={handleSubmit}
              onCancel={closePanel}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const STATUS_SEGMENT_CLASSNAMES: Record<AvailabilityDTO["status"], string> = {
  AVAILABLE: "bg-emerald-400",
  UNAVAILABLE: "bg-accent-400",
  TENTATIVE: "bg-neutral-300",
};

function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * A thin strip sized by real clock-time percentage (minutes / 1440), not an
 * equal share per distinct status - the track's own `bg-neutral-100`
 * background is what shows through any uncovered minute, so a gap is
 * visible by construction rather than a special case. Availability rows are
 * always confined to one calendar day (`src/lib/availability/build.ts`), so
 * no cross-midnight clipping is needed. Overlapping blocks (not prevented
 * upstream) paint later-starting segments over earlier ones via DOM order.
 */
function AvailabilityBand({ dayAvailability }: { dayAvailability: AvailabilityDTO[] }) {
  const segments = [...dayAvailability].sort(
    (a, b) => minutesSinceMidnight(a.startsAt) - minutesSinceMidnight(b.startsAt)
  );

  return (
    <div className="relative h-1.5 w-full shrink-0 rounded-full bg-neutral-100 overflow-hidden">
      {segments.map((a) => {
        const startMinutes = minutesSinceMidnight(a.startsAt);
        const endMinutes = minutesSinceMidnight(a.endsAt);
        return (
          <span
            key={a.id}
            className={cn("absolute inset-y-0", STATUS_SEGMENT_CLASSNAMES[a.status])}
            style={{
              left: `${(startMinutes / 1440) * 100}%`,
              width: `${((endMinutes - startMinutes) / 1440) * 100}%`,
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * Abbreviated single-line shift label for week/month grid cells - department
 * code + 24h time range (e.g. "EMERG 07:30-15:30") instead of `ShiftBlock`'s
 * full department name, which clips illegibly at narrow cell widths. Kept
 * local to this file rather than added to `ShiftBlock` so the admin
 * staff-mode reuse of `PersonalScheduleCalendar` (a separate, read-only
 * render branch) is unaffected.
 */
function CompactShiftChip({ shift }: { shift: PersonalScheduleShift }) {
  const now = new Date();
  const done = shift.endsAt < now;
  const confirmed = shift.startsAt <= now && shift.endsAt >= now;
  const label = `${shift.department.code} ${hospitalTime(shift.startsAt, false)}–${hospitalTime(shift.endsAt, false)}`;

  return (
    <div
      title={`${shift.department.name} · ${label}`}
      className={cn(
        "rounded-md border px-1 py-0.5 text-[9px] sm:text-[10px] font-semibold tabular-nums truncate",
        done && "bg-neutral-100 border-neutral-200 text-neutral-700",
        confirmed && "bg-primary-700 border-primary-800 text-white",
        !done && !confirmed && "bg-white border-neutral-200 text-neutral-800"
      )}
    >
      {label}
    </div>
  );
}
