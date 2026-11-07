import type { NextConfig } from "next";
const config: NextConfig = {
  agentRules: false,
  turbopack: { root: process.cwd() },
  devIndicators: false,
};
export default config;
