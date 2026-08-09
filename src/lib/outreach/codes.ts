/**
 * Pure helpers for the SMS reply-code scheme. No DB, no Twilio - unit-testable
 * in isolation (see tests/outreach/reply-codes.test.ts).
 *
 * Each shift carries a short `smsCode` (see prisma `Shift.smsCode`). Outreach
 * texts tell a worker how to respond:
 *
 *   Reply YES 7K2M   -> accept the FULL shift
 *   Reply PART 7K2M  -> offer to cover a PARTIAL window (scheduler confirms hours)
 *
 * A bare code ("7K2M") is treated as a full-shift accept. Carrier keywords
 * (STOP/START/HELP ...) are recognised so the inbound handler can ignore them
 * gracefully rather than mis-parsing them as a code.
 */

export type ReplyScope = "FULL" | "PARTIAL";

export type ParsedReply =
  | { kind: "bid"; scope: ReplyScope; code: string }
  | { kind: "control"; keyword: string }
  | { kind: "unknown" };

/** Alphabet for generated codes: unambiguous (no O/0, I/1) uppercase set. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;

/** Carrier / compliance keywords that must never be read as a shift code. */
const CONTROL_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "START",
  "YES-JOIN",
  "UNSTOP",
  "HELP",
  "INFO",
]);

const FULL_PREFIXES = new Set(["YES", "ACCEPT", "Y", "OK", "CONFIRM"]);
const PARTIAL_PREFIXES = new Set(["PART", "PARTIAL", "P", "SOME"]);

/** A valid shift code is 4-8 chars from the generation alphabet. */
const CODE_RE = /^[A-Z0-9]{4,8}$/;

/** Generate a random shift SMS code. Uniqueness is enforced by the DB. */
export function generateShiftCode(length = CODE_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

function isCode(token: string): boolean {
  // Codes never contain the ambiguous letters we excluded at generation, but
  // inbound text may still be a valid legacy code, so accept the broad shape.
  return CODE_RE.test(token);
}

/**
 * Parse an inbound SMS body into an intent. Whitespace-insensitive and
 * case-insensitive. Returns a discriminated union so callers must handle every
 * case (bid / carrier-control / unrecognised).
 */
export function parseReply(body: string | null | undefined): ParsedReply {
  if (!body) return { kind: "unknown" };

  const normalized = body.trim().toUpperCase().replace(/\s+/g, " ");
  if (!normalized) return { kind: "unknown" };

  const tokens = normalized.split(" ");

  // Single token: either a carrier keyword or a bare full-shift code.
  if (tokens.length === 1) {
    const [only] = tokens;
    if (CONTROL_KEYWORDS.has(only)) return { kind: "control", keyword: only };
    // A lone accept/partial keyword (e.g. "PART") is a keyword with no code, not
    // a code itself - even though it happens to match the code shape.
    if (FULL_PREFIXES.has(only) || PARTIAL_PREFIXES.has(only)) return { kind: "unknown" };
    if (isCode(only)) return { kind: "bid", scope: "FULL", code: only };
    return { kind: "unknown" };
  }

  // Two tokens: <keyword> <code>.
  if (tokens.length === 2) {
    const [prefix, code] = tokens;
    if (CONTROL_KEYWORDS.has(prefix)) return { kind: "control", keyword: prefix };
    if (!isCode(code)) return { kind: "unknown" };
    if (FULL_PREFIXES.has(prefix)) return { kind: "bid", scope: "FULL", code };
    if (PARTIAL_PREFIXES.has(prefix)) return { kind: "bid", scope: "PARTIAL", code };
    return { kind: "unknown" };
  }

  return { kind: "unknown" };
}
