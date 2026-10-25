/**
 * What to tell a scheduler whose callout control (advance / hold / resume /
 * stop) lost a race. Every transition in ./campaign is a conditional write, so
 * when two admins - or an admin and the engine - act at once exactly one lands;
 * this names what the other one did. `campaignConflictMessage` is pure.
 */
import type { CampaignStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { describeShiftConflict } from "@/lib/shifts/conflict";

export interface CampaignConflictState {
  status: CampaignStatus;
  currentTier: number;
  /** Most recent CALLOUT_* activity, if any. */
  lastChange: { action: string; actorName: string; details: string | null } | null;
}

/** Activity rows written by the engine rather than a person; see campaign.ts. */
function automatic(details: string | null): boolean {
  return details?.startsWith("Auto-escalated") ?? false;
}

export function campaignConflictMessage(state: CampaignConflictState): string {
  const { status, currentTier, lastChange } = state;
  const who = (action: string) =>
    lastChange?.action === action && !automatic(lastChange.details) ? lastChange.actorName : null;

  switch (status) {
    case "CANCELLED": {
      const name = who("CALLOUT_STOPPED");
      return name ? `Outreach was just stopped by ${name}.` : "Outreach for this shift has been stopped.";
    }
    case "FILLED":
      return "This callout just closed because the shift was filled.";
    case "EXHAUSTED":
      return "This callout has already run through every tier.";
    case "PAUSED": {
      const name = who("CALLOUT_HELD");
      return name ? `${name} just put this callout on hold.` : "This callout was just put on hold.";
    }
    case "RUNNING": {
      if (lastChange?.action === "CALLOUT_ESCALATED") {
        return automatic(lastChange.details)
          ? `This callout just advanced automatically to tier ${currentTier}.`
          : `${lastChange.actorName} just advanced this callout to tier ${currentTier}.`;
      }
      const name = who("CALLOUT_RESUMED");
      return name ? `${name} just resumed this callout.` : "This callout just changed.";
    }
  }
}

/** Read the campaign and explain why the caller's control no longer applies. */
export async function describeCampaignConflict(shiftId: string): Promise<string> {
  const campaign = await db.calloutCampaign.findUnique({
    where: { shiftId },
    select: { status: true, currentTier: true, shift: { select: { status: true } } },
  });
  if (!campaign) return "No callout campaign is running for this shift.";
  if (campaign.shift.status !== "OPEN" && campaign.status !== "FILLED") return describeShiftConflict(shiftId);

  const last = await db.shiftActivity.findFirst({
    where: { shiftId, action: { startsWith: "CALLOUT_" } },
    orderBy: { createdAt: "desc" },
    select: { action: true, details: true, actor: { select: { name: true } } },
  });
  return campaignConflictMessage({
    status: campaign.status,
    currentTier: campaign.currentTier,
    lastChange: last ? { action: last.action, actorName: last.actor.name, details: last.details } : null,
  });
}
