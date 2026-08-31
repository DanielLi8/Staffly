"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format, isSameDay, isSameMonth } from "date-fns";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseTimeInput } from "@/lib/shifts/time";
import { saveAvailability } from "@/app/actions/availability";
import type { AvailabilityDTO } from "@/lib/availability/types";
import type { ScheduleView } from "@/lib/schedule/range";
import { ShiftBlock, type PersonalScheduleShift } from "@/features/schedule/shift-block";
import { NewRequestMenu, type NewRequestChoice } from "./new-request-menu";
import { ChangeAvailabilityPanel, type BlockDraft, newBlockDraft } from "./change-availability-panel";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
  const [blocks, setBlocks] = useState<BlockDraft[]>([newBlockDraft()]);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    }
  }

  function handleNewRequestChoice(choice: NewRequestChoice) {
    if (choice === "change-availability") {
      setPanelMode("change-availability");
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

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <div className="card-base overflow-x-auto select-none flex-1 min-w-0 w-full">
          {view !== "day" && (
            <div className="min-w-[320px] sm:min-w-full grid grid-cols-7 border-b border-neutral-200 bg-neutral-50/80">
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
              "min-w-[320px] sm:min-w-full grid divide-neutral-100 border-b border-neutral-200",
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
                    }
                  }}
                  className={cn(
                    "flex flex-col cursor-pointer transition-colors overflow-hidden",
                    view === "month" && "min-h-[88px] sm:min-h-[112px]",
                    view === "week" && "min-h-[220px] sm:min-h-[320px]",
                    view === "day" && "min-h-[360px] sm:min-h-[480px]",
                    !inMonth && "bg-neutral-50/60 text-neutral-400",
                    inMonth && "bg-white",
                    isToday && !isSelected && "ring-1 ring-inset ring-primary-300 bg-primary-50/40",
                    (isSelected || inPreview) && "bg-primary-50 ring-2 ring-inset ring-primary-500"
                  )}
                >
                  <AvailabilityBand dayAvailability={dayAvailability} />

                  <div className="flex-1 min-h-0 flex flex-col gap-1 p-1 sm:p-2">
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
                      {dayShifts.map((s) => (
                        <ShiftBlock key={s.id} shift={s} compact={view !== "day"} />
                      ))}
                      {dayShifts.length === 0 && view === "day" && (
                        <p className="text-sm text-neutral-400">No shifts assigned.</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="w-full lg:w-80 shrink-0">
          {panelMode === "empty" ? (
            <div className="card-base h-full min-h-[220px] lg:min-h-[520px] flex items-center justify-center text-center p-6 text-sm text-neutral-400">
              Pick &ldquo;+ New Request&rdquo; above to change your availability, request a shift swap, or give away a shift.
            </div>
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

function AvailabilityBand({ dayAvailability }: { dayAvailability: AvailabilityDTO[] }) {
  const segments: { key: string; className: string }[] = [];
  if (dayAvailability.some((a) => a.status === "AVAILABLE")) {
    segments.push({ key: "available", className: "bg-emerald-200" });
  }
  if (dayAvailability.some((a) => a.status === "UNAVAILABLE")) {
    segments.push({ key: "unavailable", className: "bg-accent-200" });
  }
  if (dayAvailability.some((a) => a.status === "TENTATIVE")) {
    segments.push({ key: "tentative", className: "bg-neutral-300" });
  }

  return (
    <div className="flex h-1/4 min-h-[6px] w-full shrink-0">
      {segments.length === 0 ? (
        <span className="flex-1" />
      ) : (
        segments.map((s) => <span key={s.key} className={cn("flex-1", s.className)} />)
      )}
    </div>
  );
}
