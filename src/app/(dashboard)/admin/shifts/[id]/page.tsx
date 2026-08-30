import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, CalendarClock, MapPin, Clock, User, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShiftStatusBadge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { BidderList } from "@/features/shifts/bidder-list";
import { FillDashboardPanel } from "@/features/callout/fill-dashboard";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { loadFillDashboard } from "@/lib/callout/dashboard";
import { formatShiftDate, formatDate } from "@/lib/utils";
import { CancelShiftButton } from "./cancel-shift-button";
import { EditShiftTimeForm } from "./edit-shift-time-form";
import { canCancelShift } from "@/lib/shift-status";

export async function generateMetadata({ params }: { params: { id: string } }) {
  const shift = await db.shift.findUnique({ where: { id: params.id }, select: { title: true } });
  return { title: shift ? `${shift.title} – Staffly` : "Shift – Staffly" };
}

export default async function AdminShiftDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.user.role !== "SCHEDULER") redirect("/worker/shifts");

  const shift = await db.shift.findUnique({
    where: { id: params.id },
    include: {
      department: { select: { id: true, name: true, code: true, iconKey: true, wing: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      assignedWorker: {
        select: { id: true, name: true, email: true, image: true, department: true, position: true },
      },
      activities: {
        orderBy: { createdAt: "asc" },
        include: { actor: { select: { id: true, name: true } } },
      },
    },
  });

  if (!shift) notFound();

  // The live fill dashboard: cascade state, delivery tracking, and the
  // seniority-ranked bidder list with overtime projections.
  const dashboard = await loadFillDashboard(shift.id);
  if (!dashboard) notFound();

  const shiftOpen = shift.status === "OPEN";
  const deadlinePassed = new Date() > shift.bidDeadlineAt;

  return (
    <div className="max-w-4xl space-y-6">
      <Link
        href="/admin/shifts"
        className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-700 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        Back to Shifts
      </Link>

      {/* Shift header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="page-title">{shift.title}</h1>
            <ShiftStatusBadge status={shift.status} />
          </div>
          <p className="text-sm text-neutral-500 mt-1">
            Unit {shift.unit} · {shift.department.name} · Posted by {shift.createdBy.name}
          </p>
        </div>
        {canCancelShift(shift.status) && <CancelShiftButton shiftId={shift.id} />}
      </div>

      {/* Live fill dashboard - full width: it is the scheduler's primary surface
          while a callout is running, and its outreach table needs the room. */}
      <FillDashboardPanel data={dashboard} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Shift details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Assigned worker (if any) */}
          {shift.assignedWorker && (
            <Card className="border-green-200 bg-green-50">
              <CardContent className="pt-4 flex items-center gap-3">
                <Avatar name={shift.assignedWorker.name} src={shift.assignedWorker.image} />
                <div>
                  <p className="text-sm font-semibold text-green-800">Assigned to</p>
                  <p className="text-base font-bold text-green-900">{shift.assignedWorker.name}</p>
                  <p className="text-xs text-green-700">
                    {shift.assignedWorker.position} · {shift.assignedWorker.department}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Bidder list */}
          <Card>
            <CardHeader>
              <CardTitle>
                Bidders ({dashboard.bidders.length})
                {shiftOpen && deadlinePassed && (
                  <span className="ml-2 text-xs font-normal text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                    Deadline passed
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BidderList
                shiftId={shift.id}
                bidders={dashboard.bidders}
                shiftOpen={shiftOpen}
              />
            </CardContent>
          </Card>

          {/* Activity log */}
          <Card>
            <CardHeader>
              <CardTitle>Activity Log</CardTitle>
            </CardHeader>
            <CardContent>
              {shift.activities.length === 0 ? (
                <p className="text-sm text-neutral-500">No activity recorded.</p>
              ) : (
                <ol className="relative border-l border-neutral-200 space-y-4 pl-5">
                  {shift.activities.map((activity) => (
                    <li key={activity.id} className="relative">
                      <span className="absolute -left-[21px] w-3 h-3 rounded-full bg-primary-200 border-2 border-white" aria-hidden="true" />
                      <p className="text-sm font-medium text-neutral-800">
                        {formatActivityAction(activity.action)}
                      </p>
                      {activity.details && (
                        <p className="text-xs text-neutral-500">{activity.details}</p>
                      )}
                      <p className="text-xs text-neutral-400 mt-0.5">
                        {activity.actor.name} · {formatDate(activity.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Shift info sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Shift Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <InfoRow icon={CalendarClock} label="Date">
                {formatShiftDate(shift.startsAt)}
              </InfoRow>
              <InfoRow icon={Clock} label="Hours">
                <EditShiftTimeForm
                  shiftId={shift.id}
                  startsAt={shift.startsAt}
                  endsAt={shift.endsAt}
                />
              </InfoRow>
              <InfoRow icon={MapPin} label="Location">
                {shift.location}
              </InfoRow>
              <InfoRow icon={User} label="Role">
                {shift.roleNeeded}
              </InfoRow>
              {shift.notes && (
                <InfoRow icon={FileText} label="Notes">
                  {shift.notes}
                </InfoRow>
              )}
              <div className="pt-2 border-t border-neutral-100 text-xs text-neutral-400">
                Bid deadline: {formatShiftDate(shift.bidDeadlineAt)}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="w-4 h-4 text-neutral-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
      <div>
        <p className="text-xs text-neutral-400 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-neutral-800">{children}</p>
      </div>
    </div>
  );
}

function formatActivityAction(action: string): string {
  const map: Record<string, string> = {
    SHIFT_CREATED: "Shift created",
    WORKER_ASSIGNED: "Worker assigned",
    SHIFT_CANCELLED: "Shift cancelled",
    SHIFT_CLOSED: "Shift closed",
    SHIFT_TIME_EDITED: "Shift time edited",
  };
  return map[action] ?? action;
}
