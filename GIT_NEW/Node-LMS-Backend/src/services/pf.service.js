/**
 * Provident Fund service — built only on data the ERP already holds; it adds
 * no tables of its own.
 *
 * Where each figure comes from:
 *   Opening balance   HR_PF_BALANCES (PF_BAL summed per employee; PERIOD# 0 is
 *                     the migrated opening, any other period is shown as a
 *                     brought-forward entry for that month)
 *   Contributions     HR_SALARY_PROCESS_FINAL, TRANS_TYPE 'D' with a PF
 *                     deduction code. Only posted (final) months count toward
 *                     the balance. A month that has been processed but not yet
 *                     posted shows as "pending", outside the balance.
 *   Withdrawals       HR_LOAN_MST, LOAN_CD 16 (PERMANENT WITHDRAWAL-PF) — leaves
 *                     the fund for good, so it reduces the balance.
 *   Loans against PF  HR_LOAN_MST, LOAN_CD 5 (LOAN AGAINST P.F) — repaid through
 *                     salary, so it does not reduce the balance; the outstanding
 *                     part is shown separately and reduces "available".
 *
 * Only the employee's own deduction exists in this database — the salary
 * process records no employer share and no profit — so neither is invented here.
 *
 * PF deduction codes: HR_SALARY_PROCES_PRO writes PF as TRANS_ID 12 for every
 * unit, while HR_DEDUCTION gives unit 2 its own PF code (31). Both are counted
 * so a later fix of that hard-coding does not make contributions disappear.
 *
 * Loan recovery: HR_SALARY_PROCES_PRO_FINAL adds each salary recovery to
 * HR_LOAN_MST.LOAN_RECOVER *and* logs it in HR_LOAN_RECOVERY with
 * RECOVERY_TYPE '1'; a manual recovery (payroll entry screen, types C/S/A) is
 * only logged. Recovered = LOAN_RECOVER + the non-'1' log rows, so neither
 * kind is counted twice.
 */

import { getDirectConnection } from "../config/database.js";

const OUT_ARRAY = 4001; // oracledb.OUT_FORMAT_ARRAY

export const PF_LOAN_CD = "5";      // HR_LOAN_TYPE: LOAN AGAINST P.F (also hard-coded in the final process)
export const PF_WITHDRAW_CD = "16"; // HR_LOAN_TYPE: PERMANENT WITHDRAWAL-PF

// Every deduction code that means "provident fund" in some unit, plus the 12
// the salary process always writes.
const PF_CODES_SQL = `(SELECT TO_CHAR(DED_CD) FROM HR_DEDUCTION WHERE UPPER(TRIM(DED_ABRV)) = 'PF'
                       UNION SELECT '12' FROM DUAL)`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const s = (v) => (v === null || v === undefined ? "" : String(v).trim());
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v) => Math.round(num(v) * 100) / 100;
const monthLabel = (iso) => {
  const m = /^(\d{4})-(\d{2})/.exec(s(iso));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
};

// ------------------------------------------------------------------
// raw loaders — each returns plain rows for one unit (optionally one employee)
// ------------------------------------------------------------------

const loadEmployees = async (connection, unitId, empKey, branch) => {
  const binds = { u: unitId };
  let extra = "";
  if (empKey) { extra += " AND m.OLD_EMPCODE = :e"; binds.e = empKey; }
  if (branch) { extra += " AND TO_CHAR(m.LOCATION) = :b"; binds.b = String(branch); }
  const res = await connection.execute(
    `SELECT m.OLD_EMPCODE, m.EMPCODE, m.NAME, m.STATUS, m.EMP_STATUS, m.PF_IND,
            TO_CHAR(m.PF_MEM_DT,'YYYY-MM-DD'), TO_CHAR(m.DTOFAPPT,'YYYY-MM-DD'),
            m.LOCATION,
            (SELECT MAX(v.DEPT_NAME) FROM HR_EMP_MASTER_VIEW v
              WHERE v.OLD_EMPCODE = m.OLD_EMPCODE AND v.UNIT_ID = m.UNIT_ID),
            (SELECT MAX(v.DESG_DESC) FROM HR_EMP_MASTER_VIEW v
              WHERE v.OLD_EMPCODE = m.OLD_EMPCODE AND v.UNIT_ID = m.UNIT_ID)
       FROM HR_EMP_MASTER m
      WHERE m.UNIT_ID = :u${extra}`,
    binds,
    { outFormat: OUT_ARRAY }
  );
  return (res.rows ?? []).map((r) => ({
    old_empcode: s(r[0]), empcode: s(r[1]), name: s(r[2]),
    status: s(r[3]), emp_status: s(r[4]), pf_ind: s(r[5]) === "Y" ? "Y" : "N",
    pf_mem_dt: r[6] || null, dtofappt: r[7] || null, location: s(r[8]),
    dept_name: s(r[9]), desg_desc: s(r[10]),
  }));
};

const empFilter = (col, empKey) => (empKey ? ` AND ${col} = :e` : "");
const empBinds = (unitId, empKey) => (empKey ? { u: unitId, e: empKey } : { u: unitId });

const loadOpenings = async (connection, unitId, empKey) => {
  const res = await connection.execute(
    `SELECT b.OLD_EMPCODE, b."PERIOD#", SUM(NVL(b.PF_BAL,0)),
            MAX(TO_CHAR(p.PERIOD_FRM,'YYYY-MM-DD'))
       FROM HR_PF_BALANCES b
       LEFT JOIN HR_ATTND_PERIOD p ON p."PERIOD#" = b."PERIOD#" AND p.UNIT_ID = b.UNIT_ID
      WHERE b.UNIT_ID = :u${empFilter("b.OLD_EMPCODE", empKey)}
      GROUP BY b.OLD_EMPCODE, b."PERIOD#"`,
    empBinds(unitId, empKey),
    { outFormat: OUT_ARRAY }
  );
  return (res.rows ?? []).map((r) => ({
    old_empcode: s(r[0]), period: num(r[1]), amount: r2(r[2]), period_frm: r[3] || null,
  }));
};

// Posted (final) PF deductions, one row per employee per month.
const loadContributions = async (connection, unitId, empKey) => {
  const res = await connection.execute(
    `SELECT x.OLD_EMPCODE, x."PERIOD#", x.AMT,
            TO_CHAR(p.PERIOD_FRM,'YYYY-MM-DD'), TO_CHAR(p.PERIOD_TO,'YYYY-MM-DD'),
            (SELECT MAX(mf.EARNED_BASIC) FROM HR_SALARY_PROCESS_MASTER_FINAL mf
              WHERE mf.OLD_EMPCODE = x.OLD_EMPCODE AND mf.UNIT_ID = x.UNIT_ID
                AND mf."PERIOD#" = x."PERIOD#")
       FROM (SELECT f.OLD_EMPCODE, f.UNIT_ID, f."PERIOD#", SUM(NVL(f.TRANS_AMOUNT,0)) AMT
               FROM HR_SALARY_PROCESS_FINAL f
              WHERE f.UNIT_ID = :u AND f.TRANS_TYPE = 'D'
                AND TO_CHAR(f.TRANS_ID) IN ${PF_CODES_SQL}${empFilter("f.OLD_EMPCODE", empKey)}
              GROUP BY f.OLD_EMPCODE, f.UNIT_ID, f."PERIOD#") x
       LEFT JOIN HR_ATTND_PERIOD p ON p."PERIOD#" = x."PERIOD#" AND p.UNIT_ID = x.UNIT_ID`,
    empBinds(unitId, empKey),
    { outFormat: OUT_ARRAY }
  );
  return (res.rows ?? []).map((r) => ({
    old_empcode: s(r[0]), period: num(r[1]), amount: r2(r[2]),
    period_frm: r[3] || null, period_to: r[4] || null, earned_basic: r[5] === null ? null : r2(r[5]),
  }));
};

// Processed-but-not-posted PF deductions (working tables, month not yet final).
const loadPending = async (connection, unitId, empKey) => {
  const res = await connection.execute(
    `SELECT x.OLD_EMPCODE, x."PERIOD#", x.AMT, TO_CHAR(p.PERIOD_FRM,'YYYY-MM-DD')
       FROM (SELECT w.OLD_EMPCODE, w.UNIT_ID, w."PERIOD#", SUM(NVL(w.TRANS_AMOUNT,0)) AMT
               FROM HR_SALARY_PROCESS w
              WHERE w.UNIT_ID = :u AND w.TRANS_TYPE = 'D'
                AND TO_CHAR(w.TRANS_ID) IN ${PF_CODES_SQL}${empFilter("w.OLD_EMPCODE", empKey)}
                AND NOT EXISTS (SELECT 1 FROM HR_SALARY_PROCESS_MASTER_FINAL mf
                                 WHERE mf.UNIT_ID = w.UNIT_ID AND mf."PERIOD#" = w."PERIOD#")
              GROUP BY w.OLD_EMPCODE, w.UNIT_ID, w."PERIOD#") x
       LEFT JOIN HR_ATTND_PERIOD p ON p."PERIOD#" = x."PERIOD#" AND p.UNIT_ID = x.UNIT_ID`,
    empBinds(unitId, empKey),
    { outFormat: OUT_ARRAY }
  );
  return (res.rows ?? []).map((r) => ({
    old_empcode: s(r[0]), period: num(r[1]), amount: r2(r[2]), period_frm: r[3] || null,
  }));
};

// PF loans (5) and permanent withdrawals (16). HR_LOAN_MST.OLD_EMPCODE may hold
// either the OLD_EMPCODE or the EMPCODE (see payroll.service.js:empLink), so
// the caller matches on both.
const loadPfLoans = async (connection, unitId, empKeys) => {
  const binds = { u: unitId, lap: PF_LOAN_CD, wd: PF_WITHDRAW_CD };
  let extra = "";
  if (empKeys?.length) {
    extra = ` AND l.OLD_EMPCODE IN (${empKeys.map((_, i) => `:k${i}`).join(",")})`;
    empKeys.forEach((k, i) => { binds[`k${i}`] = k; });
  }
  const res = await connection.execute(
    `SELECT l."DOC#", l.OLD_EMPCODE, l.LOAN_CD, t.LOAN_DESC,
            TO_CHAR(NVL(l.LOAN_DATE, l.DOC_DT),'YYYY-MM-DD'), NVL(l.LOAN_AMT,0),
            NVL(l.LOAN_RECOVER,0)
              + NVL((SELECT SUM(rc.RECOVERD_AMT) FROM HR_LOAN_RECOVERY rc
                      WHERE rc."DOC#" = l."DOC#" AND rc.UNIT_ID = l.UNIT_ID
                        AND NVL(TO_CHAR(rc.RECOVERY_TYPE),'X') <> '1'), 0),
            l.INSTALMENT_AMT, l.NOF_INSTALMENT, TO_CHAR(l.START_DT,'YYYY-MM-DD'),
            l.LOAN_INST, l.REMARKS, l.CHQ_NO
       FROM HR_LOAN_MST l
       LEFT JOIN HR_LOAN_TYPE t ON t.LOAN_CD = l.LOAN_CD
      WHERE l.UNIT_ID = :u AND l.LOAN_CD IN (:lap, :wd)${extra}
      ORDER BY NVL(l.LOAN_DATE, l.DOC_DT), l."DOC#"`,
    binds,
    { outFormat: OUT_ARRAY }
  );
  return (res.rows ?? []).map((r) => {
    const amt = r2(r[5]);
    const recovered = Math.min(r2(r[6]), amt);
    const kind = s(r[2]) === PF_WITHDRAW_CD ? "withdrawal" : "loan";
    return {
      doc: num(r[0]), emp_key: s(r[1]), loan_cd: s(r[2]), loan_desc: s(r[3]), kind,
      loan_date: r[4] || null, amount: amt,
      recovered: kind === "loan" ? recovered : 0,
      outstanding: kind === "loan" ? r2(amt - recovered) : 0,
      instalment_amt: r[7] === null ? null : r2(r[7]), nof_instalment: r[8],
      start_dt: r[9] || null, deduct_from_salary: s(r[10]) === "Y",
      remarks: s(r[11]), chq_no: s(r[12]),
    };
  });
};

// ------------------------------------------------------------------
// aggregation
// ------------------------------------------------------------------

const emptyTotals = () => ({
  opening: 0, contributions: 0, withdrawals: 0, balance: 0,
  loan_taken: 0, loan_outstanding: 0, available: 0, pending: 0,
  last_period: null, last_period_label: "",
});

const finishTotals = (t) => {
  t.opening = r2(t.opening);
  t.contributions = r2(t.contributions);
  t.withdrawals = r2(t.withdrawals);
  t.balance = r2(t.opening + t.contributions - t.withdrawals);
  t.loan_taken = r2(t.loan_taken);
  t.loan_outstanding = r2(t.loan_outstanding);
  t.available = r2(Math.max(0, t.balance - t.loan_outstanding));
  t.pending = r2(t.pending);
  return t;
};

/**
 * Everything for one unit (optionally one employee), keyed by OLD_EMPCODE.
 * Rows in the fund data whose employee no longer exists in HR_EMP_MASTER are
 * kept (as "not on employee master") — HR_PF_BALANCES has many such rows and
 * the fund total must still include them.
 */
const buildFund = async (connection, unitId, { empKey = null, branch = null } = {}) => {
  const employees = await loadEmployees(connection, unitId, empKey, branch);
  const [openings, contributions, pending] = await Promise.all([
    loadOpenings(connection, unitId, empKey),
    loadContributions(connection, unitId, empKey),
    loadPending(connection, unitId, empKey),
  ]);
  const loanKeys = empKey ? [empKey, ...employees.map((e) => e.empcode).filter(Boolean)] : null;
  const loans = await loadPfLoans(connection, unitId, loanKeys);

  // EMPCODE -> OLD_EMPCODE so loans stored against EMPCODE land on the right person.
  const alias = new Map();
  for (const e of employees) {
    alias.set(e.old_empcode, e.old_empcode);
    if (e.empcode) alias.set(e.empcode, e.old_empcode);
  }
  const branchSet = branch ? new Set(employees.map((e) => e.old_empcode)) : null;

  const members = new Map();
  const get = (key) => {
    if (branchSet && !branchSet.has(key)) return null;
    if (!members.has(key)) {
      members.set(key, {
        employee: employees.find((e) => e.old_empcode === key) ?? null,
        openings: [], contributions: [], pending: [], loans: [],
      });
    }
    return members.get(key);
  };
  for (const e of employees) get(e.old_empcode);
  for (const o of openings) get(o.old_empcode)?.openings.push(o);
  for (const c of contributions) get(c.old_empcode)?.contributions.push(c);
  for (const p of pending) get(p.old_empcode)?.pending.push(p);
  for (const l of loans) get(alias.get(l.emp_key) ?? l.emp_key)?.loans.push(l);

  return { employees, members, contributions };
};

const memberTotals = (m) => {
  const t = emptyTotals();
  for (const o of m.openings) t.opening += o.amount;
  for (const c of m.contributions) {
    t.contributions += c.amount;
    if (t.last_period === null || (c.period_frm || "") > (t.last_period_frm || "")) {
      t.last_period = c.period;
      t.last_period_frm = c.period_frm;
    }
  }
  for (const p of m.pending) t.pending += p.amount;
  for (const l of m.loans) {
    if (l.kind === "withdrawal") t.withdrawals += l.amount;
    else { t.loan_taken += l.amount; t.loan_outstanding += l.outstanding; }
  }
  t.last_period_label = monthLabel(t.last_period_frm);
  delete t.last_period_frm;
  return finishTotals(t);
};

const hasActivity = (m) =>
  m.openings.length || m.contributions.length || m.pending.length || m.loans.length;

const memberRow = (key, m) => {
  const e = m.employee;
  return {
    old_empcode: key,
    empcode: e?.empcode || key,
    name: e?.name || "",
    on_master: !!e,
    status: e?.status || "",
    emp_status: e?.emp_status || "",
    pf_ind: e?.pf_ind || "N",
    pf_mem_dt: e?.pf_mem_dt || null,
    dept_name: e?.dept_name || "",
    desg_desc: e?.desg_desc || "",
    ...memberTotals(m),
  };
};

// Chronological ledger with a running balance. Loans against PF appear as
// memo lines (no effect on the balance) so the statement still tells the story.
const buildStatement = (m) => {
  const lines = [];
  for (const o of [...m.openings].sort((a, b) => a.period - b.period)) {
    lines.push({
      date: o.period_frm, sort: o.period === 0 ? "" : o.period_frm || "",
      type: "opening",
      description: o.period === 0 ? "Opening balance" : `Balance brought forward (${monthLabel(o.period_frm) || `period ${o.period}`})`,
      period: o.period, credit: o.amount, debit: 0,
    });
  }
  for (const c of m.contributions) {
    lines.push({
      date: c.period_frm, sort: c.period_frm || "",
      type: "contribution",
      description: `PF contribution — ${monthLabel(c.period_frm) || `period ${c.period}`}`,
      period: c.period, basic: c.earned_basic, credit: c.amount, debit: 0,
    });
  }
  for (const l of m.loans) {
    lines.push({
      date: l.loan_date, sort: l.loan_date || "",
      type: l.kind,
      description: l.kind === "withdrawal"
        ? `Permanent withdrawal (doc #${l.doc})`
        : `Loan against PF (doc #${l.doc}) — not deducted from balance`,
      doc: l.doc, credit: 0, debit: l.kind === "withdrawal" ? l.amount : 0,
      memo_amount: l.kind === "loan" ? l.amount : undefined,
    });
  }
  // Openings first, then by date; within a date, credits before debits.
  lines.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : b.credit - a.credit));
  let running = 0;
  return lines.map((ln, i) => {
    running = r2(running + ln.credit - ln.debit);
    const { sort, ...rest } = ln;
    return { sr: i + 1, ...rest, month: monthLabel(ln.date), balance: running };
  });
};

// ------------------------------------------------------------------
// public API — HR
// ------------------------------------------------------------------

/** Fund-wide figures for one company, plus month-by-month contributions. */
export const getPfSummary = async (unitId, branch = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const { members, contributions } = await buildFund(connection, unitId, { branch });
    const t = emptyTotals();
    let memberCount = 0, flagged = 0, withBalance = 0, activeLoans = 0, notOnMaster = 0;
    for (const [, m] of members) {
      if (m.employee?.pf_ind === "Y") flagged++;
      if (!hasActivity(m) && m.employee?.pf_ind !== "Y") continue;
      memberCount++;
      if (!m.employee) notOnMaster++;
      const mt = memberTotals(m);
      if (mt.balance > 0) withBalance++;
      activeLoans += m.loans.filter((l) => l.kind === "loan" && l.outstanding > 0).length;
      for (const k of ["opening", "contributions", "withdrawals", "loan_taken", "loan_outstanding", "pending"]) t[k] += mt[k];
    }
    finishTotals(t);

    // Monthly trend across posted months (branch-filtered via members).
    const byPeriod = new Map();
    for (const c of contributions) {
      if (!members.has(c.old_empcode)) continue;
      const cur = byPeriod.get(c.period) ?? { period: c.period, period_frm: c.period_frm, amount: 0, employees: 0 };
      cur.amount += c.amount;
      cur.employees += 1;
      byPeriod.set(c.period, cur);
    }
    const monthly = [...byPeriod.values()]
      .sort((a, b) => (a.period_frm || "").localeCompare(b.period_frm || "") || a.period - b.period)
      .map((p) => ({ ...p, amount: r2(p.amount), label: monthLabel(p.period_frm) || `Period ${p.period}` }));
    const last = monthly[monthly.length - 1];

    return {
      unit_id: unitId,
      totals: t,
      counts: {
        members: memberCount, pf_flagged: flagged, with_balance: withBalance,
        active_loans: activeLoans, not_on_master: notOnMaster,
      },
      last_posted: last ? { period: last.period, label: last.label } : null,
      monthly,
      notes: {
        employer_share: false,
        profit: false,
      },
    };
  } finally {
    await connection?.close();
  }
};

/**
 * Member list. scope "members" = anyone flagged PF or with any PF activity;
 * "all" adds every other employee of the company (to enrol someone).
 */
export const listPfMembers = async (unitId, { branch = null, scope = "members", q = "" } = {}) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const { members } = await buildFund(connection, unitId, { branch });
    const needle = s(q).toLowerCase();
    const items = [];
    for (const [key, m] of members) {
      if (scope !== "all" && !hasActivity(m) && m.employee?.pf_ind !== "Y") continue;
      const row = memberRow(key, m);
      if (needle && !`${row.old_empcode} ${row.empcode} ${row.name} ${row.dept_name}`.toLowerCase().includes(needle)) continue;
      items.push(row);
    }
    items.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
    return items;
  } finally {
    await connection?.close();
  }
};

/** Full statement for one employee of the company. Null when unknown. */
export const getPfStatement = async (unitId, empKey) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const key = await resolveEmpKey(connection, unitId, empKey);
    if (!key) return null;
    const { members } = await buildFund(connection, unitId, { empKey: key });
    const m = members.get(key);
    if (!m || (!m.employee && !hasActivity(m))) return null;
    return {
      member: memberRow(key, m),
      unit_name: await unitName(connection, unitId),
      lines: buildStatement(m),
      loans: m.loans,
      pending: m.pending.map((p) => ({ ...p, label: monthLabel(p.period_frm) || `Period ${p.period}` })),
    };
  } finally {
    await connection?.close();
  }
};

/** Every PF loan and withdrawal of the company, with the borrower's balance. */
export const listPfLoans = async (unitId, branch = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const { members } = await buildFund(connection, unitId, { branch });
    const items = [];
    for (const [key, m] of members) {
      if (!m.loans.length) continue;
      const totals = memberTotals(m);
      for (const l of m.loans) {
        items.push({
          ...l, old_empcode: key, name: m.employee?.name || "",
          dept_name: m.employee?.dept_name || "",
          pf_balance: totals.balance, pf_available: totals.available,
        });
      }
    }
    items.sort((a, b) => (b.loan_date || "").localeCompare(a.loan_date || "") || b.doc - a.doc);
    return items;
  } finally {
    await connection?.close();
  }
};

// Match an employee reference (OLD_EMPCODE or EMPCODE) within one company, or
// a code that only exists in HR_PF_BALANCES.
const resolveEmpKey = async (connection, unitId, ref) => {
  const r = s(ref);
  if (!r) return null;
  const res = await connection.execute(
    `SELECT OLD_EMPCODE FROM HR_EMP_MASTER
      WHERE UNIT_ID = :u AND (OLD_EMPCODE = :r OR EMPCODE = :r)
      FETCH FIRST 1 ROWS ONLY`,
    { u: unitId, r },
    { outFormat: OUT_ARRAY }
  );
  if (res.rows?.[0]?.[0]) return s(res.rows[0][0]);
  const bal = await connection.execute(
    `SELECT 1 FROM HR_PF_BALANCES WHERE UNIT_ID = :u AND OLD_EMPCODE = :r FETCH FIRST 1 ROWS ONLY`,
    { u: unitId, r },
    { outFormat: OUT_ARRAY }
  );
  return bal.rows?.length ? r : null;
};

const unitName = async (connection, unitId) => {
  try {
    const res = await connection.execute(
      `SELECT UNIT_NAME FROM UNIT_MST WHERE TO_CHAR(UNIT_ID) = TO_CHAR(:u)`,
      { u: unitId },
      { outFormat: OUT_ARRAY }
    );
    return s(res.rows?.[0]?.[0]);
  } catch {
    return "";
  }
};

// ------------------------------------------------------------------
// HR write actions
// ------------------------------------------------------------------

/**
 * Set (replace) an employee's opening balance — the PERIOD# 0 row(s) in
 * HR_PF_BALANCES. Amount 0 removes the opening. Other periods are untouched.
 */
export const setPfOpening = async (unitId, empKey, amount) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const key = await resolveEmpKey(connection, unitId, empKey);
    if (!key) return { status: "error", message: "Employee not found in this company" };
    const amt = r2(amount);
    if (amt < 0) return { status: "error", message: "Opening balance cannot be negative" };

    // The unit's own PF deduction code; the migrated rows use 12.
    const codeRes = await connection.execute(
      `SELECT MIN(TO_NUMBER(DED_CD)) FROM HR_DEDUCTION
        WHERE UPPER(TRIM(DED_ABRV)) = 'PF' AND UNIT_ID = :u AND REGEXP_LIKE(DED_CD, '^[0-9]+$')`,
      { u: unitId },
      { outFormat: OUT_ARRAY }
    );
    const dedCd = num(codeRes.rows?.[0]?.[0]) || 12;

    await connection.execute(
      `DELETE FROM HR_PF_BALANCES WHERE UNIT_ID = :u AND OLD_EMPCODE = :e AND "PERIOD#" = 0`,
      { u: unitId, e: key }
    );
    if (amt > 0) {
      await connection.execute(
        `INSERT INTO HR_PF_BALANCES (UNIT_ID, DED_CD, "PERIOD#", OLD_EMPCODE, PF_BAL)
         VALUES (:u, :d, 0, :e, :a)`,
        { u: unitId, d: dedCd, e: key, a: amt }
      );
    }
    await connection.commit();
    return { status: "success", old_empcode: key, opening: amt };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    await connection?.close();
  }
};

/**
 * Enrol / remove an employee from PF (HR_EMP_MASTER.PF_IND / PF_MEM_DT). The
 * salary process deducts PF only for PF_IND = 'Y'. Only these two columns are
 * written, so the gross-driven triggers on HR_EMP_MASTER stay idle.
 */
export const setPfMembership = async (unitId, empKey, pfInd, memberSince = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const flag = pfInd === "Y" ? "Y" : "N";
    const res = await connection.execute(
      `UPDATE HR_EMP_MASTER
          SET PF_IND = :f,
              PF_MEM_DT = CASE WHEN :f = 'Y'
                               THEN NVL(TO_DATE(:d,'YYYY-MM-DD'), NVL(PF_MEM_DT, TRUNC(SYSDATE)))
                               ELSE PF_MEM_DT END
        WHERE UNIT_ID = :u AND (OLD_EMPCODE = :e OR EMPCODE = :e)`,
      { f: flag, d: memberSince || null, u: unitId, e: s(empKey) }
    );
    if (!res.rowsAffected) {
      await connection.rollback();
      return { status: "error", message: "Employee not found in this company" };
    }
    await connection.commit();
    return { status: "success", pf_ind: flag };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    await connection?.close();
  }
};

// ------------------------------------------------------------------
// public API — employee self-service
// ------------------------------------------------------------------

/**
 * The caller's own PF: summary + statement for every company they have PF in
 * (an employee transferred between units has one account per unit).
 * Null when the card is unknown.
 */
export const getMyPf = async (cardNo) => {
  let connection;
  let accounts;
  try {
    connection = await getDirectConnection();
    const card = s(cardNo);
    if (!card) return null;
    // Same card -> employee match as the self-service payslips (CARD_NO /
    // EMPCODE only; ATDTCARD# has duplicates).
    const res = await connection.execute(
      `SELECT DISTINCT h.UNIT_ID, h.OLD_EMPCODE
         FROM HR_EMP_MASTER h
         LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
        WHERE TO_CHAR(e.CARD_NO) = :c OR h.EMPCODE = :c`,
      { c: card },
      { outFormat: OUT_ARRAY }
    );
    accounts = (res.rows ?? []).map((r) => ({ unit_id: num(r[0]), old_empcode: s(r[1]) })).filter((a) => a.old_empcode);
  } finally {
    await connection?.close();
  }
  if (!accounts.length) return null;

  const out = [];
  for (const a of accounts) {
    const st = await getPfStatement(a.unit_id, a.old_empcode);
    if (!st) continue;
    const { member } = st;
    if (member.pf_ind !== "Y" && !st.lines.length && !st.pending.length) continue;
    out.push({ unit_id: a.unit_id, ...st });
  }
  return { accounts: out };
};
