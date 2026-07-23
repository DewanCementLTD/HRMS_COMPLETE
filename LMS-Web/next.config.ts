import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable React Strict Mode — it double-invokes renders in development,
  // which causes components to flash and makes state updates appear to loop.
  reactStrictMode: false,

  async rewrites() {
    // BACKEND_URL is the server-side proxy target — must be a locally
    // reachable address (not a public domain that loops through NAT).
    // It now points at the Node backend (Node-LMS-Backend), which serves every
    // route the app uses EXCEPT payroll.
    const backendUrl =
      process.env.BACKEND_URL || "http://127.0.0.1:8003";

    // Payroll and payroll-entry (46 endpoints) are not ported to Node yet, so
    // they keep going to the legacy FastAPI backend. Delete the two payroll
    // rules below — and this variable — once Node serves /payroll* itself.
    const legacyUrl =
      process.env.LEGACY_BACKEND_URL || "http://127.0.0.1:8001";

    // Order matters: rewrites match top-down, and "/api/payroll/:path*" does
    // NOT match "/api/payroll-entry/...", so each needs its own rule and both
    // must sit above the catch-all.
    return [
      {
        source: "/api/payroll-entry/:path*",
        destination: `${legacyUrl}/payroll-entry/:path*`,
      },
      {
        source: "/api/payroll/:path*",
        destination: `${legacyUrl}/payroll/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
