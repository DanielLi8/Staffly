"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HelpCircle, Home, Menu } from "lucide-react";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { HamburgerDrawer, type DrawerLink } from "@/components/layout/hamburger-drawer";
import type { Role } from "@/types";
import type { ViewMode } from "@/lib/view-mode";

interface StafflyHeaderProps {
  userName: string;
  variant: "admin" | "worker";
  role: Role;
  viewMode: ViewMode;
}

interface TitleEntry {
  match: (pathname: string) => boolean;
  title: string;
}

/**
 * Sub-page title shown in place of the wordmark. Covers every destination
 * previously reachable from the old `adminLinks`/`workerLinks` top nav, plus
 * every other page reachable under `(dashboard)` - keep this in sync when a
 * new page is added there. Order matters: more specific matches (e.g. a
 * `/new` route) must come before the broader prefix that would also match it.
 */
const pageTitles: TitleEntry[] = [
  { match: (p) => p === "/admin/shifts/new", title: "Create New Shift" },
  { match: (p) => p.startsWith("/admin/shifts/"), title: "Shift Details" },
  { match: (p) => p === "/admin/shifts", title: "Shifts" },
  { match: (p) => p.startsWith("/admin/departments"), title: "Departments" },
  { match: (p) => p.startsWith("/admin/schedule"), title: "Location Schedule" },
  { match: (p) => p.startsWith("/admin/shift-swaps"), title: "Shift Swaps" },
  { match: (p) => p.startsWith("/admin/workers"), title: "Workers" },
  { match: (p) => p === "/worker/shifts", title: "Available Shifts" },
  { match: (p) => p.startsWith("/worker/shifts/"), title: "Shift Details" },
  { match: (p) => p.startsWith("/worker/bids") || p.startsWith("/worker/my-bids"), title: "Shift Bids" },
  { match: (p) => p.startsWith("/worker/schedule"), title: "Your Schedule" },
  { match: (p) => p.startsWith("/worker/location"), title: "Location Schedule" },
  { match: (p) => p === "/profile", title: "Profile" },
];

function pageTitleFor(pathname: string): string | null {
  return pageTitles.find((e) => e.match(pathname))?.title ?? null;
}

const workerMoreLinks: DrawerLink[] = [
  { href: "/worker/bids", label: "Shift Bids" },
  { href: "/worker/schedule", label: "Schedule" },
  { href: "/worker/location", label: "Location Schedule" },
];

const adminMoreLinks: DrawerLink[] = [
  { href: "/admin/departments", label: "Departments" },
  { href: "/admin/schedule", label: "Schedule" },
  { href: "/admin/shift-swaps", label: "Shift Swaps" },
  { href: "/admin/workers", label: "Workers" },
];

export function StafflyHeader({ userName, variant, role, viewMode }: StafflyHeaderProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const homeHref = variant === "admin" ? "/admin" : "/worker";
  const moreLinks = variant === "admin" ? adminMoreLinks : workerMoreLinks;
  const title = pathname === homeHref ? null : pageTitleFor(pathname);

  return (
    <>
      <header className="sticky top-0 z-40 bg-primary-700">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 lg:px-8">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>

          <Link
            href={homeHref}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            aria-label="Home"
          >
            <Home className="h-5 w-5" aria-hidden />
          </Link>

          {title ? (
            <span className="truncate text-[17px] font-semibold tracking-tight text-white">{title}</span>
          ) : (
            <span className="font-display truncate text-xl font-bold leading-none tracking-tight text-white">
              Staffly
            </span>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="hidden h-9 w-9 items-center justify-center rounded-lg text-white/85 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:inline-flex"
              aria-label="Help"
            >
              <HelpCircle className="h-5 w-5" aria-hidden />
            </button>
            <NotificationBell />
          </div>
        </div>
      </header>

      {drawerOpen && (
        <HamburgerDrawer
          userName={userName}
          homeHref={homeHref}
          moreLinks={moreLinks}
          role={role}
          viewMode={viewMode}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </>
  );
}
