import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth";
import { listPendingShiftSwapApprovals } from "@/app/actions/shift-swap-approvals";
import { AdminApprovalsList } from "@/features/shift-swap/admin-approvals-list";

export const metadata = { title: "Shift Swaps – Staffly" };

export default async function AdminShiftSwapsPage() {
  const session = await getSession();
  if (!session || session.user.role !== "ADMIN") redirect("/worker/shifts");

  const requests = await listPendingShiftSwapApprovals();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="page-title">Shift Swaps</h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          Requests a colleague has accepted, awaiting your approval before the shifts change hands.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending Approval ({requests.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminApprovalsList requests={requests} />
        </CardContent>
      </Card>
    </div>
  );
}
