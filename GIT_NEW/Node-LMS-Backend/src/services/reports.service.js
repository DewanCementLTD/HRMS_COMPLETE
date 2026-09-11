/**
 * HR Reports Service — Payroll & General HR reports.
 *
 * Every query here is transcribed from the authoritative Oracle report SQL kept
 * in the repo root (`Allowance List.txt`, `BAnk Advice.txt`, `PF Detail.txt`, …).
 * `query 1` of each file is the data query and is reproduced as-is; the only
 * deviations are:
 *
 *   1. `codename('LOC_ID', x, null)` is wrapped in NVL() with a scalar subquery
 *      onto HR_LOCATION. The CODENAME function exists but its LOC_ID/PERIOD#
 *      forms return NULL on this database, which would blank out the location
 *      column. A scalar subquery is used rather than another table in the FROM
 *      list so the row set stays byte-identical (an inner join would silently
 *      drop employees whose location has no HR_LOCATION row).
 *   2. `Employee Detail (Active).txt` selects `sec_nm`, which does not exist on
 *      HR_EMP_MASTER_VIEW — it becomes `NULL AS sec_nm` so the report renders a
 *      blank Section column instead of failing with ORA-00904.
 *
 * `query 2` of each file (the `FROM DUAL` header-label statements built on
 * codename('ORG')/DECODE) is NOT ported. Those labels are produced by the
 * caller from the already-resolved company/branch/period, which is both cheaper
 * and correct where codename returns NULL.
 *
 * Company/branch scope is NOT applied here — the controller resolves the HR
 * admin's company (UNIT_ID) and branch (LOCATION) via payrollShared.js and
 * passes them in as the unitId / location arguments, so a client cannot widen
 * its own scope.
 */

import { getDirectConnection } from "../config/database.js";
import { deriveRosterDay } from '../utils/rosterStatus.js';

const OUT_OBJECT = 4002; // oracledb.OUT_FORMAT_OBJECT
const OUT_ARRAY = 4001; // oracledb.OUT_FORMAT_ARRAY

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------

const toInt = (v, def = null) => {
  if (v === null || v === undefined) return def;
  const s = String(v).trim();
  if (s === "") return def;
  const f = Number(s);
  return Number.isFinite(f) ? Math.trunc(f) : def;
};

const toNum = (v, def = null) => {
  if (v === null || v === undefined || String(v).trim() === "") return def;
  const f = Number(v);
  return Number.isFinite(f) ? f : def;
};

// Optional bind: empty string / undefined all collapse to NULL, which the
// optEq/optRange predicates below read as "no filter".
/** ERP punch columns hold ':' when there was no punch. */
const cleanTime = (v) => {
  const t = String(v ?? '').trim();
  if (!t || t === ':') return null;
  return t.slice(0, 5);
};

const opt = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const s = (v) => (v === null || v === undefined ? "" : String(v).trim());

const num = (v) => (v === null || v === undefined ? 0 : Number(v) || 0);

const lowerKeys = (row) => {
  const out = {};
  for (const k of Object.keys(row)) out[k.toLowerCase()] = row[k];
  return out;
};

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-07-01" -> "Jul-2026" (the label format used by the printed reports).
const monthLabel = (frm) => {
  if (!frm || frm.length < 7) return "";
  return `${MONTHS[Number(frm.slice(5, 7))]}-${frm.slice(0, 4)}`;
};

// Column ordering for pivoted allowance/deduction columns: numeric trans_id
// first, everything unparseable last, then alphabetical. Same rule as the pay
// register (payroll.service.js:_order_cols) so the two agree.
const colSortKey = ([descr, tid]) => {
  if (tid === null || tid === undefined) return [9999, descr];
  const t = String(tid).trim();
  if (!/^-?\d+$/.test(t)) return [9999, descr];
  return [parseInt(t, 10), descr];
};

const orderCols = (m) =>
  [...m.entries()]
    .sort((a, b) => {
      const [ka0, ka1] = colSortKey(a);
      const [kb0, kb1] = colSortKey(b);
      if (ka0 !== kb0) return ka0 - kb0;
      return ka1 < kb1 ? -1 : ka1 > kb1 ? 1 : 0;
    })
    .map(([descr]) => descr);

// Scalar-subquery fallback for codename('LOC_ID', <col>, null). See file header.
// Oracle rejects a subquery inside GROUP BY (ORA-22818), so the source queries
// group by the raw `location` column instead of by `codename(location)` — an
// identical partitioning, since location determines its own name — and this
// expression is applied once on the outside.
const LOC_NAME = (col) =>
  `NVL(codename('LOC_ID', ${col}, null), (SELECT l.loc_name FROM hr_location l WHERE l.loc_id = ${col}))`;

/**
 * Optional-filter predicate: "match everything when the bind is NULL".
 *
 * The source reports all spell this `col = NVL(:bind, col)`, which looks
 * equivalent but is NOT: when `col` itself is NULL the expression becomes
 * `NULL = NULL`, which in SQL is UNKNOWN, not TRUE — so the row is dropped even
 * though the user left the filter blank. It silently under-reports instead of
 * erroring, which is why it survived so long in the original reports.
 *
 * That is not hypothetical on this database: HR_DESG.DESG_GRP is NULL for 72 of
 * 166 designations and HR_EMP_MASTER.DEPT_NO for 45 of 898 employees, and every
 * active employee of units 2 and 3 has a NULL DESG_GRP — which made the Active
 * Employee Detail report return zero rows for those companies.
 *
 * `(:bind IS NULL OR col = :bind)` keeps the intended behaviour for a supplied
 * value and stops discarding NULL-column rows when the filter is blank.
 */
const optEq = (col, bind) => `(:${bind} IS NULL OR ${col} = :${bind})`;

/**
 * Optional range predicate, same reasoning as optEq. Replaces
 * `col BETWEEN NVL(:a, 0) AND NVL(:b, 999999)`, which both drops NULL-column
 * rows and silently caps an unfiltered report at 999,999.
 */
const optRange = (col, a, b) =>
  `((:${a} IS NULL OR ${col} >= :${a}) AND (:${b} IS NULL OR ${col} <= :${b}))`;

// ------------------------------------------------------------------
// lookups (period list + designation groups for the report filter bar)
// ------------------------------------------------------------------

/**
 * Every period defined for a unit, newest first. Unlike
 * payrollEntry.service.js:listOpenPeriods this deliberately does NOT filter on
 * STATUS='O' — reports run over closed historical periods.
 */
export const listReportPeriods = async (unitId) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const res = await connection.execute(
      `SELECT "PERIOD#", SCODE, STATUS, TO_CHAR(PERIOD_FRM, 'YYYY-MM-DD')
         FROM HR_ATTND_PERIOD
        WHERE (:u IS NULL OR UNIT_ID = :u)
        ORDER BY PERIOD_FRM DESC, "PERIOD#" DESC`,
      { u: toInt(unitId) },
      { outFormat: OUT_ARRAY }
    );
    return (res.rows ?? []).map((r) => ({
      period: Number(r[0]),
      scode: s(r[1]),
      status: s(r[2]),
      period_frm: r[3],
      label: monthLabel(r[3]) || s(r[1]) || `Period ${Number(r[0])}`,
    }));
  } finally {
    await connection?.close();
  }
};

/** Designation groups (HR_DESG.DESG_GRP) — the :MDESH_ORD bind of Bank Advice. */
export const listDesgGroups = async () => {
  let connection;
  try {
    connection = await getDirectConnection();
    const res = await connection.execute(
      `SELECT DISTINCT DESG_GRP FROM HR_DESG WHERE DESG_GRP IS NOT NULL ORDER BY 1`,
      {},
      { outFormat: OUT_ARRAY }
    );
    return (res.rows ?? []).map((r) => ({ desg_grp: s(r[0]) }));
  } finally {
    await connection?.close();
  }
};

/**
 * Deduction types — the :md_cd bind of Month Wise Deduction, which is required.
 *
 * Served from here rather than reusing /payroll-entry/deduction-types because
 * LMS-Web's next.config.ts still proxies /api/payroll-entry/* to the legacy
 * FastAPI backend; routing a required lookup through a second service would
 * make this report unusable whenever that one is down.
 */
export const listDeductionTypes = async () => {
  let connection;
  try {
    connection = await getDirectConnection();
    const res = await connection.execute(
      `SELECT DED_CD, DED_DESC FROM HR_DEDUCTION ORDER BY TO_NUMBER(DED_CD)`,
      {},
      { outFormat: OUT_ARRAY }
    );
    return (res.rows ?? []).map((r) => ({ deduction_id: s(r[0]), deduction_desc: s(r[1]) }));
  } finally {
    await connection?.close();
  }
};

// Resolve period -> "Jul-2026" for the report header, without a second round
// trip per report. Returns a Map keyed by period number.
const periodLabelMap = async (connection, unitId) => {
  const res = await connection.execute(
    `SELECT "PERIOD#", TO_CHAR(PERIOD_FRM, 'YYYY-MM-DD'), SCODE
       FROM HR_ATTND_PERIOD WHERE (:u IS NULL OR UNIT_ID = :u)`,
    { u: toInt(unitId) },
    { outFormat: OUT_ARRAY }
  );
  const m = new Map();
  for (const r of res.rows ?? []) {
    m.set(Number(r[0]), monthLabel(r[1]) || s(r[2]) || `Period ${Number(r[0])}`);
  }
  return m;
};

const locationName = async (connection, locId) => {
  if (locId === null || locId === undefined || String(locId).trim() === "") return "ALL Locations";
  const res = await connection.execute(
    `SELECT LOC_NAME FROM HR_LOCATION WHERE LOC_ID = :l`,
    { l: locId },
    { outFormat: OUT_ARRAY }
  );
  return s(res.rows?.[0]?.[0]) || String(locId);
};

const unitName = async (connection, unitId) => {
  const res = await connection.execute(
    `SELECT MAX(UNIT_NAME) FROM HR_EMP_MASTER_VIEW WHERE UNIT_ID = :u`,
    { u: toInt(unitId) },
    { outFormat: OUT_ARRAY }
  );
  return s(res.rows?.[0]?.[0]);
};

// Common header block for every report. `periods` is a list of period numbers
// whose labels should be resolved (1 for single-period reports, 2 for ranges).
const buildMeta = async (connection, { unitId, location, periods = [], filters = {} }) => {
  const [uname, lname, pmap] = await Promise.all([
    unitName(connection, unitId),
    locationName(connection, location),
    periodLabelMap(connection, unitId),
  ]);
  return {
    unit_id: toInt(unitId),
    unit_name: uname,
    location: location ?? null,
    location_name: lname,
    period_labels: periods.map((p) => pmap.get(toInt(p)) || (p == null ? "" : `Period ${p}`)),
    filters,
    generated_at: new Date().toISOString(),
  };
};

// ══════════════════════════════════════════════════════════════════
// Employee Allowances Detail Report  —  "Allowance List.txt"
// ══════════════════════════════════════════════════════════════════

export const getAllowanceDetailReport = async ({
  unitId, location = null, periodFrom, periodTo, empcode = null, rtype = "C",
} = {}) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const isPosted = rtype === "P";
    const binds = {
      p_period1: toInt(periodFrom),
      p_period2: toInt(periodTo),
      munitid: toInt(unitId),
      mlocatin: opt(location),
      mempcd: opt(empcode),
      mrtypr: isPosted ? "P" : "C",
      // OT hours are summed over whichever period span the branch below used:
      // the posted branch spans period1..period2, the current branch is period1
      // only (`a.period# = :p_period1`).
      ot_p1: toInt(periodFrom),
      ot_p2: isPosted ? toInt(periodTo) : toInt(periodFrom),
    };

    // OT_HOUR is not in the source query, but the printed report has an OT Hours
    // column. It lives on HR_MONTHLY_ALLOW (the monthly-allowance entry table)
    // against allowance 19 = OVER TIME, keyed by unit/employee/period — a
    // scalar subquery keeps the aggregated row set unchanged.
    const res = await connection.execute(
      `select v.empcode, v.unitid, v.ename,
              ${LOC_NAME("v.location")} locnm,
              (select sum(nvl(ma.OT_HOUR, 0)) from HR_MONTHLY_ALLOW ma
                where ma.OLD_EMPCODE = v.empcode
                  and ma.UNIT_ID = v.unitid
                  and ma.ALLOWANCE_ID = '19'
                  and ma.period# between :ot_p1 and :ot_p2) ot_hours,
              v.all_id, v.descr, v.amont
         from (
       select a.old_empcode empcode, A.UNIT_ID  UNITID,
              ' '||c.name ename,
              c.location,
              b.allowance_id all_id,
              b.allowance_desc descr,
              sum(nvl(a.trans_amount, 0)) amont
         from hr_salary_process_final a, hr_allowance b, hr_emp_master c
        where a.trans_id = b.allowance_id
          and a.old_empcode = c.old_empcode
          and a.unit_id  = c.UNIT_ID
          and b.use_allowance = 'M'
          and a.trans_type = 'A'
          and a.period# between :p_period1 and :p_period2
          and ${optEq('a.unit_id', 'munitid')}
          and ${optEq('c.location', 'mlocatin')}
          and ${optEq('a.old_empcode', 'mempcd')}
          and :mrtypr = 'P'
        group by a.old_empcode, A.UNIT_ID,
                 c.name,
                 c.location,
                 b.allowance_id,
                 b.allowance_desc
       union all
       select a.old_empcode empcode, A.UNIT_ID UNITID,
              ' '||c.name ename,
              c.location,
              b.allowance_id all_id,
              b.allowance_desc descr,
              sum(nvl(a.trans_amount, 0)) amont
         from hr_salary_process a, hr_allowance b, hr_emp_master c
        where a.trans_id = b.allowance_id
          and a.old_empcode = c.old_empcode
          and a.unit_id  = c.UNIT_ID
          and b.use_allowance = 'M'
          and a.trans_type = 'A'
          and a.period# = :p_period1
          and ${optEq('a.unit_id', 'munitid')}
          and ${optEq('c.location', 'mlocatin')}
          and ${optEq('a.old_empcode', 'mempcd')}
          and :mrtypr = 'C'
        group by a.old_empcode, A.UNIT_ID,
                 c.name,
                 c.location,
                 b.allowance_id,
                 b.allowance_desc
         ) v
        order by v.ename, v.empcode`,
      binds,
      { outFormat: OUT_OBJECT }
    );

    const pivot = pivotByEmployee(res.rows ?? []);
    const meta = await buildMeta(connection, {
      unitId, location,
      periods: [binds.p_period1, binds.p_period2],
      filters: { employee: opt(empcode), rtype: binds.mrtypr },
    });
    return { ...pivot, meta };
  } finally {
    await connection?.close();
  }
};

// ══════════════════════════════════════════════════════════════════
// Employee Deduction Detail Report  —  "employee deduction detail.txt"
// ══════════════════════════════════════════════════════════════════

export const getDeductionDetailReport = async ({
  unitId, location = null, periodFrom, periodTo, empcode = null, rtype = "C",
} = {}) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const binds = {
      p_period1: toInt(periodFrom),
      p_period2: toInt(periodTo),
      munitid: toInt(unitId),
      mlocatin: opt(location),
      mempcd: opt(empcode),
      mrtype: rtype === "P" ? "P" : "C",
    };

    const res = await connection.execute(
      `select v.empcode, v.ename,
              ${LOC_NAME("v.location")} locnm,
              v.all_id, v.descr, v.amont
         from (
       select a.old_empcode empcode,
              ' '||c.name ename,
              c.location,
              b.ded_cd ALL_ID,
              b.ded_desc descr,
              sum(nvl(a.trans_amount, 0)) amont
         from hr_salary_process_final a, hr_deduction b, hr_emp_master c
        where a.trans_id = b.ded_cd
          and a.old_empcode = c.old_empcode
          and a.unit_id  = c.UNIT_ID
          and b.ded_cd not in (1,10,11,12,13,16,5)
          and a.trans_type = 'D'
          and a.period# between :p_period1 and :p_period2
          and ${optEq('a.unit_id', 'munitid')}
          and ${optEq('c.location', 'mlocatin')}
          and ${optEq('a.old_empcode', 'mempcd')}
          AND :mrtype = 'P'
        group by a.old_empcode,
                 c.name,
                 c.location,
                 b.ded_cd,
                 b.ded_desc
       UNION ALL
       select a.old_empcode empcode,
              ' '||c.name ename,
              c.location,
              b.ded_cd ALL_ID,
              b.ded_desc descr,
              sum(nvl(a.trans_amount, 0)) amont
         from hr_salary_process a, hr_deduction b, hr_emp_master c
        where a.trans_id = b.ded_cd
          and a.old_empcode = c.old_empcode
          and a.unit_id  = c.UNIT_ID
          and b.ded_cd not in (1,10,11,12,13,16,5)
          and a.trans_type = 'D'
          and a.period# between :p_period1 and :p_period2
          and ${optEq('a.unit_id', 'munitid')}
          and ${optEq('c.location', 'mlocatin')}
          and ${optEq('a.old_empcode', 'mempcd')}
          AND :mrtype = 'C'
        group by a.old_empcode,
                 c.name,
                 c.location,
                 b.ded_cd,
                 b.ded_desc
         ) v
        order by v.ename, v.empcode`,
      binds,
      { outFormat: OUT_OBJECT }
    );

    const pivot = pivotByEmployee(res.rows ?? []);
    const meta = await buildMeta(connection, {
      unitId, location,
      periods: [binds.p_period1, binds.p_period2],
      filters: { employee: opt(empcode), rtype: binds.mrtype },
    });
    return { ...pivot, meta };
  } finally {
    await connection?.close();
  }
};

/**
 * Both detail reports return one row per (employee, allowance/deduction). The
 * printed report is a cross-tab: one row per employee, one column per
 * allowance/deduction, plus a Total. Column order follows trans_id.
 *
 * `ot_hours` rides along on the allowance variant (it is per-employee, not
 * per-allowance, so it is set once rather than accumulated).
 */
const pivotByEmployee = (rawRows) => {
  const rows = rawRows.map(lowerKeys);
  const cols = new Map();
  const byEmp = new Map();
  let hasOtHours = false;

  for (const r of rows) {
    const code = s(r.empcode);
    const descr = s(r.descr);
    const amt = num(r.amont);
    if (!cols.has(descr)) cols.set(descr, r.all_id);
    if (!byEmp.has(code)) {
      byEmp.set(code, {
        code,
        employee_name: s(r.ename),
        location: s(r.locnm),
        ot_hours: r.ot_hours == null ? null : num(r.ot_hours),
        values: {},
        total: 0,
      });
    }
    if (r.ot_hours != null) hasOtHours = true;
    const e = byEmp.get(code);
    e.values[descr] = (e.values[descr] || 0) + amt;
    e.total += amt;
  }

  const columns = orderCols(cols);
  const list = [...byEmp.values()];
  const column_totals = Object.fromEntries(
    columns.map((c) => [c, list.reduce((t, e) => t + (e.values[c] || 0), 0)])
  );
  return {
    columns,
    rows: list,
    column_totals,
    // Lets the client render the OT Hours column only where it applies.
    has_ot_hours: hasOtHours,
    grand_total: list.reduce((t, e) => t + e.total, 0),
  };
};

// ══════════════════════════════════════════════════════════════════
// Payroll Reconciliation Detail Report (Allowance)
//   —  "Payroll Reconciliation Detail Report (Allwoance ).txt"
// ══════════════════════════════════════════════════════════════════

export const getAllowanceReconReport = async ({
  unitId, periodFrom, periodTo, empcode = null,
} = {}) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const binds = {
      mpf: toInt(periodFrom),
      mpt: toInt(periodTo),
      munit: toInt(unitId),
      memp: opt(empcode),
    };

    // The source query selects only codes and amounts; the printed report shows
    // employee names and an allowance-name section header. The original query is
    // kept verbatim as an inline view and the display labels are joined on the
    // outside, so its filtering/GROUP BY/HAVING behaviour is unchanged.
    const res = await connection.execute(
      `SELECT v.OLD_EMPCODE, v.UNIT_ID, v.TRANS_ID, v.F_AMOUNT, v.T_AMOUNT, v.DIFF,
              (SELECT ' '||MAX(m.NAME) FROM HR_EMP_MASTER m
                WHERE m.OLD_EMPCODE = v.OLD_EMPCODE AND m.UNIT_ID = v.UNIT_ID) ENAME,
              (SELECT MAX(al.ALLOWANCE_DESC) FROM HR_ALLOWANCE al
                WHERE al.ALLOWANCE_ID = v.TRANS_ID) DESCR
        FROM (
              SELECT OLD_EMPCODE,
                     UNIT_ID,
                     TRANS_ID,
                     SUM(F_AMOUNT) F_AMOUNT,
                     SUM(T_AMOUNT) T_AMOUNT,
                     SUM(F_AMOUNT) - SUM(T_AMOUNT) DIFF
                FROM ( SELECT A.OLD_EMPCODE,
                              A.UNIT_ID,
                              TRANS_ID,
                              ROUND(NVL(TRANS_AMOUNT, 0)) F_AMOUNT,
                              0 T_AMOUNT
                         FROM HR_SALARY_PROCESS_final        A,
                              HR_ALLOWANCE                   B,
                              HR_SALARY_PROCESS_MASTER_final C,
                              HR_LOCATION                    D
                        WHERE A.PERIOD# = :mpf
                          AND ${optEq('A.UNIT_ID', 'munit')}
                          AND A.TRANS_TYPE = 'A'
                          AND B.USE_ALLOWANCE <> 'F'
                          AND A.TRANS_ID = B.ALLOWANCE_ID
                          AND A.PERIOD# = C.PERIOD#
                          AND A.UNIT_ID = C.UNIT_ID
                          AND A.OLD_EMPCODE = C.OLD_EMPCODE
                          AND C.LOCATION = D.LOC_ID
                          AND ${optEq('A.OLD_EMPCODE', 'memp')}
                       UNION ALL
                       SELECT A.OLD_EMPCODE,
                              A.UNIT_ID,
                              TRANS_ID,
                              0 FROM_AMOUNT,
                              ROUND(NVL(TRANS_AMOUNT, 0)) T_AMOUNT
                         FROM HR_SALARY_PROCESS        A,
                              HR_ALLOWANCE                   B,
                              HR_SALARY_PROCESS_MASTER C,
                              HR_LOCATION                    D
                        WHERE A.PERIOD# = :mpt
                          AND ${optEq('A.UNIT_ID', 'munit')}
                          AND A.TRANS_TYPE = 'A'
                          AND B.USE_ALLOWANCE <> 'F'
                          AND A.TRANS_ID = B.ALLOWANCE_ID
                          AND A.PERIOD# = C.PERIOD#
                          AND A.UNIT_ID = C.UNIT_ID
                          AND A.OLD_EMPCODE = C.OLD_EMPCODE
                          AND C.LOCATION = D.LOC_ID
                          AND ${optEq('A.OLD_EMPCODE', 'memp')})
               GROUP BY OLD_EMPCODE, UNIT_ID, TRANS_ID
              HAVING (SUM(F_AMOUNT) != 0 or SUM(T_AMOUNT) != 0)
             ) v
       ORDER BY DESCR, ENAME, v.OLD_EMPCODE`,
      binds,
      { outFormat: OUT_OBJECT }
    );

    const groups = groupByTrans(res.rows ?? []);
    const meta = await buildMeta(connection, {
      unitId, location: null,
      periods: [binds.mpf, binds.mpt],
      filters: { employee: opt(empcode) },
    });
    return { groups, meta };
  } finally {
    await connection?.close();
  }
};

// ══════════════════════════════════════════════════════════════════
// Payroll Reconciliation Detail Report (Deduction)
//   —  "Dedudction Variance.txt"
// ══════════════════════════════════════════════════════════════════

export const getDeductionReconReport = async ({
  unitId, periodFrom, periodTo, empcode = null,
} = {}) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const binds = {
      mpf: toInt(periodFrom),
      mpt: toInt(periodTo),
      munit: toInt(unitId),
      memp: opt(empcode),
    };

    // As with the allowance variant, the file's query is the inline view and
    // only the employee name is joined on top (ded_desc it already selects).
    const res = await connection.execute(
      `SELECT v.OLD_EMPCODE, v.UNIT_ID, v.TRANS_ID, v.DED_DESC DESCR,
              v.F_AMOUNT, v.T_AMOUNT, v.DIFF,
              (SELECT ' '||MAX(m.NAME) FROM HR_EMP_MASTER m
                WHERE m.OLD_EMPCODE = v.OLD_EMPCODE AND m.UNIT_ID = v.UNIT_ID) ENAME
        FROM (
              SELECT OLD_EMPCODE,
                     UNIT_ID,
                     TRANS_ID,
                     ded_desc,
                     SUM(FROM_AMOUNT) F_AMOUNT,
                     SUM(T_AMOUNT) T_AMOUNT,
                     SUM(FROM_AMOUNT) - SUM(T_AMOUNT) DIFF
                FROM (SELECT A.OLD_EMPCODE,
                             A.UNIT_ID,
                             TRANS_ID,
                             b.ded_desc,
                             NVL(TRANS_AMOUNT, 0) FROM_AMOUNT,
                             0 T_AMOUNT
                        FROM HR_SALARY_PROCESS_FINAL A, hr_deduction B
                       WHERE A.PERIOD# = :mpf
                         AND ${optEq('A.UNIT_ID', 'munit')}
                         AND A.TRANS_TYPE = 'D'
                         AND A.TRANS_ID = B.DED_CD
                         AND ${optEq('A.OLD_EMPCODE', 'memp')}
                      UNION ALL
                      SELECT A.OLD_EMPCODE,
                             A.UNIT_ID,
                             TRANS_ID,
                             b.ded_desc,
                             0 f_AMOUNT,
                             NVL(TRANS_AMOUNT, 0) T_AMOUNT
                        FROM HR_SALARY_PROCESS A, hr_deduction B
                       WHERE A.PERIOD# = :mpt
                         AND ${optEq('A.UNIT_ID', 'munit')}
                         AND A.TRANS_TYPE = 'D'
                         AND A.TRANS_ID = B.DED_CD
                         AND ${optEq('A.OLD_EMPCODE', 'memp')} )
               GROUP BY OLD_EMPCODE, UNIT_ID, TRANS_ID, ded_desc
             ) v
       ORDER BY v.DED_DESC, ENAME, v.OLD_EMPCODE`,
      binds,
      { outFormat: OUT_OBJECT }
    );

    const groups = groupByTrans(res.rows ?? []);
    const meta = await buildMeta(connection, {
      unitId, location: null,
      periods: [binds.mpf, binds.mpt],
      filters: { employee: opt(empcode) },
    });
    return { groups, meta };
  } finally {
    await connection?.close();
  }
};

/**
 * Both reconciliation reports print one bordered block per allowance/deduction
 * with a "Total Of <NAME>" footer — group the flat rows accordingly.
 */
const groupByTrans = (rawRows) => {
  const rows = rawRows.map(lowerKeys);
  const groups = new Map();
  for (const r of rows) {
    const tid = s(r.trans_id);
    const descr = s(r.descr) || tid;
    if (!groups.has(tid)) {
      groups.set(tid, {
        trans_id: tid,
        descr,
        rows: [],
        totals: { from_amount: 0, to_amount: 0, variance: 0 },
      });
    }
    const g = groups.get(tid);
    const from_amount = num(r.f_amount);
    const to_amount = num(r.t_amount);
    const variance = num(r.diff);
    g.rows.push({ code: s(r.old_empcode), employee_name: s(r.ename), from_amount, to_amount, variance });
    g.totals.from_amount += from_amount;
    g.totals.to_amount += to_amount;
    g.totals.variance += variance;
  }
  return [...groups.values()].sort((a, b) => (a.descr < b.descr ? -1 : a.descr > b.descr ? 1 : 0));
};

// ══════════════════════════════════════════════════════════════════
// Month Wise Deduction Report  —  "Month wise deduction report.txt"
// ══════════════════════════════════════════════════════════════════

export const getMonthWiseDeductionReport = async ({
  unitId, location = null, periodFrom, periodTo, deductionId, deptNo = null, empcode = null,
} = {}) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const binds = {
      md_cd: s(deductionId),
      empcd: opt(empcode),
      mdept: opt(deptNo),
      mloc: opt(location),
      munit: toInt(unitId),
      mdt1: toInt(periodFrom),
      mdt2: toInt(periodTo),
    };

    const res = await connection.execute(
      `select a.unit_id,
              a.location,
              a.old_empcode,
              ' ' || a.name name,
              c.ded_desc,
              b.period#,
              d.period_frm,
              b.trans_amount
         from hr_emp_master           a,
              hr_salary_process_final b,
              hr_deduction            c,
              hr_attnd_period         d
        where a.OLD_EMPCODE = b.old_empcode
          and a.UNIT_ID = b.unit_id
          and b.trans_id = c.ded_cd
          and b.trans_type = 'D'
          and b.period# = d.period#
          and b.unit_id = d.unit_id
          and b.trans_id = :md_cd
          and ${optEq('a.OLD_EMPCODE', 'empcd')}
          and ${optEq('a.DEPT_NO', 'mdept')}
          and ${optEq('a.LOCATION', 'mloc')}
          and ${optEq('a.UNIT_ID', 'munit')}
          and b.period# between :mdt1 and :mdt2
        order by 1, 6, 3`,
      binds,
      { outFormat: OUT_OBJECT }
    );

    const rows = (res.rows ?? []).map(lowerKeys);
    const pmap = await periodLabelMap(connection, unitId);

    // Columns = the periods that actually returned data, in period order.
    const periodSet = [...new Set(rows.map((r) => toInt(r["period#"])))].sort((a, b) => a - b);
    const columns = periodSet.map((p) => pmap.get(p) || `Period ${p}`);

    const byEmp = new Map();
    for (const r of rows) {
      const code = s(r.old_empcode);
      const col = pmap.get(toInt(r["period#"])) || `Period ${toInt(r["period#"])}`;
      if (!byEmp.has(code)) {
        byEmp.set(code, { code, employee_name: s(r.name), values: {}, total: 0 });
      }
      const e = byEmp.get(code);
      const amt = num(r.trans_amount);
      e.values[col] = (e.values[col] || 0) + amt;
      e.total += amt;
    }

    const list = [...byEmp.values()];
    const column_totals = Object.fromEntries(
      columns.map((c) => [c, list.reduce((t, e) => t + (e.values[c] || 0), 0)])
    );

    const meta = await buildMeta(connection, {
      unitId, location,
      periods: [binds.mdt1, binds.mdt2],
      filters: {
        deduction: s(rows[0]?.ded_desc) || s(deductionId),
        department: opt(deptNo),
        employee: opt(empcode),
      },
    });

    return {
      columns,
      rows: list,
      column_totals,
      grand_total: list.reduce((t, e) => t + e.total, 0),
      meta,
    };
  } finally {
    await connection?.close();
  }
};

// ══════════════════════════════════════════════════════════════════
// Bank Advice  —  "BAnk Advice.txt"
// ══════════════════════════════════════════════════════════════════

export const getBankAdviceReport = async ({
  unitId, location = null, period, desgGrp = null, transId = null, rtype = "IN",
} = {}) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const binds = {
      maid1: opt(transId),
      mdesh_ord: opt(desgGrp),
      mperiod: toInt(period),
      munit: toInt(unitId),
      mlocation: opt(location),
      mrtype: rtype === "OT" ? "OT" : "IN",
    };

    const res = await connection.execute(
      `SELECT A.OLD_EMPCODE,
              ' ' || A.NAME NAME,
              A.LOCATION,
              E.LOC_NAME,
              A.BNKCODE,
              B.BNKNAME,
              A.BRNCODE,
              C.BRNNAME,
              A.BNKACCT,
              A.GROSS GROSS,
              round(SUM(DECODE(D.TRANS_TYPE, 'A', NVL(D.TRANS_AMOUNT, 0)))) T_ALL,
              round(SUM(DECODE(D.TRANS_TYPE, 'D', NVL(D.TRANS_AMOUNT, 0)))) T_DED
         FROM HR_EMP_MASTER     A,
              HR_BANK           B,
              HR_BRANCH         C,
              HR_SALARY_PROCESS D,
              HR_LOCATION       E,
              hr_desg           f
        WHERE A.BNKCODE = B.BNKCODE
          AND D.TRANS_TYPE || D.TRANS_ID = NVL(:maid1, D.TRANS_TYPE || D.TRANS_ID)
          AND A.BRNCODE = C.BRNCODE
          AND A.BNKCODE = C.BNKCODE
          AND B.BNKCODE = C.BNKCODE
          AND A.OLD_EMPCODE = D.OLD_EMPCODE
          AND A.UNIT_ID = D.UNIT_ID
          AND A.DESG_CD = F.DESG_CD
          AND ${optEq('F.Desg_GRP', 'mdesh_ord')}
          AND D.PERIOD# = :mperiod
          AND A.UNIT_ID = :munit
          AND A.STATUS = 'A'
          AND NVL(A.HOLD_SAL, 'N') = 'N'
          AND ${optEq('A.LOCATION', 'mlocation')}
          AND A.LOCATION = E.LOC_ID
          AND :mrtype = 'IN'
        GROUP BY A.OLD_EMPCODE, A.NAME, A.LOCATION, E.LOC_NAME,
                 A.BNKCODE, B.BNKNAME, A.BRNCODE, C.BRNNAME, A.BNKACCT, A.GROSS
       HAVING SUM(DECODE(D.TRANS_TYPE, 'A', NVL(D.TRANS_AMOUNT, 0))) > 1
       UNION ALL
       SELECT A.OLD_EMPCODE,
              ' ' || A.NAME NAME,
              A.LOCATION,
              E.LOC_NAME,
              A.BNKCODE,
              B.BNKNAME,
              A.BRNCODE,
              C.BRNNAME,
              A.BNKACCT,
              A.GROSS GROSS,
              round(SUM(DECODE(D.TRANS_TYPE, 'A', NVL(D.TRANS_AMOUNT, 0)))) T_ALL,
              round(SUM(DECODE(D.TRANS_TYPE, 'D', NVL(D.TRANS_AMOUNT, 0)))) T_DED
         FROM HR_EMP_MASTER     A,
              HR_BANK           B,
              HR_BRANCH         C,
              HR_SALARY_PROCESS D,
              HR_LOCATION       E,
              hr_desg           f
        WHERE A.BNKCODE = B.BNKCODE
          AND D.TRANS_TYPE || D.TRANS_ID != NVL(:maid1, D.TRANS_TYPE || D.TRANS_ID)
          AND A.BRNCODE = C.BRNCODE
          AND A.BNKCODE = C.BNKCODE
          AND B.BNKCODE = C.BNKCODE
          AND A.OLD_EMPCODE = D.OLD_EMPCODE
          AND A.UNIT_ID = D.UNIT_ID
          AND A.DESG_CD = F.DESG_CD
          AND ${optEq('F.Desg_GRP', 'mdesh_ord')}
          AND D.PERIOD# = :mperiod
          AND A.UNIT_ID = :munit
          AND A.STATUS = 'A'
          AND NVL(A.HOLD_SAL, 'N') = 'N'
          AND ${optEq('A.LOCATION', 'mlocation')}
          AND A.LOCATION = E.LOC_ID
          AND :mrtype = 'OT'
        GROUP BY A.OLD_EMPCODE, A.NAME, A.LOCATION, E.LOC_NAME,
                 A.BNKCODE, B.BNKNAME, A.BRNCODE, C.BRNNAME, A.BNKACCT, A.GROSS
       HAVING SUM(DECODE(D.TRANS_TYPE, 'A', NVL(D.TRANS_AMOUNT, 0))) > 1
        ORDER BY 8`,
      binds,
      { outFormat: OUT_OBJECT }
    );

    const rows = (res.rows ?? []).map(lowerKeys);

    // The printed advice is one block per bank branch, with a Total: footer.
    const groups = new Map();
    for (const r of rows) {
      const key = `${s(r.bnkcode)}|${s(r.brncode)}`;
      if (!groups.has(key)) {
        groups.set(key, {
          bank_code: s(r.bnkcode),
          bank_name: s(r.bnkname),
          branch_code: s(r.brncode),
          branch_name: s(r.brnname),
          location_name: s(r.loc_name),
          rows: [],
          total: 0,
        });
      }
      const g = groups.get(key);
      const payable = num(r.t_all) - num(r.t_ded);
      g.rows.push({
        code: s(r.old_empcode),
        employee_name: s(r.name),
        account_number: s(r.bnkacct),
        gross: num(r.gross),
        total_allowance: num(r.t_all),
        total_deduction: num(r.t_ded),
        salary_payable: payable,
      });
      g.total += payable;
    }

    const list = [...groups.values()];
    const meta = await buildMeta(connection, {
      unitId, location,
      periods: [binds.mperiod],
      filters: { desg_grp: opt(desgGrp), rtype: binds.mrtype, trans_id: opt(transId) },
    });

    return { groups: list, grand_total: list.reduce((t, g) => t + g.total, 0), meta };
  } finally {
    await connection?.close();
  }
};

// ══════════════════════════════════════════════════════════════════
// Employee Absent and Supplementary Days Report
//   —  "Employee Absent and Supplimentary Days Report.txt"
// ══════════════════════════════════════════════════════════════════

export const getAbsentSuppReport = async ({
  unitId, location = null, period, deptNo = null,
} = {}) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const binds = {
      mpf: toInt(period),
      munit: toInt(unitId),
      mloc: opt(location),
      mdept: opt(deptNo),
    };

    const res = await connection.execute(
      `SELECT UNIT_ID,
              PERIOD#,
              LOC_NAME, ' '||dept_name dept_name,
              DESG_DESC,
              ECODE,
              ENAME,
              SUM(ABSENT) ABSENT,
              SUM(S_DAYS) S_DAYS
         FROM
       (SELECT b.UNIT_ID,
               A.PERIOD#,
               b.LOC_NAME,
               b.DEPT_NAME, ' '||B.DESG_DESC  DESG_DESC,
               A.OLD_EMPCODE ECODE,
               ' '|| B.NAME ENAME,
               A.DAYS,
               A.ABSENT,
               0  S_DAYS
          FROM HR_EMP_DAYS A, HR_EMP_MASTER_VIEW B
         WHERE A.OLD_EMPCODE = B.OLD_EMPCODE
           AND A.UNIT_ID = B.UNIT_ID
           AND A.PERIOD# = :mpf
           AND A.ABSENT > 0
           AND ${optEq('A.UNIT_ID', 'munit')}
           AND ${optEq('B.LOCATION', 'mloc')}
           AND ${optEq('B.DEPT_NO', 'mdept')}
        UNION ALL
        SELECT b.UNIT_ID,
               A.PERIOD#,
               b.LOC_NAME,
               b.DEPT_NAME, ' '||B.DESG_DESC  DESG_DESC,
               A.OLD_EMPCODE ECODE,
               ' '|| B.NAME ENAME,
               0 DAYS,
               0 ABSENT,
               NOF_DAYS WORK_DAYS
          FROM hr_trans_mst A, HR_EMP_MASTER_VIEW B
         WHERE A.OLD_EMPCODE = B.OLD_EMPCODE
           AND A.UNIT_ID = B.UNIT_ID
           AND A.DOC_TYPE = 'S'
           and a.nof_days > 0
           AND A.PERIOD# = :mpf
           AND ${optEq('A.UNIT_ID', 'munit')}
           AND ${optEq('B.LOCATION', 'mloc')}
           AND ${optEq('B.DEPT_NO', 'mdept')} )
        GROUP BY UNIT_ID,
                 PERIOD#,
                 LOC_NAME, dept_name,
                 DESG_DESC,
                 ECODE,
                 ENAME
        ORDER BY ECODE`,
      binds,
      { outFormat: OUT_OBJECT }
    );

    const rows = (res.rows ?? []).map(lowerKeys).map((r, i) => ({
      sr_no: i + 1,
      unit_id: toInt(r.unit_id),
      period: toInt(r["period#"]),
      location_name: s(r.loc_name),
      department: s(r.dept_name),
      designation: s(r.desg_desc),
      code: s(r.ecode),
      employee_name: s(r.ename),
      absent: num(r.absent),
      s_days: num(r.s_days),
    }));

    const meta = await buildMeta(connection, {
      unitId, location,
      periods: [binds.mpf],
      filters: { department: opt(deptNo) },
    });

    return { rows, meta };
  } finally {
    await connection?.close();
  }
};

// ══════════════════════════════════════════════════════════════════
// Active Employee Detail Report  —  "Employee Detail (Active).txt"
// ══════════════════════════════════════════════════════════════════

// `sec_nm` is selected by the source query but does not exist on
// HR_EMP_MASTER_VIEW on this database — NULL keeps the Section column in place
// (blank) instead of raising ORA-00904. See the file header.
const EMP_DETAIL_COLS = `a.UNIT_NAME, a.LOC_NAME, a.EMP_type,
       a.OLD_EMPCODE,
       a.NAME,
       a.FHNAME,
       a.ADDRESS,
       a.SEX,
       to_char(a.DTOFBRTH, 'dd-Mon-yyyy') Datofb,
       to_char(a.DTOFAPPT, 'dd-Mon-yyyy') Datofapt,
       to_char(a.dtofconfirm, 'dd-Mon-yyyy') DatofCnfrm,
       a.DESG_DESC,
       a.GRADE_CD,
       a.DEPT_NAME, NULL sec_nm,
       substr(NVL(a."PHONE#",'Nill'),1,13) PHONE_NO,
       nvl(a.BNKACCT,'Nill') BNKACCT,
       a.NICNO,
       nvl(a.NTN,'Nill') NTN, a.qfication_nm,
       a.GROSS,
       a.BASIC,
       nvl(a.REBATE,0) REBATE,
       a.STATUS`;

/**
 * Every optional filter here uses optEq/optRange rather than the source query's
 * `col = NVL(:bind, col)` / `BETWEEN NVL(:g1,0) AND NVL(:g2,999999)`. Without
 * that, an employee with a NULL DESG_GRP, EMP_STATUS, GRADE_CD, DEPT_NO,
 * DESG_CD or GROSS was dropped even with the filter blank — which made this
 * report return zero rows for units 2 and 3. See optEq for the full reasoning.
 */
export const getActiveEmployeesReport = async ({
  unitId, location = null, rtype = "A", empcode = null, empStatus = null,
  grossFrom = null, grossTo = null, desgCd = null, deptNo = null,
  desgGrp = null, gradeCd = null,
} = {}) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const binds = {
      empcode: opt(empcode),
      mrtype: ["A", "U", "C"].includes(rtype) ? rtype : "A",
      mloc: opt(location),
      mstats: opt(empStatus),
      g1: toNum(grossFrom),
      g2: toNum(grossTo),
      munit: toInt(unitId),
      mdesg1: opt(desgCd),
      mdeptno: opt(deptNo),
      mdesg: opt(desgGrp),
      mgradde: opt(gradeCd),
    };

    const res = await connection.execute(
      `select ${EMP_DETAIL_COLS}
         from hr_emp_master_view a
        where ${optEq('a.OLD_EMPCODE', 'empcode')}
          and a.status = 'Active'
          AND :mrtype = 'C'
          AND ${optEq('a.LOCATION', 'mloc')}
          AND a.dtofconfirm is NOT null
          and a.confirm_status = 'Y'
          and ${optEq('a.emp_status', 'mstats')}
          and ${optRange('a.GROSS', 'g1', 'g2')}
          and ${optEq('a.UNIT_ID', 'munit')}
          and ${optEq('a.DESG_CD', 'mdesg1')}
          and ${optEq('a.DEPT_NO', 'mdeptno')}
          and ${optEq('a.DESG_GRP', 'mdesg')}
          and ${optEq('a.GRADE_CD', 'mgradde')}
       UNION ALL
       select ${EMP_DETAIL_COLS}
         from hr_emp_master_view a
        where ${optEq('a.OLD_EMPCODE', 'empcode')}
          and a.status = 'Active'
          AND :mrtype = 'U'
          AND ${optEq('a.LOCATION', 'mloc')}
          and nvl(a.confirm_status,'N') = 'N'
          and ${optEq('a.emp_status', 'mstats')}
          and ${optRange('a.GROSS', 'g1', 'g2')}
          and ${optEq('a.UNIT_ID', 'munit')}
          and ${optEq('a.DESG_CD', 'mdesg1')}
          and ${optEq('a.DEPT_NO', 'mdeptno')}
          and ${optEq('a.DESG_GRP', 'mdesg')}
          and ${optEq('a.GRADE_CD', 'mgradde')}
       UNION ALL
       select ${EMP_DETAIL_COLS}
         from hr_emp_master_view a
        where ${optEq('a.OLD_EMPCODE', 'empcode')}
          and a.status = 'Active'
          AND :mrtype = 'A'
          and ${optEq('a.emp_status', 'mstats')}
          and ${optRange('a.GROSS', 'g1', 'g2')}
          AND ${optEq('a.LOCATION', 'mloc')}
          and ${optEq('a.UNIT_ID', 'munit')}
          and ${optEq('a.DEPT_NO', 'mdeptno')}
          and ${optEq('a.DESG_CD', 'mdesg1')}
          and ${optEq('a.DESG_GRP', 'mdesg')}
          and ${optEq('a.GRADE_CD', 'mgradde')}
        order by 1, 2, 13, 12, 4`,
      binds,
      { outFormat: OUT_OBJECT }
    );

    const rows = (res.rows ?? []).map(lowerKeys).map((r, i) => ({
      sr_no: i + 1,
      unit: s(r.unit_name),
      location: s(r.loc_name),
      emp_type: s(r.emp_type),
      code: s(r.old_empcode),
      employee_name: s(r.name),
      father_name: s(r.fhname),
      address: s(r.address),
      sex: s(r.sex),
      date_of_birth: s(r.datofb),
      date_of_joining: s(r.datofapt),
      date_of_confirm: s(r.datofcnfrm),
      designation: s(r.desg_desc),
      grade: s(r.grade_cd),
      department: s(r.dept_name),
      section: s(r.sec_nm),
      phone: s(r.phone_no),
      bank_account: s(r.bnkacct),
      nic: s(r.nicno),
      ntn: s(r.ntn),
      qualification: s(r.qfication_nm),
      gross: num(r.gross),
      basic: num(r.basic),
      rebate: num(r.rebate),
      status: s(r.status),
    }));

    const meta = await buildMeta(connection, {
      unitId, location,
      periods: [],
      filters: {
        rtype: binds.mrtype,
        designation: opt(desgCd),
        desg_grp: opt(desgGrp),
        department: opt(deptNo),
        grade: opt(gradeCd),
        emp_status: opt(empStatus),
        gross_from: binds.g1,
        gross_to: binds.g2,
        employee: opt(empcode),
      },
    });

    return { rows, meta };
  } finally {
    await connection?.close();
  }
};

// ══════════════════════════════════════════════════════════════════
// P.F Detail Report  —  "PF Detail.txt" (both queries)
// ══════════════════════════════════════════════════════════════════

export const getPfDetailReport = async ({ unitId, empcode } = {}) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const binds = { munit: toInt(unitId), memp: s(empcode).toUpperCase() };

    // query 1 — monthly ledger: salary-process PF deductions UNION the
    // HR_PF_BALANCES rows. codename('PERIOD#',…) returns NULL here, so the
    // month label is resolved from HR_ATTND_PERIOD instead (see file header).
    const ledgerRes = await connection.execute(
      `SELECT b.unit_id,
              B.PERIOD#,
              b.old_empcode empcode,
              D.ACTUAL_GROSS,
              D.EARNED_GROSS,
              D.ACTUAL_BASIC,
              D.EARNED_BASIC,
              sum(decode(b.trans_id,'12',B.TRANS_AMOUNT,0))  amount,
              'S' src
         FROM HR_SALARY_PROCESS_FINAL        B,
              HR_DEDUCTION                   C,
              HR_SALARY_PROCESS_MASTER_FINAL D
        WHERE B.TRANS_ID = C.DED_Cd
          AND B.OLD_EMPCODE = D.OLD_EMPCODE
          AND B.UNIT_ID = D.UNIT_ID
          AND B.PERIOD# = D.PERIOD#
          AND b.trans_type = 'D'
          AND b.unit_id = NVL(:munit, B.UNIT_ID)
          and b.old_empcode = upper(:memp)
        group by b.unit_id, B.PERIOD#, b.old_empcode,
                 D.ACTUAL_GROSS, D.EARNED_GROSS, D.ACTUAL_BASIC, D.EARNED_BASIC
       UNION ALL
       SELECT b.unit_id,
              B.PERIOD#,
              b.old_empcode empcode,
              0 ACTUAL_GROSS,
              0 EARNED_GROSS,
              0 ACTUAL_BASIC,
              0 EARNED_BASIC,
              sum(PF_BAL)  amount,
              'B' src
         FROM HR_PF_BALANCES B,
              HR_DEDUCTION  C
        WHERE B.DED_CD = C.DED_Cd
          AND b.unit_id = NVL(:munit, B.UNIT_ID)
          and b.old_empcode = upper(:memp)
        group by b.unit_id, B.PERIOD#, b.old_empcode
        ORDER BY 2`,
      binds,
      { outFormat: OUT_OBJECT }
    );

    // query 2 — loan taken against the P.F, for the account-department box.
    const loanRes = await connection.execute(
      `SELECT L.LOAN_AMT, TO_CHAR(L.START_DT, 'dd-Mon-yyyy') START_DT FROM HR_LOAN_MST L
        WHERE L.OLD_EMPCODE = :memp
          AND L.unit_id = NVL(:munit, L.UNIT_ID)
          AND L.LOAN_CD = 16`,
      { memp: s(empcode), munit: toInt(unitId) },
      { outFormat: OUT_OBJECT }
    );

    const headerRes = await connection.execute(
      `SELECT OLD_EMPCODE, NAME, UNIT_NAME, DEPT_NAME, DESG_DESC
         FROM HR_EMP_MASTER_VIEW
        WHERE OLD_EMPCODE = :memp AND (:munit IS NULL OR UNIT_ID = :munit)
        FETCH FIRST 1 ROWS ONLY`,
      { memp: s(empcode), munit: toInt(unitId) },
      { outFormat: OUT_OBJECT }
    );

    const pmap = await periodLabelMap(connection, unitId);

    // Merge the two halves of the union by period: the salary-process half
    // carries the gross/basic figures, the HR_PF_BALANCES half the contribution.
    // Balance is the running cumulative of the contributions.
    const merged = new Map();
    for (const raw of ledgerRes.rows ?? []) {
      const r = lowerKeys(raw);
      const p = toInt(r["period#"]);
      if (!merged.has(p)) {
        merged.set(p, {
          period: p,
          month_year: pmap.get(p) || (p === 0 ? "Opening" : `Period ${p}`),
          actual_basic: 0, earned_basic: 0, actual_gross: 0, earned_gross: 0,
          pf_contribution: 0, balance: 0,
        });
      }
      const e = merged.get(p);
      if (s(r.src) === "S") {
        e.actual_basic = num(r.actual_basic);
        e.earned_basic = num(r.earned_basic);
        e.actual_gross = num(r.actual_gross);
        e.earned_gross = num(r.earned_gross);
        if (!e.pf_contribution) e.pf_contribution = num(r.amount);
      } else {
        // HR_PF_BALANCES is the authoritative contribution figure.
        e.pf_contribution = num(r.amount);
      }
    }

    const ledger = [...merged.values()].sort((a, b) => a.period - b.period);
    let running = 0;
    ledger.forEach((row, i) => {
      row.sr_no = i + 1;
      running += row.pf_contribution;
      row.balance = row.pf_contribution ? running : 0;
    });

    const employeeContribution = running;
    const loanRows = (loanRes.rows ?? []).map(lowerKeys);
    const loanAgainstPf = loanRows.reduce((t, r) => t + num(r.loan_amt), 0);

    const h = headerRes.rows?.[0] ? lowerKeys(headerRes.rows[0]) : {};
    const meta = await buildMeta(connection, {
      unitId, location: null, periods: [], filters: { employee: s(empcode) },
    });

    return {
      employee_header: {
        code: s(h.old_empcode) || s(empcode),
        name: s(h.name),
        unit: s(h.unit_name),
        department: s(h.dept_name),
        designation: s(h.desg_desc),
      },
      ledger,
      totals: {
        actual_basic: ledger.reduce((t, r) => t + r.actual_basic, 0),
        earned_basic: ledger.reduce((t, r) => t + r.earned_basic, 0),
        actual_gross: ledger.reduce((t, r) => t + r.actual_gross, 0),
        earned_gross: ledger.reduce((t, r) => t + r.earned_gross, 0),
        pf_contribution: employeeContribution,
      },
      account_summary: {
        // The employer matches the employee rupee for rupee (as printed).
        employee_contribution: employeeContribution,
        employer_contribution: employeeContribution,
        loan_against_pf: loanAgainstPf,
        permanent_withdrawal_pf: 0,
        total_pf: employeeContribution * 2 - loanAgainstPf,
      },
      pw_withdrawals: loanRows.map((r) => ({ date: s(r.start_dt), amount: num(r.loan_amt) })),
      meta,
    };
  } finally {
    await connection?.close();
  }
};

// ═══════════════════════════════════════════════════════════════════
// MONTHLY ATTENDANCE REPORT
//
// The wide day-grid HR prints each cycle: one row per employee, one column per
// calendar day, grouped by branch and then department. Cells carry the in/out
// punch plus the ERP's own flags, so the print can mark late arrivals, half
// days, absences and approved leave the way the legacy report did.
//
// Source is TMS_DUTY_ROSTER_V (with DUTY_ROSTER for the shift letter), the same
// view the attendance screens read, so a day shown here matches what those show.
// ═══════════════════════════════════════════════════════════════════

const DOW_LETTER = { SUNDAY: 'S', MONDAY: 'M', TUESDAY: 'T', WEDNESDAY: 'W', THURSDAY: 'T', FRIDAY: 'F', SATURDAY: 'S' };

export const getMonthlyAttendanceReport = async ({
  unitId, location = null, fromDate, toDate, deptNo = null,
} = {}) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const binds = {
      munit: toInt(unitId),
      mfrom: String(fromDate),
      mto: String(toDate),
    };
    let deptCond = '';
    if (opt(deptNo) !== null) { deptCond = "AND LTRIM(TO_CHAR(h.DEPT_NO),'0') = LTRIM(TO_CHAR(:mdept),'0')"; binds.mdept = opt(deptNo); }
    let locCond = '';
    if (opt(location) !== null) { locCond = 'AND TRIM(h.LOCATION) = TRIM(:mloc)'; binds.mloc = opt(location); }

    const res = await connection.execute(
      `SELECT TRIM(h.LOCATION)                                   AS BRANCH_CODE,
              (SELECT MIN(l.DESCR) FROM COM_LOCATION l
                WHERE TRIM(l.LCODE) = TRIM(h.LOCATION))          AS BRANCH_NAME,
              (SELECT MIN(d.DEPT_NAME) FROM HR_DEPT d
                WHERE LTRIM(d.DEPT_NO,'0') = LTRIM(h.DEPT_NO,'0')
                  AND TO_CHAR(d.COMPC) = TO_CHAR(h.UNIT_ID))     AS DEPT_NAME,
              h.EMPCODE                                          AS CARD_NO,
              h."ATDTCARD#"                                      AS EMP_NO,
              h.NAME                                             AS EMP_NAME,
              TO_CHAR(v.ROSTER_DATE, 'YYYY-MM-DD')               AS ROSTER_DATE,
              v.DAY_NAME                                         AS DAY_NAME,
              d2.ROSTER_SHIFT                                    AS SHIFT,
              v.IN_TIME                                          AS IN_TIME,
              v.OUT_TIME                                         AS OUT_TIME,
              v.ABSENT                                           AS ABSENT,
              v.HOLIDAY_FK                                       AS HOLIDAY_FK,
              v.MORNING_LATE                                     AS MORNING_LATE,
              v.EARLY_OUT_LATE                                   AS EARLY_OUT_LATE,
              v.MORNING_HALF_DAY                                 AS MORNING_HALF_DAY,
              v.EAR_OUT_HALF_DAY                                 AS EAR_OUT_HALF_DAY,
              v.LEAVE_TYPE_FK                                    AS LEAVE_TYPE_FK,
              v.LEAVE_REMARKS                                    AS LEAVE_REMARKS,
              v.ROSTER_REMARKS                                   AS ROSTER_REMARKS,
              (SELECT MIN(t.LEAVE_TYPE) FROM LEAVE_TYPES t
                WHERE t.LEAVE_TYPE_PK = v.LEAVE_TYPE_FK)         AS LEAVE_TYPE
         FROM TMS_DUTY_ROSTER_V v
         JOIN EMPLOYEE e      ON TO_CHAR(e.CARD_NO) = TO_CHAR(v.CARD_NO)
         JOIN HR_EMP_MASTER h ON h.EMPCODE = e.EMPCODE
         LEFT JOIN DUTY_ROSTER d2
                ON TO_CHAR(d2.CARD_NO) = TO_CHAR(v.CARD_NO)
               AND d2.ROSTER_DATE = v.ROSTER_DATE
        WHERE TO_CHAR(h.UNIT_ID) = TO_CHAR(:munit)
          AND h.STATUS = 'A'
          AND TRUNC(v.ROSTER_DATE) BETWEEN TO_DATE(:mfrom, 'YYYY-MM-DD') AND TO_DATE(:mto, 'YYYY-MM-DD')
          ${locCond}
          ${deptCond}
        ORDER BY BRANCH_NAME NULLS LAST, DEPT_NAME NULLS LAST, h.NAME, v.ROSTER_DATE`,
      binds,
      { outFormat: OUT_OBJECT },
    );

    const str = (v) => String(v ?? '').trim();
    const days = new Map();          // 'YYYY-MM-DD' -> { date, dow }
    const branches = new Map();      // branch -> Map(dept -> Map(card -> row))

    for (const raw of res.rows ?? []) {
      const r = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
      const date = str(r.roster_date);
      if (!date) continue;
      if (!days.has(date)) {
        days.set(date, { date, dow: DOW_LETTER[str(r.day_name).toUpperCase()] ?? '' });
      }

      // One group per branch, with the department carried on the row — the same
      // { groups: [{ rows }] } shape the other reports use, so the page's
      // search / selection / print plumbing works unchanged.
      const branch = str(r.branch_name) || str(r.branch_code) || '—';
      const dept = str(r.dept_name) || '—';
      if (!branches.has(branch)) branches.set(branch, new Map());
      const rowsByCard = branches.get(branch);

      const card = str(r.card_no);
      const key = `${dept}|${card}`;
      if (!rowsByCard.has(key)) {
        rowsByCard.set(key, {
          code: card,
          card_no: card,
          emp_no: str(r.emp_no),
          employee_name: str(r.emp_name),
          department: dept,
          branch,
          days: {},
          absent_days: 0,
          late_days: 0,
          leave_days: 0,
          present_days: 0,
        });
      }
      const row = rowsByCard.get(key);

      // Same derivation as every other attendance surface — see
      // utils/rosterStatus.js. The report used to call a day absent only when
      // ABSENT = 1 AND there was no punch at all, which disagreed with the HR
      // attendance screen on the ~700 rows the ERP flags absent despite a punch.
      const shift = str(r.shift).toUpperCase();
      const d = deriveRosterDay({ ...r, roster_shift: shift });

      row.days[date] = {
        in_time: d.in_time,
        out_time: d.out_time,
        shift,
        status: d.status,
        is_rest: d.is_rest,
        is_absent: d.is_absent,
        is_late: d.is_late,
        is_half_day: d.is_half_day,
        is_morning_late: d.is_morning_late,
        is_morning_half_day: d.is_morning_half_day,
        is_leave: d.is_leave,
        is_holiday: d.is_holiday,
        leave_type: d.leave_type,
        remarks: d.remarks,
      };
      if (d.is_absent) row.absent_days += 1;
      if (d.is_late) row.late_days += 1;
      if (d.is_leave) row.leave_days += 1;
      if (d.is_present) row.present_days += 1;
    }

    const groups = [...branches.entries()].map(([branch, rowsByCard]) => ({
      branch,
      rows: [...rowsByCard.values()].sort(
        (a, b) => a.department.localeCompare(b.department) ||
                  a.employee_name.localeCompare(b.employee_name),
      ),
    }));

    const meta = await buildMeta(connection, {
      unitId,
      location,
      periods: [],
      filters: { from_date: fromDate, to_date: toDate, dept_no: deptNo },
    });

    return {
      days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
      groups,
      meta,
    };
  } finally {
    await connection?.close();
  }
};
