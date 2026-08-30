"use client";

import { usePathname } from "next/navigation";
import { StafflyHeader } from "@/components/layout/staffly-header";
import { StafflyFooter } from "@/components/layout/staffly-footer";
import type { Role } from "@/types";

interface DashboardClientProps {
  userName: string;
  role: Role;
  children: React.ReactNode;
}

export function DashboardClient({ userName, role, children }: DashboardClientProps) {
  const pathname = usePathname();

  let variant: "admin" | "worker";
  if (pathname.startsWith("/admin")) {
    variant = "admin";
  } else if (pathname === "/profile") {
    variant = role === "ADMIN" ? "admin" : "worker";
  } else {
    variant = "worker";
  }

  return (
    <div className="flex min-h-screen flex-col bg-staffly-bg">
      <StafflyHeader userName={userName} variant={variant} />
      <div className="flex-1 flex flex-col w-full">
        <div className="flex-1 w-full max-w-6xl mx-auto px-4 lg:px-8 py-8">{children}</div>
        <StafflyFooter />
      </div>
    </div>
  );
}
