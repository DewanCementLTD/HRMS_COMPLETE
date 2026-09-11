import { getDirectConnection } from '../config/database.js';
import { logger } from '../utils/logger.js';

const OUT_ARRAY = 4001; // oracledb.OUT_FORMAT_ARRAY

// ---------------------------------------------------------------------------
// Leave allocation (LEAVE_OP) — HR grants each employee their leave for a year.
//
// ALL_LEAVE_BAL_V reads OP_BAL as the employee's entitlement:
//
//     (SELECT NVL(op_bal, 0) FROM leave_op
//       WHERE year = a.year AND leave_type_fk = b.leave_type_pk
//         AND emp_fk = a.emp_pk AND compc = a.compc AND brnch = a.brnch) new_entitled
//
// so a row only counts when EMP_FK, LEAVE_TYPE_FK, YEAR, COMPC and BRNCH all
// line up with the employee's own record — those five columns are the natural
// key here, even though the table carries no constraint saying so. Everything
// below keys on that tuple, and COMPC/BRNCH are taken from the employee rather
// than from the caller so a saved row can never be invisible to the view.
//
// EMP_FK holds EMPLOYEE.EMP_PK, which is the card number (e.g. 100299.1).
// ---------------------------------------------------------------------------

const norm = (v) => String(v ?? '').trim();

const toNum = (v) => {
  if (v === null || v === undefined || norm(v) === '') return null;
  const n = Number(norm(v));
  return Number.isFinite(n) ? n : null;
};

/** Employee identity for an allocation: card number plus their company/branch. */
const resolveEmployee = async (connection, cardNo) => {
  const card = norm(cardNo);
  const r = await connection.execute(
    `SELECT TO_CHAR(e.CARD_NO), e.EMP_PK, e.EMP_NAME, e.COMPC, e.BRNCH
       FROM EMPLOYEE e
      WHERE TO_CHAR(e.CARD_NO) = :card OR TO_CHAR(e.EMP_PK) = :card
      FETCH FIRST 1 ROWS ONLY`,
    { card },
    { outFormat: OUT_ARRAY },
  );
  const row = r.rows?.[0];
  if (!row) return null;
  return {
    card_no: norm(row[0]),
    emp_pk: row[1],
    emp_name: norm(row[2]),
    compc: row[3],
    brnch: row[4],
  };
};

/**
 * Employees of one company, for the allocation form's employee picker.
 * Company scoping is not optional: HR only ever sees their own company here.
 */
export const listAllocatableEmployeesData = async (compc, brnch) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const binds = {};
    const conds = [];
    if (norm(compc)) { conds.push('TO_CHAR(e.COMPC) = TO_CHAR(:compc)'); binds.compc = norm(compc); }
    if (norm(brnch)) { conds.push('TO_CHAR(e.BRNCH) = TO_CHAR(:brnch)'); binds.brnch = norm(brnch); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const r = await connection.execute(
      `SELECT TO_CHAR(e.CARD_NO), e.EMP_NAME, e.COMPC, e.BRNCH,
              (SELECT MIN(d.DEPT_NAME) FROM HR_DEPT d, HR_EMP_MASTER m
                WHERE m.EMPCODE = TO_CHAR(e.CARD_NO)
                  AND LTRIM(d.DEPT_NO, '0') = LTRIM(m.DEPT_NO, '0')
                  AND TO_CHAR(d.COMPC) = TO_CHAR(m.UNIT_ID)) AS DEPT_NAME
         FROM EMPLOYEE e
         ${where}
        ORDER BY e.EMP_NAME`,
      binds,
      { outFormat: OUT_ARRAY },
    );
    return (r.rows ?? []).map(([card_no, name, c, b, dept]) => ({
      card_no: norm(card_no),
      emp_name: norm(name),
      compc: c,
      brnch: b,
      department: norm(dept),
    }));
  } finally {
    await connection?.close();
  }
};

/**
 * Existing allocations for a company/year, newest employees first.
 * `card_no` narrows it to one employee (what the form loads when HR picks one).
 */
export const listLeaveOpeningsData = async ({ compc, brnch, year, card_no }) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const binds = {};
    const conds = [];
    if (norm(compc)) { conds.push('TO_CHAR(o.COMPC) = TO_CHAR(:compc)'); binds.compc = norm(compc); }
    if (norm(brnch)) { conds.push('TO_CHAR(o.BRNCH) = TO_CHAR(:brnch)'); binds.brnch = norm(brnch); }
    if (toNum(year) !== null) { conds.push('o.YEAR = :year'); binds.year = toNum(year); }
    if (norm(card_no)) { conds.push('TO_CHAR(o.EMP_FK) = TO_CHAR(:card)'); binds.card = norm(card_no); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const r = await connection.execute(
      `SELECT TO_CHAR(o.EMP_FK), o.LEAVE_TYPE_FK, o.OP_BAL,
              TO_CHAR(o.OP_DATE, 'YYYY-MM-DD'), o.YEAR, o.COMPC, o.BRNCH,
              (SELECT MIN(e.EMP_NAME) FROM EMPLOYEE e WHERE TO_CHAR(e.CARD_NO) = TO_CHAR(o.EMP_FK)) AS EMP_NAME,
              (SELECT MIN(t.LEAVE_TYPE) FROM LEAVE_TYPES t WHERE t.LEAVE_TYPE_PK = o.LEAVE_TYPE_FK) AS LEAVE_TYPE,
              (SELECT MIN(t.LEAVE_DESC) FROM LEAVE_TYPES t WHERE t.LEAVE_TYPE_PK = o.LEAVE_TYPE_FK) AS LEAVE_DESC
         FROM LEAVE_OP o
         ${where}
        ORDER BY EMP_NAME, o.LEAVE_TYPE_FK`,
      binds,
      { outFormat: OUT_ARRAY },
    );
    return (r.rows ?? []).map(([emp, typeFk, bal, opDate, yr, c, b, name, code, desc]) => ({
      card_no: norm(emp),
      emp_name: norm(name),
      leave_type_fk: typeFk,
      leave_type: norm(code),
      leave_desc: norm(desc),
      op_bal: bal === null || bal === undefined ? null : Number(bal),
      op_date: opDate,
      year: yr,
      compc: c,
      brnch: b,
    }));
  } finally {
    await connection?.close();
  }
};

/** Only these can be allocated — the balance view itself only reports 1, 2, 3. */
export const ALLOCATABLE_LEAVE_TYPES = [1, 2, 3];

/**
 * The leave year HR allocates against — the ACTIVE one only.
 *
 * ALL_LEAVE_BAL_V resolves the year per company/branch from
 * YEAR.ACTIVE_FLAG = 'Y' (2025 for company 1), and a LEAVE_OP row keyed to any
 * other year is simply never read. Offering the other years therefore only
 * invited allocations that silently do nothing, so the list is limited to the
 * active year, with its matching Payroll > Period Opening dates attached for
 * context.
 *
 * The fallback only applies when the YEAR table has no active row for the
 * company: rather than leave HR with an empty dropdown, the payroll periods and
 * any years already carrying allocations are offered, all flagged inactive so
 * the form can warn.
 */
export const listLeaveOpeningYearsData = async (compc, brnch) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const scopedBinds = norm(compc) ? { compc: norm(compc) } : {};
    const yearScope = norm(compc) ? 'AND TO_CHAR(COMPC) = TO_CHAR(:compc)' : '';

    // The active year is held per company AND branch, and the branches can
    // disagree (company 1 currently has 2026 on branch 1 and 2025 on branches
    // 12-18). What matters is the branch the employees sit in, so weight each
    // active year by how many active employees it actually covers.
    let activeYears = [];
    try {
      const a = await connection.execute(
        `SELECT y.YEAR,
                COUNT(DISTINCT TO_CHAR(y.BRNCH)) AS BRANCHES,
                (SELECT COUNT(*)
                   FROM EMPLOYEE e
                   JOIN HR_EMP_MASTER h ON h.EMPCODE = e.EMPCODE
                  WHERE h.STATUS = 'A'
                    AND TO_CHAR(e.COMPC) = TO_CHAR(y.COMPC)
                    AND TO_CHAR(e.BRNCH) IN (
                          SELECT TO_CHAR(y2.BRNCH) FROM YEAR y2
                           WHERE y2.ACTIVE_FLAG = 'Y' AND y2.YEAR = y.YEAR
                             AND TO_CHAR(y2.COMPC) = TO_CHAR(y.COMPC))) AS EMPLOYEES
           FROM YEAR y
          WHERE y.ACTIVE_FLAG = 'Y'
            ${norm(compc) ? 'AND TO_CHAR(y.COMPC) = TO_CHAR(:compc)' : ''}
            ${norm(brnch) ? 'AND TO_CHAR(y.BRNCH) = TO_CHAR(:brnch)' : ''}
          GROUP BY y.YEAR, y.COMPC
          ORDER BY EMPLOYEES DESC, y.YEAR DESC`,
        {
          ...(norm(compc) ? { compc: norm(compc) } : {}),
          ...(norm(brnch) ? { brnch: norm(brnch) } : {}),
        },
        { outFormat: OUT_ARRAY },
      );
      activeYears = (r0 => r0)(a.rows ?? [])
        .map(([year, branches, employees]) => ({
          year: Number(year),
          branches: Number(branches ?? 0),
          employees: Number(employees ?? 0),
        }))
        .filter((x) => Number.isFinite(x.year));
    } catch (e) {
      logger.warn(`[LEAVE_OP] active YEAR lookup failed: ${String(e.message).split(String.fromCharCode(10))[0]}`);
    }
    const activeYear = activeYears[0]?.year ?? null;

    // The payroll period whose end year matches, purely for the label.
    const periodFor = async (year) => {
      try {
        const r = await connection.execute(
          `SELECT RULE_ID, TO_CHAR(FROM_DATE, 'YYYY-MM-DD'), TO_CHAR(TO_DATE, 'YYYY-MM-DD'), STATUS, SCODE
             FROM HR_FINANCIAL_YEAR
            WHERE TO_CHAR(TO_DATE, 'YYYY') = :yr
              ${norm(compc) ? 'AND TO_CHAR(UNIT_ID) = TO_CHAR(:compc)' : ''}
            ORDER BY FROM_DATE DESC
            FETCH FIRST 1 ROWS ONLY`,
          { ...scopedBinds, yr: String(year) },
          { outFormat: OUT_ARRAY },
        );
        const row = r.rows?.[0];
        if (!row) return {};
        return {
          rule_id: row[0],
          year_from: row[1],
          year_to: row[2],
          scode: norm(row[4]),
          open: norm(row[3]).toUpperCase() === 'O',
        };
      } catch {
        return {};
      }
    };

    if (activeYears.length) {
      // One entry: the active year the employees being allocated to are on.
      // Company 1 currently has 2026 on branch 1 (606 active employees) and
      // 2025 on branches 12-18 (2), so the list is ordered by how many people
      // each covers and only the top one is offered. `other_active_years` says
      // when a different branch is on another year rather than hiding it.
      const chosen = activeYears[0];
      return [{
        year: chosen.year,
        active: true,
        branches: chosen.branches,
        employees: chosen.employees,
        other_active_years: activeYears.slice(1).map((a) => a.year),
        ...(await periodFor(chosen.year)),
      }];
    }

    // No active leave year configured for this company — offer what exists so
    // the screen is still usable, and let the form flag that none is active.
    const seen = new Map();
    try {
      const r = await connection.execute(
        `SELECT TO_CHAR(TO_DATE, 'YYYY'), RULE_ID, TO_CHAR(FROM_DATE, 'YYYY-MM-DD'),
                TO_CHAR(TO_DATE, 'YYYY-MM-DD'), STATUS, SCODE
           FROM HR_FINANCIAL_YEAR
          ${norm(compc) ? 'WHERE TO_CHAR(UNIT_ID) = TO_CHAR(:compc)' : ''}
          ORDER BY FROM_DATE DESC`,
        scopedBinds,
        { outFormat: OUT_ARRAY },
      );
      for (const [yr, ruleId, from, to, status, scode] of r.rows ?? []) {
        const y = Number(yr);
        if (!Number.isFinite(y) || seen.has(y)) continue;
        seen.set(y, {
          year: y, active: false, rule_id: ruleId, year_from: from, year_to: to,
          scode: norm(scode), open: norm(status).toUpperCase() === 'O',
        });
      }
    } catch (e) {
      logger.warn(`[LEAVE_OP] HR_FINANCIAL_YEAR lookup failed: ${String(e.message).split(String.fromCharCode(10))[0]}`);
    }

    const r2 = await connection.execute(
      `SELECT DISTINCT YEAR FROM LEAVE_OP
        ${norm(compc) ? 'WHERE TO_CHAR(COMPC) = TO_CHAR(:compc)' : ''}
        ORDER BY YEAR DESC`,
      scopedBinds,
      { outFormat: OUT_ARRAY },
    );
    for (const [year] of r2.rows ?? []) {
      const y = Number(year);
      if (Number.isFinite(y) && !seen.has(y)) seen.set(y, { year: y, active: false });
    }

    return [...seen.values()].sort((a, b) => b.year - a.year);
  } finally {
    await connection?.close();
  }
};

/**
 * Save one employee's allocation for a year.
 *
 * `entries` is [{ leave_type_fk, op_bal }]. A blank/null balance removes that
 * leave type's row rather than storing a zero, so the view falls back to no
 * entitlement instead of an explicit nil one. The table has no unique
 * constraint, so each entry is an UPDATE first and an INSERT only when nothing
 * matched — that keeps a second save from duplicating rows the view would then
 * read arbitrarily.
 */
export const saveLeaveOpeningData = async (payload) => {
  const { card_no, year, op_date, entries, compc: reqCompc } = payload;
  const yr = toNum(year);
  if (!norm(card_no)) return { status: 'error', message: 'Employee is required' };
  if (yr === null) return { status: 'error', message: 'Year is required' };
  if (!Array.isArray(entries) || entries.length === 0) {
    return { status: 'error', message: 'Nothing to save' };
  }

  let connection;
  try {
    connection = await getDirectConnection();
    const emp = await resolveEmployee(connection, card_no);
    if (!emp) return { status: 'error', message: `No employee found for card ${card_no}` };

    // HR may only allocate within their own company.
    if (norm(reqCompc) && norm(emp.compc) && norm(reqCompc) !== norm(emp.compc)) {
      return { status: 'error', message: 'That employee belongs to another company.' };
    }
    if (emp.compc === null || emp.brnch === null) {
      return {
        status: 'error',
        message: 'This employee has no company/branch set, so a leave allocation would not be counted.',
      };
    }

    // OP_DATE marks the start of the leave year; take it from the ERP's own YEAR
    // row so it matches the existing data rather than guessing.
    let opDate = norm(op_date);
    let isActiveYear = false;
    try {
      const y = await connection.execute(
        `SELECT TO_CHAR(MIN(YEAR_FROM), 'YYYY-MM-DD'), MAX(NVL(ACTIVE_FLAG, 'N'))
           FROM YEAR
          WHERE YEAR = :year AND TO_CHAR(COMPC) = TO_CHAR(:compc) AND TO_CHAR(BRNCH) = TO_CHAR(:brnch)`,
        { year: yr, compc: emp.compc, brnch: emp.brnch },
        { outFormat: OUT_ARRAY },
      );
      const row = y.rows?.[0];
      if (row) {
        if (!opDate && row[0]) opDate = row[0];
        isActiveYear = norm(row[1]).toUpperCase() === 'Y';
      }
    } catch (e) {
      logger.warn(`[LEAVE_OP] YEAR row lookup failed: ${String(e.message).split('\n')[0]}`);
    }
    if (!opDate) opDate = `${yr - 1}-07-01`;

    let saved = 0;
    let removed = 0;
    for (const entry of entries) {
      const typeFk = toNum(entry?.leave_type_fk);
      if (typeFk === null) continue;
      // CL / ML / EL only — the balance view reports no others.
      if (!ALLOCATABLE_LEAVE_TYPES.includes(typeFk)) continue;
      const bal = toNum(entry?.op_bal);
      const keys = {
        emp: emp.card_no,
        type: typeFk,
        year: yr,
        compc: emp.compc,
        brnch: emp.brnch,
      };

      if (bal === null) {
        const del = await connection.execute(
          `DELETE FROM LEAVE_OP
            WHERE TO_CHAR(EMP_FK) = TO_CHAR(:emp) AND LEAVE_TYPE_FK = :type
              AND YEAR = :year AND COMPC = :compc AND BRNCH = :brnch`,
          keys,
        );
        removed += del.rowsAffected ?? 0;
        continue;
      }

      const upd = await connection.execute(
        `UPDATE LEAVE_OP
            SET OP_BAL = :bal, OP_DATE = TO_DATE(:opDate, 'YYYY-MM-DD')
          WHERE TO_CHAR(EMP_FK) = TO_CHAR(:emp) AND LEAVE_TYPE_FK = :type
            AND YEAR = :year AND COMPC = :compc AND BRNCH = :brnch`,
        { ...keys, bal, opDate },
      );
      if ((upd.rowsAffected ?? 0) === 0) {
        await connection.execute(
          `INSERT INTO LEAVE_OP (EMP_FK, LEAVE_TYPE_FK, OP_BAL, OP_DATE, YEAR, COMPC, BRNCH)
           VALUES (:emp, :type, :bal, TO_DATE(:opDate, 'YYYY-MM-DD'), :year, :compc, :brnch)`,
          { ...keys, bal, opDate },
        );
      }
      saved += 1;
    }

    await connection.commit();

    // Balances only read the active leave year, so saving against any other year
    // is legitimate (setting next year up early) but won't show yet — say so
    // rather than letting HR think the allocation failed.
    const base = removed
      ? `Saved ${saved} leave type(s); cleared ${removed}.`
      : `Saved ${saved} leave type(s) for ${emp.emp_name || emp.card_no}.`;
    return {
      status: 'success',
      message: isActiveYear
        ? base
        : `${base} Note: ${yr} is not the active leave year, so this won't appear in balances until it is activated.`,
      saved,
      removed,
      is_active_year: isActiveYear,
    };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    logger.warn(`[LEAVE_OP] save failed: ${String(err.message).split('\n')[0]}`);
    return { status: 'error', message: err.message };
  } finally {
    await connection?.close();
  }
};
