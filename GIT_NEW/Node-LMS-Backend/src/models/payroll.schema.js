import { z } from "zod";

/**
 * Zod schemas for the /payroll/* routes.
 *
 * NOTE: the validate() middleware runs `schema.parse(...)` which strips any
 * query/param key not declared here, so `admin_card_no` (read by the
 * requireHrAdmin middleware from res.locals.validated.query) MUST be present
 * in every query schema below.
 *
 * Body shapes mirror models/payroll_models.py (Pydantic) field-for-field —
 * FastAPI does almost no extra validation beyond type coercion here, so these
 * stay permissive to match (no tightened constraints beyond what FastAPI has).
 */

const adminQuery = { admin_card_no: z.string().min(1, "admin_card_no is required") };

// ── Pay Register ──

export const payRegisterPeriodsSchema = z.object({
  query: z.object({
    ...adminQuery,
    compc: z.string().optional(),
    rule_id: z.coerce.number().int().optional(),
  }),
});

export const payRegisterSchema = z.object({
  query: z.object({
    ...adminQuery,
    period: z.coerce.number().int(),
    compc: z.string().optional(),
    location: z.string().optional(),
    dept_no: z.string().optional(),
    desg_cd: z.string().optional(),
    empcode: z.string().optional(),
  }),
});

// ── Period Opening ──

export const listFinancialYearsSchema = z.object({
  query: z.object({ ...adminQuery, compc: z.string().optional() }),
});

const financialYearBody = {
  from_date: z.string().min(1, "from_date is required"),
  to_date: z.string().min(1, "to_date is required"),
  scode: z.string().optional(),
  descr: z.string().optional(),
  rate: z.coerce.number().optional(),
  intrst: z.coerce.number().optional(),
  filer: z.coerce.number().optional(),
  nonfiler: z.coerce.number().optional(),
  auto_periods: z.boolean().optional().default(true),
};

export const createFinancialYearSchema = z.object({
  query: z.object({ ...adminQuery, compc: z.string().optional() }),
  body: z.object(financialYearBody),
});

export const updateFinancialYearSchema = z.object({
  params: z.object({ rule_id: z.coerce.number().int() }),
  query: z.object(adminQuery),
  body: z.object(financialYearBody),
});

const statusBody = {
  status: z.string().optional(),
  block: z.string().optional(),
};

export const financialYearStatusSchema = z.object({
  params: z.object({ rule_id: z.coerce.number().int() }),
  query: z.object(adminQuery),
  body: z.object(statusBody),
});

export const listPeriodsSchema = z.object({
  query: z.object({
    ...adminQuery,
    compc: z.string().optional(),
    rule_id: z.coerce.number().int().optional(),
  }),
});

const periodBody = {
  rule_id: z.coerce.number().int().optional(),
  period_frm: z.string().min(1, "period_frm is required"),
  period_to: z.string().min(1, "period_to is required"),
  scode: z.string().optional(),
};

export const createPeriodSchema = z.object({
  query: z.object({ ...adminQuery, compc: z.string().optional() }),
  body: z.object(periodBody),
});

export const periodStatusSchema = z.object({
  params: z.object({ period: z.coerce.number().int() }),
  query: z.object(adminQuery),
  body: z.object(statusBody),
});

// ── Tax Slabs (global) ──

export const listTaxMastersSchema = z.object({ query: z.object(adminQuery) });

const taxMasterBody = {
  tax_desc: z.string(),
  fyear: z.string().optional(),
};

export const createTaxMasterSchema = z.object({
  query: z.object(adminQuery),
  body: z.object(taxMasterBody),
});

export const taxMasterStatusSchema = z.object({
  params: z.object({ tax_id: z.coerce.number().int() }),
  query: z.object(adminQuery),
  body: z.object(statusBody),
});

export const deleteTaxMasterSchema = z.object({
  params: z.object({ tax_id: z.coerce.number().int() }),
  query: z.object(adminQuery),
});

export const listTaxDetailsSchema = z.object({
  params: z.object({ tax_id: z.coerce.number().int() }),
  query: z.object(adminQuery),
});

const taxDetailBody = {
  slab_from: z.coerce.number().optional(),
  slab_to: z.coerce.number().optional(),
  slab_rate: z.coerce.number().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  slab_ded: z.coerce.number().optional(),
  fixed_tax: z.coerce.number().optional(),
};

export const addTaxDetailSchema = z.object({
  params: z.object({ tax_id: z.coerce.number().int() }),
  query: z.object(adminQuery),
  body: z.object(taxDetailBody),
});

export const deleteTaxDetailSchema = z.object({
  params: z.object({ tax_id: z.coerce.number().int(), srno: z.coerce.number().int() }),
  query: z.object(adminQuery),
});

// ── Loans ──

export const listLoanTypesSchema = z.object({ query: z.object(adminQuery) });

const loanTypeBody = { loan_desc: z.string() };

export const createLoanTypeSchema = z.object({
  query: z.object(adminQuery),
  body: z.object(loanTypeBody),
});

export const deleteLoanTypeSchema = z.object({
  params: z.object({ loan_cd: z.string().min(1, "loan_cd is required") }),
  query: z.object(adminQuery),
});

export const listLoansSchema = z.object({
  query: z.object({ ...adminQuery, compc: z.string().optional(), empcode: z.string().optional() }),
});

const loanBody = {
  empcode: z.string().optional(),
  loan_cd: z.string().optional(),
  loan_date: z.string().optional(),
  loan_amt: z.coerce.number().optional(),
  instalment_amt: z.coerce.number().optional(),
  nof_instalment: z.coerce.number().int().optional(),
  start_dt: z.string().optional(),
  charge_int: z.string().optional(),
  int_rate: z.coerce.number().optional(),
  chq_no: z.string().optional(),
  chq_dt: z.string().optional(),
  remarks: z.string().optional(),
};

export const createLoanSchema = z.object({
  query: z.object({ ...adminQuery, compc: z.string().optional() }),
  body: z.object(loanBody),
});

export const updateLoanSchema = z.object({
  params: z.object({ doc: z.coerce.number().int() }),
  query: z.object(adminQuery),
  body: z.object(loanBody),
});

export const deleteLoanSchema = z.object({
  params: z.object({ doc: z.coerce.number().int() }),
  query: z.object({ ...adminQuery, compc: z.string().optional() }),
});

// ── Salary / Payslips (read-only) ──

export const salaryPeriodsSchema = z.object({
  query: z.object({ ...adminQuery, compc: z.string().optional(), brnch: z.string().optional() }),
});

export const salarySheetSchema = z.object({
  query: z.object({
    ...adminQuery,
    period: z.coerce.number().int(),
    compc: z.string().optional(),
    brnch: z.string().optional(),
    q: z.string().optional(),
  }),
});

export const salaryPayslipSchema = z.object({
  query: z.object({
    ...adminQuery,
    empcode: z.string().min(1, "empcode is required"),
    period: z.coerce.number().int(),
    compc: z.string().optional(),
  }),
});

export const salaryOpenPeriodSchema = z.object({
  query: z.object({ ...adminQuery, compc: z.string().optional() }),
});

export const salaryProcessSchema = z.object({
  query: z.object({ ...adminQuery, compc: z.string().optional() }),
});

// GET /payroll/salary/process-state — drives which buttons a period offers.
export const salaryProcessStateSchema = z.object({
  query: z.object({
    ...adminQuery,
    compc: z.string().optional(),
    period: z.string().min(1, "period is required"),
  }),
});

// POST /payroll/salary/process-final
// The password travels in the BODY, never the query string: query strings are
// written to the access log and kept in browser history.
export const salaryProcessFinalSchema = z.object({
  query: z.object({ ...adminQuery, compc: z.string().optional() }),
  body: z.object({
    period: z.union([z.string(), z.number()]),
    password: z.string().min(1, "Enter the payroll password"),
  }),
});
