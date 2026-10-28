import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canManageStaffAccounts } from "@/lib/authz/staff-accounts";
import { StaffEditor } from "@/features/staff/staff-editor";

export const metadata = { title: "Add Staff – Staffly" };

/** Add a new hire. Only for an admin `canManageStaffAccounts` allows. */
export default async function AddStaffPage() {
  const session = await getSession();
  if (!session || session.user.role !== "ADMIN") redirect("/worker/shifts");
  if (!canManageStaffAccounts({ id: session.user.id, role: session.user.role, email: session.user.email })) {
    notFound();
  }

  const departments = await db.department.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, code: true },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-4">
        <Link
          href="/admin/workers"
          className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All staff
        </Link>
        <div>
          <h1 className="page-title">Add staff</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            They can&apos;t sign in until they have a password. Sign-in invites aren&apos;t available yet.
          </p>
        </div>
      </div>
      <StaffEditor
        mode="create"
        departments={departments}
        initial={{
          name: "",
          email: "",
          employeeId: "",
          position: "",
          primaryDepartmentId: "",
          hireDate: "",
          seniorityRank: "",
          phone: "",
          phoneConfirmed: false,
          isTeamLead: false,
          memberships: [],
        }}
      />
    </div>
  );
}
