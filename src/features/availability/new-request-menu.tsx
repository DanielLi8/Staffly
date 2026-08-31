"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type NewRequestChoice = "change-availability" | "shift-swap" | "shift-giveaway";

const MENU_ITEMS = [
  { choice: "change-availability" as const, label: "Change Availability", enabled: true },
  { choice: "shift-swap" as const, label: "Shift Swap", enabled: false },
  { choice: "shift-giveaway" as const, label: "Shift Giveaway", enabled: false },
];

/**
 * Text-only dropdown per the captain's note (no icons). "Shift Swap" and
 * "Shift Giveaway" are wired up as disabled/coming-soon rather than routed
 * anywhere - `staffly-shift-swap-foundation` (a separate task) hasn't
 * shipped those flows yet, so a live menu item here would be a UI that lies
 * about what's implemented. Mirrors the click-outside/Escape/aria pattern
 * of `src/components/layout/user-menu.tsx`, the only other hand-rolled menu
 * in the app.
 */
export function NewRequestMenu({ onChoose }: { onChoose: (choice: NewRequestChoice) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={cn(
          "h-10 px-4 inline-flex items-center justify-center rounded-full bg-primary-700 text-white text-sm font-semibold hover:bg-primary-800",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
          open && "bg-primary-800"
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        + New Request
      </button>

      {open && (
        <div role="menu" aria-orientation="vertical" className="absolute right-0 top-full z-20 min-w-[13rem] pt-2">
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
            {MENU_ITEMS.map((item) => (
              <button
                key={item.choice}
                type="button"
                role="menuitem"
                aria-disabled={!item.enabled}
                disabled={!item.enabled}
                onClick={() => {
                  if (!item.enabled) return;
                  setOpen(false);
                  onChoose(item.choice);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2.5 px-3 py-2 text-left text-sm",
                  item.enabled ? "text-neutral-700 hover:bg-neutral-50" : "text-neutral-300 cursor-not-allowed"
                )}
              >
                <span>{item.label}</span>
                {!item.enabled && <span className="text-[10px] font-semibold uppercase tracking-wide">Coming soon</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
