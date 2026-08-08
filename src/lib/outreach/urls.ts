/**
 * Public base URL Twilio uses to reach our webhooks. In production this is the
 * deployed origin (NEXTAUTH_URL); `TWILIO_WEBHOOK_BASE_URL` overrides it when the
 * public callback host differs from the app URL (e.g. a tunnel in local dev).
 */
export function webhookBaseUrl(): string {
  return (
    process.env.TWILIO_WEBHOOK_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000"
  );
}

export function voiceWebhookUrl(shiftId: string, userId: string): string {
  const p = new URLSearchParams({ shiftId, userId });
  return `${webhookBaseUrl()}/api/webhooks/twilio/voice?${p.toString()}`;
}

export function voiceResponseUrl(shiftId: string, userId: string): string {
  const p = new URLSearchParams({ shiftId, userId });
  return `${webhookBaseUrl()}/api/webhooks/twilio/voice-response?${p.toString()}`;
}

export function statusCallbackUrl(): string {
  return `${webhookBaseUrl()}/api/webhooks/twilio/status`;
}
