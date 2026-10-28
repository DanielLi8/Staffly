/**
 * The live fill dashboard (ADMIN-only; the page that renders it enforces the
 * role). Shows the state of the cascade at a glance: where the callout is, who
 * has been reached on which channel, who responded, how long it has been open,
 * and the controls to steer it.
 */
import {
  AlertTriangle,
  CheckCircle2,
  Hourglass,
  Inbox,
  Lock,
  Mail,
  MessageSquare,
  Phone,
  Bell,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollAreaX } from "@/components/ui/scroll-area-x";
import { cn } from "@/lib/utils";
import { MAX_TIER } from "@/lib/callout/tiers";
import { isCampaignTerminal } from "@/lib/callout/decide";
import { hospitalDate, hospitalDateTime, hospitalTime, hospitalTimeWithSeconds } from "@/lib/timezone";
import type { ChannelAttempt, FillDashboard, StaffDecline } from "@/lib/callout/dashboard";
import type { Channel, CampaignStatus, DeliveryStatus } from "@prisma/client";
import { LiveStatus } from "@/features/live/live-refresh";
import { CascadeControls } from "./cascade-controls";

const TIER_LABEL: Record<number, string> = {
  1: "Available in department",
  2: "Department, no availability set",
  3: "Other departments",
};

// A stopped callout is not an alarm (bidding carries on), so it stays out of
// clinical red - DESIGN.md "The One Alarm Rule".
const CAMPAIGN_STATUS_STYLE: Record<CampaignStatus, string> = {
  RUNNING: "bg-primary-50 text-primary-800 border-primary-200",
  PAUSED: "bg-amber-50 text-amber-800 border-amber-200",
  CANCELLED: "bg-neutral-100 text-neutral-700 border-neutral-200",
  FILLED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  EXHAUSTED: "bg-neutral-100 text-neutral-700 border-neutral-200",
};

/** The campaign status says what happened to OUTREACH, never to bidding. */
const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  RUNNING: "Running",
  PAUSED: "On hold",
  CANCELLED: "Outreach stopped",
  FILLED: "Filled",
  EXHAUSTED: "Tiers exhausted",
};

const CHANNEL_ICON: Record<Channel, React.ElementType> = {
  IN_APP: Bell,
  EMAIL: Mail,
  SMS: MessageSquare,
  VOICE: Phone,
};

const DELIVERY_STYLE: Record<DeliveryStatus, string> = {
  QUEUED: "bg-neutral-100 text-neutral-600 border-neutral-200",
  SENT: "bg-sky-50 text-sky-700 border-sky-200",
  DELIVERED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ANSWERED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  FAILED: "bg-rose-50 text-rose-700 border-rose-200",
};

function formatMinutes(total: number): string {
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export function FillDashboardPanel({ data, now = new Date() }: { data: FillDashboard; now?: Date }) {
  const { campaign } = data;

  if (!campaign) {
    return (
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Callout cascade</CardTitle>
          <LiveStatus />
        </CardHeader>
        <CardContent>
          <p className="text-sm text-neutral-500">
            No callout campaign was opened for this shift. Shifts posted before the
            cascade shipped have no campaign to steer.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          Callout cascade
          <Badge className={cn("text-2xs font-bold uppercase tracking-wide", CAMPAIGN_STATUS_STYLE[campaign.status])}>
            {CAMPAIGN_STATUS_LABEL[campaign.status]}
          </Badge>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-xs text-neutral-500">
            Tier {campaign.currentTier} of {MAX_TIER} · window {campaign.currentWindowMinutes}m
          </span>
          <LiveStatus />
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <BiddingStatus data={data} />

        {campaign.openingDispatchAt && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800"
          >
            <Hourglass className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>
              Outreach is held until {hospitalTimeWithSeconds(campaign.openingDispatchAt)} - nobody
              has been contacted yet. Stop outreach before then and no message goes out.
            </span>
          </div>
        )}

        {campaign.pastStartReminderAt && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>
              This shift passed its start time while unfilled. The callout was left open
              deliberately - it is not auto-expired.
            </span>
          </div>
        )}

        {/* Headline metrics */}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Remaining gap" value={data.remainingGap === 0 ? "Filled" : `${data.remainingGap} worker`} />
          <Metric label="Elapsed" value={formatMinutes(data.elapsedMinutes)} />
          <Metric
            label="Time to fill"
            value={data.timeToFillMinutes === null ? "—" : formatMinutes(data.timeToFillMinutes)}
          />
          <Metric label="Staff reached" value={String(data.reachedCount)} />
        </dl>

        {/* Tier progress */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Tiers
          </h3>
          <ol className="space-y-2">
            {data.tiers.map((tier) => {
              const active = tier.tier === campaign.currentTier;
              const passed = tier.tier < campaign.currentTier;
              return (
                <li
                  key={tier.tier}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm",
                    active
                      ? "border-primary-300 bg-primary-50"
                      : passed
                        ? "border-neutral-200 bg-neutral-50 text-neutral-500"
                        : "border-neutral-200 bg-white text-neutral-500"
                  )}
                >
                  <span className="min-w-0">
                    <span className="font-semibold text-neutral-800">Tier {tier.tier}</span>
                    <span className="ml-2 text-xs">{TIER_LABEL[tier.tier]}</span>
                  </span>
                  <span className="text-xs whitespace-nowrap">
                    {tier.reachedCount}/{tier.candidateCount} reached · {tier.windowMinutes}m window
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Controls, or how outreach ended */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {isCampaignTerminal(campaign.status) ? "Outreach" : "Controls"}
          </h3>
          {/* Mounted in both states so a control that lost a race (e.g. Advance
              just after another admin's Stop) keeps showing why after the
              refresh that ends the campaign on screen. */}
          <CascadeControls
            shiftId={data.shift.id}
            status={campaign.status}
            currentTier={campaign.currentTier}
            maxTier={MAX_TIER}
            endedSummary={isCampaignTerminal(campaign.status) ? describeOutreachEnd(data, now) : null}
          />
        </div>

        {/* Delivery tracking */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Outreach log
          </h3>
          {data.reached.length === 0 ? (
            <p className="text-sm text-neutral-500">Nobody has been contacted yet.</p>
          ) : (
            <ScrollAreaX label="Outreach log">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
                    <th className="pb-2 pr-3 font-medium">Staff</th>
                    <th className="pb-2 pr-3 font-medium">Tier</th>
                    <th className="pb-2 pr-3 font-medium">Response</th>
                    <th className="pb-2 font-medium">Channels</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {data.reached.map((person) => (
                    <tr key={person.userId} className="align-top">
                      <td className="py-2 pr-3 font-medium text-neutral-800">{person.name}</td>
                      <td className="py-2 pr-3 text-neutral-500">{person.tier || "—"}</td>
                      <td className="py-2 pr-3">
                        <ResponseChip bidStatus={person.bidStatus} decline={person.decline} now={now} />
                      </td>
                      <td className="py-2">
                        {person.channels.length === 0 ? (
                          <span className="text-xs text-neutral-500">Not contacted</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {person.channels.map((c) => (
                              <ChannelChip key={c.channel} attempt={c} />
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollAreaX>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Whether the shift is taking bids, stated on its own line because it does NOT
 * follow the campaign badge: a stopped or exhausted callout keeps taking bids
 * until the shift is awarded or cancelled.
 */
function BiddingStatus({ data }: { data: FillDashboard }) {
  const count = data.bidders.length;
  const bids = `${count} bid${count === 1 ? "" : "s"} so far`;

  if (data.bidding.open) {
    const outreachEnded = data.campaign !== null && isCampaignTerminal(data.campaign.status);
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-md border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-800"
      >
        <Inbox className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <span>
          <span className="font-semibold">Bidding open</span> · {bids}.{" "}
          {outreachEnded
            ? "Outreach has ended, but staff can still bid in the app or by replying to an earlier text or call."
            : "Staff can bid in the app or by replying to a text or call."}
        </span>
      </div>
    );
  }

  const why =
    data.bidding.reason === "SHIFT_ENDED"
      ? "the shift ended unfilled"
      : data.shift.status === "ASSIGNED"
        ? "the shift has been awarded"
        : data.shift.status === "CANCELLED"
          ? "the shift was cancelled"
          : "the shift is closed";
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700"
    >
      <Lock className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <span>
        <span className="font-semibold">Bidding closed</span> · {why}.
      </span>
    </div>
  );
}

/** A time today reads as "9:13 PM"; anything older gets its date too. */
function whenLabel(at: Date, now: Date): string {
  return hospitalDate(at) === hospitalDate(now) ? hospitalTime(at) : hospitalDateTime(at);
}

/** What happened to outreach, for a campaign that has ended. */
export function describeOutreachEnd(data: FillDashboard, now: Date): string {
  const { campaign, shift, bidding } = data;
  if (!campaign) return "";

  if (campaign.status === "FILLED") {
    const late =
      campaign.filledAt && campaign.endedAt && campaign.endedAt < campaign.filledAt;
    return late
      ? "Filled from a bid that arrived after outreach had ended."
      : "Filled. Outreach ended when the shift was awarded.";
  }
  if (shift.status === "CANCELLED") {
    return "The shift was cancelled. No further outreach will be sent.";
  }

  const ended =
    campaign.status === "EXHAUSTED"
      ? `All ${MAX_TIER} tiers contacted with no fill yet. No more texts or calls will go out.`
      : campaign.stoppedBy
        ? `Outreach stopped at tier ${campaign.currentTier} by ${campaign.stoppedBy.name}, ${whenLabel(campaign.stoppedBy.at, now)}. No more texts or calls will go out.`
        : `Outreach stopped at tier ${campaign.currentTier}. No more texts or calls will go out.`;

  return bidding.open ? `${ended} Bidding is still open.` : ended;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
      <dt className="text-2xs font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-base font-semibold text-neutral-900">{value}</dd>
    </div>
  );
}

function ChannelChip({ attempt }: { attempt: ChannelAttempt }) {
  const Icon = CHANNEL_ICON[attempt.channel];
  return (
    <span
      title={`${attempt.channel} · ${attempt.status}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium",
        DELIVERY_STYLE[attempt.status]
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">{attempt.channel.toLowerCase()}: </span>
      {attempt.status.toLowerCase()}
    </span>
  );
}

const DECLINE_VIA: Record<Channel, string> = {
  IN_APP: "in app",
  SMS: "by text",
  VOICE: "by phone",
  EMAIL: "by email",
};

function ResponseChip({
  bidStatus,
  decline,
  now,
}: {
  bidStatus: string | null;
  decline: StaffDecline | null;
  now: Date;
}) {
  if (bidStatus) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        Bid submitted
      </span>
    );
  }
  if (decline) {
    return (
      <span className="inline-flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700">
          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
          Declined
        </span>
        <span className="whitespace-nowrap text-2xs text-neutral-500">
          {DECLINE_VIA[decline.via]}
          {decline.at ? `, ${whenLabel(decline.at, now)}` : ""}
        </span>
      </span>
    );
  }
  return <span className="text-xs text-neutral-500">No response</span>;
}
