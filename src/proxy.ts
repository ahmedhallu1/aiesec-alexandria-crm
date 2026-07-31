import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { authConfig } from "@/lib/auth.config";

/** Route protection (Next 16 "proxy" convention). Uses the edge-safe auth
 *  config; unauthenticated requests are redirected to /login. */
const { auth } = NextAuth(authConfig);

export default function proxy(request: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (auth as any)(request);
}

export const config = {
  matcher: [
    // Everything except auth endpoints, the login page, cron endpoints,
    // the public IR-call booking page, static assets, brand images, PWA
    // files and .well-known
    "/((?!api/auth|api/cron|login|inactive|book|_next/static|_next/image|favicon.ico|icons|brand|manifest.webmanifest|\\.well-known).*)",
  ],
};
