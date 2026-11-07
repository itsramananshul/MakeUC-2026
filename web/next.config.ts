import type { NextConfig } from "next";

const apiOrigin = process.env.AFTERMAP_API_ORIGIN;

const config: NextConfig = {
  agentRules: false,
  turbopack: { root: process.cwd() },
  devIndicators: false,
  async rewrites() {
    if (!apiOrigin) return [];
    const origin = new URL(apiOrigin);
    if (origin.protocol !== "https:" || origin.href !== origin.origin + "/") {
      throw new Error("AFTERMAP_API_ORIGIN must be an HTTPS origin.");
    }
    return {
      beforeFiles: [{
        source: "/api/:path*",
        destination: `${origin.origin}/api/:path*`,
      }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default config;
