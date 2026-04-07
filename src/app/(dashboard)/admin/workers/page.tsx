import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Users } from "lucide-react";

export const metadata = { title: "Workers – Staffly" };

export default async function AdminWorkersPage() {
  const session = await getSession();
  if (!session || session.user.role !== "ADMIN") redirect("/worker/shifts");

  const workers = await db.user.findMany({
    where: { role: "WORKER" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      department: true,
      position: true,
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
                    <p className="font-semibold text-neutral-900 text-sm leading-tight">{worker.name}</p>
                    <p className="text-xs text-neutral-500 truncate">{worker.email}</p>
                    {worker.position && (
                      <p className="text-xs text-primary-700 mt-1">{worker.position}</p>
                    )}
                    {worker.department && (
                      <p className="text-xs text-neutral-500">{worker.department}</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-neutral-100 flex gap-4 text-xs text-neutral-500">
                  <span>{worker._count.bids} bid{worker._count.bids !== 1 ? "s" : ""}</span>
                  <span>{worker._count.assignedShifts} assigned</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
