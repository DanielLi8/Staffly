"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, Search, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { UserMenu } from "@/components/layout/user-menu";

interface StafflyHeaderProps {
  userName: string;
  variant: "admin" | "worker" | "clerk";
}

export function StafflyHeader({ userName, variant }: StafflyHeaderProps) {
  const pathname = usePathname();
  const homeHref = variant === "admin" ? "/admin" : variant === "clerk" ? "/clerk" : "/worker";

  const adminLinks = [
    {
      href: "/admin",
      label: "Shifts",
      match: (p: string) => p === "/admin" || (p.startsWith("/admin/shifts") && !p.startsWith("/admin/workers")),
    },
    { href: "/admin/departments", label: "Departments", match: (p: string) => p.startsWith("/admin/departments") },
  ];

  const workerLinks = [
    {
      href: "/worker",
      label: "Shifts",
      match: (p: string) =>
        p === "/worker" || (p.startsWith("/worker/shifts") && !p.includes("/bids")),
    },
    {
      href: "/worker/bids",
      label: "Shift Bids",
      match: (p: string) => p.startsWith("/worker/bids") || p.startsWith("/worker/my-bids"),
    },
    {
      href: "/worker/schedule",
      label: "Schedule",
      match: (p: string) => p.startsWith("/worker/schedule"),
    },
  ];

  const clerkLinks = [
    {
      href: "/clerk",
      label: "Department Schedule",
      match: (p: string) => p.startsWith("/clerk"),
    },
  ];

  const links = variant === "admin" ? adminLinks : variant === "clerk" ? clerkLinks : workerLinks;

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200/80 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="max-w-6xl mx-auto px-4 lg:px-8 h-14 flex items-center gap-4">
        <Link href={homeHref} className="flex items-center gap-2 shrink-0">
          <span className="font-display text-xl font-bold text-primary-700 tracking-tight">Staffly</span>
        </Link>

        <nav className="hidden md:flex items-center gap-8 ml-4 border-b border-transparent -mb-px" aria-label="Primary">
          {links.map((l) => {
            const active = l.match(pathname);
            return (
              <Link key={l.href} href={l.href} className={cn("nav-link", active && "nav-link-active")}>
                {l.label}
              </Link>
            );
          })}
        </nav>

        {variant === "worker" && (
          <div className="hidden lg:flex flex-1 max-w-md mx-4">
            <label className="relative w-full">
              <span className="sr-only">Search shifts</span>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" aria-hidden />
              <input
                type="search"
                placeholder="Search shifts..."
                className="w-full h-9 pl-9 pr-3 rounded-lg border border-neutral-200 bg-neutral-50 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-300"
                readOnly
                onFocus={(e) => {
                  e.currentTarget.blur();
                  window.location.href = "/worker/shifts";
                }}
              />
            </label>
          </div>
        )}

        <div className="flex-1 md:flex-none" />

        <div className="flex items-center gap-1 sm:gap-2">
          <NotificationBell />
          <button
            type="button"
            className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-primary-700 transition-colors"
            aria-label="Help"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
          <Link
            href="/profile"
            className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-primary-700 transition-colors"
            aria-label="Profile settings"
          >
            <Settings className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-2 pl-3 border-l border-neutral-200 ml-1">
            <UserMenu userName={userName} />
          </div>
        </div>
      </div>

      <div className="md:hidden border-t border-neutral-100 px-4 py-2 flex gap-4 overflow-x-auto">
        {links.map((l) => {
          const active = l.match(pathname);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "text-sm font-medium whitespace-nowrap pb-1 border-b-2",
                active ? "text-primary-700 border-primary-700" : "text-neutral-500 border-transparent"
              )}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
