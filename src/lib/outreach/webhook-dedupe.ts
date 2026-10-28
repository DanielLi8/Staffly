import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Handle an inbound Twilio webhook at most once per provider id. Twilio
 * signatures carry no timestamp or nonce, so anyone holding one signed request
 * (a proxy log, a debugging dump) could resend it - re-creating a bid the
 * worker since withdrew. The first delivery claims `key` in `ProcessedWebhook`
 * and stores the TwiML it answered with; a repeat gets that same TwiML back
 * and changes nothing. Twilio's own retries of a request we answered are
 * covered the same way.
 *
 * Call only AFTER `readVerifiedTwilioForm` succeeds: an unsigned request must
 * never claim a key. A request with no provider id (`key` null) is handled
 * normally.
 */
export async function handleWebhookOnce(key: string | null, handle: () => Promise<string>): Promise<string> {
  if (!key) return handle();

  try {
    await db.processedWebhook.create({ data: { key } });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
    const previous = await db.processedWebhook.findUnique({ where: { key }, select: { response: true } });
    // Null while the first delivery is still being handled: answer with an
    // empty response rather than act twice.
    return previous?.response ?? EMPTY_TWIML;
  }

  let response: string;
  try {
    response = await handle();
  } catch (err) {
    // Release the claim so Twilio's retry of a failed delivery is handled.
    await db.processedWebhook.delete({ where: { key } }).catch(() => undefined);
    throw err;
  }
  await db.processedWebhook.update({ where: { key }, data: { response } });
  return response;
}

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';
