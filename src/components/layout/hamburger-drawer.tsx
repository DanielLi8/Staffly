"use client";

import { useEffect } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Home, LogOut, Settings } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { setViewMode } from "@/app/actions/view-mode";
import type { Role } from "@/types";
import type { ViewMode } from "@/lib/view-mode";

export interface DrawerLink {
  href: string;
  label: string;
}

interface HamburgerDrawerProps {
  userName: string;
  homeHref: string;
  topLinks?: DrawerLink[];
  moreLinks: DrawerLink[];
  role: Role;
  viewMode: ViewMode;
  onClose: () => void;
}

const setAdminViewMode = setViewMode.bind(null, "ADMIN");
const setWorkerViewMode = setViewMode.bind(null, "WORKER");

/**
 * Slide-in-from-left drawer, opened from the hamburger in `StafflyHeader`.
 * Crib of `ShiftSwapPanel`'s overlay/panel mechanics (fixed inset-0,
 * bg-neutral-900/40 overlay, click-outside-to-close) mirrored to the left
 * (justify-start instead of justify-end); Escape-to-close follows the
 * pattern in `user-menu.tsx`/`new-request-menu.tsx`.
 */
export function HamburgerDrawer({ userName, homeHref, topLinks = [], moreLinks, role, viewMode, onClose }: HamburgerDrawerProps) {
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
            <p className="truncate font-semibold text-neutral-900">
              {userName}
              {role === "ADMIN" && (
                <span className="ml-1.5 rounded bg-primary-50 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-primary-700">
                  Admin
                </span>
              )}
            </p>
            <p className="text-xs text-neutral-500">
              {role === "ADMIN"
                ? viewMode === "ADMIN"
                  ? "Viewing as Admin"
                  : "Viewing as Worker (preview)"
                : "Signed in"}
            </p>
          </div>
        </div>

        {role === "ADMIN" && (
          <div className="border-b border-neutral-100 px-4 py-3">
            <p className="pb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">View as</p>
            <div className="flex gap-1 rounded-lg bg-neutral-100 p-1">
              <form action={setAdminViewMode} className="flex-1">
                <button
                  type="submit"
                  disabled={viewMode === "ADMIN"}
                  aria-pressed={viewMode === "ADMIN"}
                  className={
                    viewMode === "ADMIN"
                      ? "w-full rounded-md bg-white px-2 py-1.5 text-sm font-semibold text-primary-700 shadow-sm"
                      : "w-full rounded-md px-2 py-1.5 text-sm text-neutral-600 hover:text-neutral-900"
                  }
                >
                  Admin
                </button>
              </form>
              <form action={setWorkerViewMode} className="flex-1">
                <button
                  type="submit"
                  disabled={viewMode === "WORKER"}
                  aria-pressed={viewMode === "WORKER"}
                  className={
                    viewMode === "WORKER"
                      ? "w-full rounded-md bg-white px-2 py-1.5 text-sm font-semibold text-primary-700 shadow-sm"
                      : "w-full rounded-md px-2 py-1.5 text-sm text-neutral-600 hover:text-neutral-900"
                  }
                >
                  Worker
                </button>
              </form>
            </div>
          </div>
        )}

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

        <nav className="px-2 py-1 pt-3">
          <Link
            href={homeHref}
            className="flex items-center gap-2.5 rounded-lg bg-primary-50 px-3 py-2.5 text-sm font-semibold text-primary-700"
            onClick={onClose}
          >
            <Home className="h-4 w-4" aria-hidden />
            Home
          </Link>
          {topLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
              onClick={onClose}
            >
              {l.label}
            </Link>
          ))}
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
