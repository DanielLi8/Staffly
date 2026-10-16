"use client";

import { useEffect, useRef } from "react";

/**
 * Shared behavior for the app's slide-over panels (`HamburgerDrawer`,
 * `ShiftSwapPanel`): Escape closes, focus moves into the panel when it
 * opens, and returns to whatever opened it when it closes - so a keyboard or
 * screen-reader user lands inside the dialog instead of behind its overlay.
 * Attach the returned ref to the panel element (give it `tabIndex={-1}`).
 */
export function useModalPanel<T extends HTMLElement>(onClose: () => void) {
  const panelRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  return panelRef;
}
