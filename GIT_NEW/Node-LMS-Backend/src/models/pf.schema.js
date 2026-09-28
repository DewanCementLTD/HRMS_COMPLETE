import { z } from "zod";
import { pyFloat } from "../utils/pydanticTypes.js";

/**
 * Zod schemas for the Provident Fund routes.
 *
 * HR routes (/pf/*): admin_card_no MUST be declared in every query schema —
 * validate() strips undeclared keys and requireHrAdmin reads it from there.
 * Employee route (/auth/pf/:card_no): the card must be the bearer token's own,
 * which requireEmployee enforces.
 */

const hrQuery = {
  admin_card_no: z.string().min(1, "admin_card_no is required"),
  compc: z.string().optional(),
  brnch: z.string().optional(),
};

export const pfSummarySchema = z.object({ query: z.object(hrQuery) });

export const pfMembersSchema = z.object({
  query: z.object({
    ...hrQuery,
    scope: z.enum(["members", "all"]).optional(),
    q: z.string().optional(),
  }),
});

export const pfLoansSchema = z.object({ query: z.object(hrQuery) });

export const pfStatementSchema = z.object({
  params: z.object({ empcode: z.string().min(1) }),
  query: z.object(hrQuery),
});

export const pfOpeningSchema = z.object({
  params: z.object({ empcode: z.string().min(1) }),
  query: z.object(hrQuery),
  body: z.object({ amount: pyFloat().refine((v) => v >= 0, "Amount cannot be negative") }),
});

export const pfMembershipSchema = z.object({
  params: z.object({ empcode: z.string().min(1) }),
  query: z.object(hrQuery),
  body: z.object({
    pf_ind: z.enum(["Y", "N"]),
    member_since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional().nullable(),
  }),
});

export const myPfSchema = z.object({
  params: z.object({ card_no: z.string().min(1, "card_no is required") }),
});
