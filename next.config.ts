import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the Proposal email action reads proposals/<product>.pdf at runtime
  outputFileTracingIncludes: {
    "/**": ["./proposals/**"],
  },
};

export default nextConfig;
