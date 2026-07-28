import { Router } from "express";
import { validate } from "../middlewares/validate.middleware.js";
import { requireHrAdmin } from "../middlewares/hrAdmin.middleware.js";

import {
  openPeriodsSchema, recoveryTypesSchema, allowanceTypesSchema, deductionTypesSchema,
  recoverableLoansSchema, loanRecoveriesSchema, createLoanRecoverySchema, deleteLoanRecoverySchema,
  monthlyAllowancesSchema, createMonthlyAllowanceSchema, deleteMonthlyAllowanceSchema,
  monthlyDeductionsSchema, createMonthlyDeductionSchema, deleteMonthlyDeductionSchema,
  absentDaysSchema, employeeAbsentDaysSchema, createAbsentDaysSchema, deleteAbsentDaysSchema,
} from "../models/payrollEntry.schema.js";

import {
  getOpenPeriods, getRecoveryTypes, getAllowanceTypes, getDeductionTypes,
  getRecoverableLoans, getLoanRecoveries, postLoanRecovery, delLoanRecovery,
  getMonthlyAllowances, postMonthlyAllowance, delMonthlyAllowance,
  getMonthlyDeductions, postMonthlyDeduction, delMonthlyDeduction,
  getAbsentDays, getEmployeeAbsentDays, postAbsentDays, delAbsentDays,
} from "../controllers/payrollEntry.controller.js";

const router = Router();
// Mounted at /payroll-entry. Every route requires HR-admin access
// (admin_card_no query param), matching FastAPI's per-endpoint
// require_hr_admin(admin_card_no) call.

// Open periods / LOVs
router.get("/open-periods", validate(openPeriodsSchema), requireHrAdmin, getOpenPeriods);
router.get("/recovery-types", validate(recoveryTypesSchema), requireHrAdmin, getRecoveryTypes);
router.get("/allowance-types", validate(allowanceTypesSchema), requireHrAdmin, getAllowanceTypes);
router.get("/deduction-types", validate(deductionTypesSchema), requireHrAdmin, getDeductionTypes);

// Loan recovery
router.get("/loans", validate(recoverableLoansSchema), requireHrAdmin, getRecoverableLoans);
router.get("/loan-recoveries", validate(loanRecoveriesSchema), requireHrAdmin, getLoanRecoveries);
router.post("/loan-recoveries", validate(createLoanRecoverySchema), requireHrAdmin, postLoanRecovery);
// Query-param-only DELETE (no :id path segment) — deliberate 1:1 parity with
// FastAPI's `DELETE /payroll-entry/loan-recoveries?rowid=...`. See schema file note.
router.delete("/loan-recoveries", validate(deleteLoanRecoverySchema), requireHrAdmin, delLoanRecovery);

// Monthly allowances
router.get("/allowances", validate(monthlyAllowancesSchema), requireHrAdmin, getMonthlyAllowances);
router.post("/allowances", validate(createMonthlyAllowanceSchema), requireHrAdmin, postMonthlyAllowance);
router.delete("/allowances", validate(deleteMonthlyAllowanceSchema), requireHrAdmin, delMonthlyAllowance);

// Monthly deductions
router.get("/deductions", validate(monthlyDeductionsSchema), requireHrAdmin, getMonthlyDeductions);
router.post("/deductions", validate(createMonthlyDeductionSchema), requireHrAdmin, postMonthlyDeduction);
router.delete("/deductions", validate(deleteMonthlyDeductionSchema), requireHrAdmin, delMonthlyDeduction);

// Absent days — /absent-days/employee registered before /absent-days would
// only matter for a :param wildcard, but keep the specific GET listed first
// for readability/consistency with the rest of the codebase's route ordering.
router.get("/absent-days/employee", validate(employeeAbsentDaysSchema), requireHrAdmin, getEmployeeAbsentDays);
router.get("/absent-days", validate(absentDaysSchema), requireHrAdmin, getAbsentDays);
router.post("/absent-days", validate(createAbsentDaysSchema), requireHrAdmin, postAbsentDays);
router.delete("/absent-days", validate(deleteAbsentDaysSchema), requireHrAdmin, delAbsentDays);

export default router;
