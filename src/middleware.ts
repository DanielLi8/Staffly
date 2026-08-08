import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";

/** The landing area for each role after login / when redirected off a foreign area. */
function homeFor(role: Role | undefined): string {
  if (role === "SCHEDULER") return "/admin";
  if (role === "UNIT_CLERK") return "/clerk";
  return "/worker/shifts";
}

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const role = req.nextauth.token?.role as Role | undefined;

    // /admin is the merged scheduler + admin area.
    if (pathname.startsWith("/admin") && role !== "SCHEDULER") {
      return NextResponse.redirect(new URL(homeFor(role), req.url));
    }

    // /clerk is the read-only, department-scoped unit clerk area.
    if (pathname.startsWith("/clerk") && role !== "UNIT_CLERK") {
      return NextResponse.redirect(new URL(homeFor(role), req.url));
    }

    // The worker area (open shifts, bidding) is for staff; schedulers may preview
    // it, but a unit clerk must never reach it - it would expose other departments.
    if (pathname.startsWith("/worker") && role === "UNIT_CLERK") {
      return NextResponse.redirect(new URL(homeFor(role), req.url));
    }

    return NextResponse.next();
  },
  {
    secret: process.env.NEXTAUTH_SECRET,
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: ["/admin/:path*", "/clerk/:path*", "/worker/:path*", "/profile"],
};
