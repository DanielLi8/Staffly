"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  CalendarClock,
  Users,
  ClipboardList,
  Briefcase,
} from "lucide-react";
import type { Role } from "@/types";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

const adminNav: NavItem[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Shifts", href: "/admin/shifts", icon: CalendarClock },
  { label: "Workers", href: "/admin/workers", icon: Users },
];

const workerNav: NavItem[] = [
  { label: "Dashboard", href: "/worker", icon: LayoutDashboard },
  { label: "Open Shifts", href: "/worker/shifts", icon: CalendarClock },
  { label: "My requests", href: "/worker/my-bids", icon: ClipboardList },
];

interface SidebarProps {
  role: Role;
  viewMode: "admin" | "worker";
}

export function Sidebar({ role, viewMode }: SidebarProps) {
  const pathname = usePathname();
  const nav = viewMode === "admin" ? adminNav : workerNav;

  return (
    <aside className="hidden lg:flex flex-col w-56 bg-primary-700 min-h-screen">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-primary-600">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white rounded-md flex items-center justify-center flex-shrink-0">
            <span className="text-primary-700 font-bold text-sm">S</span>
          </div>
          <span className="text-white font-bold text-lg">Staffly</span>
        </div>
        {viewMode === "worker" && role === "SCHEDULER" && (
          <span className="mt-2 inline-block text-xs bg-accent/20 text-accent-200 border border-accent/30 rounded px-2 py-0.5">
            Worker Preview
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5" aria-label="Main navigation">
        {nav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                active
                  ? "bg-white/15 text-white"
                  : "text-primary-200 hover:bg-white/10 hover:text-white"
              )}
              aria-current={active ? "page" : undefined}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Role indicator */}
      <div className="px-5 py-4 border-t border-primary-600">
        <div className="flex items-center gap-2 text-primary-300 text-xs">
          <Briefcase className="w-3.5 h-3.5" aria-hidden="true" />
          <span>
            {role === "SCHEDULER" ? "Scheduler" : role === "UNIT_CLERK" ? "Unit Clerk" : "Worker"}
          </span>
        </div>
      </div>
    </aside>
  );
}
