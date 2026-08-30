import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { parseScheduleAnchor, parseScheduleView, resolveScheduleRange, type ScheduleView } from "@/lib/schedule/range";
import { PersonalScheduleCalendar } from "@/features/schedule/personal-schedule-calendar";

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
      startsAt: { gte: rangeStart, lt: rangeEnd },
    },
    include: { department: { select: { name: true, code: true } } },
    orderBy: { startsAt: "asc" },
  });

  return (
    <PersonalScheduleCalendar
      title="Your Schedule"
      subtitle="Review your assigned clinical rotations."
      shifts={shifts}
      anchor={anchor}
      view={view}
      hrefFor={scheduleHref}
    />
  );
}
