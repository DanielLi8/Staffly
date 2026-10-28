import { redirect } from "next/navigation";
import { actorFromSession, getSession } from "@/lib/auth";
import { can } from "@/lib/authz";

export default async function RootPage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  if (can(actorFromSession(session), "portal.admin")) {
    redirect("/admin");
  }

  redirect("/worker");
}
