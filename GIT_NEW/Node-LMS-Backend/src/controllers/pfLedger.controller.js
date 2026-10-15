/**
 * Provident Fund controllers — thin handlers for the /pf/* routes.
 *
 * HR-admin access is enforced by requireHrAdmin before these run; the company
 * is resolved server-side via resolveCompany (never the raw compc param).
 */

import { resolveCompany, checked, PAYROLL_USR } from "../utils/payrollShared.js";
import {
  getSettings, saveSettings,
  listRates, saveRate, deleteRate,
  listOpenings, saveOpening, deleteOpening,
  listWithdrawals, importOpenings,
  getStatement, getSettlement, postYear,
  listZakatStatus, saveZakatStatus,
} from "../services/pfLedger.service.js";

const unitOf = (q) => resolveCompany(q.admin_card_no, q.compc);

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(res.locals.validated, res);
  } catch (err) {
    next(err);
  }
};

// ── Settings ──

export const getPfSettings = handle(async ({ query }, res) => {
  res.json(await getSettings(await unitOf(query)));
});

export const putPfSettings = handle(async ({ query, body }, res) => {
  checked(res, await saveSettings(await unitOf(query), {
    pfDedCode: body.pf_ded_code, loanCodes: body.loan_codes,
    loanSpread: body.loan_spread, zakatRate: body.zakat_rate,
  }, { usr: PAYROLL_USR }));
});

// ── Profit rates ──

export const getPfRates = handle(async ({ query }, res) => {
  res.json({ items: await listRates(await unitOf(query)) });
});

export const postPfRate = handle(async ({ query, body }, res) => {
  checked(res, await saveRate(await unitOf(query), body.fy_from, body.profit_rate, body.remarks, { usr: PAYROLL_USR }));
});

export const delPfRate = handle(async ({ query, params }, res) => {
  checked(res, await deleteRate(await unitOf(query), params.fy_from));
});

// ── Take-on balances ──

export const getPfOpenings = handle(async ({ query }, res) => {
  res.json({ items: await listOpenings(await unitOf(query), query.empcode) });
});

export const putPfOpening = handle(async ({ query, params, body }, res) => {
  checked(res, await saveOpening(await unitOf(query), params.empcode, body, { usr: PAYROLL_USR }));
});

export const delPfOpening = handle(async ({ query, params }, res) => {
  checked(res, await deleteOpening(await unitOf(query), params.empcode));
});

export const postPfOpeningsImport = handle(async ({ query, body }, res) => {
  checked(res, await importOpenings(await unitOf(query), body.as_of_fy, { overwrite: body.overwrite, usr: PAYROLL_USR }));
});

// ── Permanent withdrawals (loan type 16, read-only) ──

export const getPfWithdrawals = handle(async ({ query }, res) => {
  res.json({ items: await listWithdrawals(await unitOf(query), query.empcode) });
});

// ── Statement / settlement / posting ──

export const getPfStatement = handle(async ({ query }, res) => {
  checked(res, await getStatement(await unitOf(query), query.empcode, query.upto));
});

export const getPfSettlement = handle(async ({ query }, res) => {
  checked(res, await getSettlement(await unitOf(query), query.empcode, query.upto));
});

// ── Zakat exemption ──

export const getPfZakat = handle(async ({ query }, res) => {
  res.json({ items: await listZakatStatus(await unitOf(query), query.empcode) });
});

export const putPfZakat = handle(async ({ query, params, body }, res) => {
  checked(res, await saveZakatStatus(await unitOf(query), params.empcode, {
    zakatExempt: body.zakat_exempt, declDate: body.decl_date, declRef: body.decl_ref, remarks: body.remarks,
  }, { usr: PAYROLL_USR }));
});

export const postPfYear = handle(async ({ query, body }, res) => {
  checked(res, await postYear(await unitOf(query), body.fy_from, { usr: PAYROLL_USR }));
});
