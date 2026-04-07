import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { format } from "date-fns";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getBidUiStatus } from "@/lib/bid-display";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "WORKER") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bids = await db.shiftBid.findMany({
    where: { workerId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      shift: { include: { department: { select: { name: true, code: true } } } },
    },
  });

  const header = ["Unit", "Role", "ShiftDate", "Start", "End", "Status"];
  const lines = bids.map((b) => {
    const ui = getBidUiStatus(b.status, b.shift);
    const status =
      ui === "completed"
        ? "Completed"
        : ui === "assigned"
          ? "Assigned"
          : ui === "not_selected"
            ? "Not Selected"
            : "Pending";
    return [
      `"${b.shift.department.name.replace(/"/g, '""')}"`,
      `"${b.shift.roleNeeded.replace(/"/g, '""')}"`,
      format(b.shift.startsAt, "yyyy-MM-dd"),
      format(b.shift.startsAt, "HH:mm"),
      format(b.shift.endsAt, "HH:mm"),
      status,
    ].join(",");
  });

  const csv = [header.join(","), ...lines].join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="staffly-bid-history.csv"`,
    },
  });
}
