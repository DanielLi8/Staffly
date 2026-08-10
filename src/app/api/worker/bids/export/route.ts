import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { hospitalDate, hospitalTime } from "@/lib/timezone";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getBidUiStatus } from "@/lib/bid-display";
import { csvCell } from "@/lib/csv";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "STAFF") {
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
      csvCell(b.shift.department.name),
      csvCell(b.shift.roleNeeded),
      csvCell(hospitalDate(b.shift.startsAt)),
      csvCell(hospitalTime(b.shift.startsAt, false)),
      csvCell(hospitalTime(b.shift.endsAt, false)),
      csvCell(status),
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
