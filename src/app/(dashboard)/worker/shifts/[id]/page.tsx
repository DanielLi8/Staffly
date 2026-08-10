import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, CalendarClock, MapPin, Clock, User, FileText } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShiftStatusBadge, BidStatusBadge } from "@/components/ui/badge";
import { BidForm } from "@/features/shifts/bid-form";
import { db } from "@/lib/db";
import { getSession, actorFromSession } from "@/lib/auth";
import { workerAvailableShiftWhere } from "@/lib/authz";
import { formatShiftDate, formatShiftRange } from "@/lib/utils";

export async function generateMetadata({ params }: { params: { id: string } }) {
  const shift = await db.shift.findUnique({ where: { id: params.id }, select: { title: true } });
  return { title: shift ? `${shift.title} – Staffly` : "Shift – Staffly" };
}

export default async function WorkerShiftDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const [shift, existingBid] = await Promise.all([
    db.shift.findFirst({
      where: { AND: [workerAvailableShiftWhere(actorFromSession(session)), { id: params.id }] },
      include: {
        createdBy: { select: { name: true } },
        department: { select: { id: true, name: true, code: true } },
      },
    }),
    db.shiftBid.findUnique({
      where: {
        shiftId_workerId: {
          shiftId: params.id,
          workerId: session.user.id,
        },
      },
      select: {
        status: true,
        note: true,
        createdAt: true,
        durationScope: true,
        partialStartsAt: true,
        partialEndsAt: true,
      },
    }),
  ]);

  if (!shift) notFound();

  const shiftOpen = shift.status === "OPEN";
  const deadlinePassed = new Date() > shift.bidDeadlineAt;

  return (
    <div className="max-w-2xl space-y-6">
      <Link
        href="/worker/shifts"
        className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-700 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        Back to Open Shifts
      </Link>

      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="page-title">{shift.title}</h1>
          <ShiftStatusBadge status={shift.status} />
        </div>
        <p className="text-sm text-neutral-500 mt-1">
          Unit {shift.unit} · {shift.department.name} ({shift.department.code})
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Shift Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <InfoRow icon={CalendarClock} label="Date">
            {formatShiftDate(shift.startsAt)}
          </InfoRow>
          <InfoRow icon={Clock} label="Hours">
            {formatShiftRange(shift.startsAt, shift.endsAt)}
          </InfoRow>
          <InfoRow icon={MapPin} label="Location">
            {shift.location}
          </InfoRow>
          <InfoRow icon={User} label="Role needed">
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

      {existingBid && (
        <div className="flex items-center gap-3 px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg">
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium text-neutral-800">Your bid</p>
            <p className="text-xs text-neutral-600">
              {existingBid.durationScope === "PARTIAL" &&
              existingBid.partialStartsAt &&
              existingBid.partialEndsAt ? (
                <>
                  Partial: {format(existingBid.partialStartsAt, "MMM d, h:mm a")} –{" "}
                  {format(existingBid.partialEndsAt, "h:mm a")}
                </>
              ) : (
                <>Full posted shift</>
              )}
            </p>
            {existingBid.note && (
              <p className="text-xs text-neutral-500 italic">&ldquo;{existingBid.note}&rdquo;</p>
            )}
          </div>
          <BidStatusBadge status={existingBid.status} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{existingBid ? "Update your bid" : "Bid on this shift"}</CardTitle>
        </CardHeader>
        <CardContent>
          <BidForm
            shiftId={shift.id}
            shiftStartsAtIso={shift.startsAt.toISOString()}
            shiftEndsAtIso={shift.endsAt.toISOString()}
            existingBid={existingBid}
            shiftOpen={shiftOpen}
            deadlinePassed={deadlinePassed}
          />
        </CardContent>
      </Card>
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
