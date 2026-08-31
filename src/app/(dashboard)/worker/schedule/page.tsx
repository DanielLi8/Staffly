import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { format, addDays, subDays } from "date-fns";
import { parseScheduleAnchor, parseScheduleView, resolveScheduleRange, type ScheduleView } from "@/lib/schedule/range";
import { PersonalScheduleCalendar } from "@/features/schedule/personal-schedule-calendar";
import { NewRequestMenu } from "@/features/shift-swap/new-request-menu";

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

  const anchor = parseScheduleAnchor(searchParams.date ?? searchParams.week);
  const view = parseScheduleView(searchParams.view);
  const { rangeStart, rangeEnd } = resolveScheduleRange(view, anchor);

  const shifts = await db.shift.findMany({
    where: {
      assignedWorkerId: session.user.id,
      status: { not: "CANCELLED" },
      startsAt: { gte: rangeStart, lt: rangeEnd },
    },
    include: { department: { select: { name: true, code: true } } },
    orderBy: { startsAt: "asc" },
  });

  // Availability editing happens on all three views. Only the month grid
  // spans outside `rangeStart`/`rangeEnd` (it shows whole weeks around the
  // month, per `resolveScheduleRange`) - pad generously there rather than
  // duplicating that week-padding math; day/week already query exactly the
  // visible range.
  const availability = await db.availability.findMany({
    where: {
      userId: session.user.id,
      startsAt: {
        gte: view === "month" ? subDays(rangeStart, 7) : rangeStart,
        lt: view === "month" ? addDays(rangeEnd, 7) : rangeEnd,
      },
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <NewRequestMenu />
      </div>
      <PersonalScheduleCalendar
        title="Your Schedule"
        subtitle="Review your assigned clinical rotations."
        shifts={shifts}
        anchor={anchor}
        view={view}
        hrefFor={scheduleHref}
        editableAvailability={view === "month" ? { availability } : undefined}
      />
    </div>
  );
}
