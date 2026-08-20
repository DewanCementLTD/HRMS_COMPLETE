import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable React Strict Mode — it double-invokes renders in development,
  // which causes components to flash and makes state updates appear to loop.
  reactStrictMode: false,

  async rewrites() {
    // BACKEND_URL is the server-side proxy target — must be a locally
    // reachable address (not a public domain that loops through NAT).
    // Node-LMS-Backend (port 8003) serves ALL the web app's /api/* calls:
    // auth, hr, hrms, payroll, payroll-entry, recruitment, documents, face,
    // location, reports, and more. It's started by start_all.bat and has all
    // endpoints including Reports which don't exist in FastAPI.
    // BACKEND_URL is configured in LMS-Web/.env and defaults to 127.0.0.1:8003.
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
