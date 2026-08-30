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
  Mail,
  MessageSquare,
  Phone,
  Bell,
  XCircle,
} from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MAX_TIER } from "@/lib/callout/tiers";
import type { ChannelAttempt, FillDashboard } from "@/lib/callout/dashboard";
import type { Channel, CampaignStatus, DeliveryStatus } from "@prisma/client";
import { CascadeControls } from "./cascade-controls";

const TIER_LABEL: Record<number, string> = {
  1: "Available in department",
  2: "Department, no availability set",
  3: "Other departments",
};

const CAMPAIGN_STATUS_STYLE: Record<CampaignStatus, string> = {
  RUNNING: "bg-primary-50 text-primary-800 border-primary-200",
  PAUSED: "bg-amber-50 text-amber-800 border-amber-200",
  CANCELLED: "bg-red-50 text-accent border-accent-200",
  FILLED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  EXHAUSTED: "bg-neutral-100 text-neutral-600 border-neutral-200",
};

const CHANNEL_ICON: Record<Channel, React.ElementType> = {
  IN_APP: Bell,
  EMAIL: Mail,
  SMS: MessageSquare,
  VOICE: Phone,
};

const DELIVERY_STYLE: Record<DeliveryStatus, string> = {
  QUEUED: "bg-neutral-100 text-neutral-500 border-neutral-200",
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

export function FillDashboardPanel({ data }: { data: FillDashboard }) {
  const { campaign } = data;

  if (!campaign) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Callout cascade</CardTitle>
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
          <Badge className={cn("text-[10px] font-bold uppercase tracking-wide", CAMPAIGN_STATUS_STYLE[campaign.status])}>
            {campaign.status}
          </Badge>
        </CardTitle>
        <span className="text-xs text-neutral-500">
          Tier {campaign.currentTier} of {MAX_TIER} · window {campaign.currentWindowMinutes}m
        </span>
      </CardHeader>

      <CardContent className="space-y-6">
        {campaign.openingDispatchAt && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800"
          >
            <Hourglass className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>
              Outreach is held until {format(campaign.openingDispatchAt, "h:mm:ss a")} - nobody
              has been contacted yet. Stop the cascade before then and no message goes out.
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
          <Metric label="Staff reached" value={String(data.reached.length)} />
        </dl>

        {/* Tier progress */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Tiers
          </h4>
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

        {/* Controls */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Controls
          </h4>
          <CascadeControls
            shiftId={data.shift.id}
            status={campaign.status}
            currentTier={campaign.currentTier}
            maxTier={MAX_TIER}
          />
        </div>

        {/* Delivery tracking */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Outreach log
          </h4>
          {data.reached.length === 0 ? (
            <p className="text-sm text-neutral-500">Nobody has been contacted yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                    <th className="pb-2 pr-3 font-medium">Staff</th>
                    <th className="pb-2 pr-3 font-medium">Tier</th>
                    <th className="pb-2 pr-3 font-medium">Channels</th>
                    <th className="pb-2 font-medium">Response</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {data.reached.map((person) => (
                    <tr key={person.userId} className="align-top">
                      <td className="py-2 pr-3 font-medium text-neutral-800">{person.name}</td>
                      <td className="py-2 pr-3 text-neutral-500">{person.tier || "—"}</td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-1.5">
                          {person.channels.map((c) => (
                            <ChannelChip key={c.channel} attempt={c} />
                          ))}
                        </div>
                      </td>
                      <td className="py-2">
                        <ResponseChip bidStatus={person.bidStatus} declined={person.declined} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
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
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        DELIVERY_STYLE[attempt.status]
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {attempt.status.toLowerCase()}
    </span>
  );
}

function ResponseChip({
  bidStatus,
  declined,
}: {
  bidStatus: string | null;
  declined: boolean;
}) {
  if (bidStatus) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        Bid submitted
      </span>
    );
  }
  if (declined) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700">
        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
        Declined
      </span>
    );
  }
  return <span className="text-xs text-neutral-400">No response</span>;
}
