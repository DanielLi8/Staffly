import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <DashboardShell userName={session.user.name} role={session.user.role}>
      {children}
    </DashboardShell>
  );
}

function DashboardShell({
  userName,
  role,
  children,
}: {
  userName: string;
  role: "ADMIN" | "WORKER";
  children: React.ReactNode;
}) {
  return (
    <DashboardClient userName={userName} role={role}>
      {children}
    </DashboardClient>
  );
}

// Import client wrapper
import { DashboardClient } from "./dashboard-client";
