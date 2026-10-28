import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarDays, CheckCircle2 } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canManageStaffAccounts } from "@/lib/authz/staff-accounts";
import { staffStatus } from "@/lib/staff/accounts";
import { isCanonicalPosition } from "@/lib/staff/positions";
import { formatDateOnly } from "@/lib/staff/validation";
import { Avatar } from "@/components/ui/avatar";
import { StaffEditor } from "@/features/staff/staff-editor";
import { AccountPanel } from "@/features/staff/account-panel";
import { StaffStatusPill, TeamLeadPill } from "@/features/staff/staff-status-pill";

export const metadata = { title: "Staff Member – Staffly" };

export default async function StaffMemberPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { added?: string };
}) {
  const session = await getSession();
  if (!session || session.user.role !== "ADMIN") redirect("/worker/shifts");

  const now = new Date();
  const [user, departments] = await Promise.all([
    db.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        password: true,
        employeeId: true,
        position: true,
        department: true,
        hireDate: true,
        seniorityRank: true,
        phone: true,
        phoneVerifiedAt: true,
        isTeamLead: true,
        deactivatedAt: true,
        deactivationReason: true,
        departmentMemberships: {
          orderBy: { department: { sortOrder: "asc" } },
          select: { departmentId: true, title: true, department: { select: { name: true } } },
        },
        assignedShifts: {
          where: { status: "ASSIGNED", endsAt: { gt: now } },
          orderBy: { startsAt: "asc" },
          select: { id: true, startsAt: true, endsAt: true, department: { select: { name: true } } },
        },
        _count: { select: { bids: true, assignedShifts: true } },
      },
    }),
    db.department.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, code: true },
    }),
  ]);
  if (!user || user.role !== "STAFF") notFound();

  const status = staffStatus({ deactivatedAt: user.deactivatedAt, hasPassword: Boolean(user.password) });
  const canManage = canManageStaffAccounts({
    id: session.user.id,
    role: session.user.role,
    email: session.user.email,
  });
  const primary =
    user.departmentMemberships.find((m) => m.department.name === user.department) ?? user.departmentMemberships[0];

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Link
          href="/admin/workers"
          className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All staff
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={user.name} size="lg" />
            <div className="min-w-0">
              <h1 className="page-title truncate">{user.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-neutral-500">
                <span className="truncate">{user.email}</span>
                <StaffStatusPill status={status} />
                {user.isTeamLead && <TeamLeadPill />}
              </div>
            </div>
          </div>
          <Link
            href={`/admin/schedule?type=staff&id=${user.id}`}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <CalendarDays className="h-4 w-4" aria-hidden />
            View schedule
          </Link>
        </div>
        {searchParams.added === "1" && (
          <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            {user.name} was added.
          </p>
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <StaffEditor
          key={user.id}
          mode="edit"
          userId={user.id}
          departments={departments}
          phoneVerified={Boolean(user.phoneVerifiedAt)}
          legacyPosition={user.position && !isCanonicalPosition(user.position) ? user.position : null}
          initial={{
            name: user.name,
            employeeId: user.employeeId ?? "",
            position: isCanonicalPosition(user.position) ? user.position : "",
            primaryDepartmentId: primary?.departmentId ?? "",
            hireDate: formatDateOnly(user.hireDate),
            seniorityRank: user.seniorityRank?.toString() ?? "",
            phone: user.phone ?? "",
            phoneConfirmed: Boolean(user.phone && user.phoneVerifiedAt),
            isTeamLead: user.isTeamLead,
            memberships: user.departmentMemberships.map((m) => ({ departmentId: m.departmentId, title: m.title })),
          }}
        />
        <AccountPanel
          userId={user.id}
          name={user.name}
          status={status}
          deactivatedAt={user.deactivatedAt}
          deactivationReason={user.deactivationReason}
          canManage={canManage}
          upcomingShifts={user.assignedShifts.map((s) => ({
            id: s.id,
            startsAt: s.startsAt,
            endsAt: s.endsAt,
            departmentName: s.department.name,
          }))}
          bidCount={user._count.bids}
          assignedCount={user._count.assignedShifts}
        />
      </div>
    </div>
  );
}
