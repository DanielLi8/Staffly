import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { actorFromSession, getSession } from "@/lib/auth";
import { can, ROLE_DISPLAY } from "@/lib/authz";
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
    <DashboardClient
      userName={session.user.name}
      roleBadge={ROLE_DISPLAY[session.user.role]?.badge ?? null}
      canSwitchView={can(actorFromSession(session), "viewMode.switch")}
      viewMode={viewMode}
    >
      {children}
    </DashboardClient>
  );
}
