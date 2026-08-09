/**
 * Credential-optional Inngest access. Mirrors src/lib/outreach/twilio.ts and
 * src/lib/email.ts: with no Inngest env vars the app must keep running.
 *
 * Inngest is ONLY the timer. Posting a shift, tier-1 outreach, and every
 * scheduler control (advance / hold / stop) are plain database writes that work
 * with no Inngest account at all - see src/lib/callout/campaign.ts. What is lost
 * without keys is the *automatic* timed escalation and the past-start reminder.
 */
import { Inngest } from "inngest";

/** The events the cascade engine reacts to. Kept tiny and DB-id based. */
export interface CalloutEventData {
  /** A campaign was created; start the timed cascade for this shift. */
  "callout/started": { shiftId: string; campaignId: string };
  /**
   * Campaign state changed out-of-band (fill, manual advance, hold, stop). The
   * engine treats this only as a wake-up: it always re-reads Postgres, which is
   * the source of truth, rather than trusting the payload.
   */
  "callout/control": { shiftId: string; reason: string };
}

export const INNGEST_APP_ID = "staffly";
export const CALLOUT_STARTED_EVENT = "callout/started";
export const CALLOUT_CONTROL_EVENT = "callout/control";

let cached: Inngest | null = null;

/**
 * True when Inngest can actually run the cascade: an event key to publish with
 * and a signing key for it to call our /api/inngest endpoint back.
 */
export function isInngestConfigured(): boolean {
  return Boolean(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY);
}

/**
 * The Inngest client. Built lazily (and memoised) so that merely importing this
 * module never reads configuration - the same reason the Resend and Twilio
 * clients are lazy. The SDK picks the signing key up from INNGEST_SIGNING_KEY.
 */
export function getInngest(): Inngest {
  if (!cached) {
    cached = new Inngest({
      id: INNGEST_APP_ID,
      eventKey: process.env.INNGEST_EVENT_KEY,
    });
  }
  return cached;
}

/**
 * Publish a cascade event, best effort. No keys -> no-op. A publish failure is
 * logged and swallowed: losing the timer must never fail the scheduler's action,
 * because the database write has already happened and is what actually counts.
 */
export async function sendCalloutEvent<K extends keyof CalloutEventData>(
  name: K,
  data: CalloutEventData[K]
): Promise<{ sent: boolean }> {
  if (!isInngestConfigured()) return { sent: false };
  try {
    await getInngest().send({ name, data });
    return { sent: true };
  } catch (err) {
    console.error(`[inngest] failed to publish ${String(name)}:`, err);
    return { sent: false };
  }
}
