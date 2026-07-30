import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable React Strict Mode — it double-invokes renders in development,
  // which causes components to flash and makes state updates appear to loop.
  reactStrictMode: false,

  async rewrites() {
    // BACKEND_URL is the server-side proxy target — must be a locally
    // reachable address (not a public domain that loops through NAT).
    // The Node backend (Node-LMS-Backend) now serves every route the app uses,
    // including /payroll and /payroll-entry: payroll.routes.js and
    // payrollEntry.routes.js between them declare all 46 endpoints the web
    // client calls, with the same `{items: [...]}` response shapes.
    //
    // These two used to be split off to a legacy FastAPI backend on :8001.
    // That server is no longer run, so every payroll request 500'd at the
    // rewrite. A single catch-all is all that's needed now.
    const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8003";

    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
