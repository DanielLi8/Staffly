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
import { describeCampaignConflict } from "@/lib/callout/conflict";

const shiftIdSchema = z.string().min(1);
const tierSchema = z.number().int().min(1);

/**
 * Returned, never thrown: losing a race to another admin ("Stop" vs
 * "Advance", two Advances) is routine, and a thrown Server Action error is an
 * opaque digest in production.
 */
export type CalloutControlResult = { ok: true } | { ok: false; error: string };

async function requireScheduler() {
  const actor = await requireActor();
  requireRole(actor, "ADMIN");
  return actor;
}

async function settle(shiftId: string, result: CampaignControlResult): Promise<CalloutControlResult> {
  if (!result.ok) return { ok: false, error: await describeCampaignConflict(shiftId) };
  revalidatePath(`/admin/shifts/${shiftId}`);
  revalidatePath("/admin/shifts");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Widen the callout to the next tier now, without waiting out the window.
 * `fromTier` is the tier the scheduler's page showed: if the callout already
 * moved on (another admin, or the engine), this refuses instead of skipping a
 * tier.
 */
export async function advanceTier(rawShiftId: unknown, rawFromTier: unknown): Promise<CalloutControlResult> {
  const actor = await requireScheduler();
  const shiftId = shiftIdSchema.parse(rawShiftId);
  const fromTier = tierSchema.parse(rawFromTier);
  return settle(shiftId, await advanceCampaignTier(shiftId, { actorId: actor.id }, { fromTier }));
}

/** Freeze the callout on its current tier. */
export async function holdCallout(rawShiftId: unknown): Promise<CalloutControlResult> {
  const actor = await requireScheduler();
  const shiftId = shiftIdSchema.parse(rawShiftId);
  return settle(shiftId, await holdCampaign(shiftId, { actorId: actor.id }));
}

/** Take the callout off hold and restart the current tier's window. */
export async function resumeCallout(rawShiftId: unknown): Promise<CalloutControlResult> {
  const actor = await requireScheduler();
  const shiftId = shiftIdSchema.parse(rawShiftId);
  return settle(shiftId, await resumeCampaign(shiftId, { actorId: actor.id }));
}

/** Stop outreach for good. The shift stays open and keeps taking bids. */
export async function stopCallout(rawShiftId: unknown): Promise<CalloutControlResult> {
  const actor = await requireScheduler();
  const shiftId = shiftIdSchema.parse(rawShiftId);
  return settle(shiftId, await stopCampaign(shiftId, { actorId: actor.id }));
}
