"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { findPosition } from "@/lib/staff/positions";
import { StaffStatusPill, TeamLeadPill } from "./staff-status-pill";
import type { StaffRow } from "./types";

type Filter = "CURRENT" | "PENDING" | "DEACTIVATED";

const FILTER_LABEL: Record<Filter, string> = {
  CURRENT: "Current",
  PENDING: "Pending",
  DEACTIVATED: "Deactivated",
};

function matchesFilter(row: StaffRow, filter: Filter): boolean {
  if (filter === "CURRENT") return row.status !== "DEACTIVATED";
  return row.status === filter;
}

function matchesQuery(row: StaffRow, q: string): boolean {
  if (!q) return true;
  const haystack = [
    row.name,
    row.email,
    row.employeeId ?? "",
    row.position ?? "",
    ...row.memberships.flatMap((m) => [m.name, m.code, m.title]),
  ]
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

/** The canonical code in the wide table (full name on hover), the full name when stacked. */
function PositionText({ position, full = false }: { position: string | null; full?: boolean }) {
  if (!position) return <span className="text-neutral-500">No position</span>;
  const canonical = findPosition(position);
  return (
    <span className="text-neutral-800">
      {canonical && full ? (
        canonical.label
      ) : canonical ? (
        <abbr title={canonical.label} className="font-semibold no-underline">
          {canonical.code}
        </abbr>
      ) : (
        position
      )}
    </span>
  );
}

function Departments({ row }: { row: StaffRow }) {
  if (row.memberships.length === 0) return <span className="text-neutral-500">No department</span>;
  return (
    <ul className="space-y-1">
      {row.memberships.map((m) => (
        <li key={m.departmentId}>
          <span className="block text-neutral-800">{m.name}</span>
          <span className="block text-xs text-neutral-500">{m.title}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The Staff page list: search plus a status filter over every STAFF account,
 * each row linking to that person's record. Below `md` the position,
 * departments and status fold under the name so nothing scrolls sideways.
 */
export function StaffList({ rows }: { rows: StaffRow[] }) {
  const [filter, setFilter] = useState<Filter>("CURRENT");
  const [query, setQuery] = useState("");

  const counts = useMemo(
    () => ({
      CURRENT: rows.filter((r) => matchesFilter(r, "CURRENT")).length,
      PENDING: rows.filter((r) => matchesFilter(r, "PENDING")).length,
      DEACTIVATED: rows.filter((r) => matchesFilter(r, "DEACTIVATED")).length,
    }),
    [rows]
  );
  const filters = (Object.keys(FILTER_LABEL) as Filter[]).filter((f) => f !== "PENDING" || counts[f] > 0);
  const visible = rows.filter((r) => matchesFilter(r, filter) && matchesQuery(r, query.trim()));

  return (
    <div className="card-base overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-neutral-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                filter === f
                  ? "border-primary-700 bg-primary-700 text-white"
                  : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
              )}
            >
              {FILTER_LABEL[f]}
              <span className={cn("tabular-nums", filter === f ? "text-white/80" : "text-neutral-500")}>
                {counts[f]}
              </span>
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
          <label htmlFor="staff-search" className="sr-only">
            Search staff
          </label>
          <input
            id="staff-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, unit"
            className="h-10 w-full rounded-md border border-neutral-300 bg-white pl-9 pr-3 text-base placeholder:text-neutral-400 focus-visible:border-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:text-sm"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={Users}
          title={rows.length === 0 ? "No staff yet" : "No one matches"}
          description={
            rows.length === 0
              ? "Staff appear here once a system administrator adds them."
              : "Try another name, or a different status filter."
          }
        />
      ) : (
        <table className="w-full table-fixed text-left text-sm">
          <caption className="sr-only">Staff, {FILTER_LABEL[filter].toLowerCase()}</caption>
          <thead className="hidden border-b border-neutral-100 bg-neutral-50 md:table-header-group">
            <tr className="text-2xs font-bold uppercase tracking-wide text-neutral-600">
              <th scope="col" className="w-[38%] px-4 py-2.5">Name</th>
              <th scope="col" className="w-[13%] px-4 py-2.5">Position</th>
              <th scope="col" className="w-[31%] px-4 py-2.5">Departments</th>
              <th scope="col" className="w-[18%] px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {visible.map((row) => (
              <tr key={row.id} className="align-top transition-colors hover:bg-neutral-50">
                <td className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <Avatar name={row.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link
                          href={`/admin/workers/${row.id}`}
                          className="font-semibold text-neutral-900 hover:text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-sm"
                        >
                          {row.name}
                        </Link>
                        {row.isTeamLead && <TeamLeadPill />}
                      </div>
                      <p className="truncate text-xs text-neutral-500" title={row.email}>
                        {row.email}
                      </p>
                      <div className="mt-1.5 space-y-1 text-xs md:hidden">
                        <PositionText position={row.position} full />
                        <Departments row={row} />
                        <StaffStatusPill status={row.status} />
                      </div>
                    </div>
                  </div>
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  <PositionText position={row.position} />
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  <Departments row={row} />
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  <StaffStatusPill status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
