/**
 * Deprecated alias of /api/webhooks/telephony/status, kept for one release so
 * Twilio numbers still configured with the old URL keep working. The signature
 * is checked against this path (the URL Twilio actually signed). Remove with
 * the Twilio provider.
 */
export { POST } from "@/app/api/webhooks/telephony/status/route";

export const runtime = "nodejs";
