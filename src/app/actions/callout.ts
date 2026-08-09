"use server";

/**
 * Scheduler controls for the escalation cascade.
 *
 * Every action goes through the Phase 2 authorization layer (requireActor +
 * requireRole) and then through the DB-authoritative campaign service, which
 * re-reads state before writing. None of these need Inngest: they are the manual
 * steering that must keep working with no Inngest account.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
import { requireRole } from "@/lib/authz";
import {
  advanceCampaignTier,
  holdCampaign,
  resumeCampaign,
  stopCampaign,
  type CampaignControlResult,
} from "@/lib/callout/campaign";

const shiftIdSchema = z.string().min(1);

const FAILURE_MESSAGE: Record<
  Extract<CampaignControlResult, { ok: false }>["reason"],
  string
> = {
  NO_CAMPAIGN: "No callout campaign is running for this shift.",
  TERMINAL: "This callout has already ended.",
  SHIFT_CLOSED: "This shift is no longer open.",
};

async function requireScheduler() {
  const actor = await requireActor();
  requireRole(actor, "SCHEDULER");
  return actor;
}

function settle(shiftId: string, result: CampaignControlResult): void {
  if (!result.ok) throw new Error(FAILURE_MESSAGE[result.reason]);
  revalidatePath(`/admin/shifts/${shiftId}`);
  revalidatePath("/admin/shifts");
  revalidatePath("/admin");
}

/** Widen the callout to the next tier now, without waiting out the window. */
export async function advanceTier(rawShiftId: unknown): Promise<void> {
  const actor = await requireScheduler();
  const shiftId = shiftIdSchema.parse(rawShiftId);
  settle(shiftId, await advanceCampaignTier(shiftId, { actorId: actor.id }));
}

/** Freeze the callout on its current tier. */
export async function holdCallout(rawShiftId: unknown): Promise<void> {
  const actor = await requireScheduler();
  const shiftId = shiftIdSchema.parse(rawShiftId);
  settle(shiftId, await holdCampaign(shiftId, { actorId: actor.id }));
}

/** Take the callout off hold and restart the current tier's window. */
export async function resumeCallout(rawShiftId: unknown): Promise<void> {
  const actor = await requireScheduler();
  const shiftId = shiftIdSchema.parse(rawShiftId);
  settle(shiftId, await resumeCampaign(shiftId, { actorId: actor.id }));
}

/** Stop the callout for good. The shift itself stays open. */
export async function stopCallout(rawShiftId: unknown): Promise<void> {
  const actor = await requireScheduler();
  const shiftId = shiftIdSchema.parse(rawShiftId);
  settle(shiftId, await stopCampaign(shiftId, { actorId: actor.id }));
}
