/**
 * Inngest's entry point into the app. Inngest calls this endpoint to introspect
 * and to run each step of the cascade.
 *
 * Credential-optional: with no Inngest keys nothing ever publishes an event, so
 * nothing ever calls this route. Registering it unconditionally keeps the build
 * and the route table identical with and without an Inngest account.
 *
 * Not in the NextAuth middleware matcher (which lists only /admin|/clerk|/worker
 * |/profile), so it stays reachable; Inngest authenticates itself with
 * INNGEST_SIGNING_KEY, which the serve handler enforces.
 */
import { serve } from "inngest/next";
import { getInngest } from "@/lib/inngest/client";
import { calloutCascadeFunction } from "@/lib/inngest/functions";

export const dynamic = "force-dynamic";

export const { GET, POST, PUT } = serve({
  client: getInngest(),
  functions: [calloutCascadeFunction()],
});
