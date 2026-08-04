import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stop advertising the framework — free reconnaissance for anyone scanning.
  poweredByHeader: false,

  /** Security headers (v33 audit).
   *
   *  Deliberately WITHOUT a full Content-Security-Policy for now: this app
   *  loads Google avatars, DiceBear, Supabase and Google APIs, and a wrong
   *  `script-src` would white-screen the whole CRM for 70 people. The headers
   *  below are the ones that carry real protection with zero breakage risk;
   *  `frame-ancestors` alone closes clickjacking, which is what a CRM behind a
   *  login actually needs. A full CSP is tracked as a follow-up. */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // clickjacking: nobody may frame this app, anywhere
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
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
  // the Proposal email action reads proposals/<product>.pdf at runtime
  outputFileTracingIncludes: {
    "/**": ["./proposals/**"],
  },
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
