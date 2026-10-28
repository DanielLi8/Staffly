import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDepartmentIcon } from "@/lib/department-icons";
import { STAFFING_ROLES } from "@/lib/staffing/roles";
import { activeTemplates } from "@/lib/staffing/templates";
import { buildTargetBook, groupTarget, WEEKDAYS } from "@/lib/staffing/targets";

export const metadata = { title: "Staffing Targets – Staffly" };

/** `/admin/staffing-targets` - pick a department to edit its projected staffing. */
export default async function StaffingTargetsIndexPage() {
  const session = await getSession();
  if (!session || session.user.role !== "ADMIN") redirect("/worker");

  const departments = await db.department.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      iconKey: true,
      shiftPattern: true,
      shiftTemplates: {
        select: {
          id: true,
          pattern: true,
          code: true,
          label: true,
          startMinute: true,
          endMinute: true,
          sortOrder: true,
          targets: { select: { templateId: true, dayOfWeek: true, role: true, count: true } },
        },
      },
    },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="page-title">Staffing Targets</h1>
        <p className="mt-1 max-w-xl text-sm text-neutral-500">
          How many RNs, RPNs and PSWs each department needs on every shift. Pick a department to change its numbers.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {departments.map((d) => {
          const Icon = getDepartmentIcon(d.iconKey);
          const templates = activeTemplates(d.shiftTemplates, d.shiftPattern);
          const book = buildTargetBook(templates.flatMap((t) => t.targets), []);
          const perShift = templates.map((t) => {
            const counts = STAFFING_ROLES.map((r) => groupTarget(book, t.id, r, WEEKDAYS));
            const total = counts.every((c) => c !== null) ? counts.reduce<number>((s, c) => s + c!, 0) : null;
            return { label: t.label, total };
          });
          const hasTargets = templates.some((t) => t.targets.some((x) => x.count > 0));
          return (
            <li key={d.id}>
              <Link
                href={`/admin/departments/${d.id}/targets`}
                className="card-base group flex items-start gap-3 p-4 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary-100 bg-primary-50">
                  <Icon className="h-5 w-5 text-primary-700" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-neutral-900">{d.name}</p>
                  <p className="text-xs text-neutral-500">
                    {d.code} · {d.shiftPattern === "TWELVE_HOUR" ? "12-hour shifts" : "8-hour shifts"}
                  </p>
                  <p className="mt-2 text-sm text-neutral-700">
                    {hasTargets
                      ? `Weekday staff: ${perShift.map((s) => `${s.label} ${s.total ?? "varies"}`).join(" · ")}`
                      : "No targets set yet"}
                  </p>
                </div>
                <ArrowUpRight
                  className="h-4 w-4 shrink-0 text-neutral-400 transition-colors group-hover:text-primary-700"
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
