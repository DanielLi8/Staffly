import { Role } from "@prisma/client";
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: Role;
    };
  }

  /** What `authorize` returns; only used to mint the token at sign-in. */
  interface User {
    id: string;
    role: Role;
    sessionVersion: number;
    remember?: boolean;
  }
}

declare module "next-auth/jwt" {
  /** See `src/lib/session-policy.ts`: no name, no email, ever. */
  interface JWT {
    id: string;
    role: Role;
    sessionVersion: number;
  }
}
