import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { DashboardClient } from "./dashboard-client";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <DashboardClient userName={session.user.name} role={session.user.role}>
      {children}
    </DashboardClient>
  );
}
