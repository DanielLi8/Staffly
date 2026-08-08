import type { NextAuthOptions, Session } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { getServerSession } from "next-auth";
import type { Role } from "@prisma/client";
import type { Actor } from "./authz";

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
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await db.user.findUnique({
          where: { email: credentials.email },
        });
        if (!user) return null;

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) return null;

        const portal = credentials.portalRole as Role | undefined;
        if (portal && user.role !== portal) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          clerkDepartmentId: user.clerkDepartmentId,
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
        token.clerkDepartmentId =
          (user as { clerkDepartmentId?: string | null }).clerkDepartmentId ?? null;
        const remember = (user as { remember?: boolean }).remember === true;
        token.exp = Math.floor(Date.now() / 1000) + (remember ? 30 : 2) * 24 * 60 * 60;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.clerkDepartmentId = (token.clerkDepartmentId as string | null) ?? null;
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
    clerkDepartmentId: session.user.clerkDepartmentId ?? null,
  };
}

/** Require a signed-in user (optionally of `role`) and return them as an {@link Actor}. */
export async function requireActor(role?: Role): Promise<Actor> {
  const session = await requireAuth(role);
  return actorFromSession(session);
}
