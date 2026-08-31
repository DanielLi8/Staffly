"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ShiftSwapPanel } from "./shift-swap-panel";
import type { ShiftSwapKind } from "./types";

/**
 * The "+ New Request" trigger for `/worker/schedule`. Scoped to Shift Swap /
 * Giveaway only - "Change Availability" already has its own entry point (tap
 * a day in the month grid, see `AvailabilityMonthGrid`), so it isn't
 * duplicated here. `staffly-availability-calendar-v3` (a sibling task) owns
 * building the fuller three-option "+ New Request" menu shell from the
 * Lavish mockup; this is a standalone, functionally equivalent trigger so
 * this feature works whether or not that task has landed yet. If that menu
 * shell lands first, wire `ShiftSwapPanel` into its "Shift Swap"/"Shift
 * Giveaway" items and this file can go away.
 */
export function NewRequestMenu() {
  const [open, setOpen] = useState(false);
  const [flow, setFlow] = useState<ShiftSwapKind | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-10 px-4 inline-flex items-center gap-1.5 rounded-full bg-primary-700 text-white text-sm font-semibold hover:bg-primary-800"
      >
        <Plus className="w-4 h-4" /> New Request
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-52 bg-white border border-neutral-200 rounded-lg shadow-lg overflow-hidden z-20">
          <button
            type="button"
            onClick={() => {
              setFlow("SWAP");
              setOpen(false);
            }}
            className={cn(
              "w-full text-left px-3.5 py-2.5 text-sm font-medium text-neutral-700 hover:bg-primary-50 hover:text-primary-800 border-b border-neutral-100"
            )}
          >
            Shift Swap
          </button>
          <button
            type="button"
            onClick={() => {
              setFlow("GIVEAWAY");
              setOpen(false);
            }}
            className="w-full text-left px-3.5 py-2.5 text-sm font-medium text-neutral-700 hover:bg-primary-50 hover:text-primary-800"
          >
            Shift Giveaway
          </button>
        </div>
      )}

      {flow && <ShiftSwapPanel kind={flow} onClose={() => setFlow(null)} />}
    </div>
  );
}
