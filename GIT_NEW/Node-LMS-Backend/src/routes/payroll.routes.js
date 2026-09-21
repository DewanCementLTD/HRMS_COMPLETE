import { Router } from "express";
import { validate } from "../middlewares/validate.middleware.js";
import { requireHrAdmin } from "../middlewares/hrAdmin.middleware.js";

import {
  payRegisterPeriodsSchema, payRegisterSchema,
  listFinancialYearsSchema, createFinancialYearSchema, updateFinancialYearSchema, financialYearStatusSchema,
  listPeriodsSchema, createPeriodSchema, periodStatusSchema,
  listTaxMastersSchema, createTaxMasterSchema, taxMasterStatusSchema, deleteTaxMasterSchema,
  listTaxDetailsSchema, addTaxDetailSchema, deleteTaxDetailSchema,
  listLoanTypesSchema, createLoanTypeSchema, deleteLoanTypeSchema,
  listLoansSchema, createLoanSchema, updateLoanSchema, deleteLoanSchema,
  salaryPeriodsSchema, salarySheetSchema, salaryPayslipSchema, salaryOpenPeriodSchema, salaryProcessSchema,
  salaryProcessStateSchema, salaryProcessFinalSchema,
} from "../models/payroll.schema.js";

import {
  payRegisterPeriods, payRegister,
  getFinancialYears, postFinancialYear, putFinancialYear, patchFinancialYearStatus,
  getPeriods, postPeriod, patchPeriodStatus,
  getTaxMasters, postTaxMaster, patchTaxMasterStatus, delTaxMaster,
  getTaxDetails, postTaxDetail, delTaxDetail,
  getLoanTypes, postLoanType, delLoanType,
  getLoans, postLoan, putLoan, delLoan,
  getSalaryPeriods, getSalarySheet, getSalaryPayslip, getSalaryOpenPeriod, postSalaryProcess,
  salaryProcessState, postSalaryProcessFinal,
} from "../controllers/payroll.controller.js";

const router = Router();
// Mounted at /payroll. Every route requires HR-admin access (admin_card_no
// query param), matching FastAPI's per-endpoint require_hr_admin(admin_card_no)
// call (payroll_router.py has no router-level dependency).

// Pay Register (read-only, from HR_PAY_REG_V)
router.get("/pay-register/periods", validate(payRegisterPeriodsSchema), requireHrAdmin, payRegisterPeriods);
router.get("/pay-register", validate(payRegisterSchema), requireHrAdmin, payRegister);

// Period Opening
router.get("/financial-years", validate(listFinancialYearsSchema), requireHrAdmin, getFinancialYears);
router.post("/financial-years", validate(createFinancialYearSchema), requireHrAdmin, postFinancialYear);
router.put("/financial-years/:rule_id", validate(updateFinancialYearSchema), requireHrAdmin, putFinancialYear);
router.patch("/financial-years/:rule_id/status", validate(financialYearStatusSchema), requireHrAdmin, patchFinancialYearStatus);

router.get("/periods", validate(listPeriodsSchema), requireHrAdmin, getPeriods);
router.post("/periods", validate(createPeriodSchema), requireHrAdmin, postPeriod);
router.patch("/periods/:period/status", validate(periodStatusSchema), requireHrAdmin, patchPeriodStatus);

// Tax Slabs (global)
router.get("/tax-masters", validate(listTaxMastersSchema), requireHrAdmin, getTaxMasters);
router.post("/tax-masters", validate(createTaxMasterSchema), requireHrAdmin, postTaxMaster);
router.patch("/tax-masters/:tax_id/status", validate(taxMasterStatusSchema), requireHrAdmin, patchTaxMasterStatus);
router.delete("/tax-masters/:tax_id", validate(deleteTaxMasterSchema), requireHrAdmin, delTaxMaster);
router.get("/tax-masters/:tax_id/details", validate(listTaxDetailsSchema), requireHrAdmin, getTaxDetails);
router.post("/tax-masters/:tax_id/details", validate(addTaxDetailSchema), requireHrAdmin, postTaxDetail);
router.delete("/tax-masters/:tax_id/details/:srno", validate(deleteTaxDetailSchema), requireHrAdmin, delTaxDetail);

// Loans
router.get("/loan-types", validate(listLoanTypesSchema), requireHrAdmin, getLoanTypes);
router.post("/loan-types", validate(createLoanTypeSchema), requireHrAdmin, postLoanType);
router.delete("/loan-types/:loan_cd", validate(deleteLoanTypeSchema), requireHrAdmin, delLoanType);

router.get("/loans", validate(listLoansSchema), requireHrAdmin, getLoans);
router.post("/loans", validate(createLoanSchema), requireHrAdmin, postLoan);
router.put("/loans/:doc", validate(updateLoanSchema), requireHrAdmin, putLoan);
router.delete("/loans/:doc", validate(deleteLoanSchema), requireHrAdmin, delLoan);

// Salary / Payslips (read-only) — static paths before any wildcard, though
// none of these actually collide with a param route in this module.
router.get("/salary/periods", validate(salaryPeriodsSchema), requireHrAdmin, getSalaryPeriods);
router.get("/salary/sheet", validate(salarySheetSchema), requireHrAdmin, getSalarySheet);
router.get("/salary/payslip", validate(salaryPayslipSchema), requireHrAdmin, getSalaryPayslip);
router.get("/salary/open-period", validate(salaryOpenPeriodSchema), requireHrAdmin, getSalaryOpenPeriod);
router.post("/salary/process", validate(salaryProcessSchema), requireHrAdmin, postSalaryProcess);
router.get("/salary/process-state", validate(salaryProcessStateSchema), requireHrAdmin, salaryProcessState); // [x] /payroll/salary/process-state?admin_card_no=100001.1&period=98
router.post("/salary/process-final", validate(salaryProcessFinalSchema), requireHrAdmin, postSalaryProcessFinal); // [x] Body: {"period":98,"password":"..."} — posts the period into the FINAL tables

export default router;
