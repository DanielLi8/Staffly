import Link from "next/link";
import { Download, Filter, Search } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { getBidUiStatus } from "@/lib/bid-display";
import { getDepartmentIcon } from "@/lib/department-icons";
import { cn } from "@/lib/utils";

export const metadata = { title: "Request History – Staffly" };

const PAGE_SIZE = 10;

export default async function WorkerBidsPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const q = (searchParams.q ?? "").trim();
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const where = {
    workerId: session.user.id,
    ...(q
      ? {
          shift: {
            OR: [
              { department: { name: { contains: q, mode: "insensitive" as const } } },
              { roleNeeded: { contains: q, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };

  const [total, bids] = await Promise.all([
    db.shiftBid.count({ where }),
    db.shiftBid.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: PAGE_SIZE,
      include: {
        shift: { include: { department: { select: { name: true, code: true, iconKey: true } } } },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title text-3xl">Request history</h1>
        <p className="text-sm text-neutral-500 mt-2 max-w-2xl">
          Review and track your clinical placement requests across the network.
        </p>
      </div>

      <form className="flex flex-col sm:flex-row gap-3 sm:items-center" action="/worker/bids" method="get">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" aria-hidden />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search by Unit or Role..."
            className="w-full h-11 pl-10 pr-4 rounded-xl border border-neutral-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/25"
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="submit"
            className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-neutral-200 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <Filter className="w-4 h-4" />
            Search
          </button>
          <a
            href="/api/worker/bids/export"
            className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-neutral-200 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </a>
        </div>
      </form>

      <div className="card-base overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50/80 text-left text-[10px] font-bold uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3">Unit &amp; Role</th>
              <th className="px-4 py-3 hidden sm:table-cell">Shift date</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {bids.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-neutral-500">
                  No requests found.
                </td>
              </tr>
            ) : (
              bids.map((bid) => {
                const ui = getBidUiStatus(bid.status, bid.shift);
                const Icon = getDepartmentIcon(bid.shift.department.iconKey);
                const label =
                  ui === "completed"
                    ? "Completed"
                    : ui === "assigned"
                      ? "Assigned"
                      : ui === "not_selected"
                        ? "Not Selected"
                        : "Pending";
                return (
                  <tr key={bid.id} className="hover:bg-neutral-50/50">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-sky-50 border border-sky-100 flex items-center justify-center text-sky-800">
                          <Icon className="w-5 h-5" aria-hidden />
                        </div>
                        <div>
                          <p className="font-semibold text-neutral-900">{bid.shift.department.name}</p>
                          <p className="text-xs text-neutral-500">{bid.shift.roleNeeded}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 hidden sm:table-cell">
                      <p className="font-semibold text-neutral-900">{format(bid.shift.startsAt, "MMM d, yyyy")}</p>
                      <p className="text-xs text-neutral-500">
                        {format(bid.shift.startsAt, "hh:mm a")} – {format(bid.shift.endsAt, "hh:mm a")}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border",
                          ui === "assigned" && "bg-blue-50 text-blue-900 border-blue-200",
                          ui === "completed" && "bg-neutral-100 text-neutral-700 border-neutral-200",
                          ui === "not_selected" && "bg-rose-50 text-rose-900 border-rose-200",
                          ui === "pending" && "bg-slate-100 text-slate-800 border-slate-200"
                        )}
                      >
                        <span
                          className={cn(
                            "w-1.5 h-1.5 rounded-full",
                            ui === "assigned" && "bg-blue-600",
                            ui === "completed" && "bg-neutral-500",
                            ui === "not_selected" && "bg-rose-600",
                            ui === "pending" && "bg-slate-500"
                          )}
                        />
                        {label}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <Link
                        href={`/worker/shifts/${bid.shift.id}`}
                        className="text-sm font-medium text-primary-700 hover:underline"
                      >
                        {ui === "completed" ? "Review" : "Details"}
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-neutral-100 bg-neutral-50/50 text-xs text-neutral-500">
          <p>
            Showing {total === 0 ? 0 : skip + 1}–{Math.min(skip + PAGE_SIZE, total)} of {total} entries
          </p>
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Link
                href={`/worker/bids?page=${page - 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100"
              >
                ←
              </Link>
            ) : (
              <span className="px-3 py-1.5 rounded-lg border border-neutral-100 text-neutral-300">←</span>
            )}
            {page < totalPages ? (
              <Link
                href={`/worker/bids?page=${page + 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100"
              >
                →
              </Link>
            ) : (
              <span className="px-3 py-1.5 rounded-lg border border-neutral-100 text-neutral-300">→</span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-primary-700 text-white px-6 py-5 flex flex-col md:flex-row md:items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center text-lg font-bold shrink-0">
          ?
        </div>
        <p className="flex-1 text-sm leading-relaxed">
          Questions about your history? Our staffing coordinators are available 24/7 for support.
        </p>
        <button
          type="button"
          className="shrink-0 h-11 px-6 rounded-xl bg-white text-primary-800 text-sm font-semibold hover:bg-neutral-100"
        >
          Contact Support
        </button>
      </div>
    </div>
  );
}
