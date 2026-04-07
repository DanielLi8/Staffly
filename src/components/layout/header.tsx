"use client";

import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { LogOut, Users, ShieldCheck } from "lucide-react";
import type { Role } from "@/types";

interface HeaderProps {
  userName: string;
  role: Role;
  viewMode: "admin" | "worker";
}

export function Header({ userName, role, viewMode }: HeaderProps) {
  const router = useRouter();

  function toggleView() {
    if (viewMode === "admin") {
      router.push("/worker/shifts");
    } else {
      router.push("/admin");
    }
  }

  return (
    <header className="sticky top-0 z-30 h-14 flex items-center gap-3 px-4 lg:px-6 bg-white border-b border-neutral-200">
      {/* Mobile logo */}
      <div className="flex items-center gap-2 lg:hidden">
        <div className="w-7 h-7 bg-primary-700 rounded-md flex items-center justify-center">
          <span className="text-white font-bold text-xs">S</span>
        </div>
      </div>

      <div className="flex-1" />

      {/* Admin view toggle */}
      {role === "ADMIN" && (
        <Button
          variant="outline"
          size="sm"
          onClick={toggleView}
          className="hidden sm:inline-flex gap-1.5 text-xs"
          title={viewMode === "admin" ? "Preview Worker View" : "Back to Admin View"}
        >
          {viewMode === "admin" ? (
            <>
              <Users className="w-3.5 h-3.5" aria-hidden="true" />
              Worker View
            </>
          ) : (
            <>
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              Admin View
            </>
          )}
        </Button>
      )}

      <NotificationBell />

      {/* User menu */}
      <div className="flex items-center gap-2">
        <Avatar name={userName} size="sm" />
        <span className="hidden md:block text-sm font-medium text-neutral-700 max-w-[120px] truncate">
          {userName}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOut({ callbackUrl: "/login" })}
          title="Sign out"
          className="p-2"
        >
          <LogOut className="w-4 h-4 text-neutral-500" aria-hidden="true" />
          <span className="sr-only">Sign out</span>
        </Button>
      </div>
    </header>
  );
}
