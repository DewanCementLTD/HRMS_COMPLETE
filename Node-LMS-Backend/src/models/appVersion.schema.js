import { z } from "zod";

/**
 * Zod schemas for the /app/* routes (App Version / mobile update flow).
 *
 * Mirrors the FastAPI LMS-Backend routers/app_version_router.py.
 */

// GET /app/version-check
export const versionCheckSchema = z.object({
  query: z.object({
    platform: z.string().optional().default("ANDROID"), // ANDROID / IOS
    version: z.string().optional(), // e.g. 1.4.2
    build: z.coerce.number().int().optional(), // e.g. 48
  }),
});
