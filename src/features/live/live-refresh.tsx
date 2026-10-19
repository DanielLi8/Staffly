"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useLiveRevision, type LiveRevisionStatus } from "./use-live-revision";

const LiveStatusContext = createContext<LiveRevisionStatus | null>(null);

interface LiveRefreshProps {
  /** Wire form of a topic from src/lib/live/topics.ts, e.g. `admin-shift:<id>`. */
  topic: string;
  initialRevision: string | null;
  intervalMs?: number;
  children: React.ReactNode;
}

/**
 * Keeps a server-rendered page current: when the topic's revision moves it
 * calls `router.refresh()`, so the page re-renders through its own loaders and
 * authorization - nothing new can leak - while client state (a half-typed
 * note, an open "Confirm selection?") survives. Renders no DOM of its own.
 */
export function LiveRefresh({ topic, initialRevision, intervalMs, children }: LiveRefreshProps) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const status = useLiveRevision({ topic, initialRevision, intervalMs, onChange: refresh });
  return <LiveStatusContext.Provider value={status}>{children}</LiveStatusContext.Provider>;
}

/** Re-render every `ms` so relative labels stay honest. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function syncedLabel(lastSyncedAt: number | null, now: number): string {
  if (lastSyncedAt === null) return "Live";
  const seconds = Math.max(0, Math.round((now - lastSyncedAt) / 1000));
  if (seconds < 5) return "Live · updated just now";
  if (seconds < 60) return `Live · updated ${seconds}s ago`;
  return `Live · updated ${Math.round(seconds / 60)} min ago`;
}

/**
 * The quiet "Live" marker for a card header. Renders nothing outside a
 * {@link LiveRefresh}, so a component can include it unconditionally.
 */
export function LiveStatus({ className }: { className?: string }) {
  const status = useContext(LiveStatusContext);
  const now = useNow(1_000);
  if (!status) return null;

  const { state, lastSyncedAt } = status;
  const label =
    state === "live"
      ? syncedLabel(lastSyncedAt, now)
      : state === "reconnecting"
        ? "Reconnecting…"
        : "Live updates paused - reload to resume";

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs text-neutral-500", className)}
      data-live-state={state}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-2 w-2 flex-shrink-0 rounded-full transition-colors motion-reduce:transition-none",
          state === "live" ? "bg-emerald-500 ring-[3px] ring-emerald-100" : "bg-neutral-400"
        )}
      />
      {label}
    </span>
  );
}
