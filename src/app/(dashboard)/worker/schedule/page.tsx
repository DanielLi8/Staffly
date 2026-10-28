import { db } from "@/lib/db";
import { actorFromSession, getSession } from "@/lib/auth";
import { can, shiftListWhere } from "@/lib/authz";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { parseScheduleAnchor, parseScheduleView, resolveScheduleDays, type ScheduleView } from "@/lib/schedule/range";
import { PersonalScheduleCalendar } from "@/features/schedule/personal-schedule-calendar";
import { IncomingRequestsPanel } from "@/features/shift-swap/incoming-requests-panel";
import { listIncomingShiftSwapRequests } from "@/app/actions/shift-swap";

export const metadata = { title: "Your Schedule – Staffly" };

function scheduleHref(date: Date, view: ScheduleView) {
  return `/worker/schedule?date=${format(date, "yyyy-MM-dd")}&view=${view}`;
}

export default async function WorkerSchedulePage({
  searchParams,
}: {
  searchParams: { week?: string; date?: string; view?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const actor = actorFromSession(session);

  const anchor = parseScheduleAnchor(searchParams.date ?? searchParams.week);
  const view = parseScheduleView(searchParams.view);
  // Overlap, not `startsAt` in range: a night shift that began the evening
  // before the first visible day still draws its morning half, and a night
  // availability block spilling in from that evening still tints it.
  const { rangeStart, rangeEnd } = resolveScheduleDays(view, anchor);
  const overlapping = { startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } };

  const [shifts, availability] = await Promise.all([
    db.shift.findMany({
      where: shiftListWhere(actor, { assignedWorkerId: actor.id, status: { not: "CANCELLED" }, ...overlapping }),
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        roleNeeded: true,
        unit: true,
        department: { select: { name: true, code: true } },
      },
      orderBy: { startsAt: "asc" },
    }),
    db.availability.findMany({
      where: { userId: actor.id, ...overlapping },
      select: { id: true, startsAt: true, endsAt: true, status: true },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  // `listIncomingShiftSwapRequests` requires `swap.request` (STAFF today); an
  // ADMIN can also land on this page (middleware doesn't fence /worker off
  // from ADMIN), so skip the call entirely rather than let it throw FORBIDDEN.
  const incomingRequests = can(actor, "swap.request") ? await listIncomingShiftSwapRequests() : [];

  return (
    <div className="space-y-4">
      <IncomingRequestsPanel requests={incomingRequests} />
      <PersonalScheduleCalendar
        shifts={shifts}
        availability={availability}
        anchor={anchor}
        view={view}
        hrefFor={scheduleHref}
        editable
      />
    </div>
  );
}
