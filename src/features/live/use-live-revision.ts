"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Follow a live topic's revision (`GET /api/live/revision?topic=...`) and call
 * `onChange` when it moves. The seam every live page goes through: a push
 * "doorbell" can later trigger the same check early without touching pages.
 *
 * - Polls every `intervalMs` while the tab is visible; hidden tabs don't poll.
 * - Checks at once on mount, and when the tab becomes visible, regains focus,
 *   or comes back online.
 * - Backs off exponentially (capped at `maxBackoffMs`) on network/5xx errors.
 * - Stops for good on 400/401/403/404: retrying cannot fix those.
 *
 * `initialRevision` is the revision the server computed while rendering the
 * page, so a change landing between render and hydration is still caught. When
 * a refresh re-renders the page with a newer one, it becomes the baseline.
 */

export type LiveState = "live" | "reconnecting" | "stopped";

export interface LiveRevisionStatus {
  state: LiveState;
  /** When the server last confirmed the page is current (epoch ms); null before the first check. */
  lastSyncedAt: number | null;
}

export interface UseLiveRevisionOptions {
  topic: string;
  initialRevision: string | null;
  onChange: () => void;
  intervalMs?: number;
  maxBackoffMs?: number;
}

export const DEFAULT_INTERVAL_MS = 3_000;
export const DEFAULT_MAX_BACKOFF_MS = 60_000;
const FINAL_STATUSES = new Set([400, 401, 403, 404]);

export function useLiveRevision({
  topic,
  initialRevision,
  onChange,
  intervalMs = DEFAULT_INTERVAL_MS,
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
}: UseLiveRevisionOptions): LiveRevisionStatus {
  const [status, setStatus] = useState<LiveRevisionStatus>({ state: "live", lastSyncedAt: null });

  const revisionRef = useRef(initialRevision);
  useEffect(() => {
    revisionRef.current = initialRevision;
  }, [initialRevision]);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const visible = () => document.visibilityState === "visible";

    function schedule(delay: number) {
      clearTimeout(timer);
      if (!stopped && visible()) timer = setTimeout(check, delay);
    }

    async function check() {
      if (stopped || inFlight) return;
      clearTimeout(timer);
      inFlight = true;
      controller = new AbortController();
      try {
        const res = await fetch(`/api/live/revision?topic=${encodeURIComponent(topic)}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (stopped) return;
        if (FINAL_STATUSES.has(res.status)) {
          stopped = true;
          setStatus((prev) => ({ ...prev, state: "stopped" }));
          return;
        }
        if (!res.ok) throw new Error(`Revision check failed (${res.status})`);
        const { revision } = (await res.json()) as { revision: string };
        if (stopped) return;

        failures = 0;
        const previous = revisionRef.current;
        revisionRef.current = revision;
        setStatus({ state: "live", lastSyncedAt: Date.now() });
        if (previous !== null && previous !== revision) onChangeRef.current();
        schedule(intervalMs);
      } catch {
        if (stopped) return;
        failures += 1;
        setStatus((prev) => ({ ...prev, state: "reconnecting" }));
        schedule(Math.min(intervalMs * 2 ** failures, maxBackoffMs));
      } finally {
        inFlight = false;
      }
    }

    function wake() {
      if (stopped) return;
      if (visible()) {
        void check();
      } else {
        clearTimeout(timer);
      }
    }

    function online() {
      failures = 0;
      wake();
    }

    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", online);
    wake();

    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", online);
    };
  }, [topic, intervalMs, maxBackoffMs]);

  return status;
}
