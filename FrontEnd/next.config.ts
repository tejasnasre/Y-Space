import type { NextConfig } from "next";

// Server-only (no NEXT_PUBLIC_ prefix) so the real API origin never reaches the browser bundle for REST calls.
const BACKEND_URL = process.env.BACKEND_URL?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_USE_API_PROXY: BACKEND_URL ? "1" : "" },
  async rewrites() {
    if (!BACKEND_URL) return [];
    return [
      { source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` },
      { source: "/health", destination: `${BACKEND_URL}/health` },
    ];
  },
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  allowedDevOrigins: ["192.168.1.17", "*.ngrok-free.app"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
