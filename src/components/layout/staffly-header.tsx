"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { UserMenu } from "@/components/layout/user-menu";

interface StafflyHeaderProps {
  userName: string;
  variant: "admin" | "worker" | "clerk";
}

interface NavLink {
  href: string;
  label: string;
  match: (pathname: string) => boolean;
}

const adminLinks: NavLink[] = [
  {
    href: "/admin",
    label: "Shifts",
    match: (p) => p === "/admin" || (p.startsWith("/admin/shifts") && !p.startsWith("/admin/workers")),
  },
  { href: "/admin/departments", label: "Departments", match: (p) => p.startsWith("/admin/departments") },
  { href: "/admin/schedule", label: "Schedule", match: (p) => p.startsWith("/admin/schedule") },
];

const workerLinks: NavLink[] = [
  {
    href: "/worker",
    label: "Shifts",
    match: (p) => p === "/worker" || (p.startsWith("/worker/shifts") && !p.includes("/bids")),
  },
  {
    href: "/worker/bids",
    label: "Shift Bids",
    match: (p) => p.startsWith("/worker/bids") || p.startsWith("/worker/my-bids"),
  },
  {
    href: "/worker/schedule",
    label: "Schedule",
    match: (p) => p.startsWith("/worker/schedule"),
  },
  {
    href: "/worker/location",
    label: "Location Schedule",
    match: (p) => p.startsWith("/worker/location"),
  },
];

const clerkLinks: NavLink[] = [
  {
    href: "/clerk",
    label: "Department Schedule",
    match: (p) => p.startsWith("/clerk"),
  },
];

export function StafflyHeader({ userName, variant }: StafflyHeaderProps) {
  const pathname = usePathname();
  const homeHref = variant === "admin" ? "/admin" : variant === "clerk" ? "/clerk" : "/worker";
  const links = variant === "admin" ? adminLinks : variant === "clerk" ? clerkLinks : workerLinks;

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200/80 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-stretch gap-4 px-4 lg:gap-6 lg:px-8">
        <Link
          href={homeHref}
          className="-ml-1 flex shrink-0 items-center rounded-lg px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
        >
          <span className="font-display text-xl font-bold leading-none tracking-tight text-primary-700">
            Staffly
          </span>
        </Link>

        {/* Desktop primary nav. Links fill the header height so the active
            underline lands flush on the header's bottom border. */}
        <nav className="hidden items-stretch gap-6 md:flex lg:gap-8" aria-label="Primary">
          {links.map((l) => {
            const active = l.match(pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  // The transparent top border balances the underline so the
                  // label stays optically centered against the wordmark.
                  "inline-flex items-center whitespace-nowrap border-y-2 border-t-transparent text-sm font-medium transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40",
                  active
                    ? "border-b-primary-700 text-primary-700"
                    : "border-b-transparent text-neutral-600 hover:border-b-neutral-300 hover:text-primary-700"
                )}
                aria-current={active ? "page" : undefined}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        {/* Account cluster, always anchored to the top-right. */}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <NotificationBell />
          <button
            type="button"
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 sm:inline-flex"
            aria-label="Help"
          >
            <HelpCircle className="h-5 w-5" aria-hidden />
          </button>
          <div className="mx-1 hidden h-6 w-px bg-neutral-200 sm:block" aria-hidden />
          <UserMenu userName={userName} />
        </div>
      </div>

      {/* Mobile primary nav */}
      <div className="md:hidden">
        <nav
          className="flex gap-5 overflow-x-auto border-t border-neutral-100 px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Primary"
        >
          {links.map((l) => {
            const active = l.match(pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "inline-flex shrink-0 items-center whitespace-nowrap border-b-2 py-2.5 text-sm font-medium transition-colors",
                  active ? "border-b-primary-700 text-primary-700" : "border-b-transparent text-neutral-500"
                )}
                aria-current={active ? "page" : undefined}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
