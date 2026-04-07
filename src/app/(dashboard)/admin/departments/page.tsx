import Link from "next/link";
import { redirect } from "next/navigation";
import { Search } from "lucide-react";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDepartmentIcon } from "@/lib/department-icons";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { assignStaffFormAction } from "./assign-action";
import { createDepartmentFormAction } from "./create-action";

export const metadata = { title: "Departments – Staffly" };

export default async function AdminDepartmentsPage({
  searchParams,
}: {
  searchParams: { dept?: string; q?: string; role?: string };
}) {
  const session = await getSession();
  if (!session || session.user.role !== "ADMIN") redirect("/worker/shifts");

  const departments = await db.department.findMany({
    orderBy: { sortOrder: "asc" },
  });

  const selectedId = searchParams.dept ?? departments[0]?.id;
  const selected = departments.find((d) => d.id === selectedId) ?? departments[0];

  const q = (searchParams.q ?? "").trim().toLowerCase();
  const roleFilter = searchParams.role ?? "all";

  const roster =
    selected &&
    (await db.departmentMembership.findMany({
      where: { departmentId: selected.id },
      include: {
        user: { select: { id: true, name: true, image: true, position: true } },
      },
    }));

  const workers = await db.user.findMany({
    where: { role: "WORKER" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, position: true },
  });

  const filtered =
    roster?.filter((m) => {
      const matchQ =
        !q ||
        m.user.name.toLowerCase().includes(q) ||
        (m.user.position ?? "").toLowerCase().includes(q);
      const matchRole =
        roleFilter === "all" || (m.user.position ?? "").toLowerCase().includes(roleFilter.toLowerCase());
      return matchQ && matchRole;
    }) ?? [];

  const assignedIds = new Set(roster?.map((m) => m.userId) ?? []);

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      <aside className="w-full lg:w-64 shrink-0 space-y-4">
        <div>
          <h2 className="font-display text-lg font-bold text-primary-900">Departments</h2>
          <p className="text-xs text-neutral-500 mt-1 uppercase tracking-wider">
            {departments[0]?.wing ?? "Hospital"}
          </p>
        </div>
        <nav className="space-y-1.5" aria-label="Departments">
          {departments.map((d) => {
            const Icon = getDepartmentIcon(d.iconKey);
            const active = selected?.id === d.id;
            return (
              <Link
                key={d.id}
                href={`/admin/departments?dept=${d.id}`}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
                  active ? "bg-white text-primary-800 shadow-sm border border-neutral-200" : "text-neutral-600 hover:bg-white/60"
                )}
              >
                <Icon className="w-4 h-4 text-primary-700" aria-hidden />
                <span className="uppercase text-xs tracking-wide">{d.code}</span>
              </Link>
            );
          })}
        </nav>
        <form action={createDepartmentFormAction} className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
          <p className="text-xs font-semibold text-neutral-700">New department</p>
          <input
            name="name"
            required
            placeholder="Name"
            className="w-full h-9 px-2 rounded-lg border border-neutral-200 text-sm"
          />
          <input
            name="code"
            required
            placeholder="Code (e.g. NICU)"
            className="w-full h-9 px-2 rounded-lg border border-neutral-200 text-sm"
          />
          <button
            type="submit"
            className="w-full h-9 rounded-lg bg-primary-700 text-white text-xs font-semibold hover:bg-primary-800"
          >
            Add department
          </button>
        </form>
      </aside>

      <div className="flex-1 min-w-0 space-y-6">
        {selected && (
          <>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div>
                <h1 className="page-title text-3xl">Department Roster</h1>
                <p className="text-primary-700 font-medium mt-1">* {selected.name}</p>
              </div>
              <form className="flex flex-col sm:flex-row gap-2" method="get">
                <input type="hidden" name="dept" value={selected.id} />
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                  <input
                    name="q"
                    defaultValue={searchParams.q}
                    placeholder="Search staff..."
                    className="h-10 pl-9 pr-3 rounded-lg border border-neutral-200 bg-white text-sm w-full sm:w-56"
                  />
                </div>
                <select
                  name="role"
                  defaultValue={roleFilter}
                  className="h-10 px-3 rounded-lg border border-neutral-200 bg-white text-sm"
                >
                  <option value="all">All Roles</option>
                  <option value="nurse">Nurse</option>
                  <option value="rn">RN</option>
                </select>
                <button type="submit" className="h-10 px-4 rounded-lg border border-neutral-200 bg-white text-sm font-medium">
                  Apply
                </button>
              </form>
            </div>

            <div className="card-base divide-y divide-neutral-100">
              {filtered.map((m) => (
                <div key={m.id} className="flex items-center gap-4 p-4">
                  <Avatar name={m.user.name} src={m.user.image} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-neutral-900">{m.user.name}</p>
                    <p className="text-sm text-neutral-500">{m.title}</p>
                  </div>
                </div>
              ))}

              <div className="p-4 border-t border-dashed border-neutral-200">
                <p className="text-sm font-semibold text-neutral-800 mb-3">Assign staff member</p>
                <form action={assignStaffFormAction} className="flex flex-col sm:flex-row gap-3 sm:items-end">
                  <input type="hidden" name="departmentId" value={selected.id} />
                  <div className="flex-1">
                    <label className="text-xs font-medium text-neutral-500">Staff</label>
                    <select
                      name="userId"
                      required
                      className="mt-1 w-full h-10 px-3 rounded-lg border border-neutral-200 bg-white text-sm"
                    >
                      <option value="">Select…</option>
                      {workers
                        .filter((w) => !assignedIds.has(w.id))
                        .map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name} — {w.position}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="sm:w-48">
                    <label className="text-xs font-medium text-neutral-500">Title on roster</label>
                    <input
                      name="title"
                      required
                      placeholder="e.g. Lead RN"
                      className="mt-1 w-full h-10 px-3 rounded-lg border border-neutral-200 bg-white text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    className="h-10 px-5 rounded-lg bg-primary-700 text-white text-sm font-semibold hover:bg-primary-800"
                  >
                    Add to roster
                  </button>
                </form>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
