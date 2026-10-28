"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_TARGET_COUNT } from "@/lib/staffing/targets";

/**
 * A whole-number stepper for one projected count. `value === null` means the
 * days behind this cell differ ("Varies"); typing or stepping sets them all.
 * Arrow Up/Down step from the keyboard; `compact` drops the -/+ buttons so a
 * seven-day row fits.
 */
export function CountStepper({
  value,
  onChange,
  label,
  dirty = false,
  disabled = false,
  variesHint,
  compact = false,
}: {
  value: number | null;
  onChange: (next: number) => void;
  /** Accessible name, e.g. "Day RN, weekdays". */
  label: string;
  dirty?: boolean;
  disabled?: boolean;
  /** Shown to screen readers and as a tooltip when `value` is null. */
  variesHint?: string;
  compact?: boolean;
}) {
  const clamp = (n: number) => Math.min(MAX_TARGET_COUNT, Math.max(0, n));
  const btn =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className="inline-flex items-center gap-0.5" title={value === null ? variesHint : undefined}>
      {!compact && (
        <button
          type="button"
          className={btn}
          onClick={() => onChange(clamp((value ?? 0) - 1))}
          disabled={disabled || value === 0}
          aria-label={`Decrease ${label}`}
        >
          <Minus className="h-4 w-4" aria-hidden />
        </button>
      )}
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={value === null && variesHint ? `${label} (${variesHint})` : label}
        value={value ?? ""}
        placeholder={value === null ? "–" : undefined}
        disabled={disabled}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          if (digits === "") return;
          onChange(clamp(Number(digits)));
        }}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          onChange(clamp(e.key === "ArrowUp" ? (value ?? -1) + 1 : (value ?? 0) - 1));
        }}
        className={cn(
          "h-9 w-11 rounded-md border text-center text-base tabular-nums sm:text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50",
          dirty
            ? "border-primary-500 bg-primary-50 font-semibold text-primary-900"
            : "border-neutral-300 bg-white text-neutral-900",
          value === null && "placeholder:text-neutral-500"
        )}
      />
      {!compact && (
        <button
          type="button"
          className={btn}
          onClick={() => onChange(clamp((value ?? -1) + 1))}
          disabled={disabled || value === MAX_TARGET_COUNT}
          aria-label={`Increase ${label}`}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
