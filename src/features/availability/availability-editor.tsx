"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { dayKeysBetween, hospitalDate } from "@/lib/timezone";
import type { ScheduleView } from "@/lib/schedule/range";
import type { AvailabilityDTO } from "@/lib/availability/types";
import { buildAvailabilityRows } from "@/lib/availability/build";
import { groupRowsByDay, presetForBlocks, rowDayKey, selectionPattern } from "@/lib/availability/blocks";
import { shiftAvailabilityConflict } from "@/lib/availability/conflicts";
import {
  addDays,
  applyQuickPick,
  clampRange,
  selectedDayKeys,
  selectionOf,
  toggleDay,
  weekOf,
  type DaySelection,
  type QuickPick,
} from "@/lib/availability/selection";
import {
  loadAvailabilityContext,
  restoreAvailability,
  saveAvailability,
  type ReplacedAvailabilityRow,
} from "@/app/actions/availability";
import { Toast, type ToastMessage } from "@/components/ui/toast";
import type { PersonalScheduleShift } from "@/features/schedule/shift-block";
import { ScheduleTimeGrid } from "@/features/schedule/time-grid";
import { ScheduleMonthGrid } from "@/features/schedule/month-grid";
import { ScheduleLegend } from "@/features/schedule/schedule-legend";
import { ShiftSwapPanel } from "@/features/shift-swap/shift-swap-panel";
import type { ShiftSwapKind } from "@/features/shift-swap/types";
import { NewRequestMenu, type NewRequestChoice } from "./new-request-menu";
import { DayDetailsPanel } from "./day-details-panel";
import { SetAvailabilityPanel, type AvailabilityChoice, type EditScope } from "./set-availability-panel";

const UNDO_MS = 10_000;

interface EditState extends DaySelection {
  scope: EditScope;
}

interface Fetched {
  from: string;
  to: string;
  availability: AvailabilityDTO[];
  shifts: PersonalScheduleShift[];
}

function byId<T extends { id: string }>(...lists: T[][]): T[] {
  const map = new Map<string, T>();
  for (const list of lists) for (const item of list) map.set(item.id, item);
  return Array.from(map.values());
}

function shiftDayKeys(shift: PersonalScheduleShift): string[] {
  return dayKeysBetween(hospitalDate(shift.startsAt), hospitalDate(new Date(shift.endsAt.getTime() - 1)));
}

/**
 * `/worker/schedule`'s interactive body: the 24-hour time grid (day/week) or
 * month calendar, the Day details panel, and the "Set availability" editor
 * that replaces it while editing. Owns the header actions (+ New Request)
 * and the saved/undo toast.
 *
 * Interaction model: tapping a day shows its details. While the editor is
 * open, tapping a day ticks it on/off for the save instead (and a mouse drag
 * across month cells adds a run of days), and every day that will change is
 * highlighted on the grid - so what a save touches is visible before saving.
 *
 * The editor opens on what is SAVED, never a default: one day's saved rows
 * become its preset/custom choice, identical days likewise, and differing
 * days get an explicit "saving replaces all of them" notice (the old editor
 * showed a hard-coded 7:00 AM-3:00 PM and Submit silently overwrote the day).
 * For a range reaching past the visible page, the saved rows and shifts are
 * fetched first, and Save waits for them.
 */
export function AvailabilityEditor({
  heading,
  controls,
  view,
  dayKeys,
  monthKey,
  todayKey,
  anchorKey,
  shifts,
  availability,
}: {
  heading: ReactNode;
  controls: ReactNode;
  view: ScheduleView;
  dayKeys: string[];
  monthKey: string;
  todayKey: string;
  anchorKey: string;
  shifts: PersonalScheduleShift[];
  availability: AvailabilityDTO[];
}) {
  const router = useRouter();
  const initialFocus =
    view === "day" ? anchorKey : dayKeys.includes(todayKey) && (view === "week" || todayKey.startsWith(monthKey)) ? todayKey : view === "month" ? `${monthKey}-01` : dayKeys[0];

  const [focusedKey, setFocusedKey] = useState(initialFocus);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [choice, setChoice] = useState<AvailabilityChoice | null>(null);
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [swapFlow, setSwapFlow] = useState<ShiftSwapKind | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fetchSeq = useRef(0);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const allAvailability = useMemo(() => byId(availability, fetched?.availability ?? []), [availability, fetched]);
  const allShifts = useMemo(() => byId(shifts, fetched?.shifts ?? []), [shifts, fetched]);
  const rowsByDay = useMemo(() => groupRowsByDay(allAvailability), [allAvailability]);

  const selected = useMemo(() => (editing ? selectedDayKeys(editing) : []), [editing]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Saved rows are known for every visible day (the page query) and for the
  // last range fetched; anything else must load before the editor can say
  // what a save would replace.
  const loaded = useMemo(() => {
    if (!editing) return true;
    const visible = new Set(dayKeys);
    const inFetched = (k: string) => fetched !== null && k >= fetched.from && k <= fetched.to;
    return dayKeysBetween(editing.from, editing.to).every((k) => visible.has(k) || inFetched(k));
  }, [editing, dayKeys, fetched]);

  useEffect(() => {
    if (!editing || loaded) return;
    const seq = ++fetchSeq.current;
    const { from, to } = editing;
    loadAvailabilityContext({ from, to }).then((result) => {
      if (seq !== fetchSeq.current) return;
      if (result.ok) setFetched({ from, to, availability: result.availability, shifts: result.shifts });
      else setRangeError(result.error);
    });
  }, [editing, loaded]);

  const pattern = useMemo(
    () => (editing && loaded && selected.length > 0 ? selectionPattern(selected, rowsByDay) : null),
    [editing, loaded, selected, rowsByDay]
  );

  // Until the worker picks something, the choice IS what's saved.
  const effectiveChoice: AvailabilityChoice | null = useMemo(() => {
    if (choice) return choice;
    if (pattern?.kind === "same") return { mode: presetForBlocks(pattern.blocks) ?? "custom", blocks: pattern.blocks };
    return null;
  }, [choice, pattern]);

  const pendingConflicts = useMemo(() => {
    if (!editing || !effectiveChoice || selected.length === 0) return [];
    const built = buildAvailabilityRows(selected, effectiveChoice.blocks);
    if (!built.ok) return [];
    const merged = [...allAvailability.filter((r) => !selectedSet.has(rowDayKey(r))), ...built.rows];
    return allShifts
      .filter((s) => shiftDayKeys(s).some((k) => selectedSet.has(k)))
      .map((shift) => ({ shift, conflict: shiftAvailabilityConflict(shift, merged) }))
      .filter((c): c is { shift: PersonalScheduleShift; conflict: NonNullable<typeof c.conflict> } => c.conflict !== null);
  }, [editing, effectiveChoice, selected, selectedSet, allAvailability, allShifts]);

  const revealPanel = useCallback(() => {
    if (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches) {
      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, []);

  function showToast(next: Omit<ToastMessage, "id">, ms: number) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ ...next, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }

  function openEditor(selection: DaySelection, scope: EditScope) {
    setEditing({ ...selection, scope });
    setChoice(null);
    setSaveError(null);
    setRangeError(null);
    revealPanel();
  }

  function closeEditor() {
    setEditing(null);
    setChoice(null);
    setSaveError(null);
    setRangeError(null);
  }

  function updateSelection(next: DaySelection, scope?: EditScope) {
    const clamped = clampRange(next.from, next.to);
    setRangeError(clamped.clamped ? "That's more than 92 days, so the range was shortened." : null);
    setEditing((prev) => (prev ? { ...next, to: clamped.to, scope: scope ?? prev.scope } : prev));
  }

  function handleDaySelect(dayKey: string) {
    if (editing) {
      const next = toggleDay(editing, dayKey);
      updateSelection(next, next.from !== editing.from || next.to !== editing.to ? "dates" : editing.scope);
      return;
    }
    setFocusedKey(dayKey);
    revealPanel();
  }

  function handleDayRange(keys: string[]) {
    if (editing) {
      updateSelection(addDays(editing, keys), "dates");
    } else {
      openEditor(selectionOf(keys[0], keys[keys.length - 1]), keys.length === 1 ? "day" : "dates");
    }
  }

  function handleScopeChange(scope: EditScope) {
    if (!editing) return;
    if (scope === "day") updateSelection(selectionOf(editing.from, editing.from), scope);
    else if (scope === "week") updateSelection(weekOf(editing.from), scope);
    else updateSelection({ ...editing }, scope);
  }

  function handleNewRequest(choiceMade: NewRequestChoice) {
    if (choiceMade === "set-availability") openEditor(selectionOf(focusedKey, focusedKey), "day");
    else setSwapFlow(choiceMade === "shift-swap" ? "SWAP" : "GIVEAWAY");
  }

  async function handleUndo(dates: string[], previous: ReplacedAvailabilityRow[]) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
    const result = await restoreAvailability({ dates, rows: previous });
    setFetched(null);
    router.refresh();
    showToast(result.ok ? { message: "Change undone." } : { message: result.error, tone: "error" }, 5000);
  }

  async function handleSave() {
    if (!effectiveChoice) return;
    setSaving(true);
    setSaveError(null);
    const dates = selected;
    const result = await saveAvailability({ dates, blocks: effectiveChoice.blocks });
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    closeEditor();
    setFetched(null);
    router.refresh();
    showToast(
      {
        message: `Saved: availability for ${result.dateLabel}.`,
        action: { label: "Undo", onClick: () => handleUndo(dates, result.previous) },
      },
      UNDO_MS
    );
  }

  const isEmpty = shifts.length === 0 && availability.length === 0;
  const emptySelection =
    view === "week"
      ? { selection: selectionOf(dayKeys[0], dayKeys[6]), scope: "week" as const, label: "this week" }
      : view === "day"
        ? { selection: selectionOf(anchorKey, anchorKey), scope: "day" as const, label: "this day" }
        : {
            selection: selectionOf(`${monthKey}-01`, dayKeys.filter((k) => k.startsWith(monthKey)).pop() ?? `${monthKey}-28`),
            scope: "dates" as const,
            label: "this month",
          };

  const grid =
    view === "month" ? (
      <ScheduleMonthGrid
        dayKeys={dayKeys}
        monthKey={monthKey}
        todayKey={todayKey}
        shifts={shifts}
        availability={allAvailability}
        focusedDayKey={editing ? null : focusedKey}
        markedDayKeys={editing ? selectedSet : undefined}
        onDaySelect={handleDaySelect}
        onDayRange={handleDayRange}
        label="Your month schedule"
      />
    ) : (
      <ScheduleTimeGrid
        dayKeys={dayKeys}
        todayKey={todayKey}
        shifts={shifts}
        availability={allAvailability}
        focusedDayKey={editing ? null : focusedKey}
        markedDayKeys={editing ? selectedSet : undefined}
        onDaySelect={handleDaySelect}
        label={view === "day" ? "Your day schedule" : "Your week schedule"}
      />
    );

  return (
    <div className="space-y-4">
      {/* One header row on desktop; on a phone the date and + New Request share
          the first line and the calendar controls take the second. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="order-1 min-w-0">{heading}</div>
        <div className="order-3 w-full sm:order-2 sm:w-auto">{controls}</div>
        <div className="order-2 ml-auto sm:order-3">
          <NewRequestMenu onChoose={handleNewRequest} />
        </div>
      </div>

      {swapFlow && <ShiftSwapPanel kind={swapFlow} onClose={() => setSwapFlow(null)} />}

      {isEmpty && !editing && (
        <div className="card-base flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <CalendarPlus className="h-6 w-6 shrink-0 text-primary-700" aria-hidden />
          <div className="flex-1">
            <p className="text-base font-semibold text-neutral-900">No shifts {emptySelection.label}, and no availability set.</p>
            <p className="text-base text-neutral-600">Set your availability so your scheduler knows when to call you.</p>
          </div>
          <button
            type="button"
            onClick={() => openEditor(emptySelection.selection, emptySelection.scope)}
            className="h-11 rounded-md border border-primary-300 bg-white px-4 text-base font-semibold text-primary-700 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            Set availability for {emptySelection.label}
          </button>
        </div>
      )}

      {editing && (
        <p className="rounded-lg bg-primary-50 px-3 py-2 text-base text-primary-900 md:hidden">
          Tap days on the calendar to tick them on or off.
        </p>
      )}

      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="w-full min-w-0 flex-1 space-y-3">
          {grid}
          <ScheduleLegend showNow={view !== "month"} />
        </div>

        <div className="w-full shrink-0 md:w-80 lg:w-96">
          {editing ? (
            <SetAvailabilityPanel
              ref={panelRef}
              scope={editing.scope}
              from={editing.from}
              to={editing.to}
              selectedKeys={selected}
              rangeError={rangeError}
              onScopeChange={handleScopeChange}
              onRangeChange={(from, to) => updateSelection(selectionOf(from, to), "dates")}
              onToggleDay={(key) => updateSelection(toggleDay(editing, key))}
              onQuickPick={(pick: QuickPick) => updateSelection(applyQuickPick(editing, pick))}
              loading={!loaded}
              pattern={pattern}
              choice={effectiveChoice}
              onChoice={setChoice}
              conflicts={pendingConflicts}
              saving={saving}
              error={saveError}
              onSave={handleSave}
              onCancel={closeEditor}
            />
          ) : (
            <DayDetailsPanel
              ref={panelRef}
              dayKey={focusedKey}
              todayKey={todayKey}
              shifts={allShifts.filter((s) => shiftDayKeys(s).includes(focusedKey))}
              availability={allAvailability}
              onSetAvailability={() => openEditor(selectionOf(focusedKey, focusedKey), "day")}
            />
          )}
        </div>
      </div>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
