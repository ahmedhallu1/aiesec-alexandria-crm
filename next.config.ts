import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
