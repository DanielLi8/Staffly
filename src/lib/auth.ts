import type { NextAuthOptions, Session } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { getServerSession } from "next-auth";
import type { Role } from "@prisma/client";
import type { Actor } from "./authz";
import { clearLoginFailures, isLoginThrottled, recordLoginFailure } from "./login-throttle";
import { LOGIN_THROTTLED } from "./throttle/policy";

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

/** The client address as the platform proxy reports it (Vercel sets x-forwarded-for). */
function clientIp(headers: Record<string, string | string[] | undefined> | undefined): string | null {
  const forwarded = headers?.["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || null;
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

        const email = credentials.email;
        const ip = clientIp(request.headers);
        // Thrown (not `return null`) so the form can say why: NextAuth hands the
        // message back as `error`.
        if (await isLoginThrottled(email, ip)) throw new Error(LOGIN_THROTTLED);

        const user = await db.user.findUnique({
          where: { email },
        });
        if (!user) {
          await recordLoginFailure(email, ip);
          return null;
        }

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) {
          await recordLoginFailure(email, ip);
          return null;
        }

        const portal = credentials.portalRole as Role | undefined;
        if (portal && user.role !== portal) {
          await recordLoginFailure(email, ip);
          return null;
        }

        await clearLoginFailures(email, ip);

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          remember: credentials.remember === "true",
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role: Role }).role;
        const remember = (user as { remember?: boolean }).remember === true;
        token.exp = Math.floor(Date.now() / 1000) + (remember ? 30 : 2) * 24 * 60 * 60;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
      }
      return session;
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
