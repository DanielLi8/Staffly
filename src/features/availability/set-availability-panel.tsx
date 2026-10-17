"use client";

import { forwardRef, useRef } from "react";
import { format } from "date-fns";
import { AlertTriangle, Info, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dayKeyToLocalDate, dayKeysBetween, hospitalDate, hospitalTime } from "@/lib/timezone";
import { minuteLabel } from "@/lib/schedule/time-grid";
import {
  AVAILABILITY_PRESETS,
  blockLabel,
  blockValidationError,
  dayKeysLabel,
  isOvernight,
  TIME_STEP_MINUTES,
  type AvailabilityBlock,
  type AvailabilityPresetId,
  type SelectionPattern,
} from "@/lib/availability/blocks";
import type { ShiftAvailabilityConflict } from "@/lib/availability/conflicts";
import type { QuickPick } from "@/lib/availability/selection";
import type { PersonalScheduleShift } from "@/features/schedule/shift-block";

export type EditScope = "day" | "week" | "dates";

export interface AvailabilityChoice {
  mode: AvailabilityPresetId | "custom";
  blocks: AvailabilityBlock[];
}

const START_OPTIONS = Array.from({ length: 1440 / TIME_STEP_MINUTES }, (_, i) => i * TIME_STEP_MINUTES);
const END_OPTIONS = START_OPTIONS.map((m) => m + TIME_STEP_MINUTES);
const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

const DEFAULT_CUSTOM_BLOCK: AvailabilityBlock = { status: "AVAILABLE", startMinute: 420, endMinute: 1140 };

/** Monday-first column (0-6) of a day key. */
export function weekdayColumn(dayKey: string): number {
  return (dayKeyToLocalDate(dayKey).getDay() + 6) % 7;
}

/**
 * The "Set availability" editor (B2): pick the days - one day, a whole week,
 * or a date range with individual days ticked off - then one tap on a preset
 * (or Custom with 15-minute pickers), and save. It saves instantly (no
 * approval), so the copy never calls it a request. What will change is
 * spelled out before saving: the ticked days (also highlighted on the
 * grid), what is saved on them now, and any shift the choice would leave
 * outside your availability.
 */
export const SetAvailabilityPanel = forwardRef<
  HTMLDivElement,
  {
    scope: EditScope;
    from: string;
    to: string;
    selectedKeys: string[];
    rangeError: string | null;
    onScopeChange: (scope: EditScope) => void;
    onRangeChange: (from: string, to: string) => void;
    onToggleDay: (dayKey: string) => void;
    onQuickPick: (pick: QuickPick) => void;
    loading: boolean;
    pattern: SelectionPattern | null;
    choice: AvailabilityChoice | null;
    onChoice: (choice: AvailabilityChoice) => void;
    conflicts: { shift: PersonalScheduleShift; conflict: ShiftAvailabilityConflict }[];
    saving: boolean;
    error: string | null;
    onSave: () => void;
    onCancel: () => void;
  }
>(function SetAvailabilityPanel(props, ref) {
  const {
    scope,
    from,
    to,
    selectedKeys,
    rangeError,
    onScopeChange,
    onRangeChange,
    onToggleDay,
    onQuickPick,
    loading,
    pattern,
    choice,
    onChoice,
    conflicts,
    saving,
    error,
    onSave,
    onCancel,
  } = props;

  const rangeKeys = dayKeysBetween(from, to);
  const selected = new Set(selectedKeys);
  const dayCount = selectedKeys.length;
  const blockErrors = choice?.mode === "custom" ? choice.blocks.map(blockValidationError) : [];
  const choiceValid = choice !== null && choice.blocks.length > 0 && blockErrors.every((e) => e === null);
  const disabledReason = saving
    ? null
    : dayCount === 0
      ? "Tick at least one day."
      : loading
        ? "Checking what's saved on these days…"
        : !choice
          ? "Pick a preset or Custom."
          : choice.blocks.length === 0
            ? "Add a time range."
            : !choiceValid
              ? "Fix the highlighted time range."
              : null;

  function setCustomBlocks(update: (blocks: AvailabilityBlock[]) => AvailabilityBlock[]) {
    onChoice({ mode: "custom", blocks: update(choice?.blocks ?? []) });
  }

  return (
    <section ref={ref} aria-labelledby="set-availability-heading" className="card-base flex flex-col md:min-h-[560px] scroll-mt-20">
      <div className="border-b border-neutral-200 px-4 py-3">
        <h2 id="set-availability-heading" className="text-lg font-semibold text-neutral-900">
          Set availability
        </h2>
        <p className="text-sm text-neutral-600">Saves right away. Your scheduler sees it when filling shifts.</p>
      </div>

      <div className="flex-1 space-y-5 p-4">
        {/* 1. Which days */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-neutral-700">Days</legend>
          <ScopeToggle value={scope} onChange={onScopeChange} />

          {scope === "dates" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm font-medium text-neutral-700">
                From
                <input
                  type="date"
                  value={from}
                  onChange={(e) => e.target.value && onRangeChange(e.target.value, to < e.target.value ? e.target.value : to)}
                  className="mt-1 h-11 w-full rounded-md border border-neutral-300 px-2 text-base text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </label>
              <label className="text-sm font-medium text-neutral-700">
                To
                <input
                  type="date"
                  value={to}
                  min={from}
                  onChange={(e) => e.target.value && onRangeChange(from, e.target.value < from ? from : e.target.value)}
                  className="mt-1 h-11 w-full rounded-md border border-neutral-300 px-2 text-base text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </label>
            </div>
          )}
          {rangeError && <p className="text-sm font-medium text-accent-600">{rangeError}</p>}

          {rangeKeys.length > 1 ? (
            <div>
              <div className="mb-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Quick pick">
                {(
                  [
                    ["every-day", "Every day"],
                    ["weekdays", "Weekdays"],
                    ["weekends", "Weekends"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onQuickPick(value)}
                    className="h-8 rounded-full border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1" role="group" aria-label="Tick the days to change">
                {WEEKDAY_INITIALS.map((d, i) => (
                  <span key={i} className="text-center text-xs font-semibold text-neutral-500" aria-hidden>
                    {d}
                  </span>
                ))}
                {Array.from({ length: weekdayColumn(from) }, (_, i) => (
                  <span key={`pad-${i}`} aria-hidden />
                ))}
                {rangeKeys.map((key, i) => {
                  const on = selected.has(key);
                  const date = dayKeyToLocalDate(key);
                  const showMonth = i === 0 || date.getDate() === 1;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={on}
                      aria-label={format(date, "EEEE, MMMM d")}
                      onClick={() => onToggleDay(key)}
                      className={cn(
                        "flex h-11 flex-col items-center justify-center rounded-md border text-sm font-semibold tabular-nums leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1",
                        on
                          ? "border-primary-700 bg-primary-700 text-white"
                          : "border-dashed border-neutral-300 bg-white text-neutral-500 line-through decoration-neutral-400"
                      )}
                    >
                      {showMonth && <span className="text-2xs font-semibold uppercase no-underline">{format(date, "MMM")}</span>}
                      {format(date, "d")}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-base font-semibold text-neutral-900">{format(dayKeyToLocalDate(from), "EEEE, MMMM d")}</p>
          )}

          <p className={cn("text-base", dayCount ? "text-primary-900" : "text-neutral-600")} aria-live="polite">
            {dayCount === 0 ? (
              "No days ticked."
            ) : (
              <>
                <span className="font-semibold">
                  Will change {dayCount} day{dayCount > 1 ? "s" : ""}
                </span>
                {rangeKeys.length > 1 && <span className="text-neutral-700">: {dayKeysLabel(selectedKeys)}</span>}
              </>
            )}
          </p>
        </fieldset>

        {/* 2. What's saved now */}
        {dayCount > 0 && <SavedNow loading={loading} pattern={pattern} dayCount={dayCount} />}

        {/* 3. The choice */}
        <fieldset>
          <legend className="text-sm font-semibold text-neutral-700">Availability</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {AVAILABILITY_PRESETS.map((preset) => {
              const active = choice?.mode === preset.id;
              const unavailable = preset.blocks[0].status === "UNAVAILABLE";
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChoice({ mode: preset.id, blocks: preset.blocks })}
                  className={cn(
                    "flex h-16 flex-col items-center justify-center rounded-lg border px-2 text-base font-semibold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1",
                    active
                      ? "border-2 border-primary-700 bg-primary-50 text-primary-900"
                      : "border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "h-3 w-3 shrink-0 rounded-sm border",
                        unavailable ? "bg-unavailable-strong border-neutral-400" : "bg-emerald-200 border-emerald-400"
                      )}
                      aria-hidden
                    />
                    {preset.label}
                  </span>
                  <span className="text-sm font-medium tabular-nums text-neutral-600">{preset.detail}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-pressed={choice?.mode === "custom"}
            onClick={() =>
              onChoice({ mode: "custom", blocks: choice && choice.blocks.length ? choice.blocks : [DEFAULT_CUSTOM_BLOCK] })
            }
            className={cn(
              "mt-2 h-11 w-full rounded-lg border text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1",
              choice?.mode === "custom"
                ? "border-2 border-primary-700 bg-primary-50 text-primary-900"
                : "border-neutral-300 bg-white text-primary-700 hover:bg-neutral-50"
            )}
          >
            Custom times
          </button>

          {choice?.mode === "custom" && (
            <div className="mt-3 space-y-2">
              {choice.blocks.map((block, index) => (
                <CustomBlockRow
                  key={index}
                  index={index}
                  block={block}
                  error={blockErrors[index]}
                  onChange={(next) => setCustomBlocks((blocks) => blocks.map((b, i) => (i === index ? next : b)))}
                  onRemove={() => setCustomBlocks((blocks) => blocks.filter((_, i) => i !== index))}
                />
              ))}
              <button
                type="button"
                onClick={() => setCustomBlocks((blocks) => [...blocks, { ...DEFAULT_CUSTOM_BLOCK, status: "UNAVAILABLE" }])}
                className="inline-flex h-10 items-center gap-1.5 rounded-md px-2 text-base font-semibold text-primary-700 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Add another time range
              </button>
            </div>
          )}
        </fieldset>

        {conflicts.length > 0 && (
          <div className="flex gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-base text-amber-900" role="note">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden />
            <div>
              <p className="font-semibold">
                {conflicts.length === 1 ? "A shift would fall outside this availability" : `${conflicts.length} shifts would fall outside this availability`}
              </p>
              <ul className="mt-1 space-y-0.5">
                {conflicts.slice(0, 4).map(({ shift, conflict }) => (
                  <li key={shift.id} className="tabular-nums">
                    {format(dayKeyToLocalDate(hospitalDate(shift.startsAt)), "EEE, MMM d")} {hospitalTime(shift.startsAt, false)}–
                    {hospitalTime(shift.endsAt, false)} · {conflict === "UNAVAILABLE" ? "marked not available" : "outside your hours"}
                  </li>
                ))}
                {conflicts.length > 4 && <li>and {conflicts.length - 4} more</li>}
              </ul>
              <p className="mt-1 text-sm">You can still save. You&apos;re still expected for those shifts; use New Request to swap or give one away.</p>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-neutral-200 p-4">
        {error && (
          <p className="text-sm font-medium text-accent-600" role="alert">
            {error}
          </p>
        )}
        {disabledReason ? (
          <p className="text-sm text-neutral-600">{disabledReason}</p>
        ) : (
          <p className="text-sm text-neutral-600">
            Saves right away for {dayCount} day{dayCount > 1 ? "s" : ""}. Your scheduler is notified. You can undo for 10 seconds.
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="h-11 flex-1 rounded-md border border-neutral-300 bg-white text-base font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={disabledReason !== null || saving}
            className="h-11 flex-[2] rounded-md bg-primary-700 text-base font-semibold text-white transition-colors hover:bg-primary-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {saving ? "Saving…" : dayCount ? `Save for ${dayCount} day${dayCount === 1 ? "" : "s"}` : "Save"}
          </button>
        </div>
      </div>
    </section>
  );
});

const SCOPES: [EditScope, string][] = [
  ["day", "One day"],
  ["week", "Whole week"],
  ["dates", "Date range"],
];

/** Segmented control in the app's sliding-pill pattern (DESIGN.md, `PortalToggle` in login-form.tsx). */
function ScopeToggle({ value, onChange }: { value: EditScope; onChange: (scope: EditScope) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = SCOPES.findIndex(([v]) => v === value);

  function handleKeyDown(e: React.KeyboardEvent) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (activeIndex + step + SCOPES.length) % SCOPES.length;
    onChange(SCOPES[next][0]);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Apply to"
      onKeyDown={handleKeyDown}
      className="relative grid grid-cols-3 rounded-full border border-neutral-200 bg-neutral-100 p-0.5"
    >
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0.5 w-[calc((100%-0.25rem)/3)] rounded-full bg-white shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      />
      {SCOPES.map(([scope, label], i) => {
        const checked = scope === value;
        return (
          <button
            key={scope}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(scope)}
            className={cn(
              "relative z-10 h-9 whitespace-nowrap rounded-full px-1 text-sm font-semibold transition-colors duration-200 ease-out motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
              checked ? "text-primary-900" : "text-neutral-600 hover:text-neutral-900"
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function SavedNow({ loading, pattern, dayCount }: { loading: boolean; pattern: SelectionPattern | null; dayCount: number }) {
  if (loading || !pattern) {
    return <p className="text-base text-neutral-600">Checking what&apos;s saved…</p>;
  }
  if (pattern.kind === "empty") {
    return (
      <p className="text-base text-neutral-700">
        Saved now: <span className="font-semibold">nothing</span>
        {dayCount > 1 ? " on these days" : ""}.
      </p>
    );
  }
  if (pattern.kind === "same") {
    return (
      <div className="text-base text-neutral-700">
        <p>Saved now{dayCount > 1 ? ` on all ${dayCount} days` : ""}:</p>
        <ul className="mt-1 space-y-0.5">
          {pattern.blocks.map((b, i) => (
            <li key={i} className={cn("font-semibold tabular-nums", b.status === "AVAILABLE" ? "text-emerald-800" : "text-neutral-800")}>
              {blockLabel(b)}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5 rounded-lg border border-primary-200 bg-primary-50 p-3 text-base text-primary-900" role="note">
      <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <p>
        These days don&apos;t all have the same availability ({pattern.daysWithAvailability} of {dayCount} have some saved).{" "}
        <span className="font-semibold">Saving replaces all of them</span> with what you pick below.
      </p>
    </div>
  );
}

function CustomBlockRow({
  index,
  block,
  error,
  onChange,
  onRemove,
}: {
  index: number;
  block: AvailabilityBlock;
  error: string | null | undefined;
  onChange: (block: AvailabilityBlock) => void;
  onRemove: () => void;
}) {
  const errorId = `custom-block-${index}-error`;
  const selectClass = cn(
    "h-11 min-w-0 flex-1 rounded-md border bg-white px-2 text-base tabular-nums text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500",
    error ? "border-accent-400" : "border-neutral-300"
  );
  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
      <div className="flex items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-neutral-300 text-sm font-semibold" role="group" aria-label={`Time range ${index + 1} status`}>
          <button
            type="button"
            aria-pressed={block.status === "AVAILABLE"}
            onClick={() => onChange({ ...block, status: "AVAILABLE" })}
            className={cn(
              "h-10 px-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500",
              block.status === "AVAILABLE" ? "bg-emerald-100 text-emerald-900" : "bg-white text-neutral-600 hover:bg-neutral-50"
            )}
          >
            Available
          </button>
          <button
            type="button"
            aria-pressed={block.status === "UNAVAILABLE"}
            onClick={() => onChange({ ...block, status: "UNAVAILABLE" })}
            className={cn(
              "h-10 border-l border-neutral-300 px-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500",
              block.status === "UNAVAILABLE" ? "bg-neutral-200 text-neutral-900" : "bg-white text-neutral-600 hover:bg-neutral-50"
            )}
          >
            Not available
          </button>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove time range ${index + 1}`}
          className="ml-auto inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <select
          aria-label={`Time range ${index + 1} start`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          value={block.startMinute}
          onChange={(e) => onChange({ ...block, startMinute: Number(e.target.value) })}
          className={selectClass}
        >
          {START_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {minuteLabel(m)}
            </option>
          ))}
        </select>
        <span className="text-base text-neutral-600">to</span>
        <select
          aria-label={`Time range ${index + 1} end`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          value={block.endMinute}
          onChange={(e) => onChange({ ...block, endMinute: Number(e.target.value) })}
          className={selectClass}
        >
          {END_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m === 1440 ? "24:00 (midnight)" : minuteLabel(m)}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p id={errorId} className="text-sm font-medium text-accent-600">
          {error}
        </p>
      ) : (
        isOvernight(block) && <p className="text-sm text-neutral-600">Ends the next morning.</p>
      )}
    </div>
  );
}
