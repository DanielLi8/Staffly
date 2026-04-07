"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { ChevronDown, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

interface UserMenuProps {
  userName: string;
}

export function UserMenu({ userName }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [useHoverMenu, setUseHoverMenu] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setUseHoverMenu(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (useHoverMenu || !open) return;
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open, useHoverMenu]);

  const display = userName.split(" ")[0] || userName;

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={() => useHoverMenu && setOpen(true)}
      onMouseLeave={() => useHoverMenu && setOpen(false)}
    >
      <button
        type="button"
        className={cn(
          "flex items-center gap-1.5 max-w-[160px] rounded-lg px-2 py-1.5 text-left transition-colors",
          "text-sm font-medium text-neutral-700 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30"
        )}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          if (!useHoverMenu) setOpen((o) => !o);
        }}
      >
        <span className="truncate">{display}</span>
        <ChevronDown className={cn("w-4 h-4 shrink-0 text-neutral-400 transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="absolute right-0 top-full z-50 min-w-[11rem] pt-1"
        >
          <div className="rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="w-4 h-4 text-neutral-400" aria-hidden />
            Sign out
          </button>
          </div>
        </div>
      )}
    </div>
  );
}
