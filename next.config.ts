import type { NextConfig } from "next";

/** THE CONTENT-SECURITY-POLICY (v33 audit, F-08).
 *
 *  Every host below is one this app actually talks to, enumerated from the
 *  source rather than guessed:
 *    dicebear + googleusercontent  member avatars
 *    supabase.co                   the database and signed storage URLs
 *    generativelanguage / googleapis  The Blue Man, Sheets, Drive, Gmail, Calendar
 *    podio.com                     the automatic "does this company exist" check
 *    core.aiesec.org.eg            the CORE analytics digest
 *    googletagmanager / g-analytics  optional GA, only when the env var is set
 *    docs.google.com               the B2C contract form, opened in a frame/tab
 *
 *  `script-src` keeps 'unsafe-inline' because Next.js App Router injects inline
 *  bootstrap and hydration scripts; removing it needs a nonce threaded through
 *  middleware, and getting that wrong white-screens the CRM for 70 people. The
 *  policy still blocks the thing that matters most — loading attacker-hosted
 *  script from any other origin — and `object-src 'none'`, `base-uri 'self'`
 *  and `form-action 'self'` close plugin injection, base-tag hijacking and
 *  form exfiltration outright. */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://api.dicebear.com https://*.googleusercontent.com https://*.supabase.co https://files.podio.com https://www.google-analytics.com",
  "font-src 'self' data:",
  [
    "connect-src 'self'",
    "https://*.supabase.co",
    "https://generativelanguage.googleapis.com",
    "https://www.googleapis.com",
    "https://podio.com",
    "https://core.aiesec.org.eg",
    "https://www.google-analytics.com",
    "https://va.vercel-scripts.com",
  ].join(" "),
  "frame-src 'self' https://docs.google.com",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  // no plugins, no <base> hijacking, no posting this app's forms elsewhere
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  // Stop advertising the framework — free reconnaissance for anyone scanning.
  poweredByHeader: false,

  /** Security headers (v33 audit). */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Frame-Options", value: "DENY" },
          // stop MIME sniffing turning an upload into executable content
          { key: "X-Content-Type-Options", value: "nosniff" },
          // never leak a CRM URL (which carries account slugs) to third parties
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // the app needs none of these; deny them by default
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
          },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
      {
        // authenticated pages must never be cached by a shared proxy
        source: "/((?!_next/static|_next/image|brand|icons).*)",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  // NO `outputFileTracingIncludes` for proposals/ (v36.1): "/**" copied 38 MB
  // of PDF into every function of every deployment and filled the team's
  // 10 GB Function Storage. The decks are read from Supabase Storage instead.
  experimental: {
    serverActions: {
      // IR-call screenshots travel base64 inside the action body (~4.27 MB
      // for the 3.2 MB server cap) — Next's 1 MB default would reject them.
      // Vercel's own hard request cap is 4.5 MB; stay just under it.
      bodySizeLimit: "4.5mb",
    },
  },
};

export default nextConfig;
