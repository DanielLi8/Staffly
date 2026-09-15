import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { adminRouteRedirect, VIEW_MODE_COOKIE } from "@/lib/view-mode";

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const role = req.nextauth.token?.role as Role | undefined;
    const viewModeCookie = req.cookies.get(VIEW_MODE_COOKIE)?.value;

    // /admin is the merged scheduler + admin area. Blocks STAFF outright, and
    // blocks an ADMIN whose persisted "view as" toggle is currently WORKER -
    // the toggle is the only way back in, not a raw URL.
    const redirectTo = adminRouteRedirect(pathname, role, viewModeCookie);
    if (redirectTo) {
      return NextResponse.redirect(new URL(redirectTo, req.url));
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
  matcher: ["/admin/:path*", "/worker/:path*", "/profile"],
};
