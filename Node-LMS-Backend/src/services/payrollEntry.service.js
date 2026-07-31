/**
 * Payroll entry service — period-based payroll input data the ERP salary
 * process consumes.
 *
 * Faithful 1:1 port of the FastAPI LMS-Backend's
 * repositories/payroll_entry_repository.py. Four modules, all per-company
 * (UNIT_ID) and (except loan recovery reads) keyed to a payroll PERIOD —
 * normally the company's currently *open* period:
 *
 *   1. Loan recovery / adjustment  -> HR_LOAN_RECOVERY (ledger; reads loan in HR_LOAN_MST)
 *   2. Monthly allowances          -> HR_MONTHLY_ALLOW  (LOV: HR_ALLOWANCE, INCL_GROSS='N')
 *   3. Monthly deductions          -> HR_MONTHLY_DED    (LOV: HR_DEDUCTION)
 *   4. Absent days                 -> HR_ABSENT_DAYS
 *
 * Employee records elsewhere are keyed by OLD_EMPCODE (e.g. '100001.1'); the
 * UI sends EMPCODE, which we resolve with HR_EMP_MASTER. Branch =
 * HR_EMP_MASTER.LOCATION, and (per the FastAPI source) is filtered in
 * application code after the fetch, not via SQL WHERE — replicated as-is here.
 */

import { getDirectConnection } from "../config/database.js";

const OUT_ARRAY = 4001; // oracledb.OUT_FORMAT_ARRAY

const MONTHS = ["", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Recovery type LOV. There is no lookup table in the DB for this 1-char column
// (HR_LOAN_RECOVERY.RECOVERY_TYPE), so these are the business options exposed
// in the dropdown (mirrors RECOVERY_TYPES in payroll_entry_repository.py).
const RECOVERY_TYPES = [
  { value: "C", label: "Cash Recovery" },
  { value: "S", label: "Salary Deduction" },
  { value: "A", label: "Adjustment / Write-off" },
];
const RECOVERY_LABELS = Object.fromEntries(RECOVERY_TYPES.map((r) => [r.value, r.label]));

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

// Row value -> trimmed string ("" when NULL). Coerces first so NUMBER columns
// (EMPCODE, LOCATION, ...) don't blow up on .trim() (mirrors _t).
const t = (v) => (v === null || v === undefined ? "" : String(v).trim());

const label = (frm) => {
  if (!frm || frm.length < 7) return "";
  return `${MONTHS[Number(frm.slice(5, 7))]} - ${frm.slice(0, 4)}`;
};

// Reusable employee-info subselects (name / empcode / designation / department),
// matching the fixes used elsewhere (leading-zero codes; department scoped per
// company). Mirrors _EMP_COLS.format(alias=...).
const empCols = (alias) => `
    (SELECT MAX(e.NAME) FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE = ${alias}.OLD_EMPCODE OR e.EMPCODE = ${alias}.OLD_EMPCODE),
    (SELECT MAX(e.EMPCODE) FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE = ${alias}.OLD_EMPCODE OR e.EMPCODE = ${alias}.OLD_EMPCODE),
    (SELECT MIN(dg.DESG_DESC) FROM HR_EMP_MASTER e JOIN HR_DESG dg
            ON LTRIM(dg.DESG_CD,'0')=LTRIM(e.DESG_CD,'0') AND TO_CHAR(dg.COMPC)=TO_CHAR(e.UNIT_ID)
       WHERE e.OLD_EMPCODE = ${alias}.OLD_EMPCODE OR e.EMPCODE = ${alias}.OLD_EMPCODE),
    (SELECT MIN(d.DEPT_NAME) FROM HR_EMP_MASTER e JOIN HR_DEPT d
            ON LTRIM(d.DEPT_NO,'0')=LTRIM(e.DEPT_NO,'0') AND TO_CHAR(d.COMPC)=TO_CHAR(e.UNIT_ID)
       WHERE e.OLD_EMPCODE = ${alias}.OLD_EMPCODE OR e.EMPCODE = ${alias}.OLD_EMPCODE)
`;

// Value stored in *.OLD_EMPCODE for an employee — prefer their OLD_EMPCODE,
// else the empcode itself (mirrors _emp_link; note this variant also matches
// on OLD_EMPCODE directly, unlike payroll.service.js's empLink).
const empLink = async (connection, empcode) => {
  try {
    const result = await connection.execute(
      `SELECT OLD_EMPCODE FROM HR_EMP_MASTER WHERE EMPCODE = :e OR OLD_EMPCODE = :e`,
      { e: String(empcode) },
      { outFormat: OUT_ARRAY }
    );
    const r = result.rows?.[0];
    if (r && r[0]) return String(r[0]).trim();
  } catch { /* ignore */ }
  return String(empcode);
};

// ════════════════════════════════════════════════════════════════
// PERIODS — the company's open period(s)
// ════════════════════════════════════════════════════════════════

export const listOpenPeriods = async (compc) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `SELECT "PERIOD#", RULE_ID, TO_CHAR(PERIOD_FRM,'YYYY-MM-DD'),
              TO_CHAR(PERIOD_TO,'YYYY-MM-DD'), P_DAYS
       FROM HR_ATTND_PERIOD
       WHERE UNIT_ID = :u AND UPPER(NVL(STATUS,'O')) = 'O'
       ORDER BY PERIOD_FRM DESC, "PERIOD#" DESC`,
      { u: toInt(compc) },
      { outFormat: OUT_ARRAY }
    );
    return (result.rows ?? []).map((r) => ({
      period: Number(r[0]), rule_id: r[1] !== null && r[1] !== undefined ? Number(r[1]) : null,
      period_frm: r[2], period_to: r[3], p_days: r[4],
      label: label(r[2]) || `Period ${Number(r[0])}`,
    }));
  } finally {
    await connection?.close();
  }
};

/**
 * Periods selectable in the Monthly Inputs screens: the company's open period
 * and every earlier month **of the same financial year** (RULE_ID). Later
 * months of the year exist already (created with STATUS 'C' up-front) but have
 * not happened yet, so they are excluded.
 *
 * Entries can only be edited in the open period; the earlier ones are returned
 * so past input can be reviewed, flagged with is_open = false.
 */
export const listEntryPeriods = async (compc) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `WITH open_p AS (
         SELECT RULE_ID, PERIOD_FRM
           FROM (SELECT RULE_ID, PERIOD_FRM
                   FROM HR_ATTND_PERIOD
                  WHERE UNIT_ID = :u AND UPPER(NVL(STATUS,'O')) = 'O'
                  ORDER BY PERIOD_FRM DESC, "PERIOD#" DESC)
          WHERE ROWNUM = 1
       )
       SELECT p."PERIOD#", p.RULE_ID, TO_CHAR(p.PERIOD_FRM,'YYYY-MM-DD'),
              TO_CHAR(p.PERIOD_TO,'YYYY-MM-DD'), p.P_DAYS,
              UPPER(NVL(p.STATUS,'O'))
         FROM HR_ATTND_PERIOD p, open_p o
        WHERE p.UNIT_ID = :u
          AND p.RULE_ID = o.RULE_ID
          AND p.PERIOD_FRM <= o.PERIOD_FRM
        ORDER BY p.PERIOD_FRM DESC, p."PERIOD#" DESC`,
      { u: toInt(compc) },
      { outFormat: OUT_ARRAY }
    );
    return (result.rows ?? []).map((r) => ({
      period: Number(r[0]),
      rule_id: r[1] !== null && r[1] !== undefined ? Number(r[1]) : null,
      period_frm: r[2], period_to: r[3], p_days: r[4],
      status: t(r[5]) || "O",
      is_open: t(r[5]) === "O",
      label: label(r[2]) || `Period ${Number(r[0])}`,
    }));
  } finally {
    await connection?.close();
  }
};

/**
 * Read-side period resolver: accepts any period belonging to the company, open
 * or closed, so a past month's entries can be displayed. Falls back to the
 * latest open period when none is given.
 *
 * Writes must NOT use this — they use resolvePeriod below, which only ever
 * resolves an open period.
 */
const resolvePeriodForRead = async (connection, compc, period = null) => {
  const u = toInt(compc);
  if (period === null || period === undefined || String(period).trim() === "") {
    return resolvePeriod(connection, compc, null);
  }
  const result = await connection.execute(
    `SELECT "PERIOD#", RULE_ID FROM HR_ATTND_PERIOD
      WHERE UNIT_ID = :u AND "PERIOD#" = :p`,
    { u, p: toInt(period) },
    { outFormat: OUT_ARRAY }
  );
  const r = result.rows?.[0];
  if (!r) return [null, null];
  return [Number(r[0]), r[1] !== null && r[1] !== undefined ? Number(r[1]) : null];
};

// Return [period#, rule_id] for an open period of the company. If `period` is
// given it must be open; otherwise the latest open period is used. Returns
// [null, null] when there is no matching open period (mirrors _resolve_period).
const resolvePeriod = async (connection, compc, period = null) => {
  const u = toInt(compc);
  let result;
  if (period !== null && period !== undefined) {
    result = await connection.execute(
      `SELECT "PERIOD#", RULE_ID FROM HR_ATTND_PERIOD
       WHERE UNIT_ID = :u AND "PERIOD#" = :p AND UPPER(NVL(STATUS,'O')) = 'O'`,
      { u, p: toInt(period) },
      { outFormat: OUT_ARRAY }
    );
  } else {
    result = await connection.execute(
      `SELECT "PERIOD#", RULE_ID FROM HR_ATTND_PERIOD
       WHERE UNIT_ID = :u AND UPPER(NVL(STATUS,'O')) = 'O'
       ORDER BY PERIOD_FRM DESC, "PERIOD#" DESC FETCH FIRST 1 ROWS ONLY`,
      { u },
      { outFormat: OUT_ARRAY }
    );
  }
  const r = result.rows?.[0];
  if (!r) return [null, null];
  return [Number(r[0]), r[1] !== null && r[1] !== undefined ? Number(r[1]) : null];
};

/**
 * Message for a write that could not resolve an open period. Distinguishes
 * "the period you named is closed" from "this company has no open period at
 * all" — the old wording claimed the latter for both.
 */
const closedPeriodError = async (connection, compc, period) => {
  if (period !== null && period !== undefined && String(period).trim() !== "") {
    const [p] = await resolvePeriodForRead(connection, compc, period);
    if (p !== null) {
      return { status: "error", message: `Period is closed — entries can only be changed in the open period.` };
    }
  }
  return { status: "error", message: "No open period for this company. Open a period first." };
};

// ════════════════════════════════════════════════════════════════
// 1 — LOAN RECOVERY / ADJUSTMENT (HR_LOAN_RECOVERY)
// ════════════════════════════════════════════════════════════════

export const recoveryTypes = () => RECOVERY_TYPES.map((r) => ({ ...r }));

// Return [old_empcode, loan_amt, outstanding] for a loan, where outstanding =
// loan_amt - LOAN_RECOVER - sum(manual recoveries already recorded).
const loanOutstanding = async (connection, doc) => {
  const loanRes = await connection.execute(
    `SELECT OLD_EMPCODE, NVL(LOAN_AMT,0), NVL(LOAN_RECOVER,0) FROM HR_LOAN_MST WHERE "DOC#" = :d`,
    { d: toInt(doc) },
    { outFormat: OUT_ARRAY }
  );
  const r = loanRes.rows?.[0];
  if (!r) return [null, 0, 0];
  const oldEmp = t(r[0]);
  const amt = Number(r[1] || 0);
  const rec = Number(r[2] || 0);
  const manualRes = await connection.execute(
    `SELECT NVL(SUM(RECOVERD_AMT),0) FROM HR_LOAN_RECOVERY WHERE "DOC#" = :d`,
    { d: toInt(doc) },
    { outFormat: OUT_ARRAY }
  );
  const manual = Number(manualRes.rows?.[0]?.[0] || 0);
  return [oldEmp, amt, amt - rec - manual];
};

export const listRecoverableLoans = async (compc, brnch = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `SELECT l."DOC#", l.OLD_EMPCODE, t.LOAN_DESC, l.LOAN_CD,
              NVL(l.LOAN_AMT,0), NVL(l.LOAN_RECOVER,0),
              NVL((SELECT SUM(rc.RECOVERD_AMT) FROM HR_LOAN_RECOVERY rc WHERE rc."DOC#" = l."DOC#"),0),
              ${empCols("l")},
              (SELECT MAX(e.LOCATION) FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE = l.OLD_EMPCODE OR e.EMPCODE = l.OLD_EMPCODE)
       FROM HR_LOAN_MST l
       LEFT JOIN HR_LOAN_TYPE t ON t.LOAN_CD = l.LOAN_CD
       WHERE l.UNIT_ID = :u
       ORDER BY l."DOC#" DESC`,
      { u: toInt(compc) },
      { outFormat: OUT_ARRAY }
    );
    const b = toStr(brnch);
    const out = [];
    for (const r of result.rows ?? []) {
      const loc = t(r[11]); // LOCATION is NUMBER -> t() avoids the strip-on-int crash
      if (b && loc !== b) continue;
      const amt = Number(r[4] || 0);
      const outstanding = amt - Number(r[5] || 0) - Number(r[6] || 0);
      out.push({
        doc: Number(r[0]), old_empcode: t(r[1]),
        loan_desc: t(r[2]) || t(r[3]),
        loan_amt: amt, balance: outstanding,
        name: t(r[7]), empcode: t(r[8]) || t(r[1]),
        designation: t(r[9]), department: t(r[10]),
      });
    }
    return out;
  } finally {
    await connection?.close();
  }
};

export const listLoanRecoveries = async (compc, doc = null, brnch = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const conds = ["rc.UNIT_ID = :u"];
    const params = { u: toInt(compc) };
    if (doc !== null && doc !== undefined) { conds.push('rc."DOC#" = :d'); params.d = toInt(doc); }
    const result = await connection.execute(
      `SELECT rc.ROWID, rc."DOC#", rc."PERIOD#", NVL(rc.RECOVERD_AMT,0), rc.RECOVERY_TYPE,
              NVL(rc.BALANCE_AMT,0), rc.REMARKS, rc.OLD_EMPCODE,
              ${empCols("rc")},
              (SELECT MAX(e.LOCATION) FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE = rc.OLD_EMPCODE OR e.EMPCODE = rc.OLD_EMPCODE),
              NVL(l.LOAN_AMT,0),
              (SELECT t.LOAN_DESC FROM HR_LOAN_TYPE t WHERE t.LOAN_CD = l.LOAN_CD)
       FROM HR_LOAN_RECOVERY rc
       LEFT JOIN HR_LOAN_MST l ON l."DOC#" = rc."DOC#"
       WHERE ${conds.join(" AND ")}
       ORDER BY rc."DOC#" DESC, rc.USR_DATE_UPD DESC`,
      params,
      { outFormat: OUT_ARRAY }
    );
    const b = toStr(brnch);
    const out = [];
    for (const r of result.rows ?? []) {
      const loc = t(r[12]); // LOCATION is NUMBER -> t() avoids the strip-on-int crash
      if (b && loc !== b) continue;
      const rt = t(r[4]);
      out.push({
        rowid: String(r[0]), doc: r[1] !== null && r[1] !== undefined ? Number(r[1]) : null,
        period: r[2] !== null && r[2] !== undefined ? Number(r[2]) : null,
        recovered_amt: Number(r[3] || 0), recovery_type: rt,
        recovery_type_label: RECOVERY_LABELS[rt] ?? rt,
        balance_amt: Number(r[5] || 0), remarks: t(r[6]),
        old_empcode: t(r[7]), name: t(r[8]),
        empcode: t(r[9]) || t(r[7]), designation: t(r[10]),
        department: t(r[11]), loan_amt: Number(r[13] || 0),
        loan_desc: t(r[14]),
      });
    }
    return out;
  } finally {
    await connection?.close();
  }
};

export const createLoanRecovery = async (compc, doc, recoveryType, recoveredAmt, remarks, intRateRec = null, { period = null, usr = null } = {}) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const u = toInt(compc);
    const d = toInt(doc);
    if (d === null) return { status: "error", message: "Select a loan" };
    const amt = toNum(recoveredAmt);
    if (amt === null || amt <= 0) return { status: "error", message: "Recovery amount must be greater than zero" };
    const [per] = await resolvePeriod(connection, u, period);
    if (per === null) return { status: "error", message: "No open period for this company. Open a period first." };
    const [oldEmp, , outstanding] = await loanOutstanding(connection, d);
    if (oldEmp === null) return { status: "error", message: "Loan not found" };
    if (amt > outstanding + 0.01) {
      return {
        status: "error",
        message: `Recovery (${Math.round(amt).toLocaleString()}) exceeds the outstanding balance (${Math.round(outstanding).toLocaleString()})`,
      };
    }
    const balance = outstanding - amt;
    await connection.execute(
      `INSERT INTO HR_LOAN_RECOVERY
         ("DOC#", "PERIOD#", RECOVERD_AMT, RECOVERY_TYPE, INT_RATE_REC, UNIT_ID,
          BALANCE_AMT, USR_ID_UPD, USR_DATE_UPD, REMARKS, OLD_EMPCODE)
       VALUES (:d, :p, :amt, :rt, :ir, :u, :bal, :usr, SYSDATE, :rem, :emp)`,
      {
        d, p: per, amt, rt: (toStr(recoveryType) || "C").slice(0, 1),
        ir: toNum(intRateRec), u, bal: balance, usr: (toStr(usr) || "HR").slice(0, 2),
        rem: (toStr(remarks) || "").slice(0, 50), emp: oldEmp,
      }
    );
    await connection.commit();
    return { status: "success", balance };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

export const deleteLoanRecovery = async (compc, rowid) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `DELETE FROM HR_LOAN_RECOVERY WHERE ROWID = :rid AND UNIT_ID = :u`,
      { rid: String(rowid), u: toInt(compc) }
    );
    await connection.commit();
    if (!result.rowsAffected) return { status: "error", message: "Recovery not found" };
    return { status: "success" };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

// ════════════════════════════════════════════════════════════════
// 2 — MONTHLY ALLOWANCES (HR_MONTHLY_ALLOW; LOV HR_ALLOWANCE INCL_GROSS='N')
// ════════════════════════════════════════════════════════════════

export const listAllowanceTypes = async () => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `SELECT ALLOWANCE_ID, ALLOWANCE_DESC, ALLOWANCE_TYPE
       FROM HR_ALLOWANCE WHERE INCL_GROSS = 'N'
       ORDER BY LPAD(ALLOWANCE_ID, 5)`,
      {},
      { outFormat: OUT_ARRAY }
    );
    return (result.rows ?? []).map((r) => ({ allowance_id: t(r[0]), allowance_desc: t(r[1]), allowance_type: r[2] }));
  } finally {
    await connection?.close();
  }
};

export const listMonthlyAllowances = async (compc, period = null, empcode = null, brnch = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const u = toInt(compc);
    const [per] = await resolvePeriodForRead(connection, u, period);
    if (per === null) return [];
    const conds = ["a.UNIT_ID = :u", 'a."PERIOD#" = :p'];
    const params = { u, p: per };
    if (empcode) {
      const link = await empLink(connection, String(empcode));
      conds.push("(a.OLD_EMPCODE = :e OR a.OLD_EMPCODE = :ec)");
      params.e = link;
      params.ec = String(empcode);
    }
    const result = await connection.execute(
      `SELECT a.OLD_EMPCODE, a.ALLOWANCE_ID, NVL(a.AMOUNT,0), a.OT_HOUR, a.REMARKS,
              al.ALLOWANCE_DESC,
              ${empCols("a")},
              (SELECT MAX(e.LOCATION) FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE = a.OLD_EMPCODE OR e.EMPCODE = a.OLD_EMPCODE)
       FROM HR_MONTHLY_ALLOW a
       LEFT JOIN HR_ALLOWANCE al ON TRIM(al.ALLOWANCE_ID) = TRIM(a.ALLOWANCE_ID)
       WHERE ${conds.join(" AND ")}
       ORDER BY 7`,
      params,
      { outFormat: OUT_ARRAY }
    );
    const b = toStr(brnch);
    const out = [];
    for (const r of result.rows ?? []) {
      const loc = t(r[10]); // LOCATION is NUMBER -> t() avoids the strip-on-int crash
      if (b && loc !== b) continue;
      out.push({
        old_empcode: t(r[0]), allowance_id: t(r[1]),
        amount: Number(r[2] || 0), ot_hour: r[3], remarks: t(r[4]),
        allowance_desc: t(r[5]), name: t(r[6]),
        empcode: t(r[7]) || t(r[0]), designation: t(r[8]),
        department: t(r[9]),
      });
    }
    return out;
  } finally {
    await connection?.close();
  }
};

export const upsertMonthlyAllowance = async (compc, empcode, allowanceId, amount, otHour = null, remarks = null, { period = null, usr = null } = {}) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const u = toInt(compc);
    if (!toStr(empcode)) return { status: "error", message: "Employee is required" };
    if (!toStr(allowanceId)) return { status: "error", message: "Allowance is required" };
    let [per, rule] = await resolvePeriod(connection, u, period);
    if (per === null) return closedPeriodError(connection, u, period);
    if (rule === null) rule = 0;
    const link = await empLink(connection, String(empcode));
    await connection.execute(
      `MERGE INTO HR_MONTHLY_ALLOW t
       USING (SELECT :e AS OLD_EMPCODE, :aid AS ALLOWANCE_ID, :p AS PNO,
                     :u AS UNIT_ID, :rid AS RULE_ID FROM dual) s
       ON (t.OLD_EMPCODE = s.OLD_EMPCODE AND t.ALLOWANCE_ID = s.ALLOWANCE_ID
           AND t."PERIOD#" = s.PNO AND t.UNIT_ID = s.UNIT_ID AND t.RULE_ID = s.RULE_ID)
       WHEN MATCHED THEN UPDATE SET t.AMOUNT = :amt, t.OT_HOUR = :ot, t.REMARKS = :rem,
                                    t.USR_ID_UPD = :usr, t.USR_DATE_UPD = SYSDATE
       WHEN NOT MATCHED THEN INSERT
         (OLD_EMPCODE, ALLOWANCE_ID, AMOUNT, "PERIOD#", UNIT_ID, USR_ID_UPD,
          USR_DATE_UPD, OT_HOUR, REMARKS, RULE_ID)
         VALUES (:e, :aid, :amt, :p, :u, :usr, SYSDATE, :ot, :rem, :rid)`,
      {
        e: link, aid: String(allowanceId).trim(), p: per, u, rid: rule,
        amt: toNum(amount) ?? 0, ot: toNum(otHour), rem: (toStr(remarks) || "").slice(0, 50),
        usr: (toStr(usr) || "HR").slice(0, 2),
      }
    );
    await connection.commit();
    return { status: "success", period: per };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

export const deleteMonthlyAllowance = async (compc, empcode, allowanceId, period = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const u = toInt(compc);
    const [per] = await resolvePeriod(connection, u, period);
    if (per === null) return closedPeriodError(connection, u, period);
    const link = await empLink(connection, String(empcode));
    const result = await connection.execute(
      `DELETE FROM HR_MONTHLY_ALLOW
       WHERE (OLD_EMPCODE = :e OR OLD_EMPCODE = :ec) AND ALLOWANCE_ID = :aid
         AND "PERIOD#" = :p AND UNIT_ID = :u`,
      { e: link, ec: String(empcode), aid: String(allowanceId).trim(), p: per, u }
    );
    await connection.commit();
    if (!result.rowsAffected) return { status: "error", message: "Entry not found" };
    return { status: "success" };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

// ════════════════════════════════════════════════════════════════
// 3 — MONTHLY DEDUCTIONS (HR_MONTHLY_DED; LOV HR_DEDUCTION)
// ════════════════════════════════════════════════════════════════

export const listDeductionTypes = async (compc = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const c = toInt(compc);
    const where = c !== null ? "WHERE UNIT_ID = :u" : "";
    const params = c !== null ? { u: c } : {};
    const result = await connection.execute(
      `SELECT DED_CD, DED_DESC FROM HR_DEDUCTION ${where} ORDER BY LPAD(DED_CD, 5)`,
      params,
      { outFormat: OUT_ARRAY }
    );
    return (result.rows ?? []).map((r) => ({ deduction_id: t(r[0]), deduction_desc: t(r[1]) }));
  } finally {
    await connection?.close();
  }
};

export const listMonthlyDeductions = async (compc, period = null, empcode = null, brnch = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const u = toInt(compc);
    const [per] = await resolvePeriodForRead(connection, u, period);
    if (per === null) return [];
    const conds = ["a.UNIT_ID = :u", 'a."PERIOD#" = :p'];
    const params = { u, p: per };
    if (empcode) {
      const link = await empLink(connection, String(empcode));
      conds.push("(a.OLD_EMPCODE = :e OR a.OLD_EMPCODE = :ec)");
      params.e = link;
      params.ec = String(empcode);
    }
    const result = await connection.execute(
      `SELECT a.OLD_EMPCODE, a.DEDUCTION_ID, NVL(a.AMOUNT,0), a.REMARKS,
              dd.DED_DESC,
              ${empCols("a")},
              (SELECT MAX(e.LOCATION) FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE = a.OLD_EMPCODE OR e.EMPCODE = a.OLD_EMPCODE)
       FROM HR_MONTHLY_DED a
       LEFT JOIN HR_DEDUCTION dd ON TRIM(dd.DED_CD) = TRIM(a.DEDUCTION_ID)
       WHERE ${conds.join(" AND ")}
       ORDER BY 6`,
      params,
      { outFormat: OUT_ARRAY }
    );
    const b = toStr(brnch);
    const out = [];
    for (const r of result.rows ?? []) {
      const loc = t(r[9]); // LOCATION is NUMBER -> t() avoids the strip-on-int crash
      if (b && loc !== b) continue;
      out.push({
        old_empcode: t(r[0]), deduction_id: t(r[1]),
        amount: Number(r[2] || 0), remarks: t(r[3]),
        deduction_desc: t(r[4]), name: t(r[5]),
        empcode: t(r[6]) || t(r[0]), designation: t(r[7]),
        department: t(r[8]),
      });
    }
    return out;
  } finally {
    await connection?.close();
  }
};

export const upsertMonthlyDeduction = async (compc, empcode, deductionId, amount, remarks = null, { period = null, usr = null } = {}) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const u = toInt(compc);
    if (!toStr(empcode)) return { status: "error", message: "Employee is required" };
    if (!toStr(deductionId)) return { status: "error", message: "Deduction is required" };
    const [per] = await resolvePeriod(connection, u, period);
    if (per === null) return closedPeriodError(connection, u, period);
    const link = await empLink(connection, String(empcode));
    await connection.execute(
      `MERGE INTO HR_MONTHLY_DED t
       USING (SELECT :e AS OLD_EMPCODE, :did AS DEDUCTION_ID, :p AS PNO, :u AS UNIT_ID FROM dual) s
       ON (t.OLD_EMPCODE = s.OLD_EMPCODE AND t.DEDUCTION_ID = s.DEDUCTION_ID
           AND t."PERIOD#" = s.PNO AND t.UNIT_ID = s.UNIT_ID)
       WHEN MATCHED THEN UPDATE SET t.AMOUNT = :amt, t.REMARKS = :rem,
                                    t.USR_ID_UPD = :usr, t.USR_DATE_UPD = SYSDATE
       WHEN NOT MATCHED THEN INSERT
         (OLD_EMPCODE, DEDUCTION_ID, AMOUNT, "PERIOD#", UNIT_ID, USR_ID_UPD, USR_DATE_UPD, REMARKS)
         VALUES (:e, :did, :amt, :p, :u, :usr, SYSDATE, :rem)`,
      {
        e: link, did: String(deductionId).trim(), p: per, u,
        amt: toNum(amount) ?? 0, rem: (toStr(remarks) || "").slice(0, 50), usr: (toStr(usr) || "HR").slice(0, 2),
      }
    );
    await connection.commit();
    return { status: "success", period: per };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

export const deleteMonthlyDeduction = async (compc, empcode, deductionId, period = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const u = toInt(compc);
    const [per] = await resolvePeriod(connection, u, period);
    if (per === null) return closedPeriodError(connection, u, period);
    const link = await empLink(connection, String(empcode));
    const result = await connection.execute(
      `DELETE FROM HR_MONTHLY_DED
       WHERE (OLD_EMPCODE = :e OR OLD_EMPCODE = :ec) AND DEDUCTION_ID = :did
         AND "PERIOD#" = :p AND UNIT_ID = :u`,
      { e: link, ec: String(empcode), did: String(deductionId).trim(), p: per, u }
    );
    await connection.commit();
    if (!result.rowsAffected) return { status: "error", message: "Entry not found" };
    return { status: "success" };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

// ════════════════════════════════════════════════════════════════
// 4 — ABSENT DAYS (HR_ABSENT_DAYS)
// ════════════════════════════════════════════════════════════════

export const listAbsentDays = async (compc, period = null, empcode = null, brnch = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const u = toInt(compc);
    const [per] = await resolvePeriodForRead(connection, u, period);
    if (per === null) return [];
    const conds = ["a.UNIT_ID = :u", 'a."PERIOD#" = :p'];
    const params = { u, p: per };
    if (empcode) {
      const link = await empLink(connection, String(empcode));
      conds.push("(a.OLD_EMPCODE = :e OR a.OLD_EMPCODE = :ec)");
      params.e = link;
      params.ec = String(empcode);
    }
    const result = await connection.execute(
      `SELECT a.OLD_EMPCODE, NVL(a.ABSENT_DAYS,0),
              ${empCols("a")},
              (SELECT MAX(e.LOCATION) FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE = a.OLD_EMPCODE OR e.EMPCODE = a.OLD_EMPCODE)
       FROM HR_ABSENT_DAYS a
       WHERE ${conds.join(" AND ")}
       ORDER BY 4`,
      params,
      { outFormat: OUT_ARRAY }
    );
    const b = toStr(brnch);
    const out = [];
    for (const r of result.rows ?? []) {
      const loc = t(r[6]); // LOCATION is NUMBER -> t() avoids the strip-on-int crash
      if (b && loc !== b) continue;
      out.push({
        old_empcode: t(r[0]), absent_days: Number(r[1] || 0),
        name: t(r[2]), empcode: t(r[3]) || t(r[0]),
        designation: t(r[4]), department: t(r[5]),
      });
    }
    return out;
  } finally {
    await connection?.close();
  }
};

export const getEmployeeAbsent = async (compc, empcode, period = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const u = toInt(compc);
    const [per] = await resolvePeriodForRead(connection, u, period);
    if (per === null) return { absent_days: 0, period: null };
    const link = await empLink(connection, String(empcode));
    const result = await connection.execute(
      `SELECT NVL(ABSENT_DAYS,0) FROM HR_ABSENT_DAYS
       WHERE (OLD_EMPCODE = :e OR OLD_EMPCODE = :ec) AND UNIT_ID = :u AND "PERIOD#" = :p`,
      { e: link, ec: String(empcode), u, p: per },
      { outFormat: OUT_ARRAY }
    );
    const r = result.rows?.[0];
    return { absent_days: r ? Number(r[0]) : 0, period: per };
  } finally {
    await connection?.close();
  }
};

export const setAbsentDays = async (compc, empcode, absentDays, { period = null, usr = null } = {}) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const u = toInt(compc);
    if (!toStr(empcode)) return { status: "error", message: "Employee is required" };
    const days = toNum(absentDays);
    if (days === null || days < 0) return { status: "error", message: "Absent days must be zero or more" };
    const [per] = await resolvePeriod(connection, u, period);
    if (per === null) return closedPeriodError(connection, u, period);
    const link = await empLink(connection, String(empcode));
    await connection.execute(
      `MERGE INTO HR_ABSENT_DAYS t
       USING (SELECT :e AS OLD_EMPCODE, :u AS UNIT_ID, :p AS PNO FROM dual) s
       ON (t.OLD_EMPCODE = s.OLD_EMPCODE AND t.UNIT_ID = s.UNIT_ID AND t."PERIOD#" = s.PNO)
       WHEN MATCHED THEN UPDATE SET t.ABSENT_DAYS = :days, t.USR_ID_UPD = :usr, t.USR_DATE_UPD = SYSDATE
       WHEN NOT MATCHED THEN INSERT
         (OLD_EMPCODE, UNIT_ID, "PERIOD#", ABSENT_DAYS, USR_ID_UPD, USR_DATE_UPD)
         VALUES (:e, :u, :p, :days, :usr, SYSDATE)`,
      { e: link, u, p: per, days, usr: (toStr(usr) || "HR").slice(0, 2) }
    );
    await connection.commit();
    return { status: "success", period: per, absent_days: days };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

export const deleteAbsentDays = async (compc, empcode, period = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const u = toInt(compc);
    const [per] = await resolvePeriod(connection, u, period);
    if (per === null) return closedPeriodError(connection, u, period);
    const link = await empLink(connection, String(empcode));
    const result = await connection.execute(
      `DELETE FROM HR_ABSENT_DAYS
       WHERE (OLD_EMPCODE = :e OR OLD_EMPCODE = :ec) AND UNIT_ID = :u AND "PERIOD#" = :p`,
      { e: link, ec: String(empcode), u, p: per }
    );
    await connection.commit();
    if (!result.rowsAffected) return { status: "error", message: "Entry not found" };
    return { status: "success" };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};
