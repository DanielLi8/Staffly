"use client";

import { useEffect } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Home, LogOut, Search, Settings } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";

export interface DrawerLink {
  href: string;
  label: string;
}

interface HamburgerDrawerProps {
  userName: string;
  homeHref: string;
  moreLinks: DrawerLink[];
  onClose: () => void;
}

/**
 * Slide-in-from-left drawer, opened from the hamburger in `StafflyHeader`.
 * Crib of `ShiftSwapPanel`'s overlay/panel mechanics (fixed inset-0,
 * bg-neutral-900/40 overlay, click-outside-to-close) mirrored to the left
 * (justify-start instead of justify-end); Escape-to-close follows the
 * pattern in `user-menu.tsx`/`new-request-menu.tsx`.
 */
export function HamburgerDrawer({ userName, homeHref, moreLinks, onClose }: HamburgerDrawerProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-start">
      <div className="absolute inset-0 bg-neutral-900/40" onClick={onClose} aria-hidden />
      <div className="relative flex h-full w-[300px] max-w-[85vw] flex-col bg-white shadow-xl">
        <div className="flex items-center gap-3 border-b border-neutral-200 p-5">
          <Avatar name={userName} size="lg" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-neutral-900">{userName}</p>
            <p className="text-xs text-neutral-500">Signed in</p>
          </div>
        </div>

        <div className="space-y-0.5 border-b border-neutral-100 px-3 py-2">
          <Link
            href="/profile"
            className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
            onClick={onClose}
          >
            <Settings className="h-4 w-4 text-neutral-400" aria-hidden />
            Edit Profile
          </Link>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="h-4 w-4 text-neutral-400" aria-hidden />
            Sign Out
          </button>
        </div>

        <div className="px-4 pb-2 pt-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
              aria-hidden
            />
            <input
              disabled
              placeholder="Search (coming soon)"
              className="h-9 w-full rounded-lg border border-neutral-200 bg-neutral-50 pl-9 pr-3 text-sm text-neutral-400 placeholder:text-neutral-400"
            />
          </div>
        </div>

        <nav className="px-2 py-1">
          <Link
            href={homeHref}
            className="flex items-center gap-2.5 rounded-lg bg-primary-50 px-3 py-2.5 text-sm font-semibold text-primary-700"
            onClick={onClose}
          >
            <Home className="h-4 w-4" aria-hidden />
            Home
          </Link>
        </nav>

        <div className="mt-2 flex-1 overflow-y-auto px-2">
          <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-400">More</p>
          <div className="space-y-0.5">
            {moreLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50"
                onClick={onClose}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
