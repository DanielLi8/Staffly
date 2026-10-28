import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canManageStaffAccounts } from "@/lib/authz/staff-accounts";
import { staffStatus } from "@/lib/staff/accounts";
import { StaffList } from "@/features/staff/staff-list";
import { DepartmentList } from "@/features/staff/department-list";
import type { StaffRow } from "@/features/staff/types";

export const metadata = { title: "Staff – Staffly" };

/**
 * The one Staff page: every STAFF account (search + status filter, each row
 * opening that person's record at /admin/workers/[id]) and the department
 * list. "Add staff" only shows for whoever `canManageStaffAccounts` allows.
 */
export default async function AdminStaffPage() {
  const session = await getSession();
  if (!session || session.user.role !== "ADMIN") redirect("/worker/shifts");

  const [users, departments] = await Promise.all([
    db.user.findMany({
      where: { role: "STAFF" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        employeeId: true,
        position: true,
        isTeamLead: true,
        deactivatedAt: true,
        password: true,
        departmentMemberships: {
          orderBy: { department: { sortOrder: "asc" } },
          select: { title: true, department: { select: { id: true, name: true, code: true } } },
        },
      },
    }),
    db.department.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        code: true,
        wing: true,
        iconKey: true,
        _count: { select: { memberships: true } },
      },
    }),
  ]);

  const rows: StaffRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    employeeId: u.employeeId,
    position: u.position,
    isTeamLead: u.isTeamLead,
    status: staffStatus({ deactivatedAt: u.deactivatedAt, hasPassword: Boolean(u.password) }),
    memberships: u.departmentMemberships.map((m) => ({
      departmentId: m.department.id,
      code: m.department.code,
      name: m.department.name,
      title: m.title,
    })),
  }));
  const current = rows.filter((r) => r.status !== "DEACTIVATED").length;
  const canAdd = canManageStaffAccounts({
    id: session.user.id,
    role: session.user.role,
    email: session.user.email,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Staff</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            {current} {current === 1 ? "person" : "people"} · {departments.length}{" "}
            {departments.length === 1 ? "department" : "departments"}
          </p>
        </div>
        {canAdd && (
          <Link
            href="/admin/workers/new"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-primary-700 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add staff
          </Link>
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <StaffList rows={rows} />
        <DepartmentList
          departments={departments.map((d) => ({
            id: d.id,
            name: d.name,
            code: d.code,
            wing: d.wing,
            iconKey: d.iconKey,
            memberCount: d._count.memberships,
          }))}
        />
      </div>
    </div>
  );
}
