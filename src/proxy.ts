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
    // files and .well-known.
    //
    // `api/v1` is the read-only accounts endpoint (v34.2). It carries its own
    // auth — a named, revocable API key checked against a stored hash — so a
    // session redirect would only break it. It is NOT unauthenticated: see
    // src/app/api/v1/accounts/route.ts.
    //
    // THE METADATA ROUTES BELONG HERE TOO (v33.58). `icon.png` and
    // `apple-icon.png` are Next metadata files — public, static, and served
    // to every browser tab and every phone that installs the PWA. They were
    // not excluded, so each one woke the proxy: an auth check, a function
    // invocation, and a billable one, to decide that a favicon may be shown
    // to a stranger. They show up in the production logs by name.
    "/((?!api/auth|api/cron|api/v1|login|inactive|book|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|opengraph-image|icons|brand|manifest.webmanifest|robots.txt|sitemap.xml|\\.well-known).*)",
  ],
};
