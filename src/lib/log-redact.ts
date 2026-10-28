/**
 * Log-safe descriptions of errors and contact details. Provider exceptions
 * (Twilio's "The 'To' number +1416... is not a valid phone number", Resend's
 * recipient errors) carry staff phone numbers and emails in their message, and
 * logging the raw error copies them into Vercel log retention/export. Log
 * `describeError(err)` instead of `err`.
 */

// A "+"-led or 7+-digit run, optionally with common separators.
const PHONE_RE = /\+?\d(?:[\s().-]{0,2}\d){6,}/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** "+14165551234" -> "+*********34": keeps only the last two digits. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${phone.startsWith("+") ? "+" : ""}${"*".repeat(Math.max(digits.length - 2, 0))}${digits.slice(-2)}`;
}

/** "maria.santos@hospital.org" -> "m***@hospital.org". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** Mask every phone number and email address inside free text. */
export function redactContactDetails(text: string): string {
  return text.replace(EMAIL_RE, (m) => maskEmail(m)).replace(PHONE_RE, (m) => maskPhone(m));
}

/**
 * One log line for a caught error: its name, provider code/status when there
 * is one (Twilio's `code`/`status`, Resend's `statusCode`), and the message
 * with contact details masked. Never the raw object, whose fields (Twilio's
 * `moreInfo`, request details) can carry the number again.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return redactContactDetails(String(err));
  const e = err as Error & { code?: unknown; status?: unknown; statusCode?: unknown };
  const parts = [e.name];
  if (e.code !== undefined) parts.push(`code=${String(e.code)}`);
  const status = e.status ?? e.statusCode;
  if (status !== undefined) parts.push(`status=${String(status)}`);
  return `${parts.join(" ")}: ${redactContactDetails(e.message)}`;
}
