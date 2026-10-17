"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Horizontal scroll container that marks hidden overflow with an edge fade,
 * so a wide grid (e.g. the month heatmap's days 29-31 at phone width) never
 * hides columns behind an unmarked scroll. The fades are purely visual
 * (`aria-hidden`, `pointer-events-none`); keyboard and screen-reader access
 * is the native scroll region's. A `--staff-col` CSS variable set on (or
 * above) this element keeps the left fade clear of a sticky first column.
 */
export function ScrollAreaX({
  className,
  innerClassName,
  label,
  children,
}: {
  className?: string;
  innerClassName?: string;
  label?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [update]);

  return (
    <div className={cn("relative", className)}>
      <div
        ref={ref}
        onScroll={update}
        className={cn("overflow-x-auto", innerClassName)}
        role={label ? "region" : undefined}
        aria-label={label}
        tabIndex={label ? 0 : undefined}
      >
        {children}
      </div>
      <div
        aria-hidden
        data-edge="left"
        data-visible={edges.left}
        style={{ left: "var(--staff-col, 0px)" }}
        className={cn(
          "pointer-events-none absolute inset-y-0 w-6 bg-gradient-to-r from-neutral-900/10 to-transparent transition-opacity duration-150 ease-out motion-reduce:transition-none",
          edges.left ? "opacity-100" : "opacity-0"
        )}
      />
      <div
        aria-hidden
        data-edge="right"
        data-visible={edges.right}
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-neutral-900/10 to-transparent transition-opacity duration-150 ease-out motion-reduce:transition-none",
          edges.right ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  );
}
