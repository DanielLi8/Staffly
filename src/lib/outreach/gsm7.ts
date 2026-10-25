/**
 * GSM-7 helpers for outbound SMS. Pure, no provider dependency.
 *
 * Why this exists: a single character outside the GSM 03.38 alphabet (an en
 * dash, a curly quote, a narrow no-break space from `Intl`) silently switches a
 * whole text to UCS-2, which drops a segment from 160 to 70 characters - so a
 * ~155-character callout bills as 3 segments instead of 1. Every provider bills
 * per segment. Every outbound SMS body goes through {@link toGsm7}, and callout
 * bodies are fitted to {@link SMS_SINGLE_SEGMENT} septets.
 */

/** GSM 03.38 basic character set (each costs one septet). */
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/** GSM 03.38 extension table (each costs two septets: ESC + char). */
const GSM_EXTENSION = "^{}\\[~]|€\f";

const BASIC = new Set(Array.from(GSM_BASIC));
const EXTENSION = new Set(Array.from(GSM_EXTENSION));

/** Septets in one single-part GSM-7 message. */
export const SMS_SINGLE_SEGMENT = 160;
/** Septets per part once a GSM-7 message is split (the UDH takes the rest). */
const GSM_MULTIPART_SEGMENT = 153;
const UCS2_SINGLE_SEGMENT = 70;
const UCS2_MULTIPART_SEGMENT = 67;

/** Common typographic characters and their plain GSM-7 stand-ins. */
const REPLACEMENTS: Record<string, string> = {
  "‐": "-", // hyphen
  "‑": "-", // non-breaking hyphen
  "‒": "-", // figure dash
  "–": "-", // en dash
  "—": "-", // em dash
  "―": "-", // horizontal bar
  "−": "-", // minus sign
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "′": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "″": '"',
  "…": "...",
  "·": "-", // middle dot
  "•": "-", // bullet
  " ": " ", // no-break space
  " ": " ", // figure space
  " ": " ", // thin space
  " ": " ", // narrow no-break space (Intl puts one before AM/PM)
  "\t": " ",
};

function isGsmChar(ch: string): boolean {
  return BASIC.has(ch) || EXTENSION.has(ch);
}

/** True when every character of `text` is encodable in GSM-7. */
export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!isGsmChar(ch)) return false;
  }
  return true;
}

/**
 * Rewrite `text` into the GSM-7 alphabet: typographic punctuation becomes its
 * ASCII stand-in, accented letters outside the set lose their accent ("ô" ->
 * "o"; "é" is already GSM-7 and stays), and anything left becomes "?".
 */
export function toGsm7(text: string): string {
  let out = "";
  for (const ch of text) {
    if (isGsmChar(ch)) {
      out += ch;
      continue;
    }
    const replacement = REPLACEMENTS[ch];
    if (replacement !== undefined) {
      out += replacement;
      continue;
    }
    const stripped = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += stripped && isGsm7(stripped) ? stripped : "?";
  }
  return out;
}

/** Septets `text` costs in GSM-7, or null when it is not GSM-7 encodable. */
export function gsm7Septets(text: string): number | null {
  let septets = 0;
  for (const ch of text) {
    if (BASIC.has(ch)) septets += 1;
    else if (EXTENSION.has(ch)) septets += 2;
    else return null;
  }
  return septets;
}

export interface SmsEncodingInfo {
  encoding: "GSM-7" | "UCS-2";
  /** Septets for GSM-7, UTF-16 code units for UCS-2. */
  units: number;
  segments: number;
}

/** How a carrier will encode and bill `text`. */
export function smsEncoding(text: string): SmsEncodingInfo {
  const septets = gsm7Septets(text);
  if (septets !== null) {
    const segments =
      septets <= SMS_SINGLE_SEGMENT ? 1 : Math.ceil(septets / GSM_MULTIPART_SEGMENT);
    return { encoding: "GSM-7", units: septets, segments };
  }
  const units = text.length;
  const segments =
    units <= UCS2_SINGLE_SEGMENT ? 1 : Math.ceil(units / UCS2_MULTIPART_SEGMENT);
  return { encoding: "UCS-2", units, segments };
}

/**
 * Shorten GSM-7 `text` to at most `maxSeptets`, ending in "..." when cut.
 * Trailing spaces/punctuation before the ellipsis are dropped so a cut reads
 * cleanly ("Cardiac Inten..." not "Cardiac ...").
 */
export function truncateGsm7(text: string, maxSeptets: number): string {
  if ((gsm7Septets(text) ?? Infinity) <= maxSeptets) return text;
  const ellipsis = "...";
  const budget = Math.max(0, maxSeptets - ellipsis.length);
  let out = "";
  let used = 0;
  for (const ch of text) {
    const cost = EXTENSION.has(ch) ? 2 : 1;
    if (used + cost > budget) break;
    out += ch;
    used += cost;
  }
  out = out.replace(/[\s,.;:(-]+$/, "");
  return maxSeptets < ellipsis.length ? ellipsis.slice(0, maxSeptets) : out + ellipsis;
}
