/**
 * Payroll entry controllers — thin request/response handlers for the
 * /payroll-entry/* routes.
 *
 * HR-admin access is enforced by the requireHrAdmin middleware before these
 * run. Company/branch scope is resolved via resolveCompany/resolveBranch from
 * payrollShared.js — the same cross-module import payroll_entry_router.py
 * uses from payroll_router.py in FastAPI (_company/_branch/_checked/USR).
 */

import { resolveCompany, resolveBranch, checked, PAYROLL_USR } from "../utils/payrollShared.js";
import {
  listOpenPeriods, recoveryTypes,
  listRecoverableLoans, listLoanRecoveries, createLoanRecovery, deleteLoanRecovery,
  listEntryPeriods,
  listAllowanceTypes, listMonthlyAllowances, upsertMonthlyAllowance, deleteMonthlyAllowance,
  listDeductionTypes, listMonthlyDeductions, upsertMonthlyDeduction, deleteMonthlyDeduction,
  listAbsentDays, getEmployeeAbsent, setAbsentDays, deleteAbsentDays,
} from "../services/payrollEntry.service.js";

// ── Open periods / LOVs ──

// GET /payroll-entry/open-periods
export const getOpenPeriods = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    res.json({ items: await listOpenPeriods(await resolveCompany(admin_card_no, compc)) });
  } catch (err) {
    next(err);
  }
};

// GET /payroll-entry/entry-periods — open period + earlier months of its year
export const getEntryPeriods = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    res.json({ items: await listEntryPeriods(await resolveCompany(admin_card_no, compc)) });
  } catch (err) {
    next(err);
  }
};

// GET /payroll-entry/recovery-types
export const getRecoveryTypes = async (req, res, next) => {
  try {
    res.json({ items: recoveryTypes() });
  } catch (err) {
    next(err);
  }
};

// GET /payroll-entry/allowance-types
export const getAllowanceTypes = async (req, res, next) => {
  try {
    res.json({ items: await listAllowanceTypes() });
  } catch (err) {
    next(err);
  }
};

// GET /payroll-entry/deduction-types
export const getDeductionTypes = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    res.json({ items: await listDeductionTypes(await resolveCompany(admin_card_no, compc)) });
  } catch (err) {
    next(err);
  }
};

// ── Loan recovery ──

// GET /payroll-entry/loans
export const getRecoverableLoans = async (req, res, next) => {
  try {
    const { admin_card_no, compc, brnch } = res.locals.validated.query;
    const unitId = await resolveCompany(admin_card_no, compc);
    res.json({ items: await listRecoverableLoans(unitId, await resolveBranch(admin_card_no, compc, brnch)) });
  } catch (err) {
    next(err);
  }
};

// GET /payroll-entry/loan-recoveries
export const getLoanRecoveries = async (req, res, next) => {
  try {
    const { admin_card_no, compc, brnch, doc } = res.locals.validated.query;
    const unitId = await resolveCompany(admin_card_no, compc);
    res.json({ items: await listLoanRecoveries(unitId, doc, await resolveBranch(admin_card_no, compc, brnch)) });
  } catch (err) {
    next(err);
  }
};

// POST /payroll-entry/loan-recoveries
export const postLoanRecovery = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    const { doc, recovery_type, recovered_amt, remarks, int_rate_rec } = res.locals.validated.body;
    const result = await createLoanRecovery(await resolveCompany(admin_card_no, compc), doc, recovery_type, recovered_amt, remarks, int_rate_rec, { usr: PAYROLL_USR });
    checked(res, result);
  } catch (err) {
    next(err);
  }
};

// DELETE /payroll-entry/loan-recoveries
export const delLoanRecovery = async (req, res, next) => {
  try {
    const { admin_card_no, rowid, compc } = res.locals.validated.query;
    checked(res, await deleteLoanRecovery(await resolveCompany(admin_card_no, compc), rowid));
  } catch (err) {
    next(err);
  }
};

// ── Monthly allowances ──

// GET /payroll-entry/allowances
export const getMonthlyAllowances = async (req, res, next) => {
  try {
    const { admin_card_no, compc, brnch, empcode, period } = res.locals.validated.query;
    const unitId = await resolveCompany(admin_card_no, compc);
    const branch = await resolveBranch(admin_card_no, compc, brnch);
    res.json({ items: await listMonthlyAllowances(unitId, period ?? null, empcode, branch) });
  } catch (err) {
    next(err);
  }
};

// POST /payroll-entry/allowances
export const postMonthlyAllowance = async (req, res, next) => {
  try {
    const { admin_card_no, compc, period } = res.locals.validated.query;
    const { empcode, allowance_id, amount, ot_hour, remarks } = res.locals.validated.body;
    const result = await upsertMonthlyAllowance(await resolveCompany(admin_card_no, compc), empcode, allowance_id, amount, ot_hour, remarks, { period: period ?? null, usr: PAYROLL_USR });
    checked(res, result);
  } catch (err) {
    next(err);
  }
};

// DELETE /payroll-entry/allowances
export const delMonthlyAllowance = async (req, res, next) => {
  try {
    const { admin_card_no, empcode, allowance_id, compc, period } = res.locals.validated.query;
    checked(res, await deleteMonthlyAllowance(await resolveCompany(admin_card_no, compc), empcode, allowance_id, period ?? null));
  } catch (err) {
    next(err);
  }
};

// ── Monthly deductions ──

// GET /payroll-entry/deductions
export const getMonthlyDeductions = async (req, res, next) => {
  try {
    const { admin_card_no, compc, brnch, empcode, period } = res.locals.validated.query;
    const unitId = await resolveCompany(admin_card_no, compc);
    const branch = await resolveBranch(admin_card_no, compc, brnch);
    res.json({ items: await listMonthlyDeductions(unitId, period ?? null, empcode, branch) });
  } catch (err) {
    next(err);
  }
};

// POST /payroll-entry/deductions
export const postMonthlyDeduction = async (req, res, next) => {
  try {
    const { admin_card_no, compc, period } = res.locals.validated.query;
    const { empcode, deduction_id, amount, remarks } = res.locals.validated.body;
    const result = await upsertMonthlyDeduction(await resolveCompany(admin_card_no, compc), empcode, deduction_id, amount, remarks, { period: period ?? null, usr: PAYROLL_USR });
    checked(res, result);
  } catch (err) {
    next(err);
  }
};

// DELETE /payroll-entry/deductions
export const delMonthlyDeduction = async (req, res, next) => {
  try {
    const { admin_card_no, empcode, deduction_id, compc, period } = res.locals.validated.query;
    checked(res, await deleteMonthlyDeduction(await resolveCompany(admin_card_no, compc), empcode, deduction_id, period ?? null));
  } catch (err) {
    next(err);
  }
};

// ── Absent days ──

// GET /payroll-entry/absent-days
export const getAbsentDays = async (req, res, next) => {
  try {
    const { admin_card_no, compc, brnch, empcode, period } = res.locals.validated.query;
    const unitId = await resolveCompany(admin_card_no, compc);
    const branch = await resolveBranch(admin_card_no, compc, brnch);
    res.json({ items: await listAbsentDays(unitId, period ?? null, empcode, branch) });
  } catch (err) {
    next(err);
  }
};

// GET /payroll-entry/absent-days/employee
export const getEmployeeAbsentDays = async (req, res, next) => {
  try {
    const { admin_card_no, empcode, compc, period } = res.locals.validated.query;
    res.json(await getEmployeeAbsent(await resolveCompany(admin_card_no, compc), empcode, period ?? null));
  } catch (err) {
    next(err);
  }
};

// POST /payroll-entry/absent-days
export const postAbsentDays = async (req, res, next) => {
  try {
    const { admin_card_no, compc, period } = res.locals.validated.query;
    const { empcode, absent_days } = res.locals.validated.body;
    checked(res, await setAbsentDays(await resolveCompany(admin_card_no, compc), empcode, absent_days, { period: period ?? null, usr: PAYROLL_USR }));
  } catch (err) {
    next(err);
  }
};

// DELETE /payroll-entry/absent-days
export const delAbsentDays = async (req, res, next) => {
  try {
    const { admin_card_no, empcode, compc, period } = res.locals.validated.query;
    checked(res, await deleteAbsentDays(await resolveCompany(admin_card_no, compc), empcode, period ?? null));
  } catch (err) {
    next(err);
  }
};
