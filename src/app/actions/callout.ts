"use server";

/**
 * Scheduler controls for the escalation cascade.
 *
 * Every action goes through the authorization layer (requireActor with the
 * `callout.control` capability) and then through the DB-authoritative campaign service, which
 * re-reads state before writing. None of these need Inngest: they are the manual
 * steering that must keep working with no Inngest account.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth";
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

function requireScheduler() {
  return requireActor("callout.control");
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

/** Stop outreach for good. The shift stays open and keeps taking bids. */
export async function stopCallout(rawShiftId: unknown): Promise<void> {
  const actor = await requireScheduler();
  const shiftId = shiftIdSchema.parse(rawShiftId);
  settle(shiftId, await stopCampaign(shiftId, { actorId: actor.id }));
}
