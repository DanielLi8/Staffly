import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { resolveViewMode, VIEW_MODE_COOKIE } from "@/lib/view-mode";
import { DashboardClient } from "./dashboard-client";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  const session = await getSession();
  if (!session) redirect("/login");

  const viewMode = resolveViewMode(session.user.role, cookies().get(VIEW_MODE_COOKIE)?.value);

  return (
    <DashboardClient userName={session.user.name} role={session.user.role} viewMode={viewMode}>
      {children}
    </DashboardClient>
  );
}
