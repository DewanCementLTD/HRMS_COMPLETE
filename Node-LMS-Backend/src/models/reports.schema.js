import { z } from "zod";

/**
 * Zod validation schemas for the /reports/* endpoints.
 *
 * One schema per report rather than a single permissive one, so the binds each
 * Oracle report actually requires (a period, a deduction code, an employee) are
 * rejected at the edge with the FastAPI-shaped 422 that validate.middleware.js
 * produces, instead of reaching the database as a NULL.
 *
 * `compc` / `brnch` are accepted here but are NOT trusted — the controller
 * re-resolves them against the admin's rights via payrollShared.js.
 */

// Every report is scoped by the HR admin and the sidebar's company/branch.
const base = {
  admin_card_no: z.string().min(1, "admin_card_no is required"),
  compc: z.string().optional(),
  brnch: z.string().optional(),
};

// Blank strings arrive from unset <select> elements; treat them as "no filter".
const optStr = z.string().trim().min(1).optional();
const optNum = z.coerce.number().optional();

const q = (shape) => z.object({ query: z.object({ ...base, ...shape }) });

export const lookupsSchema = q({});

// Salary source: 'C' = HR_SALARY_PROCESS (current), 'P' = HR_SALARY_PROCESS_FINAL (posted).
const rtypeCP = z.enum(["C", "P"]).optional().default("C");

export const allowanceDetailSchema = q({
  period_from: z.coerce.number().int(),
  period_to: z.coerce.number().int(),
  empcode: optStr,
  rtype: rtypeCP,
});

export const deductionDetailSchema = allowanceDetailSchema;

export const allowanceReconSchema = q({
  period_from: z.coerce.number().int(),
  period_to: z.coerce.number().int(),
  empcode: optStr,
});

export const deductionReconSchema = allowanceReconSchema;

export const monthWiseDeductionSchema = q({
  deduction_id: z.string().trim().min(1, "deduction_id is required"),
  period_from: z.coerce.number().int(),
  period_to: z.coerce.number().int(),
  dept_no: optStr,
  empcode: optStr,
});

export const bankAdviceSchema = q({
  period: z.coerce.number().int(),
  desg_grp: optStr,
  trans_id: optStr,
  rtype: z.enum(["IN", "OT"]).optional().default("IN"),
});

export const absentSuppSchema = q({
  period: z.coerce.number().int(),
  dept_no: optStr,
});

export const activeEmployeesSchema = q({
  // 'A' = all active, 'C' = confirmed only, 'U' = un-confirmed only.
  rtype: z.enum(["A", "U", "C"]).optional().default("A"),
  empcode: optStr,
  emp_status: optStr,
  gross_from: optNum,
  gross_to: optNum,
  desg_cd: optStr,
  dept_no: optStr,
  desg_grp: optStr,
  grade_cd: optStr,
});

export const pfDetailSchema = q({
  empcode: z.string().trim().min(1, "empcode is required"),
});
