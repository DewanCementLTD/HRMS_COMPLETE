/**
 * Payroll controllers — thin request/response handlers for the /payroll/* routes.
 *
 * HR-admin access is enforced by the requireHrAdmin middleware before these
 * run. Company/branch scope is resolved server-side via resolveCompany/
 * resolveBranch (payrollShared.js) — never trusting the raw compc/brnch query
 * params — exactly as the FastAPI payroll_router does with _company/_branch.
 */

import { resolveCompany, resolveBranch, checked, PAYROLL_USR } from "../utils/payrollShared.js";
import {
  getPayRegisterPeriods, getPayRegister,
  listFinancialYears, createFinancialYear, updateFinancialYear, setFinancialYearStatus,
  listPeriods, createPeriod, setPeriodStatus,
  listTaxMasters, createTaxMaster, setTaxMasterStatus, deleteTaxMaster,
  listTaxDetails, addTaxDetail, deleteTaxDetail,
  listLoanTypes, addLoanType, deleteLoanType,
  listLoans, createLoan, updateLoan, deleteLoan,
  listSalaryPeriods, listProcessedSalaries, getPayslip, getOpenPeriod, runSalaryProcess,
} from "../services/payroll.service.js";

// ── Pay Register ──

// GET /payroll/pay-register/periods
export const payRegisterPeriods = async (req, res, next) => {
  try {
    const { admin_card_no, compc, rule_id } = res.locals.validated.query;
    const unitId = await resolveCompany(admin_card_no, compc);
    res.json({ items: await getPayRegisterPeriods(unitId, rule_id) });
  } catch (err) {
    next(err);
  }
};

// GET /payroll/pay-register
export const payRegister = async (req, res, next) => {
  try {
    const { admin_card_no, period, compc, location, dept_no, desg_cd, empcode } = res.locals.validated.query;
    const unitId = await resolveCompany(admin_card_no, compc);
    res.json(await getPayRegister(unitId, period, location, dept_no, desg_cd, empcode));
  } catch (err) {
    next(err);
  }
};

// ── Period Opening ──

// GET /payroll/financial-years
export const getFinancialYears = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    res.json({ items: await listFinancialYears(await resolveCompany(admin_card_no, compc)) });
  } catch (err) {
    next(err);
  }
};

// POST /payroll/financial-years
export const postFinancialYear = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    const body = res.locals.validated.body;
    const result = await createFinancialYear(body.from_date, body.to_date, body.scode, body.descr,
      await resolveCompany(admin_card_no, compc),
      { usr: PAYROLL_USR, rate: body.rate, intrst: body.intrst, filer: body.filer, nonfiler: body.nonfiler, autoPeriods: body.auto_periods });
    checked(res, result);
  } catch (err) {
    next(err);
  }
};

// PUT /payroll/financial-years/:rule_id
export const putFinancialYear = async (req, res, next) => {
  try {
    const { rule_id } = res.locals.validated.params;
    const body = res.locals.validated.body;
    const result = await updateFinancialYear(rule_id, {
      fromDate: body.from_date, toDate: body.to_date, scode: body.scode, descr: body.descr,
      rate: body.rate, intrst: body.intrst, filer: body.filer, nonfiler: body.nonfiler,
    });
    checked(res, result);
  } catch (err) {
    next(err);
  }
};

// PATCH /payroll/financial-years/:rule_id/status
export const patchFinancialYearStatus = async (req, res, next) => {
  try {
    const { rule_id } = res.locals.validated.params;
    const { status } = res.locals.validated.body;
    checked(res, await setFinancialYearStatus(rule_id, status));
  } catch (err) {
    next(err);
  }
};

// GET /payroll/periods
export const getPeriods = async (req, res, next) => {
  try {
    const { admin_card_no, compc, rule_id } = res.locals.validated.query;
    res.json({ items: await listPeriods(await resolveCompany(admin_card_no, compc), rule_id) });
  } catch (err) {
    next(err);
  }
};

// POST /payroll/periods
export const postPeriod = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    const { rule_id, period_frm, period_to, scode } = res.locals.validated.body;
    const result = await createPeriod(rule_id, period_frm, period_to, scode,
      await resolveCompany(admin_card_no, compc), { usr: PAYROLL_USR });
    checked(res, result);
  } catch (err) {
    next(err);
  }
};

// PATCH /payroll/periods/:period/status
export const patchPeriodStatus = async (req, res, next) => {
  try {
    const { period } = res.locals.validated.params;
    const { status, block } = res.locals.validated.body;
    checked(res, await setPeriodStatus(period, status, block));
  } catch (err) {
    next(err);
  }
};

// ── Tax Slabs (global) ──

// GET /payroll/tax-masters
export const getTaxMasters = async (req, res, next) => {
  try {
    res.json({ items: await listTaxMasters() });
  } catch (err) {
    next(err);
  }
};

// POST /payroll/tax-masters
export const postTaxMaster = async (req, res, next) => {
  try {
    const { tax_desc, fyear } = res.locals.validated.body;
    if (!tax_desc.trim()) return res.status(400).json({ detail: "Description is required" });
    checked(res, await createTaxMaster(tax_desc, fyear, { usr: PAYROLL_USR }));
  } catch (err) {
    next(err);
  }
};

// PATCH /payroll/tax-masters/:tax_id/status
export const patchTaxMasterStatus = async (req, res, next) => {
  try {
    const { tax_id } = res.locals.validated.params;
    const { status } = res.locals.validated.body;
    checked(res, await setTaxMasterStatus(tax_id, status));
  } catch (err) {
    next(err);
  }
};

// DELETE /payroll/tax-masters/:tax_id
export const delTaxMaster = async (req, res, next) => {
  try {
    const { tax_id } = res.locals.validated.params;
    checked(res, await deleteTaxMaster(tax_id));
  } catch (err) {
    next(err);
  }
};

// GET /payroll/tax-masters/:tax_id/details
export const getTaxDetails = async (req, res, next) => {
  try {
    const { tax_id } = res.locals.validated.params;
    res.json({ items: await listTaxDetails(tax_id) });
  } catch (err) {
    next(err);
  }
};

// POST /payroll/tax-masters/:tax_id/details
export const postTaxDetail = async (req, res, next) => {
  try {
    const { tax_id } = res.locals.validated.params;
    const { slab_from, slab_to, slab_rate, date_from, date_to, slab_ded, fixed_tax } = res.locals.validated.body;
    const result = await addTaxDetail(tax_id, slab_from, slab_to, slab_rate, date_from, date_to, slab_ded, fixed_tax, { usr: PAYROLL_USR });
    checked(res, result);
  } catch (err) {
    next(err);
  }
};

// DELETE /payroll/tax-masters/:tax_id/details/:srno
export const delTaxDetail = async (req, res, next) => {
  try {
    const { tax_id, srno } = res.locals.validated.params;
    checked(res, await deleteTaxDetail(tax_id, srno));
  } catch (err) {
    next(err);
  }
};

// ── Loans ──

// GET /payroll/loan-types
export const getLoanTypes = async (req, res, next) => {
  try {
    res.json({ items: await listLoanTypes() });
  } catch (err) {
    next(err);
  }
};

// POST /payroll/loan-types
export const postLoanType = async (req, res, next) => {
  try {
    const { loan_desc } = res.locals.validated.body;
    if (!loan_desc.trim()) return res.status(400).json({ detail: "Description is required" });
    checked(res, await addLoanType(loan_desc, { usr: PAYROLL_USR }));
  } catch (err) {
    next(err);
  }
};

// DELETE /payroll/loan-types/:loan_cd
export const delLoanType = async (req, res, next) => {
  try {
    const { loan_cd } = res.locals.validated.params;
    checked(res, await deleteLoanType(loan_cd));
  } catch (err) {
    next(err);
  }
};

// GET /payroll/loans
export const getLoans = async (req, res, next) => {
  try {
    const { admin_card_no, compc, empcode } = res.locals.validated.query;
    res.json({ items: await listLoans(await resolveCompany(admin_card_no, compc), empcode) });
  } catch (err) {
    next(err);
  }
};

// POST /payroll/loans
export const postLoan = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    const body = res.locals.validated.body;
    if (!body.empcode) return res.status(400).json({ detail: "Employee is required" });
    const result = await createLoan(
      body.empcode, body.loan_cd, body.loan_date, body.loan_amt, body.instalment_amt,
      body.nof_instalment, body.start_dt, body.charge_int, body.int_rate, body.chq_no,
      body.chq_dt, body.remarks, await resolveCompany(admin_card_no, compc), { usr: PAYROLL_USR }
    );
    checked(res, result);
  } catch (err) {
    next(err);
  }
};

// PUT /payroll/loans/:doc
export const putLoan = async (req, res, next) => {
  try {
    const { doc } = res.locals.validated.params;
    const body = res.locals.validated.body;
    const result = await updateLoan(doc, {
      loanCd: body.loan_cd, loanDate: body.loan_date, loanAmt: body.loan_amt,
      instalmentAmt: body.instalment_amt, nofInstalment: body.nof_instalment,
      startDt: body.start_dt, chargeInt: body.charge_int, intRate: body.int_rate,
      chqNo: body.chq_no, chqDt: body.chq_dt, remarks: body.remarks,
    });
    checked(res, result);
  } catch (err) {
    next(err);
  }
};

// DELETE /payroll/loans/:doc
export const delLoan = async (req, res, next) => {
  try {
    const { doc } = res.locals.validated.params;
    const { admin_card_no, compc } = res.locals.validated.query;
    checked(res, await deleteLoan(doc, await resolveCompany(admin_card_no, compc)));
  } catch (err) {
    next(err);
  }
};

// ── Salary / Payslips (read-only) ──

// GET /payroll/salary/periods
export const getSalaryPeriods = async (req, res, next) => {
  try {
    const { admin_card_no, compc, brnch } = res.locals.validated.query;
    const unitId = await resolveCompany(admin_card_no, compc);
    res.json({ items: await listSalaryPeriods(unitId, await resolveBranch(admin_card_no, compc, brnch)) });
  } catch (err) {
    next(err);
  }
};

// GET /payroll/salary/sheet
export const getSalarySheet = async (req, res, next) => {
  try {
    const { admin_card_no, period, compc, brnch, q } = res.locals.validated.query;
    const unitId = await resolveCompany(admin_card_no, compc);
    const branch = await resolveBranch(admin_card_no, compc, brnch);
    res.json({ items: await listProcessedSalaries(unitId, period, q, branch) });
  } catch (err) {
    next(err);
  }
};

// GET /payroll/salary/payslip
export const getSalaryPayslip = async (req, res, next) => {
  try {
    const { admin_card_no, empcode, period, compc } = res.locals.validated.query;
    const ps = await getPayslip(await resolveCompany(admin_card_no, compc), empcode, period);
    if (!ps) return res.status(404).json({ detail: "No processed salary for this employee/period" });
    res.json(ps);
  } catch (err) {
    next(err);
  }
};

// GET /payroll/salary/open-period
export const getSalaryOpenPeriod = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    res.json({ open_period: await getOpenPeriod(await resolveCompany(admin_card_no, compc)) });
  } catch (err) {
    next(err);
  }
};

// POST /payroll/salary/process
export const postSalaryProcess = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    checked(res, await runSalaryProcess(await resolveCompany(admin_card_no, compc)));
  } catch (err) {
    next(err);
  }
};
