import { z } from "zod";

/**
 * Zod schemas for the /hr/* routes (HR-admin gated).
 *
 * Mirrors the FastAPI LMS-Backend routers/hr_router.py + models/hr_models.py.
 *
 * NOTE: the validate() middleware runs `schema.parse(...)` which strips any
 * query/param key not declared here, so `admin_card_no` (read by the
 * requireHrAdmin middleware from res.locals.validated.query) MUST be present
 * in every query schema below.
 */

// GET /hr/employees/search
export const hrSearchEmployeesSchema = z.object({
  query: z.object({
    q: z.string().min(1, "q is required"),
    admin_card_no: z.string().min(1, "admin_card_no is required"),
  }),
});

// POST /hr/face/enroll  (mirrors HRFaceEnrollRequest)
export const hrFaceEnrollSchema = z.object({
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
  }),
  body: z.object({
    card_no: z.string().min(1, "card_no is required"),
    frames: z.array(z.string()).min(1, "frames is required"),
    created_at: z.string().optional(),
  }),
});
