import { z } from "zod";

// Setup → Holidays. `admin_card_no` must be declared on every query: the
// validate() middleware strips undeclared keys and requireHrAdmin reads it.

const scopeQuery = z.object({
  admin_card_no: z.string().min(1, "admin_card_no is required"),
  compc: z.string().optional(),
  // The admin's active branch: when set, only that branch is offered / listed.
  brnch: z.string().optional(),
});

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

export const holidayScopeSchema = z.object({ query: scopeQuery });

export const holidaySaveSchema = z.object({
  query: scopeQuery,
  body: z.object({
    holiday_from: ymd,
    holiday_to: ymd.optional(),
    reason: z.string().min(1, "Reason is required").max(100),
    branches: z.array(z.union([z.string(), z.number()]).transform(String)).min(1, "Select at least one branch"),
  }),
});

export const holidayUpdateSchema = holidaySaveSchema.extend({
  params: z.object({ id: z.coerce.number().int().positive() }),
});

export const holidayDeleteSchema = z.object({
  query: scopeQuery,
  params: z.object({ id: z.coerce.number().int().positive() }),
});
