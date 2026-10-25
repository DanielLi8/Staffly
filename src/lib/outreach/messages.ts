/**
 * Message content for SMS and voice. Deliberately limited to department, role,
 * and date/time - NO patient/clinical detail (never the shift's `notes`). Pure
 * string builders so they are trivially testable.
 *
 * Every SMS body here is GSM-7 only and fits one 160-septet segment (see
 * ./gsm7 for why one stray en dash triples the bill).
 */
import { hospitalDateTime, hospitalTime } from "@/lib/timezone";
import { SMS_SINGLE_SEGMENT, gsm7Septets, toGsm7, truncateGsm7 } from "./gsm7";
import type { OutreachShift } from "./types";

/**
 * "Mon, Nov 2, 7:00 AM-7:00 PM". `separator` sits between the two times: a
 * plain hyphen for SMS (GSM-7), " to " for text read aloud.
 */
export function formatShiftWhen(
  shift: Pick<OutreachShift, "startsAt" | "endsAt">,
  separator = "-"
): string {
  const day = hospitalDateTime(shift.startsAt).split(" · ")[0];
  const start = hospitalTime(shift.startsAt);
  const end = hospitalTime(shift.endsAt);
  return `${day}, ${start}${separator}${end}`;
}

/** "Registered Nurse (RN)" -> "RN"; null when the role has no abbreviation. */
function roleAbbreviation(role: string): string | null {
  const match = role.match(/\(([^()]{1,8})\)\s*$/);
  return match ? match[1].trim() : null;
}

/** Fit `fields` into `build` within one segment by shrinking them in steps. */
function fitOneSegment<K extends string>(
  fields: Record<K, string>,
  build: (f: Record<K, string>) => string,
  steps: { field: K; min?: number; replace?: (value: string) => string | null }[]
): string {
  const current = { ...fields };
  const septets = () => gsm7Septets(build(current)) ?? Infinity;

  for (const step of steps) {
    const over = septets() - SMS_SINGLE_SEGMENT;
    if (over <= 0) break;
    const value = current[step.field];
    if (step.replace) {
      current[step.field] = step.replace(value) ?? value;
    } else if (step.min !== undefined) {
      const length = gsm7Septets(value) ?? value.length;
      const target = Math.max(step.min, length - over);
      if (target < length) current[step.field] = truncateGsm7(value, target);
    }
  }
  // Safety net only: the step minimums keep any 8-char code within budget.
  return truncateGsm7(build(current), SMS_SINGLE_SEGMENT);
}

/**
 * SMS body: dept, role, unit, time, and how to answer with the reply code.
 * Always one GSM-7 segment: a long role first falls back to its abbreviation,
 * then the department, unit and role are shortened with "..." as needed.
 */
export function smsBody(shift: OutreachShift): string {
  const when = toGsm7(formatShiftWhen(shift));
  const code = shift.smsCode ? toGsm7(shift.smsCode) : null;
  const reply = code
    ? ` Reply YES ${code} to accept, NO ${code} to decline, PART ${code} for partial.`
    : " Open the Staffly app to respond.";

  return fitOneSegment(
    {
      dept: toGsm7(shift.departmentName),
      role: toGsm7(shift.roleNeeded),
      unit: toGsm7(shift.unit),
    },
    (f) => `Staffly: ${f.dept} needs ${f.role}, Unit ${f.unit}, ${when}.${reply}`,
    [
      { field: "role", replace: roleAbbreviation },
      { field: "dept", min: 12 },
      { field: "unit", min: 4 },
      { field: "role", min: 10 },
      { field: "dept", min: 4 },
    ]
  );
}

/** A one-segment GSM-7 reply to an inbound text, naming the shift if it fits. */
function replyWithShift(prefix: string, title: string, suffix: string): string {
  return fitOneSegment(
    { title: toGsm7(title) },
    (f) => toGsm7(`${prefix}${f.title}${suffix}`),
    [{ field: "title", min: 8 }]
  );
}

/** Replies to inbound SMS. Every one is GSM-7 and a single segment. */
export const smsReplies = {
  unknown:
    "Sorry, we didn't understand that. Reply YES <code> to accept or NO <code> to decline, or open the Staffly app.",
  unknownSender: "We couldn't match your number to a Staffly account.",
  unknownCode: (code: string) =>
    toGsm7(`Shift code ${truncateGsm7(toGsm7(code), 12)} wasn't recognized.`),
  closed: "That shift is no longer accepting responses. Thanks for replying.",
  bidAccepted: (title: string, partial: boolean) =>
    replyWithShift(
      `Thanks! Your ${partial ? "partial-shift " : ""}bid for `,
      title,
      " is in. The scheduler will confirm."
    ),
  declined: (title: string) =>
    replyWithShift("Got it - you declined ", title, ". We won't contact you again about it."),
  declineNeedsCode:
    "You have more than one open callout. Reply NO <code> with the code from the text you want to decline.",
  declineNothingOpen: "You have no open callout to decline. Thanks for replying.",
} as const;

/** Words the IVR reads aloud before "press 1 to accept". */
export function voicePrompt(shift: OutreachShift): string {
  const when = formatShiftWhen(shift, " to ");
  return (
    `This is a Staffly callout. The ${shift.departmentName} department needs a ` +
    `${shift.roleNeeded} in unit ${shift.unit} on ${when}. ` +
    `Press 1 to accept this shift. Press 2 to decline.`
  );
}
