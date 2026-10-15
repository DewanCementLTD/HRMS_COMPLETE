import { z } from "zod";

/**
 * Zod schemas for the /pf/* (Provident Fund) routes.
 *
 * validate() strips undeclared keys, so `admin_card_no` (read by
 * requireHrAdmin) must be in every query schema. Dates are YYYY-MM-DD; a
 * financial year is identified by its 1st of July (fy_from).
 */

const adminQuery = { admin_card_no: z.string().min(1, "admin_card_no is required"), compc: z.string().optional() };
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const fyStart = z.string().regex(/^\d{4}-07-01$/, "Use the 1st of July of the financial year, YYYY-07-01");
const boolish = z.preprocess((v) => (typeof v === "string" ? !["false", "0", "n", "no"].includes(v.toLowerCase()) : v), z.boolean());

// ── Settings ──

export const getSettingsSchema = z.object({ query: z.object(adminQuery) });

export const saveSettingsSchema = z.object({
  query: z.object(adminQuery),
  body: z.object({
    pf_ded_code: z.string().max(3).optional(),
    loan_codes: z.union([z.array(z.string()), z.string()]).optional(),
    loan_spread: z.coerce.number().min(0).optional(),
    zakat_rate: z.coerce.number().min(0).optional(),
  }),
});

// ── Profit rates ──

export const listRatesSchema = z.object({ query: z.object(adminQuery) });

export const saveRateSchema = z.object({
  query: z.object(adminQuery),
  body: z.object({
    fy_from: fyStart,
    profit_rate: z.coerce.number().min(0).lt(1, "profit_rate is a fraction, e.g. 0.0587 for 5.87%"),
    remarks: z.string().optional(),
  }),
});

export const deleteRateSchema = z.object({
  params: z.object({ fy_from: fyStart }),
  query: z.object(adminQuery),
});

// ── Take-on balances ──

export const listOpeningsSchema = z.object({
  query: z.object({ ...adminQuery, empcode: z.string().optional() }),
});

export const saveOpeningSchema = z.object({
  params: z.object({ empcode: z.string().min(1) }),
  query: z.object(adminQuery),
  body: z.object({
    as_of_fy: fyStart,
    emp_contrib: z.coerce.number().optional(),
    emp_profit: z.coerce.number().optional(),
    emp_deductions: z.coerce.number().optional(),
    co_contrib: z.coerce.number().optional(),
    co_profit: z.coerce.number().optional(),
    co_deductions: z.coerce.number().optional(),
    remarks: z.string().optional(),
  }),
});

export const deleteOpeningSchema = z.object({
  params: z.object({ empcode: z.string().min(1) }),
  query: z.object(adminQuery),
});

export const importOpeningsSchema = z.object({
  query: z.object(adminQuery),
  body: z.object({ as_of_fy: fyStart, overwrite: boolish.optional().default(false) }),
});

// ── Permanent withdrawals (loan type 16, read-only) ──

export const listWithdrawalsSchema = z.object({
  query: z.object({ ...adminQuery, empcode: z.string().optional() }),
});

// ── Statement / settlement / posting ──

export const statementSchema = z.object({
  query: z.object({ ...adminQuery, empcode: z.string().min(1, "empcode is required"), upto: dateStr.optional() }),
});

export const settlementSchema = z.object({
  query: z.object({ ...adminQuery, empcode: z.string().min(1, "empcode is required"), upto: dateStr.optional() }),
});

// ── Zakat exemption ──

export const listZakatSchema = z.object({
  query: z.object({ ...adminQuery, empcode: z.string().optional() }),
});

export const saveZakatSchema = z.object({
  params: z.object({ empcode: z.string().min(1) }),
  query: z.object(adminQuery),
  body: z.object({
    zakat_exempt: boolish,
    decl_date: dateStr.optional(),
    decl_ref: z.string().max(50).optional(),
    remarks: z.string().max(200).optional(),
  }),
});

export const postYearSchema = z.object({
  query: z.object(adminQuery),
  body: z.object({ fy_from: fyStart }),
});
