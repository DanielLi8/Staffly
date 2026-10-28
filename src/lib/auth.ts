import type { NextAuthOptions, Session } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { getServerSession } from "next-auth";
import { encode } from "next-auth/jwt";
import type { JWT } from "next-auth/jwt";
import type { Role } from "@prisma/client";
import type { Actor } from "./authz";
import { loginThrottle } from "./login-throttle";
import {
  REMEMBER_ME_MAX_AGE_SECONDS,
  SessionRevokedError,
  issueSessionClaims,
  readSessionClaims,
  sessionRevocationReason,
} from "./session-policy";

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Name/email for the session callback, keyed by the token object the `jwt`
 * callback returns (NextAuth hands that same object straight to `session`),
 * so one DB read per request covers both revocation and display. The token
 * itself never carries them - see `session-policy.ts`.
 */
const sessionProfiles = new WeakMap<object, { name: string; email: string }>();

// Fail fast with an actionable message. Left to NextAuth's own handling, a
// missing/empty secret doesn't crash - it silently auto-derives a dev secret
// that differs between the API route bundle and the page bundle in the App
// Router, so a login appears to succeed and then silently fails to survive
// the first navigation (bounced back to /login, no error). Never rely on
// that fallback here.
if (!process.env.NEXTAUTH_SECRET) {
  throw new Error(
    "NEXTAUTH_SECRET is not set. Generate one with `openssl rand -base64 32` and set it in .env - see .env.example."
  );
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        portalRole: { label: "Portal role", type: "text" },
        remember: { label: "Remember", type: "text" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;

        const forwardedFor = request.headers?.["x-forwarded-for"]?.split(",")[0]?.trim();
        const key = `${forwardedFor || "unknown"}:${credentials.email.toLowerCase()}`;
        if (!loginThrottle.isAllowed(key)) return null;

        const user = await db.user.findUnique({
          where: { email: credentials.email },
        });
        if (!user) {
          loginThrottle.recordFailure(key);
          return null;
        }

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) {
          loginThrottle.recordFailure(key);
          return null;
        }

        const portal = credentials.portalRole as Role | undefined;
        if (portal && user.role !== portal) {
          loginThrottle.recordFailure(key);
          return null;
        }

        // Same generic failure as a wrong password: never confirm to a
        // stranger that an account exists but is deactivated.
        if (user.deactivatedAt) {
          loginThrottle.recordFailure(key);
          return null;
        }

        loginThrottle.reset(key);

        return {
          id: user.id,
          role: user.role,
          sessionVersion: user.sessionVersion,
          remember: credentials.remember === "true",
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    // The longest a session can live. Each token's real end is its own `exp`
    // (12 h or 7 d from sign-in), which `encode` below keeps fixed, and the auth
    // route handler sets the cookie's expiry to match per request.
    maxAge: REMEMBER_ME_MAX_AGE_SECONDS,
  },
  jwt: {
    // NextAuth's encode re-stamps `exp = now + maxAge` on every refresh, which
    // would make every session rolling and as long as `maxAge`. Keep the
    // absolute end chosen at sign-in instead.
    async encode(params) {
      const exp = params.token?.exp;
      if (typeof exp !== "number") return encode(params);
      return encode({ ...params, maxAge: Math.max(0, exp - nowSeconds()) });
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        return { ...issueSessionClaims(user, user.remember === true, nowSeconds()) };
      }

      // Every later request re-checks the account, so deactivation, a role
      // change or a bumped sessionVersion takes effect on the next request.
      const claims = readSessionClaims(token);
      if (!claims) throw new SessionRevokedError("MALFORMED");
      const current = await db.user.findUnique({
        where: { id: claims.id },
        select: { role: true, sessionVersion: true, deactivatedAt: true, name: true, email: true },
      });
      const reason = sessionRevocationReason(claims, current, nowSeconds());
      if (reason) throw new SessionRevokedError(reason);

      // A fresh object: drops anything else an older token carried.
      const next: JWT = { ...claims };
      sessionProfiles.set(next, { name: current!.name, email: current!.email });
      return next;
    },
    async session({ session, token }) {
      const profile =
        sessionProfiles.get(token) ??
        (await db.user.findUnique({ where: { id: token.id }, select: { name: true, email: true } }));
      session.user = {
        id: token.id,
        role: token.role,
        name: profile?.name ?? "",
        email: profile?.email ?? "",
      };
      return session;
    },
  },
  logger: {
    // A revoked session is routine (signed out, demoted, deactivated), not an
    // error worth a stack trace on every request it is presented.
    error(code, metadata) {
      if (metadata instanceof SessionRevokedError) return;
      console.error(`[next-auth][error][${code}]`, metadata);
    },
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export async function getSession(): Promise<Session | null> {
  return getServerSession(authOptions);
}

export async function requireAuth(role?: Role): Promise<Session> {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("UNAUTHORIZED");
  }
  if (role && session.user.role !== role) {
    throw new Error("FORBIDDEN");
  }
  return session;
}

/** Build the typed {@link Actor} used by the authorization layer from a session. */
export function actorFromSession(session: Session): Actor {
  return {
    id: session.user.id,
    role: session.user.role,
  };
}

/** Require a signed-in user (optionally of `role`) and return them as an {@link Actor}. */
export async function requireActor(role?: Role): Promise<Actor> {
  const session = await requireAuth(role);
  return actorFromSession(session);
}
