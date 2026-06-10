import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable React Strict Mode — it double-invokes renders in development,
  // which causes components to flash and makes state updates appear to loop.
  reactStrictMode: false,

  async rewrites() {
    // BACKEND_URL is the server-side proxy target — must be a locally
    // reachable address (not a public domain that loops through NAT).
    const backendUrl =
      process.env.BACKEND_URL || "http://163.61.91.221:8001";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
