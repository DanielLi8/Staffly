"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ToastMessage } from "@/components/ui/toast";
import type { StaffingResult } from "@/lib/staffing/store";

export type RunStaffingAction = (
  action: () => Promise<StaffingResult>,
  onDone?: (result: StaffingResult) => void
) => void;

const TOAST_MS = 5000;

/**
 * One runner for every targets-page action: shows the result in a toast and
 * re-renders the page from the server on success - and on STALE too, so the
 * admin sees the numbers someone else just saved instead of their stale copy.
 * A thrown error (auth, unexpected) gets the generic retry message.
 */
export function useStaffingAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const show = useCallback((message: string, tone: ToastMessage["tone"]) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), message, tone });
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const run: RunStaffingAction = useCallback(
    (action, onDone) => {
      startTransition(async () => {
        let result: StaffingResult;
        try {
          result = await action();
        } catch {
          show("Something went wrong saving that. Please try again.", "error");
          return;
        }
        show(result.message, result.ok ? "success" : "error");
        if (result.ok || result.reason === "STALE") router.refresh();
        onDone?.(result);
      });
    },
    [router, show]
  );

  return { run, pending, toast, dismissToast: () => setToast(null) };
}
