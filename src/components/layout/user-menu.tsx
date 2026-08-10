"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
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

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

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
          // Square (36x36) while only the avatar shows, so it matches the
          // adjacent icon buttons; widens once the name appears at sm.
          "flex h-9 max-w-[11rem] items-center gap-2 rounded-lg px-1 transition-colors sm:pr-2",
          "text-sm font-medium text-neutral-700 hover:bg-neutral-100",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40",
          open && "bg-neutral-100"
        )}
        aria-label={`Account menu, ${userName}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          if (!useHoverMenu) setOpen((o) => !o);
        }}
      >
        <Avatar name={userName} size="sm" />
        <span className="hidden truncate sm:inline">{display}</span>
        <ChevronDown
          className={cn(
            "hidden h-4 w-4 shrink-0 text-neutral-400 transition-transform sm:block",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div role="menu" aria-orientation="vertical" className="absolute right-0 top-full z-50 min-w-[13rem] pt-2">
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
            <div className="border-b border-neutral-100 px-3 py-2">
              <p className="truncate text-sm font-semibold text-neutral-900">{userName}</p>
              <p className="text-xs text-neutral-500">Signed in</p>
            </div>
            <Link
              href="/profile"
              role="menuitem"
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"
              onClick={() => setOpen(false)}
            >
              <Settings className="h-4 w-4 text-neutral-400" aria-hidden />
              Profile settings
            </Link>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="h-4 w-4 text-neutral-400" aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
