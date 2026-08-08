/**
 * Shared plumbing for the public Twilio webhooks. Every webhook MUST call
 * {@link readVerifiedTwilioForm} and reject when it returns null, before any DB
 * write - this is the signature-verification security boundary.
 */
import { isValidTwilioSignature } from "./twilio";
import { webhookBaseUrl } from "./urls";

/**
 * The exact URL Twilio signed. We rebuild it from our own public base + the
 * request path/query (rather than trusting the proxied request host) so it
 * matches the callback URLs we hand Twilio when placing calls/sends.
 */
export function twilioRequestUrl(request: Request): string {
  const u = new URL(request.url);
  const base = webhookBaseUrl().replace(/\/$/, "");
  return `${base}${u.pathname}${u.search}`;
}

/**
 * Parse a Twilio form-encoded POST body into a plain string map. Returns an
 * empty map for an absent/unparseable body rather than throwing, so a malformed
 * request fails the signature check (403) instead of erroring (500).
 */
export async function parseTwilioForm(request: Request): Promise<Record<string, string>> {
  const params: Record<string, string> = {};
  try {
    const form = await request.formData();
    form.forEach((value, key) => {
      params[key] = typeof value === "string" ? value : "";
    });
  } catch {
    return {};
  }
  return params;
}

/**
 * Read and signature-verify a Twilio webhook request. Returns the validated
 * params, or null when the signature is missing/invalid or the auth token is
 * unset. Callers reject (403) on null.
 */
export async function readVerifiedTwilioForm(
  request: Request
): Promise<Record<string, string> | null> {
  const signature = request.headers.get("x-twilio-signature");
  const url = twilioRequestUrl(request);
  const params = await parseTwilioForm(request);

  if (!isValidTwilioSignature({ signature, url, params })) {
    return null;
  }
  return params;
}
