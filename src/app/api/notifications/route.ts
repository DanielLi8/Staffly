import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const notifications = await db.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { shift: { select: { id: true, title: true } } },
  });

  return NextResponse.json(notifications);
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ids } = await req.json();
  if (!Array.isArray(ids)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  await db.notification.updateMany({
    where: { id: { in: ids }, userId: session.user.id },
    data: { read: true },
  });

  return NextResponse.json({ ok: true });
}
