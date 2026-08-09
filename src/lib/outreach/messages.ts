/**
 * Message content for SMS and voice. Deliberately limited to department, role,
 * and date/time - NO patient/clinical detail (never the shift's `notes`). Pure
 * string builders so they are trivially testable.
 */
import { format } from "date-fns";
import type { OutreachShift } from "./types";

export function formatShiftWhen(shift: Pick<OutreachShift, "startsAt" | "endsAt">): string {
  const day = format(shift.startsAt, "EEE MMM d");
  const start = format(shift.startsAt, "h:mm a");
  const end = format(shift.endsAt, "h:mm a");
  return `${day}, ${start}–${end}`;
}

/** SMS body: dept, role, time, and how to accept via reply code. */
export function smsBody(shift: OutreachShift): string {
  const when = formatShiftWhen(shift);
  const base = `Staffly: ${shift.departmentName} needs a ${shift.roleNeeded} (Unit ${shift.unit}) on ${when}.`;
  if (!shift.smsCode) {
    return `${base} Open the app to bid.`;
  }
  return `${base} Reply YES ${shift.smsCode} to accept, or PART ${shift.smsCode} to offer a partial shift.`;
}

/** Words the IVR reads aloud before "press 1 to accept". */
export function voicePrompt(shift: OutreachShift): string {
  const when = formatShiftWhen(shift);
  return (
    `This is a Staffly callout. The ${shift.departmentName} department needs a ` +
    `${shift.roleNeeded} in unit ${shift.unit} on ${when}. ` +
    `Press 1 to accept this shift. Press 2 to decline.`
  );
}
