import { z } from "zod";

/**
 * Zod schemas for the /payroll-entry/* routes.
 *
 * NOTE: the validate() middleware runs `schema.parse(...)` which strips any
 * query/param key not declared here, so `admin_card_no` (read by the
 * requireHrAdmin middleware from res.locals.validated.query) MUST be present
 * in every query schema below.
 *
 * Several DELETE routes here take their target key as QUERY params, not path
 * params (loan-recoveries, allowances, deductions, absent-days) — this is a
 * deliberate deviation from every other DELETE route in the Node codebase,
 * required for 1:1 parity with FastAPI's payroll_entry_router.py, which
 * declares e.g. `def del_loan_recovery(admin_card_no, rowid: str = Query(...))`
 * with no path segment. Do not "fix" these to use :id path params.
 */

const adminQuery = { admin_card_no: z.string().min(1, "admin_card_no is required") };

// Optional payroll period. Omitted = the company's open period (previous
// behaviour). Reads accept any period; writes still require it to be open.
const periodQuery = { period: z.coerce.number().int().optional() };

// ── Open periods / LOVs ──

export const openPeriodsSchema = z.object({
  query: z.object({ ...adminQuery, compc: z.string().optional() }),
});

export const entryPeriodsSchema = z.object({
  query: z.object({ ...adminQuery, compc: z.string().optional() }),
});

export const recoveryTypesSchema = z.object({ query: z.object(adminQuery) });

export const allowanceTypesSchema = z.object({ query: z.object(adminQuery) });

export const deductionTypesSchema = z.object({
  query: z.object({ ...adminQuery, compc: z.string().optional() }),
});

// ── Loan recovery ──

export const recoverableLoansSchema = z.object({
  query: z.object({ ...adminQuery, compc: z.string().optional(), brnch: z.string().optional() }),
});

export const loanRecoveriesSchema = z.object({
  query: z.object({
    ...adminQuery,
    compc: z.string().optional(),
    brnch: z.string().optional(),
    doc: z.coerce.number().int().optional(),
  }),
});

const loanRecoveryBody = {
  doc: z.coerce.number().int(),
  recovery_type: z.string().optional().default("C"),
  recovered_amt: z.coerce.number(),
  remarks: z.string().optional(),
  int_rate_rec: z.coerce.number().optional(),
};

export const createLoanRecoverySchema = z.object({
  query: z.object({ ...adminQuery, ...periodQuery, compc: z.string().optional() }),
  body: z.object(loanRecoveryBody),
});

export const deleteLoanRecoverySchema = z.object({
  query: z.object({ ...adminQuery, rowid: z.string().min(1, "rowid is required"), compc: z.string().optional() }),
});

// ── Monthly allowances ──

export const monthlyAllowancesSchema = z.object({
  query: z.object({
    ...adminQuery, ...periodQuery, compc: z.string().optional(), brnch: z.string().optional(), empcode: z.string().optional(),
  }),
});

const monthlyAllowanceBody = {
  empcode: z.string().min(1, "empcode is required"),
  allowance_id: z.string().min(1, "allowance_id is required"),
  amount: z.coerce.number(),
  ot_hour: z.coerce.number().optional(),
  remarks: z.string().optional(),
};

export const createMonthlyAllowanceSchema = z.object({
  query: z.object({ ...adminQuery, ...periodQuery, compc: z.string().optional() }),
  body: z.object(monthlyAllowanceBody),
});

export const deleteMonthlyAllowanceSchema = z.object({
  query: z.object({
    ...adminQuery, ...periodQuery,
    empcode: z.string().min(1, "empcode is required"),
    allowance_id: z.string().min(1, "allowance_id is required"),
    compc: z.string().optional(),
  }),
});

// ── Monthly deductions ──

export const monthlyDeductionsSchema = z.object({
  query: z.object({
    ...adminQuery, ...periodQuery, compc: z.string().optional(), brnch: z.string().optional(), empcode: z.string().optional(),
  }),
});

const monthlyDeductionBody = {
  empcode: z.string().min(1, "empcode is required"),
  deduction_id: z.string().min(1, "deduction_id is required"),
  amount: z.coerce.number(),
  remarks: z.string().optional(),
};

export const createMonthlyDeductionSchema = z.object({
  query: z.object({ ...adminQuery, ...periodQuery, compc: z.string().optional() }),
  body: z.object(monthlyDeductionBody),
});

export const deleteMonthlyDeductionSchema = z.object({
  query: z.object({
    ...adminQuery, ...periodQuery,
    empcode: z.string().min(1, "empcode is required"),
    deduction_id: z.string().min(1, "deduction_id is required"),
    compc: z.string().optional(),
  }),
});

// ── Absent days ──

export const absentDaysSchema = z.object({
  query: z.object({
    ...adminQuery, ...periodQuery, compc: z.string().optional(), brnch: z.string().optional(), empcode: z.string().optional(),
  }),
});

export const employeeAbsentDaysSchema = z.object({
  query: z.object({
    ...adminQuery, ...periodQuery, empcode: z.string().min(1, "empcode is required"), compc: z.string().optional(),
  }),
});

const absentDaysBody = {
  empcode: z.string().min(1, "empcode is required"),
  absent_days: z.coerce.number(),
};

export const createAbsentDaysSchema = z.object({
  query: z.object({ ...adminQuery, ...periodQuery, compc: z.string().optional() }),
  body: z.object(absentDaysBody),
});

export const deleteAbsentDaysSchema = z.object({
  query: z.object({
    ...adminQuery, ...periodQuery, empcode: z.string().min(1, "empcode is required"), compc: z.string().optional(),
  }),
});
