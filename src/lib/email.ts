import { Resend } from "resend";

const FROM = process.env.EMAIL_FROM ?? "Staffly <noreply@staffly.com>";

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

// Construct the client lazily: the Resend constructor throws without a key, so
// building it eagerly would crash any module that imports this one in the
// credential-free demo. Built only when a key is present.
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set — skipping email send.");
    return;
  }

  try {
    await resend.emails.send({
      from: FROM,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    });
  } catch (err) {
    // Email failure must never break the calling flow
    console.error("[email] Send failed:", err);
  }
}

export function newShiftEmailHtml(opts: {
  workerName: string;
  shiftTitle: string;
  unit: string;
  date: string;
  appUrl: string;
}): string {
  return `
    <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; color: #1A202C;">
      <div style="background: #003087; padding: 24px 32px;">
        <h1 style="color: white; margin: 0; font-size: 20px;">Staffly</h1>
        <p style="color: #A9BFEB; margin: 4px 0 0;">Callout Coverage Platform</p>
      </div>
      <div style="padding: 32px; background: #F8FAFC;">
        <h2 style="color: #003087; margin-top: 0;">New Shift Available</h2>
        <p>Hi ${opts.workerName},</p>
        <p>A new callout shift is available and you're eligible to bid:</p>
        <div style="background: white; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #003087;">
          <strong>${opts.shiftTitle}</strong><br/>
          <span style="color: #64748B;">Unit ${opts.unit} · ${opts.date}</span>
        </div>
        <a href="${opts.appUrl}/worker/shifts"
           style="display: inline-block; background: #003087; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
          View &amp; Bid Now
        </a>
        <p style="color: #64748B; font-size: 13px; margin-top: 32px;">
          You received this because you are registered on Staffly as a worker.
        </p>
      </div>
    </div>
  `;
}

export function assignmentEmailHtml(opts: {
  workerName: string;
  shiftTitle: string;
  date: string;
  selected: boolean;
  appUrl: string;
}): string {
  const colour = opts.selected ? "#003087" : "#64748B";
  const heading = opts.selected ? "You've Been Assigned!" : "Shift Filled";
  const body = opts.selected
    ? `Congratulations! You were selected for the <strong>${opts.shiftTitle}</strong> shift on ${opts.date}.`
    : `Another worker was selected for the <strong>${opts.shiftTitle}</strong> shift on ${opts.date}. Thank you for bidding.`;

  return `
    <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; color: #1A202C;">
      <div style="background: #003087; padding: 24px 32px;">
        <h1 style="color: white; margin: 0; font-size: 20px;">Staffly</h1>
      </div>
      <div style="padding: 32px; background: #F8FAFC;">
        <h2 style="color: ${colour}; margin-top: 0;">${heading}</h2>
        <p>Hi ${opts.workerName},</p>
        <p>${body}</p>
        <a href="${opts.appUrl}/worker/my-bids"
           style="display: inline-block; background: ${colour}; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
          View My Bids
        </a>
      </div>
    </div>
  `;
}
