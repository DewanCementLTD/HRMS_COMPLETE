import { z } from "zod";

/**
 * Zod validation schemas for the /reports/* endpoints.
 */

const adminQuery = { admin_card_no: z.string().min(1, "admin_card_no is required") };

// Common query schema for report filtering
export const reportQuerySchema = z.object({
  query: z.object({
    ...adminQuery,
    compc: z.string().optional(),
    brnch: z.string().optional(),
    desg_cd: z.string().optional(),
    dept_no: z.string().optional(),
    period: z.coerce.number().int().optional(),
    from_date: z.string().optional(),
    to_date: z.string().optional(),
    allowance_id: z.string().optional(),
    deduction_id: z.string().optional(),
    empcode: z.string().optional(),
  }),
});
