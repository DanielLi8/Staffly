/**
 * Generates a month of realistic demo data on top of the base seed:
 *
 *   pnpm seed:month              # November 2026
 *   pnpm seed:month 2026-12      # any yyyy-MM
 *   pnpm seed:month 2026-11 --now=2026-11-04T14:00:00Z   # pin "today"
 *
 * Safe to re-run: it replaces only the rows it generated for that month (see
 * prisma/seed-month/write.ts). Local databases only - it refuses any
 * DATABASE_URL whose host isn't localhost.
 */
import { PrismaClient } from "@prisma/client";
import { payPeriodFor, payPeriodLabel } from "@/lib/schedule-rules/pay-period";
import { staffingRoleOf } from "@/lib/roles/staffing-role";
import { hospitalDate, hospitalDateTime } from "@/lib/timezone";
import { monthPrefix } from "./seed-month/plan";
import { seedMonth } from "./seed-month/write";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function parseArgs(argv: string[]): { month: string; now: Date } {
  let month = "2026-11";
  let now = new Date();
  for (const arg of argv) {
    if (/^\d{4}-\d{2}$/.test(arg)) month = arg;
    else if (arg.startsWith("--now=")) now = new Date(arg.slice("--now=".length));
    else throw new Error(`Unknown argument "${arg}". Usage: pnpm seed:month [yyyy-MM] [--now=ISO]`);
  }
  if (Number.isNaN(now.getTime())) throw new Error("--now is not a valid date");
  return { month, now };
}

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to write demo data to non-local database host "${host}".`);
  }
}

async function main() {
  const { month, now } = parseArgs(process.argv.slice(2));
  assertLocalDatabase();
  const db = new PrismaClient();
  try {
    const started = Date.now();
    const { plan, demoStaffCreated, deleted } = await seedMonth(db, { month, now });
    console.log(`✓ ${month} demo data written in ${((Date.now() - started) / 1000).toFixed(1)}s (now = ${now.toISOString()})`);
    console.log(`  demo staff created: ${demoStaffCreated}, previous generated rows replaced: ${deleted}`);
    console.log(
      `  rows: ${plan.shifts.length} shifts, ${plan.bids.length} bids, ${plan.campaigns.length} callouts, ` +
        `${plan.outreach.length} outreach attempts, ${plan.declines.length} declines, ${plan.swaps.length} swap requests, ` +
        `${plan.availability.length} availability, ${plan.activities.length} activity, ${plan.notifications.length} notifications`
    );
    await report(db, month);
  } finally {
    await db.$disconnect();
  }
}

/** What landed, read back from the database. */
async function report(db: PrismaClient, month: string) {
  const prefix = monthPrefix(month);
  const shifts = await db.shift.findMany({
    where: { id: { startsWith: prefix } },
    include: { department: true, assignedWorker: { select: { name: true } } },
    orderBy: { startsAt: "asc" },
  });

  const count = (key: (s: (typeof shifts)[number]) => string) => {
    const table: Record<string, Record<string, number>> = {};
    for (const s of shifts) {
      const row = (table[key(s)] ??= { total: 0, ASSIGNED: 0, OPEN: 0, CANCELLED: 0 });
      row.total++;
      row[s.status] = (row[s.status] ?? 0) + 1;
    }
    return table;
  };
  console.log("\nShifts by department:");
  console.table(count((s) => s.department.code));
  console.log("Shifts by role:");
  console.table(count((s) => staffingRoleOf(s.roleNeeded) ?? s.roleNeeded));

  const open = shifts.filter((s) => s.status === "OPEN");
  console.log(`\nOpen shifts (${open.length}), first few:`);
  for (const s of open.slice(0, 6)) console.log(`  ${hospitalDateTime(s.startsAt)}  ${s.title}  [${s.smsCode}]`);

  // Pay-period hours for everyone holding a shift this month (all their shifts, not just generated ones).
  const people = Array.from(new Set(shifts.map((s) => s.assignedWorkerId).filter(Boolean))) as string[];
  const held = await db.shift.findMany({
    where: { assignedWorkerId: { in: people }, status: { not: "CANCELLED" } },
    select: { startsAt: true, endsAt: true, assignedWorker: { select: { name: true } } },
  });
  const hours = new Map<string, number>();
  for (const s of held) {
    const period = payPeriodFor(s.startsAt);
    if (!hospitalDate(s.startsAt).startsWith(month) && !hospitalDate(period.end).startsWith(month)) continue;
    const key = `${s.assignedWorker!.name}|${payPeriodLabel(period)}`;
    hours.set(key, (hours.get(key) ?? 0) + (s.endsAt.getTime() - s.startsAt.getTime()) / 3_600_000);
  }
  const ranked = Array.from(hours.entries()).sort((a, b) => b[1] - a[1]);
  console.log(`\nAt/over the 75 h pay-period line: ${ranked.filter(([, h]) => h >= 75).length}; 70-74.9 h: ${ranked.filter(([, h]) => h >= 70 && h < 75).length}`);
  for (const [key, h] of ranked.slice(0, 8)) {
    const [name, period] = key.split("|");
    console.log(`  ${name.padEnd(22)} ${period.padEnd(16)} ${h.toFixed(1)} h`);
  }

  const doubles = await db.shiftActivity.findMany({
    where: { shiftId: { startsWith: prefix }, action: "WORKER_ASSIGNED", details: { contains: "double" } },
    include: { shift: true },
  });
  console.log(`\nBack-to-back doubles: ${doubles.length}`);
  for (const d of doubles) console.log(`  ${hospitalDateTime(d.shift.startsAt)}  ${d.details}`);

  const swaps = await db.shiftSwapRequest.groupBy({ by: ["kind", "status"], where: { id: { startsWith: prefix } }, _count: true });
  console.log("\nSwap requests:", swaps.map((s) => `${s.kind}/${s.status}: ${s._count}`).join(", "));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
