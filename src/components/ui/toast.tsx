"use client";

import { CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ToastMessage {
  id: number;
  message: string;
  tone?: "success" | "error";
  action?: { label: string; onClick: () => void };
}

/**
 * Bottom-of-screen confirmation with an optional action (e.g. Undo). The live
 * region is always mounted so a screen reader announces each new message;
 * the owner decides how long a message stays. `z-50` so it sits above the
 * sticky header and slide-over panels (DESIGN.md Layering Rule).
 */
export function Toast({ toast, onDismiss }: { toast: ToastMessage | null; onDismiss: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-center sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2"
    >
      {toast && (
        <div
          key={toast.id}
          className={cn(
            "pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl px-4 py-3 text-base text-white shadow-lg",
            toast.tone === "error" ? "bg-accent-700" : "bg-neutral-900"
          )}
        >
          {toast.tone !== "error" && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" aria-hidden />}
          <p className="min-w-0 flex-1">{toast.message}</p>
          {toast.action && (
            <button
              type="button"
              onClick={toast.action.onClick}
              className="h-10 shrink-0 rounded-md px-3 text-base font-semibold text-primary-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="-mr-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white/80 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
