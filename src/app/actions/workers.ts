"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

const setTeamLeadSchema = z.object({
  userId: z.string().min(1),
  isTeamLead: z.boolean(),
});

/**
 * Set or clear a staff member's Lead RN / Team Lead tag - a designation
 * independent of `position`. `positionMatchesRole` (src/lib/shifts/role-match.ts)
 * never reads this flag, by design: the tag must never affect ordinary
 * position-based callout/bid matching.
 */
export async function setTeamLead(raw: unknown) {
  await requireAuth("ADMIN");
  const data = setTeamLeadSchema.parse(raw);

  await db.user.update({
    where: { id: data.userId },
    data: { isTeamLead: data.isTeamLead },
  });

  revalidatePath("/admin/workers");
}
