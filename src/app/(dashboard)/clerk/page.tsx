import { redirect } from "next/navigation";
import { CalendarClock, MapPin, Users, ShieldCheck } from "lucide-react";
import { getSession, actorFromSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { shiftListWhere } from "@/lib/authz";
import { ShiftStatusBadge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { getDepartmentIcon } from "@/lib/department-icons";
import { formatCalendarDay, formatShiftRange } from "@/lib/utils";

export const metadata = { title: "Department Schedule – Staffly" };

export default async function ClerkSchedulePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.role !== "UNIT_CLERK") redirect("/");

  const actor = actorFromSession(session);

  // The department a clerk is scoped to. If unset, there is nothing to show and
  // no query should run against a real department.
  const department = actor.clerkDepartmentId
    ? await db.department.findUnique({
        where: { id: actor.clerkDepartmentId },
        select: { id: true, name: true, code: true, iconKey: true, wing: true },
      })
    : null;

  // The scope is AND-ed in unconditionally: this query can only ever return
  // shifts for the clerk's own department, regardless of any other filter.
  const shifts = await db.shift.findMany({
    where: shiftListWhere(actor),
    orderBy: { startsAt: "asc" },
    include: {
      department: { select: { name: true, code: true, iconKey: true } },
      assignedWorker: { select: { id: true, name: true, image: true } },
      _count: { select: { bids: true } },
    },
  });

  const DeptIcon = getDepartmentIcon(department?.iconKey ?? "star");
  const now = new Date();
  const upcoming = shifts.filter((s) => s.endsAt >= now);
  const past = shifts.filter((s) => s.endsAt < now);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
            <DeptIcon className="w-6 h-6 text-primary-700" aria-hidden />
          </div>
          <div>
            <h1 className="page-title text-3xl md:text-4xl">
              {department ? department.name : "Department Schedule"}
            </h1>
            <p className="text-sm text-neutral-500 mt-2 max-w-xl">
              {department
                ? `Read-only schedule for ${department.name} (${department.code}).`
                : "No department is assigned to your account. Contact an admin for access."}
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 text-neutral-600 border border-neutral-200 px-3 py-1 text-xs font-medium shrink-0">
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden />
          Read-only
        </span>
      </div>

      <section>
        <h2 className="section-title mb-4">Upcoming Shifts</h2>
        {upcoming.length === 0 ? (
          <div className="card-base p-12 text-center text-neutral-500 text-sm">
            No upcoming shifts scheduled for this department.
          </div>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((shift) => (
              <ScheduleRow key={shift.id} shift={shift} />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="section-title mb-4">Past Shifts</h2>
          <ul className="space-y-3">
            {past.map((shift) => (
              <ScheduleRow key={shift.id} shift={shift} muted />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

type ClerkShift = {
  id: string;
  roleNeeded: string;
  unit: string;
  location: string;
  startsAt: Date;
  endsAt: Date;
  status: "OPEN" | "ASSIGNED" | "CLOSED" | "CANCELLED";
  assignedWorker: { id: string; name: string; image: string | null } | null;
  _count: { bids: number };
};

function ScheduleRow({ shift, muted = false }: { shift: ClerkShift; muted?: boolean }) {
  return (
    <li
      className={`rounded-xl border border-neutral-200/80 p-4 flex flex-col sm:flex-row sm:items-center gap-4 ${
        muted ? "bg-neutral-100/40" : "bg-white"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex rounded-full bg-sky-50 text-sky-800 border border-sky-100 px-2 py-0.5 text-[11px] font-medium">
            {shift.roleNeeded}
          </span>
          <ShiftStatusBadge status={shift.status} />
          <span className="text-xs text-neutral-400">Unit {shift.unit}</span>
        </div>
        <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-5 text-sm text-neutral-600">
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5 text-neutral-400" aria-hidden />
            {formatCalendarDay(shift.startsAt)} · {formatShiftRange(shift.startsAt, shift.endsAt)}
          </span>
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0" aria-hidden />
            <span className="truncate">{shift.location}</span>
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between sm:justify-end gap-6 shrink-0">
        {shift.assignedWorker ? (
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Assigned
            </p>
            <div className="flex items-center justify-end gap-2 mt-1">
              <Avatar
                name={shift.assignedWorker.name}
                size="sm"
                src={shift.assignedWorker.image ?? undefined}
              />
              <span className="text-sm font-medium text-neutral-900">
                {shift.assignedWorker.name}
              </span>
            </div>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 text-sm text-neutral-500">
            <Users className="w-3.5 h-3.5 text-neutral-400" aria-hidden />
            {shift._count.bids === 0
              ? "Unfilled"
              : `${shift._count.bids} bid${shift._count.bids !== 1 ? "s" : ""}`}
          </div>
        )}
      </div>
    </li>
  );
}
