/**
 * Provident Fund ledger service — profit, company share, PF loans, zakat and
 * settlement for the /pf/* routes (alongside pf.service.js, which serves the
 * deduction-only balances, enrolment and opening screens).
 *
 * All arithmetic lives in utils/pfEngine.js; this file only loads the inputs
 * (salary-process contributions, PF loans, withdrawals, take-on balances,
 * declared rates, posted years) and persists posted years. Tables are created
 * by sql/2026-10-01_provident_fund.sql.
 *
 * Contributions are never typed in: each finalised salary month gives
 * (EARNED_GROSS - HR_DESG.FPO_AMOUNT) / 1.55 × 8.33%, and the company part is
 * the same amount. Permanent withdrawals and PF loans come from HR_LOAN_MST
 * (loan types 16 and 5); opening balances can be imported from HR_PF_BALANCES.
 */

import oracledb from "oracledb";
import { getDirectConnection } from "../config/database.js";
import {
  PF_DEFAULTS, buildHistory, computeSettlement, fiscalYearOf, fyLabel,
} from "../utils/pfEngine.js";

const OUT_ARRAY = 4001; // oracledb.OUT_FORMAT_ARRAY

const toInt = (v, def = null) => {
  if (v === null || v === undefined || String(v).trim() === "") return def;
  const f = Number(v);
  return Number.isFinite(f) ? Math.trunc(f) : def;
};
const toNum = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const f = Number(v);
  return Number.isFinite(f) ? f : null;
};
const toStr = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
const toDateStr = (v) => (v ? toStr(String(v).slice(0, 10)) : null);
const trimOrEmpty = (v) => (v === null || v === undefined ? "" : String(v).trim());
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const isFyStart = (s) => /^\d{4}-07-01$/.test(s || "");

const fail = (message) => ({ status: "error", message });

// ════════════════════════════════════════════════════════════════
// LOADERS (connection supplied by the caller)
// ════════════════════════════════════════════════════════════════

// Defaults match the ERP: deduction 12 = PROVIDENT FUND, loan type 5 = LOAN AGAINST P.F,
// loan type 16 = PERMANENT WITHDRAWAL-PF (HR_LOAN_TYPE is global, not per company).
const DEFAULT_PF_DED_CODE = "12";
const DEFAULT_LOAN_CODES = ["5"];
const WITHDRAWAL_LOAN_CODES = ["16"];

const loadSettings = async (connection, unit) => {
  const res = await connection.execute(
    `SELECT PF_DED_CODE, LOAN_CODES, LOAN_SPREAD, ZAKAT_RATE FROM HR_PF_SETTINGS WHERE UNIT_ID = :u`,
    { u: unit },
    { outFormat: OUT_ARRAY }
  );
  const r = res.rows?.[0];
  const cfg = { ...PF_DEFAULTS };
  let pfDedCode = DEFAULT_PF_DED_CODE;
  let loanCodes = DEFAULT_LOAN_CODES;
  if (r) {
    pfDedCode = trimOrEmpty(r[0]) || DEFAULT_PF_DED_CODE;
    loanCodes = String(r[1] || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (r[2] !== null) cfg.loanSpread = Number(r[2]);
    if (r[3] !== null) cfg.zakatRate = Number(r[3]);
  }
  return { cfg, pfDedCode, loanCodes };
};

const loadMemberFlags = async (connection, unit, oldEmp) => {
  const res = await connection.execute(
    `SELECT OLD_EMPCODE, ZAKAT_EXEMPT, TO_CHAR(DECL_DATE,'YYYY-MM-DD'), DECL_REF, REMARKS
       FROM HR_PF_MEMBER WHERE UNIT_ID = :u AND (:e IS NULL OR OLD_EMPCODE = :e)`,
    { u: unit, e: oldEmp },
    { outFormat: OUT_ARRAY }
  );
  const map = {};
  for (const r of res.rows ?? []) {
    map[trimOrEmpty(r[0])] = {
      zakat_exempt: trimOrEmpty(r[1]) === "Y", decl_date: r[2], decl_ref: trimOrEmpty(r[3]), remarks: trimOrEmpty(r[4]),
    };
  }
  return map;
};

const loadRates = async (connection, unit) => {
  const res = await connection.execute(
    `SELECT TO_CHAR(FY_FROM,'YYYY-MM-DD'), TO_CHAR(FY_TO,'YYYY-MM-DD'), PROFIT_RATE, STATUS, REMARKS,
            TO_CHAR(POSTED_ON,'YYYY-MM-DD')
       FROM HR_PF_PROFIT_RATE WHERE UNIT_ID = :u ORDER BY FY_FROM`,
    { u: unit },
    { outFormat: OUT_ARRAY }
  );
  return (res.rows ?? []).map((r) => ({
    fy_from: r[0], fy_to: r[1], fy_label: fyLabel(r[0]), profit_rate: Number(r[2]),
    status: trimOrEmpty(r[3]), remarks: trimOrEmpty(r[4]), posted_on: r[5],
  }));
};

// Payroll key (OLD_EMPCODE) for an employee code — salary master and loans use it.
const resolveOldEmpcode = async (connection, unit, empcode) => {
  const res = await connection.execute(
    `SELECT NVL(OLD_EMPCODE, EMPCODE) FROM HR_EMP_MASTER
      WHERE (EMPCODE = :e OR OLD_EMPCODE = :e) AND UNIT_ID = :u FETCH FIRST 1 ROWS ONLY`,
    { e: String(empcode), u: unit },
    { outFormat: OUT_ARRAY }
  );
  return res.rows?.[0]?.[0] ? String(res.rows[0][0]).trim() : null;
};

const loadMembers = async (connection, unit, oldEmp = null) => {
  const res = await connection.execute(
    `SELECT NVL(m.OLD_EMPCODE, m.EMPCODE), m.EMPCODE, m.NAME, m."ATDTCARD#",
            TO_CHAR(m.DTOFAPPT,'YYYY-MM-DD'), TO_CHAR(m.DTOFRESIGN,'YYYY-MM-DD'),
            m.PF_IND, TO_CHAR(m.PF_MEM_DT,'YYYY-MM-DD'),
            (SELECT MIN(dg.DESG_DESC) FROM HR_DESG dg
              WHERE LTRIM(dg.DESG_CD,'0') = LTRIM(m.DESG_CD,'0') AND TO_CHAR(dg.COMPC) = TO_CHAR(m.UNIT_ID)),
            (SELECT MIN(d.DEPT_NAME) FROM HR_DEPT d
              WHERE LTRIM(d.DEPT_NO,'0') = LTRIM(m.DEPT_NO,'0') AND TO_CHAR(d.COMPC) = TO_CHAR(m.UNIT_ID))
       FROM HR_EMP_MASTER m
      WHERE m.UNIT_ID = :u AND (:e IS NULL OR m.OLD_EMPCODE = :e OR m.EMPCODE = :e)`,
    { u: unit, e: oldEmp },
    { outFormat: OUT_ARRAY }
  );
  const map = {};
  for (const r of res.rows ?? []) {
    const key = trimOrEmpty(r[0]);
    map[key] = {
      old_empcode: key, empcode: trimOrEmpty(r[1]), name: trimOrEmpty(r[2]), atdtcard: trimOrEmpty(r[3]),
      joining_date: r[4], exit_date: r[5], pf_ind: trimOrEmpty(r[6]), pf_member_since: r[7],
      designation: trimOrEmpty(r[8]), department: trimOrEmpty(r[9]),
    };
  }
  return map;
};

const groupBy = (rows, key) => {
  const out = {};
  for (const r of rows) (out[r[key]] ||= []).push(r);
  return out;
};

/**
 * One row per member per FINALISED salary month (HR_SALARY_PROCESS_MASTER_FINAL —
 * the draft HR_SALARY_PROCESS_MASTER is wiped on every salary run). The engine
 * turns EARNED_GROSS and the designation's FPO into the contribution
 * ((gross - FPO) / 1.55 × 8.33%).
 *
 * Membership comes from HR_EMP_MASTER: PF_IND = 'Y' and the month ends on or
 * after PF_MEM_DT (else the confirmation / appointment date), so a back-dated
 * membership is honoured. Only months in which the employee was PERMANENT
 * (EMP_STATUS '2' on the finalised salary row) count — the same rule as the PF
 * deduction in HR_SALARY_PROCES_PRO. A calendar month finalised under two periods (e.g.
 * July 2026 = periods 48 and 96 in unit 1) counts once, from the latest period.
 * What payroll actually deducted is carried alongside for comparison.
 */
const loadContributions = async (connection, unit, oldEmp, toDate, pfDedCode) => {
  const res = await connection.execute(
    `SELECT OLD_EMPCODE, "PERIOD#", PFRM, PTO, EARNED_GROSS, DESG_CD, FPO, DEDUCTED FROM (
       SELECT f.OLD_EMPCODE, f."PERIOD#", TO_CHAR(p.PERIOD_FRM,'YYYY-MM-DD') PFRM, TO_CHAR(p.PERIOD_TO,'YYYY-MM-DD') PTO,
              NVL(f.EARNED_GROSS,0) EARNED_GROSS, f.DESG_CD,
              (SELECT MIN(d.FPO_AMOUNT) FROM HR_DESG d
                WHERE LTRIM(d.DESG_CD,'0') = LTRIM(f.DESG_CD,'0') AND TO_CHAR(d.COMPC) = TO_CHAR(f.UNIT_ID)) FPO,
              (SELECT SUM(s.TRANS_AMOUNT) FROM HR_SALARY_PROCESS_FINAL s
                WHERE s.OLD_EMPCODE = f.OLD_EMPCODE AND s.UNIT_ID = f.UNIT_ID AND s."PERIOD#" = f."PERIOD#"
                  AND s.TRANS_TYPE = 'D' AND TRIM(s.TRANS_ID) = :ded) DEDUCTED,
              ROW_NUMBER() OVER (PARTITION BY f.OLD_EMPCODE, TRUNC(p.PERIOD_FRM,'MM') ORDER BY f."PERIOD#" DESC) RN
         FROM HR_SALARY_PROCESS_MASTER_FINAL f
         JOIN HR_ATTND_PERIOD p ON p."PERIOD#" = f."PERIOD#" AND p.UNIT_ID = f.UNIT_ID
         JOIN HR_EMP_MASTER e ON e.OLD_EMPCODE = f.OLD_EMPCODE AND e.UNIT_ID = f.UNIT_ID
        WHERE f.UNIT_ID = :u AND (:e IS NULL OR f.OLD_EMPCODE = :e)
          AND UPPER(TRIM(NVL(e.PF_IND,'N'))) = 'Y'
          AND TRIM(f.EMP_STATUS) = '2'
          AND p.PERIOD_TO >= COALESCE(e.PF_MEM_DT, e.DTOFCONFIRM, e.DTOFAPPT, p.PERIOD_TO)
          AND p.PERIOD_TO <= TO_DATE(:t,'YYYY-MM-DD'))
      WHERE RN = 1
      ORDER BY OLD_EMPCODE, PTO`,
    { u: unit, e: oldEmp, t: toDate, ded: pfDedCode },
    { outFormat: OUT_ARRAY }
  );
  return groupBy((res.rows ?? []).map((r) => ({
    old_empcode: trimOrEmpty(r[0]), period: Number(r[1]), period_frm: r[2], value_date: r[3],
    earned_gross: Number(r[4]), desg_cd: trimOrEmpty(r[5]),
    fpo: r[6] === null ? 0 : Number(r[6]), fpo_missing: r[6] === null,
    payroll_deducted: r[7] === null ? null : Number(r[7]),
  })), "old_empcode");
};

/**
 * Permanent withdrawals = HR_LOAN_MST rows of the "PERMANENT WITHDRAWAL-PF" loan
 * type (code 16), entered from the payroll Loans screen: LOAN_AMT leaves the
 * balance on LOAN_DATE.
 */
const loadWithdrawals = async (connection, unit, oldEmp) => {
  const codeBinds = {};
  const codeList = WITHDRAWAL_LOAN_CODES.map((c, i) => { codeBinds[`w${i}`] = c; return `:w${i}`; }).join(", ");
  const res = await connection.execute(
    `SELECT l."DOC#", l.OLD_EMPCODE, TO_CHAR(NVL(l.LOAN_DATE, l.DOC_DT),'YYYY-MM-DD'), NVL(l.LOAN_AMT,0),
            l.REMARKS, l.CHQ_NO, TO_CHAR(l.CHQ_DT,'YYYY-MM-DD')
       FROM HR_LOAN_MST l
      WHERE l.UNIT_ID = :u AND (:e IS NULL OR l.OLD_EMPCODE = :e) AND TRIM(l.LOAN_CD) IN (${codeList})
        AND NVL(l.LOAN_AMT,0) > 0
      ORDER BY NVL(l.LOAN_DATE, l.DOC_DT), l."DOC#"`,
    { u: unit, e: oldEmp, ...codeBinds },
    { outFormat: OUT_ARRAY }
  );
  return groupBy((res.rows ?? []).map((r) => ({
    doc: Number(r[0]), old_empcode: trimOrEmpty(r[1]), date: r[2], amount: Number(r[3]),
    remarks: trimOrEmpty(r[4]), chq_no: trimOrEmpty(r[5]), chq_dt: r[6],
  })), "old_empcode");
};

const monthEnd = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

/**
 * PF loan movements per member: +disbursement on LOAN_DATE, -recovery for every
 * HR_LOAN_RECOVERY row (dated at its period end), and the salary-deducted
 * LOAN_RECOVER total laid out as the monthly instalment schedule from START_DT.
 */
const loadLoanMovements = async (connection, unit, oldEmp, loanCodes) => {
  if (!loanCodes.length) return {};
  const codeBinds = {};
  const codeList = loanCodes.map((c, i) => { codeBinds[`c${i}`] = c; return `:c${i}`; }).join(", ");
  const loanRes = await connection.execute(
    `SELECT l."DOC#", l.OLD_EMPCODE, TO_CHAR(NVL(l.LOAN_DATE, l.DOC_DT),'YYYY-MM-DD'), NVL(l.LOAN_AMT,0),
            NVL(l.LOAN_RECOVER,0), NVL(l.INSTALMENT_AMT,0),
            TO_CHAR(NVL(l.START_DT, NVL(l.LOAN_DATE, l.DOC_DT)),'YYYY-MM-DD')
       FROM HR_LOAN_MST l
      WHERE l.UNIT_ID = :u AND (:e IS NULL OR l.OLD_EMPCODE = :e) AND TRIM(l.LOAN_CD) IN (${codeList})`,
    { u: unit, e: oldEmp, ...codeBinds },
    { outFormat: OUT_ARRAY }
  );
  const loans = loanRes.rows ?? [];
  if (!loans.length) return {};

  const recRes = await connection.execute(
    `SELECT rc."DOC#", NVL(rc.RECOVERD_AMT,0),
            TO_CHAR(NVL(p.PERIOD_TO, rc.USR_DATE_UPD),'YYYY-MM-DD')
       FROM HR_LOAN_RECOVERY rc
       JOIN HR_LOAN_MST l ON l."DOC#" = rc."DOC#"
       LEFT JOIN HR_ATTND_PERIOD p ON p."PERIOD#" = rc."PERIOD#" AND p.UNIT_ID = rc.UNIT_ID
      WHERE l.UNIT_ID = :u AND (:e IS NULL OR l.OLD_EMPCODE = :e) AND TRIM(l.LOAN_CD) IN (${codeList})`,
    { u: unit, e: oldEmp, ...codeBinds },
    { outFormat: OUT_ARRAY }
  );
  const recByDoc = groupBy((recRes.rows ?? []).map((r) => ({ doc: Number(r[0]), amount: Number(r[1]), date: r[2] })), "doc");

  const out = {};
  for (const r of loans) {
    const doc = Number(r[0]);
    const emp = trimOrEmpty(r[1]);
    const list = (out[emp] ||= []);
    list.push({ date: r[2], amount: Number(r[3]), kind: "DISB", ref: doc });
    for (const rc of recByDoc[doc] || []) {
      if (rc.date && rc.amount) list.push({ date: rc.date, amount: -rc.amount, kind: "REC", ref: doc });
    }
    // Salary-deducted recoveries: INSTALMENT_AMT per month from START_DT until LOAN_RECOVER is used up.
    let remaining = Number(r[4]);
    const inst = Number(r[5]);
    let y = Number(r[6].slice(0, 4));
    let m = Number(r[6].slice(5, 7));
    if (remaining > 0 && inst <= 0) {
      list.push({ date: monthEnd(y, m), amount: -remaining, kind: "SAL", ref: doc });
      remaining = 0;
    }
    while (remaining > 1e-9) {
      const amt = Math.min(inst, remaining);
      list.push({ date: monthEnd(y, m), amount: -amt, kind: "SAL", ref: doc });
      remaining -= amt;
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
};

const loadTakeOns = async (connection, unit, oldEmp) => {
  const res = await connection.execute(
    `SELECT OLD_EMPCODE, TO_CHAR(AS_OF_FY,'YYYY-MM-DD'), EMP_CONTRIB, EMP_PROFIT, EMP_DEDUCTIONS,
            CO_CONTRIB, CO_PROFIT, CO_DEDUCTIONS, REMARKS
       FROM HR_PF_OPENING WHERE UNIT_ID = :u AND (:e IS NULL OR OLD_EMPCODE = :e)`,
    { u: unit, e: oldEmp },
    { outFormat: OUT_ARRAY }
  );
  const map = {};
  for (const r of res.rows ?? []) {
    const n = (v) => Number(v || 0);
    map[trimOrEmpty(r[0])] = {
      old_empcode: trimOrEmpty(r[0]), as_of_fy: r[1],
      emp_contrib: n(r[2]), emp_profit: n(r[3]), emp_deductions: n(r[4]),
      co_contrib: n(r[5]), co_profit: n(r[6]), co_deductions: n(r[7]),
      emp_balance: n(r[2]) + n(r[3]) - n(r[4]),
      co_balance: n(r[5]) + n(r[6]) - n(r[7]),
      remarks: trimOrEmpty(r[8]),
    };
  }
  return map;
};

// Posted years in the same shape computeYear() returns.
const loadPosted = async (connection, unit, oldEmp) => {
  const yRes = await connection.execute(
    `SELECT OLD_EMPCODE, TO_CHAR(FY_FROM,'YYYY-MM-DD'), TO_CHAR(FY_TO,'YYYY-MM-DD'), TO_CHAR(CUTOFF_DATE,'YYYY-MM-DD'),
            PROFIT_RATE, LOAN_RATE,
            EMP_OPENING, EMP_CONTRIB, EMP_PRODUCT, EMP_PROFIT, EMP_WITHDRAWN, LOAN_INTEREST, EMP_CLOSING,
            CO_OPENING, CO_CONTRIB, CO_PRODUCT, CO_PROFIT, CO_WITHDRAWN, CO_CLOSING,
            LOAN_OPENING, LOAN_PRODUCT, LOAN_CLOSING
       FROM HR_PF_YEAR WHERE UNIT_ID = :u AND (:e IS NULL OR OLD_EMPCODE = :e)`,
    { u: unit, e: oldEmp },
    { outFormat: OUT_ARRAY }
  );
  const lRes = await connection.execute(
    `SELECT OLD_EMPCODE, TO_CHAR(FY_FROM,'YYYY-MM-DD'), LINE_TYPE, TO_CHAR(VALUE_DATE,'YYYY-MM-DD'), "PERIOD#", REF_DOC,
            EARNED_GROSS, FPO, BASIC, EMP_AMT, CO_AMT, DAYS, EMP_PRODUCT, CO_PRODUCT
       FROM HR_PF_YEAR_LINE WHERE UNIT_ID = :u AND (:e IS NULL OR OLD_EMPCODE = :e)
      ORDER BY OLD_EMPCODE, FY_FROM, LINE_NO`,
    { u: unit, e: oldEmp },
    { outFormat: OUT_ARRAY }
  );
  const n = (v) => (v === null || v === undefined ? null : Number(v));
  const linesByKey = {};
  for (const r of lRes.rows ?? []) {
    const key = `${trimOrEmpty(r[0])}|${r[1]}`;
    const b = (linesByKey[key] ||= { pf: [], loan: [] });
    const type = trimOrEmpty(r[2]);
    if (type.startsWith("LOAN")) {
      b.loan.push({ line_type: type, value_date: r[3], ref_doc: n(r[5]), amount: n(r[9]), days: n(r[11]), product: n(r[12]) });
    } else {
      b.pf.push({
        line_type: type, value_date: r[3], period: n(r[4]), ref_doc: n(r[5]),
        earned_gross: n(r[6]), fpo: n(r[7]), basic: n(r[8]),
        emp_amt: n(r[9]), co_amt: n(r[10]), days: n(r[11]), emp_product: n(r[12]), co_product: n(r[13]),
      });
    }
  }
  const map = {};
  for (const r of yRes.rows ?? []) {
    const emp = trimOrEmpty(r[0]);
    const lines = linesByKey[`${emp}|${r[1]}`] || { pf: [], loan: [] };
    (map[emp] ||= {})[r[1]] = {
      fy_from: r[1], fy_to: r[2], fy_label: fyLabel(r[1]), cutoff: r[3],
      profit_rate: n(r[4]), loan_rate: n(r[5]), lines: lines.pf,
      emp: { opening: n(r[6]), contribution: n(r[7]), product: n(r[8]), profit: n(r[9]), withdrawn: n(r[10]), loan_interest: n(r[11]), closing: n(r[12]) },
      co: { opening: n(r[13]), contribution: n(r[14]), product: n(r[15]), profit: n(r[16]), withdrawn: n(r[17]), closing: n(r[18]) },
      loan: { opening: n(r[19]), product: n(r[20]), interest: n(r[11]), closing: n(r[21]), lines: lines.loan },
    };
  }
  return map;
};

/** Everything buildHistory() needs for one unit (optionally one member). */
const loadUnitData = async (connection, unit, oldEmp, toDate) => {
  const { cfg, pfDedCode, loanCodes } = await loadSettings(connection, unit);
  const [rates, members, flags, contributions, withdrawals, loans, takeOns, posted] = [
    await loadRates(connection, unit),
    await loadMembers(connection, unit, oldEmp),
    await loadMemberFlags(connection, unit, oldEmp),
    await loadContributions(connection, unit, oldEmp, toDate, pfDedCode),
    await loadWithdrawals(connection, unit, oldEmp),
    await loadLoanMovements(connection, unit, oldEmp, loanCodes),
    await loadTakeOns(connection, unit, oldEmp),
    await loadPosted(connection, unit, oldEmp),
  ];
  return { cfg, pfDedCode, loanCodes, rates, members, flags, contributions, withdrawals, loans, takeOns, posted };
};

// Zakat is deducted unless the member's exemption declaration is on file.
const zakatStatus = (data, oldEmp) => {
  const f = data.flags[oldEmp];
  return f ? { zakat_exempt: f.zakat_exempt, decl_date: f.decl_date, decl_ref: f.decl_ref } : { zakat_exempt: false, decl_date: null, decl_ref: "" };
};

const memberHistory = (data, oldEmp, upto, extraWithdrawals = []) => {
  const member = data.members[oldEmp] || {};
  return buildHistory({
    upto,
    exitDate: member.exit_date || null,
    takeOn: data.takeOns[oldEmp] || null,
    posted: data.posted[oldEmp] || {},
    rates: data.rates,
    contributions: data.contributions[oldEmp] || [],
    withdrawals: [...(data.withdrawals[oldEmp] || []), ...extraWithdrawals],
    loanMovements: data.loans[oldEmp] || [],
    cfg: data.cfg,
  });
};

const isPosted = (rates, dateStr) => {
  const fy = fiscalYearOf(dateStr).from;
  return rates.some((r) => r.fy_from === fy && r.status === "P");
};

// ════════════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════════════

export const getSettings = async (unit) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const { cfg, pfDedCode, loanCodes } = await loadSettings(connection, unit);
    return {
      unit_id: unit, pf_ded_code: pfDedCode, loan_codes: loanCodes,
      loan_spread: cfg.loanSpread, zakat_rate: cfg.zakatRate, profit_divisor: cfg.profitDivisor,
    };
  } finally {
    await connection?.close();
  }
};

export const saveSettings = async (unit, { pfDedCode = null, loanCodes = null, loanSpread = null, zakatRate = null } = {}, { usr = null } = {}) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const codes = Array.isArray(loanCodes) ? loanCodes.map((c) => String(c).trim()).filter(Boolean).join(",") : toStr(loanCodes);
    await connection.execute(
      `MERGE INTO HR_PF_SETTINGS s
       USING (SELECT :u UNIT_ID FROM DUAL) x ON (s.UNIT_ID = x.UNIT_ID)
       WHEN MATCHED THEN UPDATE SET
         PF_DED_CODE = NVL(:ded, s.PF_DED_CODE), LOAN_CODES = NVL(:codes, s.LOAN_CODES),
         LOAN_SPREAD = NVL(:ls, s.LOAN_SPREAD), ZAKAT_RATE = NVL(:zr, s.ZAKAT_RATE),
         USR_ID_UPD = :usr, USR_DATE_UPD = SYSDATE
       WHEN NOT MATCHED THEN INSERT
         (UNIT_ID, PF_DED_CODE, LOAN_CODES, LOAN_SPREAD, ZAKAT_RATE, USR_ID_UPD, USR_DATE_UPD)
         VALUES (:u, NVL(:ded, '${DEFAULT_PF_DED_CODE}'), NVL(:codes, '${DEFAULT_LOAN_CODES.join(",")}'),
                 NVL(:ls, ${PF_DEFAULTS.loanSpread}), NVL(:zr, ${PF_DEFAULTS.zakatRate}), :usr, SYSDATE)`,
      { u: unit, ded: toStr(pfDedCode), codes, ls: toNum(loanSpread), zr: toNum(zakatRate), usr: toStr(usr) }
    );
    await connection.commit();
    return { status: "success" };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return fail(err.message);
  } finally {
    await connection?.close();
  }
};

// ════════════════════════════════════════════════════════════════
// PROFIT RATES (declared yearly by the trustees)
// ════════════════════════════════════════════════════════════════

export const listRates = async (unit) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const rates = await loadRates(connection, unit);
    const cntRes = await connection.execute(
      `SELECT TO_CHAR(FY_FROM,'YYYY-MM-DD'), COUNT(*), SUM(EMP_PROFIT + CO_PROFIT)
         FROM HR_PF_YEAR WHERE UNIT_ID = :u GROUP BY FY_FROM`,
      { u: unit },
      { outFormat: OUT_ARRAY }
    );
    const counts = Object.fromEntries((cntRes.rows ?? []).map((r) => [r[0], { members: Number(r[1]), profit: Number(r[2] || 0) }]));
    return rates.map((r) => ({ ...r, posted_members: counts[r.fy_from]?.members || 0, posted_profit: counts[r.fy_from]?.profit || 0 }));
  } finally {
    await connection?.close();
  }
};

export const saveRate = async (unit, fyFrom, profitRate, remarks = null, { usr = null } = {}) => {
  const fy = toDateStr(fyFrom);
  if (!isFyStart(fy)) return fail("fy_from must be the 1st of July of the financial year (YYYY-07-01)");
  const rate = toNum(profitRate);
  if (rate === null || rate < 0 || rate >= 1) return fail("profit_rate must be a fraction between 0 and 1 (e.g. 0.0587 for 5.87%)");
  const { to } = fiscalYearOf(fy);
  let connection;
  try {
    connection = await getDirectConnection();
    const st = await connection.execute(
      `SELECT STATUS FROM HR_PF_PROFIT_RATE WHERE UNIT_ID = :u AND FY_FROM = TO_DATE(:f,'YYYY-MM-DD')`,
      { u: unit, f: fy },
      { outFormat: OUT_ARRAY }
    );
    if (trimOrEmpty(st.rows?.[0]?.[0]) === "P") return fail(`${fyLabel(fy)} is already posted; its rate can no longer change`);
    await connection.execute(
      `MERGE INTO HR_PF_PROFIT_RATE r
       USING (SELECT :u UNIT_ID, TO_DATE(:f,'YYYY-MM-DD') FY_FROM FROM DUAL) x
          ON (r.UNIT_ID = x.UNIT_ID AND r.FY_FROM = x.FY_FROM)
       WHEN MATCHED THEN UPDATE SET PROFIT_RATE = :rate, REMARKS = :rem, USR_ID_UPD = :usr, USR_DATE_UPD = SYSDATE
       WHEN NOT MATCHED THEN INSERT (UNIT_ID, FY_FROM, FY_TO, PROFIT_RATE, STATUS, REMARKS, USR_ID_UPD, USR_DATE_UPD)
         VALUES (:u, TO_DATE(:f,'YYYY-MM-DD'), TO_DATE(:t,'YYYY-MM-DD'), :rate, 'D', :rem, :usr, SYSDATE)`,
      { u: unit, f: fy, t: to, rate, rem: toStr(remarks), usr: toStr(usr) }
    );
    await connection.commit();
    return { status: "success", fy_from: fy, fy_label: fyLabel(fy), profit_rate: rate };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return fail(err.message);
  } finally {
    await connection?.close();
  }
};

export const deleteRate = async (unit, fyFrom) => {
  const fy = toDateStr(fyFrom);
  let connection;
  try {
    connection = await getDirectConnection();
    const res = await connection.execute(
      `DELETE FROM HR_PF_PROFIT_RATE WHERE UNIT_ID = :u AND FY_FROM = TO_DATE(:f,'YYYY-MM-DD') AND STATUS <> 'P'`,
      { u: unit, f: fy }
    );
    await connection.commit();
    if (!res.rowsAffected) return fail("Rate not found, or the year is already posted");
    return { status: "success" };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return fail(err.message);
  } finally {
    await connection?.close();
  }
};

// ════════════════════════════════════════════════════════════════
// TAKE-ON BALANCES (one-time carry-over from the Excel statements)
// ════════════════════════════════════════════════════════════════

export const listOpenings = async (unit, empcode = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const oldEmp = empcode ? await resolveOldEmpcode(connection, unit, empcode) : null;
    if (empcode && !oldEmp) return [];
    const map = await loadTakeOns(connection, unit, oldEmp);
    const members = await loadMembers(connection, unit, oldEmp);
    return Object.values(map).map((t) => ({ ...t, name: members[t.old_empcode]?.name || "", as_of_fy_label: fyLabel(t.as_of_fy) }));
  } finally {
    await connection?.close();
  }
};

export const saveOpening = async (unit, empcode, body, { usr = null } = {}) => {
  const fy = toDateStr(body.as_of_fy);
  if (!isFyStart(fy)) return fail("as_of_fy must be the 1st of July of the first year the system computes (YYYY-07-01)");
  let connection;
  try {
    connection = await getDirectConnection();
    const oldEmp = await resolveOldEmpcode(connection, unit, empcode);
    if (!oldEmp) return fail("Employee not found in this company");
    const posted = await connection.execute(
      `SELECT COUNT(*) FROM HR_PF_YEAR WHERE UNIT_ID = :u AND OLD_EMPCODE = :e`,
      { u: unit, e: oldEmp },
      { outFormat: OUT_ARRAY }
    );
    if (Number(posted.rows[0][0]) > 0) return fail("This member already has posted PF years; the take-on balance is frozen");
    const n = (v) => toNum(v) ?? 0;
    await connection.execute(
      `MERGE INTO HR_PF_OPENING o
       USING (SELECT :u UNIT_ID, :e OLD_EMPCODE FROM DUAL) x ON (o.UNIT_ID = x.UNIT_ID AND o.OLD_EMPCODE = x.OLD_EMPCODE)
       WHEN MATCHED THEN UPDATE SET AS_OF_FY = TO_DATE(:f,'YYYY-MM-DD'),
         EMP_CONTRIB = :ec, EMP_PROFIT = :ep, EMP_DEDUCTIONS = :ed, CO_CONTRIB = :cc, CO_PROFIT = :cp,
         CO_DEDUCTIONS = :cd, REMARKS = :rem, USR_ID_UPD = :usr, USR_DATE_UPD = SYSDATE
       WHEN NOT MATCHED THEN INSERT (UNIT_ID, OLD_EMPCODE, AS_OF_FY, EMP_CONTRIB, EMP_PROFIT, EMP_DEDUCTIONS,
         CO_CONTRIB, CO_PROFIT, CO_DEDUCTIONS, REMARKS, USR_ID_UPD, USR_DATE_UPD)
         VALUES (:u, :e, TO_DATE(:f,'YYYY-MM-DD'), :ec, :ep, :ed, :cc, :cp, :cd, :rem, :usr, SYSDATE)`,
      {
        u: unit, e: oldEmp, f: fy,
        ec: n(body.emp_contrib), ep: n(body.emp_profit), ed: n(body.emp_deductions),
        cc: n(body.co_contrib), cp: n(body.co_profit), cd: n(body.co_deductions),
        rem: toStr(body.remarks), usr: toStr(usr),
      }
    );
    await connection.commit();
    return { status: "success", old_empcode: oldEmp };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return fail(err.message);
  } finally {
    await connection?.close();
  }
};

export const deleteOpening = async (unit, empcode) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const oldEmp = await resolveOldEmpcode(connection, unit, empcode);
    if (!oldEmp) return fail("Employee not found in this company");
    const posted = await connection.execute(
      `SELECT COUNT(*) FROM HR_PF_YEAR WHERE UNIT_ID = :u AND OLD_EMPCODE = :e`,
      { u: unit, e: oldEmp },
      { outFormat: OUT_ARRAY }
    );
    if (Number(posted.rows[0][0]) > 0) return fail("This member already has posted PF years; the take-on balance is frozen");
    const res = await connection.execute(`DELETE FROM HR_PF_OPENING WHERE UNIT_ID = :u AND OLD_EMPCODE = :e`, { u: unit, e: oldEmp });
    await connection.commit();
    if (!res.rowsAffected) return fail("Take-on balance not found");
    return { status: "success" };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return fail(err.message);
  } finally {
    await connection?.close();
  }
};

/**
 * Bulk take-on from the ERP's HR_PF_BALANCES (summed per member for the PF
 * deduction code, as at the take-on year). PF_BAL is the member's contribution balance and
 * PF_PROFIT the profit on it; the company part is the same (carbon copy).
 * Members with posted years are never touched; existing take-ons are kept
 * unless `overwrite` is set.
 */
export const importOpenings = async (unit, asOfFy, { overwrite = false, usr = null } = {}) => {
  const fy = toDateStr(asOfFy);
  if (!isFyStart(fy)) return fail("as_of_fy must be the 1st of July of the first year the system computes (YYYY-07-01)");
  let connection;
  try {
    connection = await getDirectConnection();
    const { pfDedCode } = await loadSettings(connection, unit);
    // PERIOD# 0 is the migrated opening (what /pf/members/:empcode/opening writes);
    // a row for a later period is a brought-forward entry, included when its
    // month ends before the take-on year starts.
    const balRes = await connection.execute(
      `SELECT b.OLD_EMPCODE, SUM(NVL(b.PF_BAL,0)), SUM(NVL(b.PF_PROFIT,0)), COUNT(*)
         FROM HR_PF_BALANCES b
         LEFT JOIN HR_ATTND_PERIOD p ON p."PERIOD#" = b."PERIOD#" AND p.UNIT_ID = b.UNIT_ID
        WHERE b.UNIT_ID = :u AND TO_CHAR(b.DED_CD) = :ded AND b.OLD_EMPCODE IS NOT NULL
          AND (b."PERIOD#" = 0 OR p.PERIOD_TO < TO_DATE(:f,'YYYY-MM-DD'))
        GROUP BY b.OLD_EMPCODE`,
      { u: unit, ded: pfDedCode, f: fy },
      { outFormat: OUT_ARRAY }
    );
    const rows = balRes.rows ?? [];
    if (!rows.length) return fail(`HR_PF_BALANCES has no rows for this company and PF deduction code ${pfDedCode}`);

    const existing = new Set(Object.keys(await loadTakeOns(connection, unit, null)));
    const postedRes = await connection.execute(
      `SELECT DISTINCT OLD_EMPCODE FROM HR_PF_YEAR WHERE UNIT_ID = :u`, { u: unit }, { outFormat: OUT_ARRAY }
    );
    const posted = new Set((postedRes.rows ?? []).map((r) => trimOrEmpty(r[0])));
    const members = await loadMembers(connection, unit, null);

    let imported = 0;
    const skipped = [];
    for (const r of rows) {
      const emp = trimOrEmpty(r[0]);
      if (!members[emp]) { skipped.push({ old_empcode: emp, reason: "not in HR_EMP_MASTER for this company" }); continue; }
      if (posted.has(emp)) { skipped.push({ old_empcode: emp, reason: "has posted PF years" }); continue; }
      if (existing.has(emp) && !overwrite) { skipped.push({ old_empcode: emp, reason: "take-on already exists" }); continue; }
      const bal = Number(r[1]);
      const profit = Number(r[2]);
      await connection.execute(
        `MERGE INTO HR_PF_OPENING o
         USING (SELECT :u UNIT_ID, :e OLD_EMPCODE FROM DUAL) x ON (o.UNIT_ID = x.UNIT_ID AND o.OLD_EMPCODE = x.OLD_EMPCODE)
         WHEN MATCHED THEN UPDATE SET AS_OF_FY = TO_DATE(:f,'YYYY-MM-DD'),
           EMP_CONTRIB = :bal, EMP_PROFIT = :pr, EMP_DEDUCTIONS = 0, CO_CONTRIB = :bal, CO_PROFIT = :pr,
           CO_DEDUCTIONS = 0, REMARKS = :rem, USR_ID_UPD = :usr, USR_DATE_UPD = SYSDATE
         WHEN NOT MATCHED THEN INSERT (UNIT_ID, OLD_EMPCODE, AS_OF_FY, EMP_CONTRIB, EMP_PROFIT, EMP_DEDUCTIONS,
           CO_CONTRIB, CO_PROFIT, CO_DEDUCTIONS, REMARKS, USR_ID_UPD, USR_DATE_UPD)
           VALUES (:u, :e, TO_DATE(:f,'YYYY-MM-DD'), :bal, :pr, 0, :bal, :pr, 0, :rem, :usr, SYSDATE)`,
        { u: unit, e: emp, f: fy, bal, pr: profit, rem: `Imported from HR_PF_BALANCES (${r[3]} row(s))`, usr: toStr(usr) }
      );
      imported += 1;
    }
    await connection.commit();
    return { status: "success", as_of_fy: fy, imported, skipped };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return fail(err.message);
  } finally {
    await connection?.close();
  }
};

// ════════════════════════════════════════════════════════════════
// PERMANENT WITHDRAWALS (read-only: entered as loan type 16 in the payroll Loans screen)
// ════════════════════════════════════════════════════════════════

export const listWithdrawals = async (unit, empcode = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const oldEmp = empcode ? await resolveOldEmpcode(connection, unit, empcode) : null;
    if (empcode && !oldEmp) return [];
    const map = await loadWithdrawals(connection, unit, oldEmp);
    const members = await loadMembers(connection, unit, oldEmp);
    return Object.values(map).flat().map((w) => ({ ...w, name: members[w.old_empcode]?.name || "" }));
  } finally {
    await connection?.close();
  }
};

// ════════════════════════════════════════════════════════════════
// STATEMENT & SETTLEMENT
// ════════════════════════════════════════════════════════════════

export const getStatement = async (unit, empcode, upto = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const oldEmp = await resolveOldEmpcode(connection, unit, empcode);
    if (!oldEmp) return fail("Employee not found in this company");
    const until = toDateStr(upto) || todayStr();
    const data = await loadUnitData(connection, unit, oldEmp, until);
    const member = data.members[oldEmp] || { old_empcode: oldEmp };
    let history;
    try {
      history = memberHistory(data, oldEmp, until);
    } catch (err) {
      if (err.code) return fail(err.message);
      throw err;
    }
    const fpoMissing = (data.contributions[oldEmp] || []).filter((c) => c.fpo_missing).map((c) => c.period);
    return {
      member: { ...member, ...zakatStatus(data, oldEmp) }, upto: history.end,
      take_on: data.takeOns[oldEmp] || null,
      years: history.years,
      balances: { employee: history.emp_balance, company: history.co_balance, loan_outstanding: history.loan_outstanding },
      warnings: fpoMissing.length ? [`No HR_DESG.FPO_AMOUNT for the designation in periods ${fpoMissing.join(", ")} — FPO taken as 0`] : [],
    };
  } finally {
    await connection?.close();
  }
};

export const getSettlement = async (unit, empcode, upto = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const oldEmp = await resolveOldEmpcode(connection, unit, empcode);
    if (!oldEmp) return fail("Employee not found in this company");
    const data = await loadUnitData(connection, unit, oldEmp, toDateStr(upto) || todayStr());
    const member = data.members[oldEmp] || { old_empcode: oldEmp };
    // Settle at the exit date when there is one, else as at `upto` / today.
    const until = toDateStr(upto) || member.exit_date || todayStr();
    let history;
    try {
      history = memberHistory(data, oldEmp, until);
    } catch (err) {
      if (err.code) return fail(err.message);
      throw err;
    }
    const zakat = zakatStatus(data, oldEmp);
    return {
      member: { ...member, ...zakat },
      ...computeSettlement({ history, zakatExempt: zakat.zakat_exempt, cfg: data.cfg }),
      permanent_withdrawals: data.withdrawals[oldEmp] || [],
    };
  } finally {
    await connection?.close();
  }
};

// ════════════════════════════════════════════════════════════════
// ZAKAT EXEMPTION (per member)
// ════════════════════════════════════════════════════════════════

export const listZakatStatus = async (unit, empcode = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const oldEmp = empcode ? await resolveOldEmpcode(connection, unit, empcode) : null;
    if (empcode && !oldEmp) return [];
    const flags = await loadMemberFlags(connection, unit, oldEmp);
    const members = await loadMembers(connection, unit, oldEmp);
    // Every employee of the company, defaulting to "not exempt" when no declaration is on file.
    return Object.values(members).map((m) => ({
      old_empcode: m.old_empcode, empcode: m.empcode, name: m.name, pf_ind: m.pf_ind,
      zakat_exempt: flags[m.old_empcode]?.zakat_exempt ?? false,
      decl_date: flags[m.old_empcode]?.decl_date ?? null,
      decl_ref: flags[m.old_empcode]?.decl_ref ?? "",
      remarks: flags[m.old_empcode]?.remarks ?? "",
    }));
  } finally {
    await connection?.close();
  }
};

export const saveZakatStatus = async (unit, empcode, { zakatExempt, declDate = null, declRef = null, remarks = null }, { usr = null } = {}) => {
  const exempt = zakatExempt ? "Y" : "N";
  const dd = toDateStr(declDate);
  if (exempt === "Y" && !dd) return fail("decl_date (date of the zakat exemption declaration) is required to mark a member exempt");
  let connection;
  try {
    connection = await getDirectConnection();
    const oldEmp = await resolveOldEmpcode(connection, unit, empcode);
    if (!oldEmp) return fail("Employee not found in this company");
    await connection.execute(
      `MERGE INTO HR_PF_MEMBER m
       USING (SELECT :u UNIT_ID, :e OLD_EMPCODE FROM DUAL) x ON (m.UNIT_ID = x.UNIT_ID AND m.OLD_EMPCODE = x.OLD_EMPCODE)
       WHEN MATCHED THEN UPDATE SET ZAKAT_EXEMPT = :z, DECL_DATE = TO_DATE(:dd,'YYYY-MM-DD'), DECL_REF = :dr,
         REMARKS = :rem, USR_ID_UPD = :usr, USR_DATE_UPD = SYSDATE
       WHEN NOT MATCHED THEN INSERT (UNIT_ID, OLD_EMPCODE, ZAKAT_EXEMPT, DECL_DATE, DECL_REF, REMARKS, USR_ID_UPD, USR_DATE_UPD)
         VALUES (:u, :e, :z, TO_DATE(:dd,'YYYY-MM-DD'), :dr, :rem, :usr, SYSDATE)`,
      { u: unit, e: oldEmp, z: exempt, dd: exempt === "Y" ? dd : null, dr: exempt === "Y" ? toStr(declRef) : null, rem: toStr(remarks), usr: toStr(usr) }
    );
    await connection.commit();
    return { status: "success", old_empcode: oldEmp, zakat_exempt: exempt === "Y" };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return fail(err.message);
  } finally {
    await connection?.close();
  }
};

// ════════════════════════════════════════════════════════════════
// YEAR-END POSTING (freezes every member's statement for the year)
// ════════════════════════════════════════════════════════════════

const insertYear = async (connection, unit, oldEmp, y, usr) => {
  await connection.execute(
    `INSERT INTO HR_PF_YEAR (UNIT_ID, OLD_EMPCODE, FY_FROM, FY_TO, CUTOFF_DATE, PROFIT_RATE, LOAN_RATE,
       EMP_OPENING, EMP_CONTRIB, EMP_PRODUCT, EMP_PROFIT, EMP_WITHDRAWN, LOAN_INTEREST, EMP_CLOSING,
       CO_OPENING, CO_CONTRIB, CO_PRODUCT, CO_PROFIT, CO_WITHDRAWN, CO_CLOSING,
       LOAN_OPENING, LOAN_PRODUCT, LOAN_CLOSING, POSTED_ON, USR_ID_UPD)
     VALUES (:u, :e, TO_DATE(:ff,'YYYY-MM-DD'), TO_DATE(:ft,'YYYY-MM-DD'), TO_DATE(:co,'YYYY-MM-DD'), :pr, :lr,
       :eo, :ec, :ep, :epr, :ew, :li, :ecl, :coo, :coc, :cop, :copr, :cow, :cocl, :lo, :lp, :lc, SYSDATE, :usr)`,
    {
      u: unit, e: oldEmp, ff: y.fy_from, ft: y.fy_to, co: y.cutoff, pr: y.profit_rate, lr: y.loan_rate,
      eo: y.emp.opening, ec: y.emp.contribution, ep: y.emp.product, epr: y.emp.profit, ew: y.emp.withdrawn,
      li: y.emp.loan_interest, ecl: y.emp.closing,
      coo: y.co.opening, coc: y.co.contribution, cop: y.co.product, copr: y.co.profit, cow: y.co.withdrawn, cocl: y.co.closing,
      lo: y.loan.opening, lp: y.loan.product, lc: y.loan.closing, usr: toStr(usr),
    }
  );
  const rows = [
    ...y.lines.map((l) => ({
      t: l.line_type, vd: l.value_date, p: l.period ?? null, rd: l.ref_doc ?? null,
      eg: l.earned_gross ?? null, fpo: l.fpo ?? null, b: l.basic ?? null,
      ea: l.emp_amt, ca: l.co_amt, d: l.days, ep: l.emp_product, cp: l.co_product,
    })),
    ...y.loan.lines.map((l) => ({
      t: l.line_type, vd: l.value_date, p: null, rd: l.ref_doc ?? null, eg: null, fpo: null, b: null,
      ea: l.amount, ca: null, d: l.days, ep: l.product, cp: null,
    })),
  ].map((r, i) => ({ u: unit, e: oldEmp, ff: y.fy_from, n: i + 1, ...r }));
  if (rows.length) {
    await connection.executeMany(
      `INSERT INTO HR_PF_YEAR_LINE (UNIT_ID, OLD_EMPCODE, FY_FROM, LINE_NO, LINE_TYPE, VALUE_DATE, "PERIOD#", REF_DOC,
         EARNED_GROSS, FPO, BASIC, EMP_AMT, CO_AMT, DAYS, EMP_PRODUCT, CO_PRODUCT)
       VALUES (:u, :e, TO_DATE(:ff,'YYYY-MM-DD'), :n, :t, TO_DATE(:vd,'YYYY-MM-DD'), :p, :rd,
         :eg, :fpo, :b, :ea, :ca, :d, :ep, :cp)`,
      rows,
      {
        bindDefs: {
          u: { type: oracledb.NUMBER }, e: { type: oracledb.STRING, maxSize: 8 }, ff: { type: oracledb.STRING, maxSize: 10 }, n: { type: oracledb.NUMBER },
          t: { type: oracledb.STRING, maxSize: 10 }, vd: { type: oracledb.STRING, maxSize: 10 }, p: { type: oracledb.NUMBER }, rd: { type: oracledb.NUMBER },
          eg: { type: oracledb.NUMBER }, fpo: { type: oracledb.NUMBER }, b: { type: oracledb.NUMBER }, ea: { type: oracledb.NUMBER }, ca: { type: oracledb.NUMBER },
          d: { type: oracledb.NUMBER }, ep: { type: oracledb.NUMBER }, cp: { type: oracledb.NUMBER },
        },
      }
    );
  }
};

/**
 * Post (freeze) a financial year for every PF member of the company. Earlier
 * years must be posted first; re-posting is allowed until the next year is
 * posted (e.g. after a late salary re-process).
 */
export const postYear = async (unit, fyFrom, { usr = null } = {}) => {
  const fy = toDateStr(fyFrom);
  if (!isFyStart(fy)) return fail("fy_from must be the 1st of July of the financial year (YYYY-07-01)");
  const { to } = fiscalYearOf(fy);
  let connection;
  try {
    connection = await getDirectConnection();
    const rates = await loadRates(connection, unit);
    if (!rates.some((r) => r.fy_from === fy)) return fail(`Declare the profit rate for ${fyLabel(fy)} before posting it`);
    const pending = rates.find((r) => r.fy_from < fy && r.status !== "P");
    if (pending) return fail(`Post ${pending.fy_label} first — years are posted in order`);
    const later = rates.find((r) => r.fy_from > fy && r.status === "P");
    if (later) return fail(`${later.fy_label} is already posted; ${fyLabel(fy)} can no longer be re-posted`);

    const data = await loadUnitData(connection, unit, null, to);
    const prevFy = `${Number(fy.slice(0, 4)) - 1}-07-01`;
    const candidates = new Set([
      ...Object.keys(data.contributions),
      ...Object.keys(data.withdrawals),
      ...Object.keys(data.loans),
      ...Object.values(data.takeOns).filter((t) => t.as_of_fy <= fy).map((t) => t.old_empcode),
      ...Object.entries(data.posted).filter(([, ys]) => ys[prevFy]).map(([e]) => e),
    ]);

    await connection.execute(`DELETE FROM HR_PF_YEAR_LINE WHERE UNIT_ID = :u AND FY_FROM = TO_DATE(:f,'YYYY-MM-DD')`, { u: unit, f: fy });
    await connection.execute(`DELETE FROM HR_PF_YEAR WHERE UNIT_ID = :u AND FY_FROM = TO_DATE(:f,'YYYY-MM-DD')`, { u: unit, f: fy });
    for (const ys of Object.values(data.posted)) delete ys[fy];

    let posted = 0;
    let totalProfit = 0;
    const skipped = [];
    for (const emp of candidates) {
      const exit = data.members[emp]?.exit_date;
      if (exit && exit < fy) continue; // left (and settled) before this year
      let history;
      try {
        history = memberHistory(data, emp, to);
      } catch (err) {
        if (!err.code) throw err;
        skipped.push({ old_empcode: emp, reason: err.message });
        continue;
      }
      // Persist this year plus any earlier year of this member that was never posted.
      const toPost = history.years.filter((y) => y.status === "computed" && y.fy_from <= fy);
      if (!toPost.some((y) => y.fy_from === fy)) continue;
      const provisional = toPost.find((y) => y.provisional);
      if (provisional) {
        skipped.push({ old_empcode: emp, reason: `No declared rate for ${provisional.fy_label}` });
        continue;
      }
      for (const y of toPost) {
        if (y.fy_from !== fy) {
          await connection.execute(`DELETE FROM HR_PF_YEAR_LINE WHERE UNIT_ID = :u AND OLD_EMPCODE = :e AND FY_FROM = TO_DATE(:f,'YYYY-MM-DD')`, { u: unit, e: emp, f: y.fy_from });
          await connection.execute(`DELETE FROM HR_PF_YEAR WHERE UNIT_ID = :u AND OLD_EMPCODE = :e AND FY_FROM = TO_DATE(:f,'YYYY-MM-DD')`, { u: unit, e: emp, f: y.fy_from });
        }
        await insertYear(connection, unit, emp, y, usr);
        if (y.fy_from === fy) {
          posted += 1;
          totalProfit += y.emp.profit + y.co.profit;
        }
      }
    }

    await connection.execute(
      `UPDATE HR_PF_PROFIT_RATE SET STATUS = 'P', POSTED_ON = SYSDATE, USR_ID_UPD = :usr, USR_DATE_UPD = SYSDATE
        WHERE UNIT_ID = :u AND FY_FROM = TO_DATE(:f,'YYYY-MM-DD')`,
      { u: unit, f: fy, usr: toStr(usr) }
    );
    await connection.commit();
    return { status: "success", fy_label: fyLabel(fy), members_posted: posted, total_profit: totalProfit, skipped };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return fail(err.message);
  } finally {
    await connection?.close();
  }
};
