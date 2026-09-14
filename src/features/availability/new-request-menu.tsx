"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type NewRequestChoice = "change-availability" | "shift-swap" | "shift-giveaway";

const MENU_ITEMS = [
  { choice: "change-availability" as const, label: "Change Availability" },
  { choice: "shift-swap" as const, label: "Shift Swap" },
  { choice: "shift-giveaway" as const, label: "Shift Giveaway" },
];

/**
 * Text-only dropdown per the captain's note (no icons). The single "+ New
 * Request" entry point for `/worker/schedule` - Change Availability, Shift
 * Swap, and Shift Giveaway are all live. Mirrors the click-outside/Escape/aria
 * pattern of `src/components/layout/user-menu.tsx`, the only other
 * hand-rolled menu in the app.
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
                onClick={() => {
                  setOpen(false);
                  onChoose(item.choice);
                }}
                className="flex w-full items-center justify-between gap-2.5 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"
              >
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
