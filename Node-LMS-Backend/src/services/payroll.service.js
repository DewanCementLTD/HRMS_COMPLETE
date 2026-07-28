/**
 * Payroll service — Period Opening, Tax Slabs, Loans, Salary/Payslip (read-only)
 * and Pay Register (read-only).
 *
 * Faithful 1:1 port of the FastAPI LMS-Backend:
 *   repositories/payroll_repository.py           (Period Opening / Tax Slabs / Loans)
 *   repositories/salary_repository.py            (Salary / Payslip)
 *   repositories/payroll_register_repository.py  (Pay Register)
 *
 * IDs are generated with SELECT NVL(MAX(col),0)+1 (no sequences), matching the
 * FastAPI source exactly — this is intentional, not "fixed" with a sequence.
 */

import { getDirectConnection } from "../config/database.js";
import { logger } from "../utils/logger.js";

const OUT_OBJECT = 4002; // oracledb.OUT_FORMAT_OBJECT
const OUT_ARRAY = 4001; // oracledb.OUT_FORMAT_ARRAY

// ------------------------------------------------------------------
// small helpers (mirror _int / _num / _s / _d in payroll_repository.py)
// ------------------------------------------------------------------

const toInt = (v, def = null) => {
  if (v === null || v === undefined) return def;
  const s = String(v).trim();
  if (s === "") return def;
  const f = Number(s);
  return Number.isFinite(f) ? Math.trunc(f) : def;
};

const toNum = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const f = Number(v);
  return Number.isFinite(f) ? f : null;
};

const toStr = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  return String(v).trim();
};

const toDateStr = (v) => (v ? toStr(String(v).slice(0, 10)) : null);

const getTodayLocalDateStr = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const trimOrEmpty = (v) => (v === null || v === undefined ? "" : String(v).trim());

const lowerKeys = (row) => {
  const out = {};
  for (const k of Object.keys(row)) out[k.toLowerCase()] = row[k];
  return out;
};

const MONTHS = ["", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const label = (frm) => {
  if (!frm || frm.length < 7) return "";
  return `${MONTHS[Number(frm.slice(5, 7))]} - ${frm.slice(0, 4)}`;
};

// ════════════════════════════════════════════════════════════════
// MODULE 1 — PERIOD OPENING (financial years + monthly periods)
// ════════════════════════════════════════════════════════════════

export const listFinancialYears = async (compc = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const c = toInt(compc);
    const where = c !== null ? "WHERE UNIT_ID = :u" : "";
    const params = c !== null ? { u: c } : {};
    const result = await connection.execute(
      `SELECT RULE_ID, TO_CHAR(FROM_DATE,'YYYY-MM-DD'), TO_CHAR(TO_DATE,'YYYY-MM-DD'),
              STATUS, SCODE, DESCR, RATE, INTRST, FILER, NONFILER, UNIT_ID
       FROM HR_FINANCIAL_YEAR ${where} ORDER BY FROM_DATE DESC, RULE_ID DESC`,
      params,
      { outFormat: OUT_ARRAY }
    );
    return (result.rows ?? []).map((r) => ({
      rule_id: Number(r[0]), from_date: r[1], to_date: r[2],
      status: trimOrEmpty(r[3]), scode: trimOrEmpty(r[4]), descr: trimOrEmpty(r[5]),
      rate: r[6], intrst: r[7], filer: r[8], nonfiler: r[9], unit_id: r[10],
    }));
  } finally {
    await connection?.close();
  }
};

// Yields [year, month] for each calendar month from from_date's month to
// to_date's month inclusive (mirrors _months_between).
const monthsBetween = (fromStr, toStr) => {
  const out = [];
  const fy = Number(fromStr.slice(0, 4));
  const fm = Number(fromStr.slice(5, 7));
  const ty = Number(toStr.slice(0, 4));
  const tm = Number(toStr.slice(5, 7));
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push([y, m]);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
};

// [period_frm, period_to, p_days] for a calendar month (mirrors _month_bounds).
const monthBounds = (y, m) => {
  const pad = (n) => String(n).padStart(2, "0");
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(lastDay)}`, lastDay];
};

// Auto-create one HR_ATTND_PERIOD per calendar month in the year's range.
// Runs on the same connection/transaction as the caller (mirrors _generate_periods).
const generatePeriods = async (connection, ruleId, fromDate, toDate, scode, compc, usr) => {
  const maxRes = await connection.execute(
    `SELECT NVL(MAX("PERIOD#"), 0) FROM HR_ATTND_PERIOD`,
    {},
    { outFormat: OUT_ARRAY }
  );
  let pno = Number(maxRes.rows[0][0]);
  let created = 0;
  for (const [y, m] of monthsBetween(fromDate, toDate)) {
    const [pfrm, pto, pdays] = monthBounds(y, m);
    pno += 1;
    // Auto-generated periods start CLOSED ('C'); HR opens the one they want to
    // work on (attendance, monthly inputs, salary process) from Period Opening.
    await connection.execute(
      `INSERT INTO HR_ATTND_PERIOD
         (RULE_ID, "PERIOD#", PERIOD_FRM, PERIOD_TO, STATUS, BLOCK_FLAG,
          UNIT_ID, USR_ID_UPD, USR_DATE_UPD, P_DAYS, SCODE)
       VALUES (:r, :pno, TO_DATE(:pf,'YYYY-MM-DD'), TO_DATE(:pt,'YYYY-MM-DD'),
               'C', 'N', :u, :usr, SYSDATE, :pd, :sc)`,
      { r: ruleId, pno, pf: pfrm, pt: pto, u: compc, usr, pd: pdays, sc: (scode || String(y)).slice(0, 10) }
    );
    created += 1;
  }
  return created;
};

export const createFinancialYear = async (
  fromDate,
  toDate,
  scode,
  descr,
  compc,
  { usr = null, rate = null, intrst = null, filer = null, nonfiler = null, autoPeriods = true } = {}
) => {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let connection;
    try {
      connection = await getDirectConnection();
      const fd = toDateStr(fromDate);
      const td = toDateStr(toDate);
      if (!fd || !td) return { status: "error", message: "From and To dates are required" };
      const c = toInt(compc) || 1;

      await connection.execute(`LOCK TABLE HR_FINANCIAL_YEAR IN EXCLUSIVE MODE`);
      if (autoPeriods) {
        await connection.execute(`LOCK TABLE HR_ATTND_PERIOD IN EXCLUSIVE MODE`);
      }

      const ruleRes = await connection.execute(
        `SELECT NVL(MAX(RULE_ID), 0) + 1 FROM HR_FINANCIAL_YEAR`,
        {},
        { outFormat: OUT_ARRAY }
      );
      const ruleId = Number(ruleRes.rows[0][0]);
      await connection.execute(
        `INSERT INTO HR_FINANCIAL_YEAR
           (RULE_ID, FROM_DATE, TO_DATE, STATUS, UNIT_ID, USR_ID_UPD, USR_DATE_UPD,
            SCODE, DESCR, RATE, INTRST, FILER, NONFILER)
         VALUES (:rid, TO_DATE(:fd,'YYYY-MM-DD'), TO_DATE(:td,'YYYY-MM-DD'), 'O',
                 :u, :usr, SYSDATE, :sc, :descr, :rate, :intrst, :filer, :nonfiler)`,
        {
          rid: ruleId, fd, td, u: c, usr: toStr(usr), sc: toStr(scode), descr: toStr(descr),
          rate: toNum(rate), intrst: toNum(intrst), filer: toNum(filer), nonfiler: toNum(nonfiler),
        }
      );
      const n = autoPeriods ? await generatePeriods(connection, ruleId, fd, td, scode, c, toStr(usr)) : 0;
      await connection.commit();
      return { status: "success", rule_id: ruleId, periods_created: n };
    } catch (err) {
      try { await connection?.rollback(); } catch { /* ignore */ }
      const msg = String(err?.message ?? "");
      if ((msg.includes("ORA-00001") || msg.includes("ORA-00054")) && attempt < maxRetries) {
        continue;
      }
      return { status: "error", message: err.message };
    } finally {
      await connection?.close();
    }
  }
};

export const updateFinancialYear = async (
  ruleId,
  { fromDate = null, toDate = null, scode = null, descr = null, rate = null, intrst = null, filer = null, nonfiler = null } = {}
) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const sets = [];
    const params = { rid: toInt(ruleId) };
    const fields = [
      ["scode", "SCODE", toStr(scode), false],
      ["descr", "DESCR", toStr(descr), false],
      ["rate", "RATE", toNum(rate), false],
      ["intrst", "INTRST", toNum(intrst), false],
      ["filer", "FILER", toNum(filer), false],
      ["nonfiler", "NONFILER", toNum(nonfiler), false],
      ["fd", "FROM_DATE", toDateStr(fromDate), true],
      ["td", "TO_DATE", toDateStr(toDate), true],
    ];
    for (const [key, col, val, isDate] of fields) {
      if (val === null || val === undefined) continue;
      sets.push(isDate ? `${col} = TO_DATE(:${key},'YYYY-MM-DD')` : `${col} = :${key}`);
      params[key] = val;
    }
    if (sets.length === 0) return { status: "error", message: "Nothing to update" };
    await connection.execute(`UPDATE HR_FINANCIAL_YEAR SET ${sets.join(", ")} WHERE RULE_ID = :rid`, params);
    await connection.commit();
    return { status: "success" };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

export const setFinancialYearStatus = async (ruleId, status) => {
  const st = String(status ?? "").toUpperCase().startsWith("O") ? "O" : "C";
  let connection;
  try {
    connection = await getDirectConnection();
    await connection.execute(
      `UPDATE HR_FINANCIAL_YEAR SET STATUS = :s, USR_DATE_UPD = SYSDATE WHERE RULE_ID = :r`,
      { s: st, r: toInt(ruleId) }
    );
    await connection.commit();
    return { status: "success", new_status: st };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

export const listPeriods = async (compc = null, ruleId = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const conds = [];
    const params = {};
    const c = toInt(compc);
    if (c !== null) { conds.push("UNIT_ID = :u"); params.u = c; }
    const r = toInt(ruleId);
    if (r !== null) { conds.push("RULE_ID = :r"); params.r = r; }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const result = await connection.execute(
      `SELECT "PERIOD#", RULE_ID, TO_CHAR(PERIOD_FRM,'YYYY-MM-DD'),
              TO_CHAR(PERIOD_TO,'YYYY-MM-DD'), STATUS, BLOCK_FLAG, P_DAYS, SCODE, UNIT_ID
       FROM HR_ATTND_PERIOD ${where} ORDER BY PERIOD_FRM, "PERIOD#"`,
      params,
      { outFormat: OUT_ARRAY }
    );
    return (result.rows ?? []).map((row) => ({
      period: Number(row[0]), rule_id: row[1], period_frm: row[2], period_to: row[3],
      status: trimOrEmpty(row[4]), block_flag: trimOrEmpty(row[5]),
      p_days: row[6], scode: trimOrEmpty(row[7]), unit_id: row[8],
    }));
  } finally {
    await connection?.close();
  }
};

const daysBetween = (fromStr, toStr) => {
  const [fy, fm, fd] = fromStr.split("-").map(Number);
  const [ty, tm, td] = toStr.split("-").map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86400000);
};

export const createPeriod = async (ruleId, periodFrm, periodTo, scode, compc, { usr = null } = {}) => {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let connection;
    try {
      connection = await getDirectConnection();
      const pf = toDateStr(periodFrm);
      const pt = toDateStr(periodTo);
      if (!pf || !pt) return { status: "error", message: "Period from/to dates are required" };
      const c = toInt(compc) || 1;

      await connection.execute(`LOCK TABLE HR_ATTND_PERIOD IN EXCLUSIVE MODE`);

      const pnoRes = await connection.execute(
        `SELECT NVL(MAX("PERIOD#"), 0) + 1 FROM HR_ATTND_PERIOD`,
        {},
        { outFormat: OUT_ARRAY }
      );
      const pno = Number(pnoRes.rows[0][0]);
      const pdays = daysBetween(pf, pt) + 1;
      await connection.execute(
        `INSERT INTO HR_ATTND_PERIOD
           (RULE_ID, "PERIOD#", PERIOD_FRM, PERIOD_TO, STATUS, BLOCK_FLAG,
            UNIT_ID, USR_ID_UPD, USR_DATE_UPD, P_DAYS, SCODE)
         VALUES (:r, :pno, TO_DATE(:pf,'YYYY-MM-DD'), TO_DATE(:pt,'YYYY-MM-DD'),
                 'O', 'N', :u, :usr, SYSDATE, :pd, :sc)`,
        { r: toInt(ruleId), pno, pf, pt, u: c, usr: toStr(usr), pd: pdays, sc: (toStr(scode) || "").slice(0, 10) }
      );
      await connection.commit();
      return { status: "success", period: pno };
    } catch (err) {
      try { await connection?.rollback(); } catch { /* ignore */ }
      const msg = String(err?.message ?? "");
      if ((msg.includes("ORA-00001") || msg.includes("ORA-00054")) && attempt < maxRetries) {
        continue;
      }
      return { status: "error", message: err.message };
    } finally {
      await connection?.close();
    }
  }
};

export const setPeriodStatus = async (period, status, block = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const sets = [];
    const params = { p: toInt(period) };
    if (status !== null && status !== undefined) {
      sets.push("STATUS = :s");
      params.s = String(status).toUpperCase().startsWith("O") ? "O" : "C";
    }
    if (block !== null && block !== undefined) {
      sets.push("BLOCK_FLAG = :b");
      const bu = String(block).toUpperCase();
      params.b = bu.startsWith("Y") || bu.startsWith("T") || bu.startsWith("1") ? "Y" : "N";
    }
    if (sets.length === 0) return { status: "error", message: "Nothing to update" };
    sets.push("USR_DATE_UPD = SYSDATE");
    await connection.execute(`UPDATE HR_ATTND_PERIOD SET ${sets.join(", ")} WHERE "PERIOD#" = :p`, params);
    await connection.commit();
    return { status: "success" };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

// ════════════════════════════════════════════════════════════════
// MODULE 2 — TAX SLABS (global)
// ════════════════════════════════════════════════════════════════

export const listTaxMasters = async () => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `SELECT TAX_ID, TAX_DESC, FYEAR, STATUS,
              (SELECT COUNT(*) FROM HR_TAX_DTL d WHERE d.TAX_ID = m.TAX_ID) AS slabs
       FROM HR_TAX_MST m ORDER BY TAX_ID DESC`,
      {},
      { outFormat: OUT_ARRAY }
    );
    return (result.rows ?? []).map((r) => ({
      tax_id: Number(r[0]), tax_desc: trimOrEmpty(r[1]), fyear: trimOrEmpty(r[2]),
      status: trimOrEmpty(r[3]), slabs: Number(r[4] || 0),
    }));
  } finally {
    await connection?.close();
  }
};

export const createTaxMaster = async (taxDesc, fyear, { usr = null } = {}) => {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let connection;
    try {
      connection = await getDirectConnection();
      await connection.execute(`LOCK TABLE HR_TAX_MST IN EXCLUSIVE MODE`);
      const idRes = await connection.execute(`SELECT NVL(MAX(TAX_ID), 0) + 1 FROM HR_TAX_MST`, {}, { outFormat: OUT_ARRAY });
      const taxId = Number(idRes.rows[0][0]);
      await connection.execute(
        `INSERT INTO HR_TAX_MST (TAX_ID, TAX_DESC, FYEAR, STATUS, USER_ID_UPD, USER_DATE_UPD)
         VALUES (:id, :d, :f, 'O', :usr, SYSDATE)`,
        { id: taxId, d: toStr(taxDesc), f: toStr(fyear), usr: toStr(usr) }
      );
      await connection.commit();
      return { status: "success", tax_id: taxId };
    } catch (err) {
      try { await connection?.rollback(); } catch { /* ignore */ }
      const msg = String(err?.message ?? "");
      if ((msg.includes("ORA-00001") || msg.includes("ORA-00054")) && attempt < maxRetries) {
        continue;
      }
      return { status: "error", message: err.message };
    } finally {
      await connection?.close();
    }
  }
};

export const setTaxMasterStatus = async (taxId, status) => {
  const st = String(status ?? "").toUpperCase().startsWith("O") ? "O" : "C";
  let connection;
  try {
    connection = await getDirectConnection();
    await connection.execute(
      `UPDATE HR_TAX_MST SET STATUS = :s, USER_DATE_UPD = SYSDATE WHERE TAX_ID = :id`,
      { s: st, id: toInt(taxId) }
    );
    await connection.commit();
    return { status: "success", new_status: st };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

export const deleteTaxMaster = async (taxId) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const tid = toInt(taxId);
    await connection.execute(`DELETE FROM HR_TAX_DTL WHERE TAX_ID = :id`, { id: tid });
    await connection.execute(`DELETE FROM HR_TAX_MST WHERE TAX_ID = :id`, { id: tid });
    await connection.commit();
    return { status: "success" };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

export const listTaxDetails = async (taxId) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `SELECT TAX_ID, SRNO, SLAB_FROM, SLAB_TO, SLAB_RATE,
              TO_CHAR(DATE_FROM,'YYYY-MM-DD'), TO_CHAR(DATE_TO,'YYYY-MM-DD'),
              SLAB_DED, FIXED_TAX
       FROM HR_TAX_DTL WHERE TAX_ID = :id ORDER BY SLAB_FROM, SRNO`,
      { id: toInt(taxId) },
      { outFormat: OUT_ARRAY }
    );
    return (result.rows ?? []).map((r) => ({
      tax_id: Number(r[0]), srno: r[1] !== null && r[1] !== undefined ? Number(r[1]) : null,
      slab_from: r[2], slab_to: r[3], slab_rate: r[4],
      date_from: r[5], date_to: r[6], slab_ded: r[7], fixed_tax: r[8],
    }));
  } finally {
    await connection?.close();
  }
};

export const addTaxDetail = async (taxId, slabFrom, slabTo, slabRate, dateFrom, dateTo, slabDed, fixedTax, { usr = null } = {}) => {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let connection;
    try {
      connection = await getDirectConnection();
      await connection.execute(`LOCK TABLE HR_TAX_DTL IN EXCLUSIVE MODE`);
      const srnoRes = await connection.execute(`SELECT NVL(MAX(SRNO), 0) + 1 FROM HR_TAX_DTL`, {}, { outFormat: OUT_ARRAY });
      const srno = Number(srnoRes.rows[0][0]);
      await connection.execute(
        `INSERT INTO HR_TAX_DTL
           (TAX_ID, SRNO, SLAB_FROM, SLAB_TO, SLAB_RATE, DATE_FROM, DATE_TO,
            SLAB_DED, FIXED_TAX, USER_ID_UPD, USER_DATE_UPD)
         VALUES (:t, :sr, :sf, :st, :rate,
                 TO_DATE(:df,'YYYY-MM-DD'), TO_DATE(:dt,'YYYY-MM-DD'),
                 :ded, :fix, :usr, SYSDATE)`,
        {
          t: toInt(taxId), sr: srno, sf: toNum(slabFrom), st: toNum(slabTo), rate: toNum(slabRate),
          df: toDateStr(dateFrom), dt: toDateStr(dateTo), ded: toNum(slabDed), fix: toNum(fixedTax), usr: toStr(usr),
        }
      );
      await connection.commit();
      return { status: "success", srno };
    } catch (err) {
      try { await connection?.rollback(); } catch { /* ignore */ }
      const msg = String(err?.message ?? "");
      if ((msg.includes("ORA-00001") || msg.includes("ORA-00054")) && attempt < maxRetries) {
        continue;
      }
      return { status: "error", message: err.message };
    } finally {
      await connection?.close();
    }
  }
};

export const deleteTaxDetail = async (taxId, srno) => {
  let connection;
  try {
    connection = await getDirectConnection();
    await connection.execute(`DELETE FROM HR_TAX_DTL WHERE TAX_ID = :t AND SRNO = :s`, {
      t: toInt(taxId), s: toInt(srno),
    });
    await connection.commit();
    return { status: "success" };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

// ════════════════════════════════════════════════════════════════
// MODULE 3 — LOANS
// ════════════════════════════════════════════════════════════════

export const listLoanTypes = async () => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `SELECT LOAN_CD, LOAN_DESC FROM HR_LOAN_TYPE WHERE LOAN_CD IS NOT NULL ORDER BY LOAN_DESC`,
      {},
      { outFormat: OUT_ARRAY }
    );
    return (result.rows ?? []).map((r) => ({ loan_cd: trimOrEmpty(r[0]), loan_desc: trimOrEmpty(r[1]) }));
  } finally {
    await connection?.close();
  }
};

export const addLoanType = async (loanDesc, { usr = null } = {}) => {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let connection;
    try {
      connection = await getDirectConnection();
      await connection.execute(`LOCK TABLE HR_LOAN_TYPE IN EXCLUSIVE MODE`);
      const cdRes = await connection.execute(
        `SELECT NVL(MAX(TO_NUMBER(LOAN_CD)), 0) + 1 FROM HR_LOAN_TYPE WHERE REGEXP_LIKE(LOAN_CD, '^[0-9]+$')`,
        {},
        { outFormat: OUT_ARRAY }
      );
      const cd = String(Math.trunc(Number(cdRes.rows[0][0])));
      await connection.execute(
        `INSERT INTO HR_LOAN_TYPE (LOAN_CD, LOAN_DESC, USR_ID_UPD, USR_DATE_UPD) VALUES (:c, :d, :usr, SYSDATE)`,
        { c: cd, d: toStr(loanDesc), usr: toStr(usr) }
      );
      await connection.commit();
      return { status: "success", loan_cd: cd, loan_desc: toStr(loanDesc) };
    } catch (err) {
      try { await connection?.rollback(); } catch { /* ignore */ }
      const msg = String(err?.message ?? "");
      if ((msg.includes("ORA-00001") || msg.includes("ORA-00054")) && attempt < maxRetries) {
        continue;
      }
      return { status: "error", message: err.message };
    } finally {
      await connection?.close();
    }
  }
};

export const deleteLoanType = async (loanCd) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(`DELETE FROM HR_LOAN_TYPE WHERE LOAN_CD = :c`, { c: String(loanCd) });
    await connection.commit();
    if (!result.rowsAffected) return { status: "error", message: "Loan type not found" };
    return { status: "success" };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

// Resolve the value to store in HR_LOAN_MST.OLD_EMPCODE for an employee —
// prefer their OLD_EMPCODE, else the empcode itself (mirrors _emp_link).
const empLink = async (connection, empcode) => {
  try {
    const result = await connection.execute(
      `SELECT OLD_EMPCODE FROM HR_EMP_MASTER WHERE EMPCODE = :e`,
      { e: empcode },
      { outFormat: OUT_ARRAY }
    );
    const r = result.rows?.[0];
    if (r && r[0]) return String(r[0]).trim();
  } catch { /* ignore, mirrors Python's bare except */ }
  return String(empcode);
};

export const listLoans = async (compc = null, empcode = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const conds = [];
    const params = {};
    const c = toInt(compc);
    if (c !== null) { conds.push("l.UNIT_ID = :u"); params.u = c; }
    if (empcode) {
      const link = await empLink(connection, String(empcode));
      conds.push("(l.OLD_EMPCODE = :e OR l.OLD_EMPCODE = :ec)");
      params.e = link;
      params.ec = String(empcode);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const sqlWithDept = `
      SELECT l."DOC#", l.OLD_EMPCODE, m.NAME, l.LOAN_CD, t.LOAN_DESC,
             NVL(dep.DEPT_NAME, TO_CHAR(m.DEPT_NO)) AS DEPT_NAME,
             TO_CHAR(l.LOAN_DATE,'YYYY-MM-DD'), l.LOAN_AMT, l.INSTALMENT_AMT,
             l.NOF_INSTALMENT, NVL(l.LOAN_RECOVER,0),
             TO_CHAR(l.START_DT,'YYYY-MM-DD'), l.CHARGE_INT, l.INT_RATE,
             l.CHQ_NO, TO_CHAR(l.CHQ_DT,'YYYY-MM-DD'), l.REMARKS, l.UNIT_ID
        FROM HR_LOAN_MST l
        LEFT JOIN HR_EMP_MASTER m ON (m.OLD_EMPCODE = l.OLD_EMPCODE OR m.EMPCODE = l.OLD_EMPCODE)
        LEFT JOIN HR_LOAN_TYPE t ON t.LOAN_CD = l.LOAN_CD
        LEFT JOIN HR_DEPT dep
               ON TO_CHAR(dep.DEPT_NO) = TO_CHAR(m.DEPT_NO) AND TO_CHAR(dep.COMPC) = TO_CHAR(m.UNIT_ID)
        ${where}
       ORDER BY l."DOC#" DESC
    `;
    // Department join can fail on odd data types — retry without it (mirrors
    // the ORA- fallback in payroll_repository.py:list_loans).
    const sqlWithoutDept = `
      SELECT l."DOC#", l.OLD_EMPCODE, m.NAME, l.LOAN_CD, t.LOAN_DESC,
             TO_CHAR(m.DEPT_NO) AS DEPT_NAME,
             TO_CHAR(l.LOAN_DATE,'YYYY-MM-DD'), l.LOAN_AMT, l.INSTALMENT_AMT,
             l.NOF_INSTALMENT, NVL(l.LOAN_RECOVER,0),
             TO_CHAR(l.START_DT,'YYYY-MM-DD'), l.CHARGE_INT, l.INT_RATE,
             l.CHQ_NO, TO_CHAR(l.CHQ_DT,'YYYY-MM-DD'), l.REMARKS, l.UNIT_ID
        FROM HR_LOAN_MST l
        LEFT JOIN HR_EMP_MASTER m ON (m.OLD_EMPCODE = l.OLD_EMPCODE OR m.EMPCODE = l.OLD_EMPCODE)
        LEFT JOIN HR_LOAN_TYPE t ON t.LOAN_CD = l.LOAN_CD
        ${where}
       ORDER BY l."DOC#" DESC
    `;

    let result;
    try {
      result = await connection.execute(sqlWithDept, params, { outFormat: OUT_ARRAY });
    } catch (err) {
      if (!String(err.message).includes("ORA-")) throw err;
      logger.warn({ err }, "[payroll] listLoans department join failed, retrying without it");
      result = await connection.execute(sqlWithoutDept, params, { outFormat: OUT_ARRAY });
    }

    return (result.rows ?? []).map((r) => {
      const amt = Number(r[7] || 0);
      const rec = Number(r[10] || 0);
      return {
        doc: Number(r[0]), old_empcode: trimOrEmpty(r[1]), name: trimOrEmpty(r[2]),
        loan_cd: trimOrEmpty(r[3]), loan_desc: trimOrEmpty(r[4]),
        dept_name: trimOrEmpty(r[5]), loan_date: r[6], loan_amt: amt,
        instalment_amt: r[8], nof_instalment: r[9], loan_recover: rec,
        balance: amt - rec, start_dt: r[11], charge_int: trimOrEmpty(r[12]),
        int_rate: r[13], chq_no: trimOrEmpty(r[14]), chq_dt: r[15],
        remarks: trimOrEmpty(r[16]), unit_id: r[17],
      };
    });
  } finally {
    await connection?.close();
  }
};

export const createLoan = async (
  empcode, loanCd, loanDate, loanAmt, instalmentAmt, nofInstalment,
  startDt, chargeInt, intRate, chqNo, chqDt, remarks, compc, { usr = null } = {}
) => {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let connection;
    try {
      connection = await getDirectConnection();
      if (!toStr(empcode)) return { status: "error", message: "Employee is required" };
      const c = toInt(compc) || 1;
      const link = await empLink(connection, String(empcode));

      await connection.execute(`LOCK TABLE HR_LOAN_MST IN EXCLUSIVE MODE`);

      const docRes = await connection.execute(`SELECT NVL(MAX("DOC#"), 0) + 1 FROM HR_LOAN_MST`, {}, { outFormat: OUT_ARRAY });
      const doc = Number(docRes.rows[0][0]);
      const ld = toDateStr(loanDate) || getTodayLocalDateStr();
      await connection.execute(
        `INSERT INTO HR_LOAN_MST
           ("DOC#", DOC_DT, UNIT_ID, OLD_EMPCODE, LOAN_CD, LOAN_DATE, LOAN_AMT,
            LOAN_RECOVER, INSTALMENT_AMT, NOF_INSTALMENT, START_DT, CHARGE_INT,
            INT_RATE, USR_ID_UPD, USR_DATE_UPD, REMARKS, CHQ_NO, CHQ_DT)
         VALUES (:doc, TO_DATE(:ld,'YYYY-MM-DD'), :u, :emp, :lc, TO_DATE(:ld,'YYYY-MM-DD'),
                 :amt, 0, :inst, :nof, TO_DATE(:sd,'YYYY-MM-DD'), :ci, :ir, :usr, SYSDATE,
                 :rem, :chq, TO_DATE(:chqd,'YYYY-MM-DD'))`,
        {
          doc, ld, u: c, emp: link, lc: toStr(loanCd),
          amt: toNum(loanAmt), inst: toNum(instalmentAmt), nof: toInt(nofInstalment),
          sd: toDateStr(startDt) || ld, ci: String(chargeInt ?? "").toUpperCase().startsWith("Y") ? "Y" : "N",
          ir: toNum(intRate), usr: toStr(usr), rem: toStr(remarks),
          chq: toStr(chqNo), chqd: toDateStr(chqDt),
        }
      );
      await connection.commit();
      return { status: "success", doc };
    } catch (err) {
      try { await connection?.rollback(); } catch { /* ignore */ }
      const msg = String(err?.message ?? "");
      if ((msg.includes("ORA-00001") || msg.includes("ORA-00054")) && attempt < maxRetries) {
        continue;
      }
      return { status: "error", message: err.message };
    } finally {
      await connection?.close();
    }
  }
};

export const updateLoan = async (
  doc,
  { loanCd = null, loanDate = null, loanAmt = null, instalmentAmt = null, nofInstalment = null,
    startDt = null, chargeInt = null, intRate = null, chqNo = null, chqDt = null, remarks = null } = {}
) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const sets = [];
    const params = { doc: toInt(doc) };
    for (const [key, col, val] of [
      ["lc", "LOAN_CD", toStr(loanCd)], ["amt", "LOAN_AMT", toNum(loanAmt)],
      ["inst", "INSTALMENT_AMT", toNum(instalmentAmt)], ["nof", "NOF_INSTALMENT", toInt(nofInstalment)],
      ["ir", "INT_RATE", toNum(intRate)], ["rem", "REMARKS", toStr(remarks)],
      ["chq", "CHQ_NO", toStr(chqNo)],
    ]) {
      if (val !== null && val !== undefined) { sets.push(`${col} = :${key}`); params[key] = val; }
    }
    if (chargeInt !== null && chargeInt !== undefined) {
      sets.push("CHARGE_INT = :ci");
      params.ci = String(chargeInt).toUpperCase().startsWith("Y") ? "Y" : "N";
    }
    for (const [key, col, val] of [
      ["ld", "LOAN_DATE", toDateStr(loanDate)], ["sd", "START_DT", toDateStr(startDt)], ["chqd", "CHQ_DT", toDateStr(chqDt)],
    ]) {
      if (val !== null && val !== undefined) { sets.push(`${col} = TO_DATE(:${key},'YYYY-MM-DD')`); params[key] = val; }
    }
    if (sets.length === 0) return { status: "error", message: "Nothing to update" };
    sets.push("USR_DATE_UPD = SYSDATE");
    await connection.execute(`UPDATE HR_LOAN_MST SET ${sets.join(", ")} WHERE "DOC#" = :doc`, params);
    await connection.commit();
    return { status: "success" };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

export const deleteLoan = async (doc, compc = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const params = { doc: toInt(doc) };
    let where = `"DOC#" = :doc`;
    const c = toInt(compc);
    if (c !== null) { where += " AND UNIT_ID = :u"; params.u = c; }
    const result = await connection.execute(`DELETE FROM HR_LOAN_MST WHERE ${where}`, params);
    await connection.commit();
    if (!result.rowsAffected) return { status: "error", message: "Loan not found" };
    return { status: "success" };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

// ════════════════════════════════════════════════════════════════
// MODULE 4 — SALARY / PAYSLIP (read-only)
// ════════════════════════════════════════════════════════════════

// Fiscal year runs Jul→Jun. Returns [fiscal_start, cal_start] as YYYY-MM-DD.
const fiscalCalStarts = (periodFrm) => {
  if (!periodFrm || periodFrm.length < 7) return [null, null];
  const y = Number(periodFrm.slice(0, 4));
  const m = Number(periodFrm.slice(5, 7));
  const fy = m >= 7 ? y : y - 1;
  return [`${fy}-07-01`, `${y}-01-01`];
};

export const listSalaryPeriods = async (compc = null, brnch = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `SELECT m."PERIOD#", TO_CHAR(MIN(p.PERIOD_FRM),'YYYY-MM-DD'),
              TO_CHAR(MIN(p.PERIOD_TO),'YYYY-MM-DD'), COUNT(*)
       FROM HR_SALARY_PROCESS_MASTER m
       LEFT JOIN HR_ATTND_PERIOD p ON p."PERIOD#" = m."PERIOD#" AND p.UNIT_ID = m.UNIT_ID
       WHERE (:u IS NULL OR m.UNIT_ID = :u)
         AND (:b IS NULL OR TRIM(m.LOCATION) = TRIM(:b))
       GROUP BY m."PERIOD#" ORDER BY m."PERIOD#" DESC`,
      { u: toInt(compc), b: toStr(brnch) },
      { outFormat: OUT_ARRAY }
    );
    return (result.rows ?? []).map((r) => ({
      period: Number(r[0]), period_frm: r[1], period_to: r[2],
      label: label(r[1]) || `Period ${Number(r[0])}`, emp_count: Number(r[3]),
    }));
  } finally {
    await connection?.close();
  }
};

export const listProcessedSalaries = async (compc, period, q = null, brnch = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `SELECT m.OLD_EMPCODE,
              (SELECT MAX(e.NAME) FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE=m.OLD_EMPCODE OR e.EMPCODE=m.OLD_EMPCODE),
              (SELECT MAX(e."ATDTCARD#") FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE=m.OLD_EMPCODE OR e.EMPCODE=m.OLD_EMPCODE),
              (SELECT MAX(e.EMPCODE) FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE=m.OLD_EMPCODE OR e.EMPCODE=m.OLD_EMPCODE),
              NVL((SELECT MIN(d.DEPT_NAME) FROM HR_DEPT d
                     WHERE LTRIM(d.DEPT_NO,'0')=LTRIM(m.DEPT_NO,'0') AND TO_CHAR(d.COMPC)=TO_CHAR(m.UNIT_ID)),
                  TO_CHAR(m.DEPT_NO)),
              NVL(m.ACTUAL_GROSS,0), NVL(m.EARNED_GROSS,0), NVL(m.TOTAL_EARNING,0),
              (SELECT NVL(SUM(s.TRANS_AMOUNT),0) FROM HR_SALARY_PROCESS s
                 WHERE s.OLD_EMPCODE=m.OLD_EMPCODE AND s."PERIOD#"=m."PERIOD#" AND s.UNIT_ID=m.UNIT_ID AND s.TRANS_TYPE='D'),
              m.SAL
       FROM HR_SALARY_PROCESS_MASTER m
       WHERE m."PERIOD#" = :p AND (:u IS NULL OR m.UNIT_ID = :u)
         AND (:b IS NULL OR TRIM(m.LOCATION) = TRIM(:b))
       ORDER BY 2`,
      { p: toInt(period), u: toInt(compc), b: toStr(brnch) },
      { outFormat: OUT_ARRAY }
    );
    let out = (result.rows ?? []).map((r) => {
      const earned = Number(r[6] || 0);
      const ded = Number(r[8] || 0);
      const net = r[9] !== null && r[9] !== undefined ? Number(r[9]) : earned - ded;
      return {
        old_empcode: trimOrEmpty(r[0]), name: trimOrEmpty(r[1]),
        atdtcard: trimOrEmpty(r[2]), empcode: trimOrEmpty(r[3]),
        dept_name: trimOrEmpty(r[4]), actual_gross: Number(r[5] || 0),
        earned_gross: earned, total_earning: Number(r[7] || 0),
        total_deduction: ded, net,
      };
    });
    if (q) {
      const ql = q.toLowerCase();
      out = out.filter(
        (o) => o.name.toLowerCase().includes(ql) || o.old_empcode.toLowerCase().includes(ql) || o.atdtcard.toLowerCase().includes(ql)
      );
    }
    return out;
  } finally {
    await connection?.close();
  }
};

export const getPayslip = async (compc, empcode, period) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const u = toInt(compc);
    const per = toInt(period);

    let key = String(empcode);
    try {
      const keyRes = await connection.execute(
        `SELECT OLD_EMPCODE FROM HR_EMP_MASTER WHERE EMPCODE = :e`,
        { e: String(empcode) },
        { outFormat: OUT_ARRAY }
      );
      const kr = keyRes.rows?.[0];
      if (kr && kr[0]) key = String(kr[0]).trim();
    } catch { /* ignore, mirrors Python's bare except */ }

    const mRes = await connection.execute(
      `SELECT NVL(m.ACTUAL_GROSS,0), NVL(m.ACTUAL_BASIC,0), NVL(m.EARNED_GROSS,0), NVL(m.EARNED_BASIC,0),
              NVL(m.W_DAY,0), NVL(m.ABSENT_DAYS,0), NVL(m.TOTAL_EARNING,0), m.SAL, m.GRADE_CD, m.DEPT_NO,
              m.LOCATION, m.BNKACCT, m.EMP_STATUS, m.OLD_EMPCODE,
              (SELECT MIN(d.DEPT_NAME) FROM HR_DEPT d WHERE LTRIM(d.DEPT_NO,'0')=LTRIM(m.DEPT_NO,'0') AND TO_CHAR(d.COMPC)=TO_CHAR(m.UNIT_ID)),
              (SELECT MIN(l.DESCR) FROM COM_LOCATION l WHERE TRIM(l.LCODE)=TRIM(m.LOCATION))
       FROM HR_SALARY_PROCESS_MASTER m
       WHERE m.OLD_EMPCODE IN (:e, :ec) AND m."PERIOD#" = :p AND (:u IS NULL OR m.UNIT_ID = :u)
       FETCH FIRST 1 ROWS ONLY`,
      { e: key, ec: String(empcode), p: per, u },
      { outFormat: OUT_ARRAY }
    );
    const m = mRes.rows?.[0];
    if (!m) return null;
    key = m[13] || key;
    const mDept = m[14] ? String(m[14]).trim() : null;
    const mLoc = m[15] ? String(m[15]).trim() : null;

    const prRes = await connection.execute(
      `SELECT TO_CHAR(PERIOD_FRM,'YYYY-MM-DD'), TO_CHAR(PERIOD_TO,'YYYY-MM-DD')
       FROM HR_ATTND_PERIOD WHERE "PERIOD#" = :p AND (:u IS NULL OR UNIT_ID = :u) FETCH FIRST 1 ROWS ONLY`,
      { p: per, u },
      { outFormat: OUT_ARRAY }
    );
    const pr = prRes.rows?.[0];
    const pfrm = pr ? pr[0] : null;
    const pend = (pr ? pr[1] : null) || "2099-12-31";
    const [fstart, cstart] = pfrm ? fiscalCalStarts(pfrm) : [null, null];
    const starts = [fstart, cstart].filter(Boolean).sort();
    const minstart = starts.length ? starts[0] : null;

    const hRes = await connection.execute(
      `SELECT NAME, "ATDTCARD#", TO_CHAR(DTOFAPPT,'YYYY-MM-DD'), GRADE_CD,
              (SELECT MIN(dg.DESG_DESC) FROM HR_DESG dg
                 WHERE LTRIM(dg.DESG_CD,'0')=LTRIM(HR_EMP_MASTER.DESG_CD,'0')
                   AND TO_CHAR(dg.COMPC)=TO_CHAR(HR_EMP_MASTER.UNIT_ID)),
              (SELECT MIN(d.DEPT_NAME) FROM HR_DEPT d
                 WHERE LTRIM(d.DEPT_NO,'0')=LTRIM(HR_EMP_MASTER.DEPT_NO,'0') AND TO_CHAR(d.COMPC)=TO_CHAR(HR_EMP_MASTER.UNIT_ID)),
              (SELECT MIN(l.DESCR) FROM COM_LOCATION l WHERE TRIM(l.LCODE)=TRIM(HR_EMP_MASTER.LOCATION)),
              (SELECT MIN(s.EMP_STATUS_DESC) FROM HR_EMP_STATUS s WHERE s.EMP_STATUS = HR_EMP_MASTER.EMP_STATUS),
              BNKACCT, (SELECT MIN(u2.UNIT_NAME) FROM UNIT_MST u2 WHERE u2.UNIT_ID = HR_EMP_MASTER.UNIT_ID),
              EMPCODE
       FROM HR_EMP_MASTER WHERE OLD_EMPCODE = :e OR EMPCODE = :ec FETCH FIRST 1 ROWS ONLY`,
      { e: key, ec: String(empcode) },
      { outFormat: OUT_ARRAY }
    );
    const h = hRes.rows?.[0] || Array(11).fill(null);

    const lRes = await connection.execute(
      `SELECT l.TRANS_TYPE,
              SUM(CASE WHEN l."PERIOD#" = :p THEN l.TRANS_AMOUNT ELSE 0 END),
              SUM(CASE WHEN :fstart IS NOT NULL AND pp.PERIOD_FRM BETWEEN TO_DATE(:fstart,'YYYY-MM-DD') AND TO_DATE(:pend,'YYYY-MM-DD') THEN l.TRANS_AMOUNT ELSE 0 END),
              SUM(CASE WHEN :cstart IS NOT NULL AND pp.PERIOD_FRM BETWEEN TO_DATE(:cstart,'YYYY-MM-DD') AND TO_DATE(:pend,'YYYY-MM-DD') THEN l.TRANS_AMOUNT ELSE 0 END),
              MAX(CASE WHEN l.TRANS_TYPE='A' THEN a.ALLOWANCE_DESC ELSE d.DED_DESC END),
              MAX(NVL(CASE WHEN l.TRANS_TYPE='A' THEN a.PAY_SEQ ELSE d.PAY_SEQ END, 999)),
              MAX(NVL(a.ALLOWANCE_TYPE, 2)), l.TRANS_ID
       FROM HR_SALARY_PROCESS l
       LEFT JOIN HR_ATTND_PERIOD pp ON pp."PERIOD#" = l."PERIOD#" AND pp.UNIT_ID = l.UNIT_ID
       LEFT JOIN HR_ALLOWANCE a ON l.TRANS_TYPE='A' AND TRIM(TO_CHAR(a.ALLOWANCE_ID)) = TRIM(l.TRANS_ID)
       LEFT JOIN HR_DEDUCTION d ON l.TRANS_TYPE='D' AND TRIM(TO_CHAR(d.DED_CD)) = TRIM(l.TRANS_ID)
       WHERE l.OLD_EMPCODE = :e AND (:u IS NULL OR l.UNIT_ID = :u)
         AND (l."PERIOD#" = :p OR (:minstart IS NOT NULL AND pp.PERIOD_FRM BETWEEN TO_DATE(:minstart,'YYYY-MM-DD') AND TO_DATE(:pend,'YYYY-MM-DD')))
       GROUP BY l.TRANS_TYPE, l.TRANS_ID
       ORDER BY l.TRANS_TYPE, MAX(NVL(CASE WHEN l.TRANS_TYPE='A' THEN a.PAY_SEQ ELSE d.PAY_SEQ END, 999))`,
      { p: per, e: key, u, fstart, cstart, pend, minstart },
      { outFormat: OUT_ARRAY }
    );

    const earnings = [];
    const deductions = [];
    for (const r of lRes.rows ?? []) {
      const it = {
        desc: trimOrEmpty(r[4] || r[7]),
        this: Number(r[1] || 0), fiscal: Number(r[2] || 0), cal: Number(r[3] || 0),
        atype: Number(r[6] || 2),
      };
      (r[0] === "A" ? earnings : deductions).push(it);
    }

    const master = {
      actual_gross: Number(m[0]), actual_basic: Number(m[1]),
      earned_gross: Number(m[2]), earned_basic: Number(m[3]),
      w_day: Number(m[4]), absent_days: Number(m[5]),
      total_earning: Number(m[6]), net_pay: m[7] !== null && m[7] !== undefined ? Number(m[7]) : null,
    };
    const dedThis = deductions.reduce((s, d) => s + d.this, 0);
    const dedFiscal = deductions.reduce((s, d) => s + d.fiscal, 0);
    const dedCal = deductions.reduce((s, d) => s + d.cal, 0);
    const net = master.net_pay !== null ? master.net_pay : master.total_earning - dedThis;

    const loanRes = await connection.execute(
      `SELECT NVL(t.LOAN_DESC,'Loan'), NVL(l.LOAN_AMT,0) - NVL(l.LOAN_RECOVER,0)
       FROM HR_LOAN_MST l LEFT JOIN HR_LOAN_TYPE t ON t.LOAN_CD = l.LOAN_CD
       WHERE (l.OLD_EMPCODE = :e OR l.OLD_EMPCODE = :ec) AND (:u IS NULL OR l.UNIT_ID = :u)
         AND NVL(l.LOAN_AMT,0) - NVL(l.LOAN_RECOVER,0) > 0`,
      { e: key, ec: String(empcode), u },
      { outFormat: OUT_ARRAY }
    );
    const loans = (loanRes.rows ?? []).map((r) => ({ loan_desc: trimOrEmpty(r[0]) || "Loan", balance: Number(r[1] || 0) }));

    return {
      header: {
        name: trimOrEmpty(h[0]), code: trimOrEmpty(h[10] || String(empcode)),
        atdtcard: trimOrEmpty(h[1]),
        joining_date: h[2], grade: trimOrEmpty(h[3] || m[8]),
        designation: trimOrEmpty(h[4]), dept_name: mDept || trimOrEmpty(h[5]),
        location: mLoc || trimOrEmpty(h[6]), emp_type: trimOrEmpty(h[7]),
        bank_acct: trimOrEmpty(h[8] || m[11]), company_name: trimOrEmpty(h[9]),
        company_compc: u !== null ? String(u) : "",
        period_label: pfrm ? label(pfrm) : `Period ${per}`,
        w_day: master.w_day, absent_days: master.absent_days,
        earning_days: master.w_day - master.absent_days,
      },
      earnings, deductions, master,
      totals: {
        earning_this: master.total_earning, deduction_this: dedThis,
        deduction_fiscal: dedFiscal, deduction_cal: dedCal, net_payable: net,
      },
      loans,
    };
  } finally {
    await connection?.close();
  }
};

export const getOpenPeriod = async (compc) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `SELECT "PERIOD#", RULE_ID, TO_CHAR(PERIOD_FRM,'YYYY-MM-DD'), TO_CHAR(PERIOD_TO,'YYYY-MM-DD')
       FROM HR_ATTND_PERIOD
       WHERE UNIT_ID = :u AND UPPER(NVL(STATUS,'O')) = 'O'
       ORDER BY PERIOD_FRM DESC, "PERIOD#" DESC FETCH FIRST 1 ROWS ONLY`,
      { u: toInt(compc) },
      { outFormat: OUT_ARRAY }
    );
    const r = result.rows?.[0];
    if (!r) return null;
    return {
      period: Number(r[0]), rule_id: r[1] !== null && r[1] !== undefined ? Number(r[1]) : null,
      period_frm: r[2], period_to: r[3], label: label(r[2]) || `Period ${Number(r[0])}`,
    };
  } finally {
    await connection?.close();
  }
};

// Run the ERP salary-process procedure HR_SALARY_PROCES_PRO for the company's
// currently OPEN period. The procedure recomputes attendance and rebuilds
// HR_SALARY_PROCESS / HR_SALARY_PROCESS_MASTER for that unit & period.
//
// Signature: HR_SALARY_PROCES_PRO(MUNIT, MPRIOD, MPRIOD_FRM, MPRIOD_TO, MRULE_ID).
// node-oracledb has no callproc() — this uses an anonymous PL/SQL block instead,
// binding the PERIOD_FRM/PERIOD_TO DATE values fetched above directly (they come
// back as native JS Date objects), matching the Python cur.callproc(...) call.
export const runSalaryProcess = async (compc) => {
  const u = toInt(compc);
  if (u === null) return { status: "error", message: "Company is required" };
  let connection;
  try {
    connection = await getDirectConnection();
    const periodRes = await connection.execute(
      `SELECT "PERIOD#", RULE_ID, PERIOD_FRM, PERIOD_TO, TO_CHAR(PERIOD_FRM,'YYYY-MM-DD')
       FROM HR_ATTND_PERIOD
       WHERE UNIT_ID = :u AND UPPER(NVL(STATUS,'O')) = 'O'
       ORDER BY PERIOD_FRM DESC, "PERIOD#" DESC FETCH FIRST 1 ROWS ONLY`,
      { u },
      { outFormat: OUT_ARRAY }
    );
    const row = periodRes.rows?.[0];
    if (!row) return { status: "error", message: "No open period for this company. Open a period first." };
    const period = Number(row[0]);
    const ruleId = row[1] !== null && row[1] !== undefined ? Number(row[1]) : null;
    const pfrm = row[2];
    const pto = row[3];

    await connection.execute(`BEGIN HR_SALARY_PROCES_PRO(:unit, :period, :pfrm, :pto, :rule); END;`, {
      unit: u, period, pfrm, pto, rule: ruleId,
    });
    await connection.commit();

    const countRes = await connection.execute(
      `SELECT COUNT(*) FROM HR_SALARY_PROCESS_MASTER WHERE UNIT_ID = :u AND "PERIOD#" = :p`,
      { u, p: period },
      { outFormat: OUT_ARRAY }
    );
    const processed = Number(countRes.rows?.[0]?.[0] || 0);
    return { status: "success", period, label: label(row[4]) || `Period ${period}`, processed };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

// ════════════════════════════════════════════════════════════════
// MODULE 5 — PAY REGISTER (read-only, from HR_PAY_REG_V)
// ════════════════════════════════════════════════════════════════

export const getPayRegisterPeriods = async (unitId, ruleId = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const u = toInt(unitId);
    const rId = toInt(ruleId);
    const binds = { u };
    let pRuleFilter = "";
    if (rId !== null) {
      pRuleFilter = " AND p.RULE_ID = :rId";
      binds.rId = rId;
    }
    const result = await connection.execute(
      `SELECT period_no, MIN(period_frm) AS pfrm, MAX(period_name) AS pname, MAX(rule_id) AS rule_id
       FROM (
         SELECT p."PERIOD#" AS period_no, TO_CHAR(p.PERIOD_FRM, 'YYYY-MM-DD') AS period_frm,
                p.SCODE AS period_name, p.RULE_ID AS rule_id
         FROM HR_ATTND_PERIOD p
         WHERE (:u IS NULL OR p.UNIT_ID = :u) ${pRuleFilter}
         UNION ALL
         SELECT v.period# AS period_no, NULL AS period_frm,
                codename('PERIOD#', v.period#, v.unit_id) AS period_name,
                NULL AS rule_id
         FROM HR_PAY_REG_V v
         WHERE (:u IS NULL OR v.unit_id = :u) AND NVL(v.amont, 0) <> 0
       )
       GROUP BY period_no
       ORDER BY period_no DESC`,
      binds,
      { outFormat: OUT_ARRAY }
    );
    return (result.rows ?? []).map((r) => {
      const pno = Number(r[0]);
      const pfrm = r[1];
      const pname = trimOrEmpty(r[2]);
      const rid = r[3] != null ? Number(r[3]) : null;
      const l = label(pfrm) || pname || `Period ${pno}`;
      return { period: pno, label: l, rule_id: rid };
    });
  } finally {
    await connection?.close();
  }
};

// Sort key for allow_cols/ded_cols: (int(trans_id), descr) if trans_id parses
// as a pure integer, else (9999, descr) — mirrors _order_cols in
// payroll_register_repository.py exactly (Python int() rejects decimals).
const colSortKey = ([descr, tid]) => {
  if (tid === null || tid === undefined) return [9999, descr];
  const s = String(tid).trim();
  if (!/^-?\d+$/.test(s)) return [9999, descr];
  return [parseInt(s, 10), descr];
};

export const getPayRegister = async (unitId, period, location = null, deptNo = null, desgCd = null, empcode = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    let filters = "";
    const binds = { unit_id: toInt(unitId), period: toInt(period) };
    if (location) { filters += " AND a.location = :location"; binds.location = String(location); }
    if (deptNo) { filters += " AND a.dept_no = :dept_no"; binds.dept_no = String(deptNo); }
    if (desgCd) { filters += " AND a.desg_cd = :desg_cd"; binds.desg_cd = String(desgCd); }
    if (empcode) { filters += " AND a.old_empcode = :empcode"; binds.empcode = String(empcode); }

    const result = await connection.execute(
      `SELECT b.UNIT_NAME,
              codename('LOCATION', a.location, a.unit_id)  AS loc_name,
              codename('DEPT_NO',  a.dept_no,  a.unit_id)  AS dep_name,
              codename('DESG_CD',  a.desg_cd,  a.unit_id)  AS desg_name,
              a.old_empcode, b.NAME,
              a.w_day, a.absent_days,
              a.actual_gross, a.actual_basic, a.earned_gross, a.earned_basic,
              a.trans_type, a.period#,
              codename('PERIOD#', a.period#, a.unit_id)    AS period_name,
              a.hold_sal, a.trans_id, a.descr, a.amont,
              a.location, a.dept_no, a.desg_cd
         FROM HR_PAY_REG_V a, hr_emp_master_view b
        WHERE a.old_empcode = b.OLD_EMPCODE
          AND a.unit_id = b.UNIT_ID
          AND a.unit_id = :unit_id
          AND a.period# = :period
          AND NVL(a.amont, 0) <> 0
          ${filters}
        ORDER BY loc_name, dep_name, b.NAME, a.old_empcode, a.trans_type, a.trans_id`,
      binds,
      { outFormat: OUT_OBJECT }
    );
    const rows = (result.rows ?? []).map(lowerKeys);

    const emps = {};
    const order = [];
    const allowCols = new Map();
    const dedCols = new Map();
    let unitName = "";
    let periodName = "";

    const s = (v) => (typeof v === "string" ? v.trim() : v || "");

    for (const r of rows) {
      unitName = unitName || s(r.unit_name);
      periodName = periodName || s(r.period_name);
      const ec = r.old_empcode;
      if (!(ec in emps)) {
        emps[ec] = {
          old_empcode: ec, name: s(r.name), location: s(r.loc_name),
          department: s(r.dep_name), designation: s(r.desg_name),
          w_day: r.w_day, absent_days: r.absent_days,
          actual_gross: r.actual_gross, actual_basic: r.actual_basic,
          earned_gross: r.earned_gross, earned_basic: r.earned_basic,
          hold_sal: s(r.hold_sal), allows: {}, deds: {},
          tot_all: 0, tot_ded: 0, net: 0,
        };
        order.push(ec);
      }
      const e = emps[ec];
      const tt = s(r.trans_type).toUpperCase();
      const descr = s(r.descr);
      const amt = r.amont || 0;
      const tid = r.trans_id;

      if (descr === "TOT_ALL") e.tot_all = amt;
      else if (descr === "TOT_DED") e.tot_ded = amt;
      else if (descr === "NET" || tt === "X") e.net = amt;
      else if (tt === "A") {
        e.allows[descr] = (e.allows[descr] || 0) + amt;
        if (!allowCols.has(descr)) allowCols.set(descr, tid);
      } else if (tt === "D") {
        e.deds[descr] = (e.deds[descr] || 0) + amt;
        if (!dedCols.has(descr)) dedCols.set(descr, tid);
      }
    }

    if (!periodName) {
      try {
        const pNameRes = await connection.execute(
          `SELECT NVL(NULLIF(TRIM(codename('PERIOD#', :p, :u)), ''), NVL(TRIM(SCODE), TO_CHAR(PERIOD_FRM, 'MON - YYYY')))
             FROM HR_ATTND_PERIOD WHERE "PERIOD#" = :p AND (:u IS NULL OR UNIT_ID = :u)`,
          { p: toInt(period), u: toInt(unitId) },
          { outFormat: OUT_ARRAY }
        );
        if (pNameRes.rows?.[0]?.[0]) periodName = String(pNameRes.rows[0][0]).trim();
      } catch { /* ignore fallback error */ }
    }

    const orderCols = (m) =>
      [...m.entries()]
        .sort((a, b) => {
          const [ka0, ka1] = colSortKey(a);
          const [kb0, kb1] = colSortKey(b);
          if (ka0 !== kb0) return ka0 - kb0;
          return ka1 < kb1 ? -1 : ka1 > kb1 ? 1 : 0;
        })
        .map(([descr]) => descr);

    return {
      unit_name: unitName, period: toInt(period), period_name: periodName,
      allow_cols: orderCols(allowCols), ded_cols: orderCols(dedCols),
      employees: order.map((ec) => emps[ec]),
    };
  } finally {
    await connection?.close();
  }
};
