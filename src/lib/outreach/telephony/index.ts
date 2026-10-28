/**
 * Telephony provider selection. `TELEPHONY_PROVIDER` picks the implementation:
 *
 * - unset / `twilio` -> Twilio (the default, so existing deployments are
 *   unchanged; with no Twilio credentials it no-ops on its own)
 * - `none`           -> no provider: SMS skipped, OTP unavailable, webhooks 403
 *
 * An unrecognized value fails closed to `none` (logged) rather than sending
 * through a provider nobody chose. Read on every call, not cached, so tests and
 * a redeploy with a new value need no restart logic.
 */
import { noopProvider } from "./noop";
import { twilioProvider } from "./twilio";
import type { TelephonyProvider, TelephonyProviderName } from "./types";

export type * from "./types";

const PROVIDERS: Record<TelephonyProviderName, TelephonyProvider> = {
  twilio: twilioProvider,
  none: noopProvider,
};

export const DEFAULT_TELEPHONY_PROVIDER: TelephonyProviderName = "twilio";

/** Resolve a `TELEPHONY_PROVIDER` value to a provider name; null when unrecognized. */
export function parseTelephonyProvider(raw: string | undefined): TelephonyProviderName | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return DEFAULT_TELEPHONY_PROVIDER;
  return Object.hasOwn(PROVIDERS, value) ? (value as TelephonyProviderName) : null;
}

export function getTelephonyProvider(): TelephonyProvider {
  const raw = process.env.TELEPHONY_PROVIDER;
  const name = parseTelephonyProvider(raw);
  if (!name) {
    console.error(`[telephony] Unknown TELEPHONY_PROVIDER "${raw}" - SMS and phone verification are off.`);
    return noopProvider;
  }
  return PROVIDERS[name];
}
