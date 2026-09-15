import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Users, ShieldCheck } from "lucide-react";
import { toggleTeamLeadFormAction } from "./toggle-team-lead-action";

export const metadata = { title: "Workers – Staffly" };

export default async function AdminWorkersPage() {
  const session = await getSession();
  if (!session || session.user.role !== "ADMIN") redirect("/worker/shifts");

  const workers = await db.user.findMany({
    where: { role: "STAFF" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      department: true,
      position: true,
      isTeamLead: true,
      createdAt: true,
      _count: { select: { bids: true, assignedShifts: true } },
    },
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="page-title">Workers</h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          {workers.length} registered worker{workers.length !== 1 ? "s" : ""}
        </p>
      </div>

      {workers.length === 0 ? (
        <EmptyState icon={Users} title="No workers registered" description="Workers will appear here once they sign up." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {workers.map((worker) => (
            <Card key={worker.id}>
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <Avatar name={worker.name} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-neutral-900 text-sm leading-tight">{worker.name}</p>
                      {worker.isTeamLead && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 text-primary-700 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">
                          <ShieldCheck className="w-3 h-3" aria-hidden />
                          Team Lead
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-500 truncate">{worker.email}</p>
                    {worker.position && (
                      <p className="text-xs text-primary-700 mt-1">{worker.position}</p>
                    )}
                    {worker.department && (
                      <p className="text-xs text-neutral-500">{worker.department}</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-neutral-100 flex items-center justify-between gap-4 text-xs text-neutral-500">
                  <div className="flex gap-4">
                    <span>{worker._count.bids} bid{worker._count.bids !== 1 ? "s" : ""}</span>
                    <span>{worker._count.assignedShifts} assigned</span>
                  </div>
                  <form action={toggleTeamLeadFormAction}>
                    <input type="hidden" name="userId" value={worker.id} />
                    <input type="hidden" name="isTeamLead" value={(!worker.isTeamLead).toString()} />
                    <button
                      type="submit"
                      className="text-xs font-medium text-primary-700 hover:text-primary-800 hover:underline"
                    >
                      {worker.isTeamLead ? "Remove Team Lead" : "Mark Team Lead"}
                    </button>
                  </form>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
