import NextAuth from "next-auth";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { authOptions } from "@/lib/auth";
import { sessionLifetimeSeconds } from "@/lib/session-policy";

type RouteContext = { params: { nextauth: string[] } };

/**
 * How long the session cookie written by this request should live. NextAuth
 * sets the cookie's expiry from `session.maxAge`, a single static value, but
 * a session is 12 h or 7 d depending on "remember me" - so pass it per request:
 * at sign-in from the submitted form, afterwards from the token's own `exp`.
 */
async function cookieMaxAge(req: NextRequest, action: string | undefined): Promise<number> {
  if (req.method === "POST" && action === "callback") {
    const form = new URLSearchParams(await req.clone().text());
    return sessionLifetimeSeconds(form.get("remember") === "true");
  }
  const token = await getToken({ req, secret: authOptions.secret });
  if (typeof token?.exp === "number") {
    return Math.max(0, token.exp - Math.floor(Date.now() / 1000));
  }
  return sessionLifetimeSeconds(false);
}

async function handler(req: NextRequest, ctx: RouteContext) {
  const maxAge = await cookieMaxAge(req, ctx.params.nextauth?.[0]);
  return NextAuth(req, ctx, { ...authOptions, session: { ...authOptions.session, maxAge } });
}

export { handler as GET, handler as POST };
