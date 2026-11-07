/**
 * Public holidays for chosen branches (Setup → Holidays).
 *
 * The ERP has a HOLIDAYS table, but it cannot be used for this: its hourly job
 * CREATE_DUTY_ROSTER_PRO stamps every HOLIDAYS row onto EVERY employee's roster
 * — the COMPC/BRNCH predicates in that UPDATE are commented out — so a holiday
 * meant for one branch would land on every company and branch in the schema.
 *
 * So holidays live in LMS_HOLIDAY (one company) + LMS_HOLIDAY_BRANCH (its
 * branches), and this module stamps DUTY_ROSTER itself, the same way the ERP
 * would for a holiday: HOLIDAY_FK + STATUS, plus the reason in ROSTER_REMARKS
 * so the attendance screens show "Holiday — <reason>".
 *
 * Everything downstream already understands HOLIDAY_FK: the ERP job never marks
 * such a day absent or late, leave is not charged on it, roster defaults leave
 * it alone, and rosterStatus.js shows it as Holiday. The ERP job only stamps
 * rows whose HOLIDAY_FK IS NULL, so it never overwrites ours either.
 *
 * Rules:
 *   - Branches are the employee's CURRENT branch (HR_EMP_MASTER.UNIT_ID +
 *     LOCATION) — what HR sees everywhere — not DUTY_ROSTER.BRNCH, which can
 *     be stale after a transfer.
 *   - A day of approved leave, or a day already carrying another holiday, is
 *     never touched.
 *   - LMS_HOLIDAY_SEQ starts at 900001 so our HOLIDAY_FK values can never be
 *     mistaken for an ERP HOLIDAYS.HOLIDAY_PK.
 *   - Roster days are generated ~60 days ahead, so a holiday further out is
 *     stamped later by applyAllHolidays(), which runs after every roster build
 *     and on the roster-defaults schedule.
 */

import { getDirectConnection } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { branchNameSql } from '../utils/branchName.js';

const OUT_ARRAY = 4001; // oracledb.OUT_FORMAT_ARRAY

const norm = (v) => String(v ?? '').trim();
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

/** Longest holiday allowed in one entry — a guard against a mistyped year. */
const MAX_HOLIDAY_DAYS = 31;
const REASON_MAX = 100; // DUTY_ROSTER.STATUS is VARCHAR2(100)

let tablesReady = false;

const ensureHolidayTables = async (connection) => {
  if (tablesReady) return;
  const ddl = [
    `CREATE TABLE LMS_HOLIDAY (
        HOLIDAY_ID    NUMBER PRIMARY KEY,
        COMPC         NUMBER NOT NULL,
        HOLIDAY_FROM  DATE NOT NULL,
        HOLIDAY_TO    DATE NOT NULL,
        REASON        VARCHAR2(100) NOT NULL,
        CREATED_BY    VARCHAR2(50),
        CREATED_AT    DATE DEFAULT SYSDATE,
        UPDATED_BY    VARCHAR2(50),
        UPDATED_AT    DATE
     )`,
    `CREATE TABLE LMS_HOLIDAY_BRANCH (
        HOLIDAY_ID  NUMBER NOT NULL REFERENCES LMS_HOLIDAY (HOLIDAY_ID) ON DELETE CASCADE,
        BRNCH       VARCHAR2(20) NOT NULL,
        PRIMARY KEY (HOLIDAY_ID, BRNCH)
     )`,
    `CREATE SEQUENCE LMS_HOLIDAY_SEQ START WITH 900001 NOCACHE`,
  ];
  for (const sql of ddl) {
    try {
      await connection.execute(sql);
      logger.info(`[HOLIDAY] ${sql.trim().split('\n')[0].replace(/\($/, '').trim()}`);
    } catch (e) {
      // ORA-00955: already exists.
      if (!String(e.message).includes('ORA-00955')) throw e;
    }
  }
  tablesReady = true;
};

/** Roster days of the holiday's branches, keyed off the employee's current branch. */
const HOLIDAY_DAYS_WHERE = `
      TRUNC(d.ROSTER_DATE) BETWEEN TO_DATE(:hfrom, 'YYYY-MM-DD') AND TO_DATE(:hto, 'YYYY-MM-DD')
  AND d.CARD_NO IN (
        SELECT e.CARD_NO
          FROM EMPLOYEE e
          JOIN HR_EMP_MASTER h ON h.EMPCODE = e.EMPCODE
         WHERE TO_CHAR(h.UNIT_ID) = TO_CHAR(:compc)
           AND TRIM(h.LOCATION) IN (SELECT b.BRNCH FROM LMS_HOLIDAY_BRANCH b WHERE b.HOLIDAY_ID = :id))`;

/**
 * Put one holiday on the roster (`from`/`to` as 'YYYY-MM-DD'). Returns the number of days stamped (including
 * days that already carried it, so the figure is "days on this holiday").
 */
const stampHoliday = async (connection, h) => {
  const binds = { id: h.id, compc: h.compc, hfrom: h.from, hto: h.to, reason: h.reason };
  const r = await connection.execute(
    `UPDATE DUTY_ROSTER d
        SET d.HOLIDAY_FK = :id,
            d.STATUS = :reason,
            d.ROSTER_REMARKS = :reason,
            d.ABSENT_DAYS = NULL
      WHERE ${HOLIDAY_DAYS_WHERE}
        AND d.LEAVE_TYPE_FK IS NULL
        AND (d.HOLIDAY_FK IS NULL OR d.HOLIDAY_FK = :id)`,
    binds,
  );
  return r.rowsAffected ?? 0;
};

/**
 * Take a holiday off the roster. The day goes back to a normal day; if it is in
 * the past with no punch, the ERP's hourly job marks it absent again as it
 * would any other day.
 */
const unstampHoliday = async (connection, id) => {
  const r = await connection.execute(
    `UPDATE DUTY_ROSTER
        SET HOLIDAY_FK = NULL,
            STATUS = NULL,
            ROSTER_REMARKS = CASE WHEN ROSTER_REMARKS = STATUS THEN NULL ELSE ROSTER_REMARKS END
      WHERE HOLIDAY_FK = :id`,
    { id },
  );
  return r.rowsAffected ?? 0;
};

const toDate = (s) => {
  const t = norm(s);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Branches of one company HR may give a holiday to, with active headcount. */
export const listHolidayBranchesData = async (compc, allowedBranches = []) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const r = await connection.execute(
      `SELECT TRIM(l.LCODE), l.DESCR,
              (SELECT COUNT(*) FROM HR_EMP_MASTER h
                WHERE h.STATUS = 'A'
                  AND TO_CHAR(h.UNIT_ID) = TO_CHAR(l.COMPC)
                  AND TRIM(h.LOCATION) = TRIM(l.LCODE)) AS EMPLOYEES
         FROM COM_LOCATION l
        WHERE TO_CHAR(l.COMPC) = TO_CHAR(:compc)
        ORDER BY LPAD(TRIM(l.LCODE), 6)`,
      { compc },
      { outFormat: OUT_ARRAY },
    );
    const allowed = new Set((allowedBranches || []).map(norm));
    return (r.rows ?? [])
      .map(([code, name, employees]) => ({ brnch: norm(code), name: norm(name), employees: Number(employees) || 0 }))
      .filter((b) => !allowed.size || allowed.has(b.brnch));
  } finally {
    await connection?.close();
  }
};

/** The company's holidays, newest first, with their branches and stamped days. */
export const listHolidaysData = async (compc) => {
  let connection;
  try {
    connection = await getDirectConnection();
    await ensureHolidayTables(connection);
    const r = await connection.execute(
      `SELECT h.HOLIDAY_ID, TO_CHAR(h.HOLIDAY_FROM, 'YYYY-MM-DD'), TO_CHAR(h.HOLIDAY_TO, 'YYYY-MM-DD'),
              h.REASON, h.CREATED_BY, TO_CHAR(h.CREATED_AT, 'YYYY-MM-DD HH24:MI'),
              (SELECT COUNT(*) FROM DUTY_ROSTER d WHERE d.HOLIDAY_FK = h.HOLIDAY_ID) AS STAMPED
         FROM LMS_HOLIDAY h
        WHERE TO_CHAR(h.COMPC) = TO_CHAR(:compc)
        ORDER BY h.HOLIDAY_FROM DESC, h.HOLIDAY_ID DESC`,
      { compc },
      { outFormat: OUT_ARRAY },
    );
    const b = await connection.execute(
      `SELECT b.HOLIDAY_ID, b.BRNCH, ${branchNameSql('b.BRNCH', 'h.COMPC')}
         FROM LMS_HOLIDAY_BRANCH b
         JOIN LMS_HOLIDAY h ON h.HOLIDAY_ID = b.HOLIDAY_ID
        WHERE TO_CHAR(h.COMPC) = TO_CHAR(:compc)
        ORDER BY LPAD(b.BRNCH, 6)`,
      { compc },
      { outFormat: OUT_ARRAY },
    );
    const branchesOf = new Map();
    for (const [id, brnch, name] of b.rows ?? []) {
      const list = branchesOf.get(id) ?? [];
      list.push({ brnch: norm(brnch), name: norm(name) || norm(brnch) });
      branchesOf.set(id, list);
    }
    return (r.rows ?? []).map(([id, from, to, reason, by, at, stamped]) => ({
      holiday_id: id,
      holiday_from: from,
      holiday_to: to,
      reason: norm(reason),
      created_by: norm(by),
      created_at: at,
      roster_days: Number(stamped) || 0,
      branches: branchesOf.get(id) ?? [],
    }));
  } finally {
    await connection?.close();
  }
};

/**
 * Create (no holiday_id) or change a holiday, and put it on the roster.
 * `allowedBranches` is the admin's branch rights; an empty list means all.
 */
export const saveHolidayData = async ({ holiday_id, compc, from, to, reason, branches, by, allowedBranches = [] }) => {
  const dFrom = toDate(from);
  const dTo = toDate(to || from);
  const why = norm(reason);
  const picked = [...new Set((branches || []).map(norm).filter(Boolean))];

  if (!dFrom || !dTo) return { status: 'error', message: 'A valid date is required' };
  if (dTo < dFrom) return { status: 'error', message: '"To" date cannot be before "From" date' };
  const days = Math.round((dTo - dFrom) / 86400000) + 1;
  if (days > MAX_HOLIDAY_DAYS) return { status: 'error', message: `A holiday can be at most ${MAX_HOLIDAY_DAYS} days` };
  if (!why) return { status: 'error', message: 'Reason is required (e.g. "Iqbal Day")' };
  if (why.length > REASON_MAX) return { status: 'error', message: `Reason must be at most ${REASON_MAX} characters` };
  if (!picked.length) return { status: 'error', message: 'Select at least one branch' };

  const allowed = new Set((allowedBranches || []).map(norm));
  const forbidden = picked.filter((b) => allowed.size && !allowed.has(b));
  if (forbidden.length) return { status: 'error', message: `You have no rights on branch ${forbidden.join(', ')}` };

  let connection;
  try {
    connection = await getDirectConnection();
    await ensureHolidayTables(connection);

    // Every branch must exist under this company.
    const known = await connection.execute(
      `SELECT TRIM(LCODE) FROM COM_LOCATION WHERE TO_CHAR(COMPC) = TO_CHAR(:compc)`,
      { compc }, { outFormat: OUT_ARRAY },
    );
    const knownSet = new Set((known.rows ?? []).map(([c]) => norm(c)));
    const unknown = picked.filter((b) => !knownSet.has(b));
    if (unknown.length) return { status: 'error', message: `Branch ${unknown.join(', ')} is not a branch of this company` };

    let id = holiday_id ? Number(holiday_id) : null;
    const fromStr = norm(from);
    const toStr = norm(to) || fromStr;
    const binds = { compc, hfrom: fromStr, hto: toStr, reason: why, by: norm(by).slice(0, 50) };
    if (id) {
      const upd = await connection.execute(
        `UPDATE LMS_HOLIDAY
            SET HOLIDAY_FROM = TO_DATE(:hfrom, 'YYYY-MM-DD'), HOLIDAY_TO = TO_DATE(:hto, 'YYYY-MM-DD'), REASON = :reason,
                UPDATED_BY = :by, UPDATED_AT = SYSDATE
          WHERE HOLIDAY_ID = :id AND TO_CHAR(COMPC) = TO_CHAR(:compc)`,
        { ...binds, id },
      );
      if (!upd.rowsAffected) return { status: 'error', message: 'Holiday not found' };
      // Dates or branches may have changed: clear the old days, then restamp.
      await unstampHoliday(connection, id);
      await connection.execute(`DELETE FROM LMS_HOLIDAY_BRANCH WHERE HOLIDAY_ID = :id`, { id });
    } else {
      const s = await connection.execute(`SELECT LMS_HOLIDAY_SEQ.NEXTVAL FROM DUAL`, {}, { outFormat: OUT_ARRAY });
      id = Number(s.rows[0][0]);
      await connection.execute(
        `INSERT INTO LMS_HOLIDAY (HOLIDAY_ID, COMPC, HOLIDAY_FROM, HOLIDAY_TO, REASON, CREATED_BY)
         VALUES (:id, :compc, TO_DATE(:hfrom, 'YYYY-MM-DD'), TO_DATE(:hto, 'YYYY-MM-DD'), :reason, :by)`,
        { ...binds, id },
      );
    }
    for (const brnch of picked) {
      await connection.execute(
        `INSERT INTO LMS_HOLIDAY_BRANCH (HOLIDAY_ID, BRNCH) VALUES (:id, :brnch)`,
        { id, brnch },
      );
    }
    const stamped = await stampHoliday(connection, { id, compc, from: fromStr, to: toStr, reason: why });
    await connection.commit();

    return {
      status: 'success',
      holiday_id: id,
      roster_days: stamped,
      message: stamped
        ? `Holiday saved: ${stamped} roster day(s) marked "${why}".`
        : `Holiday saved. No roster days exist yet for those dates; they will be marked as soon as the roster is generated.`,
    };
  } catch (e) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    logger.error(`[HOLIDAY] save failed: ${firstLine(e)}`);
    return { status: 'error', message: firstLine(e) };
  } finally {
    await connection?.close();
  }
};

/** Remove a holiday and give its days back as normal roster days. */
export const deleteHolidayData = async (holidayId, compc) => {
  let connection;
  try {
    connection = await getDirectConnection();
    await ensureHolidayTables(connection);
    const id = Number(holidayId);
    const own = await connection.execute(
      `SELECT COUNT(*) FROM LMS_HOLIDAY WHERE HOLIDAY_ID = :id AND TO_CHAR(COMPC) = TO_CHAR(:compc)`,
      { id, compc }, { outFormat: OUT_ARRAY },
    );
    if (!Number(own.rows?.[0]?.[0])) return { status: 'error', message: 'Holiday not found' };
    const cleared = await unstampHoliday(connection, id);
    await connection.execute(`DELETE FROM LMS_HOLIDAY WHERE HOLIDAY_ID = :id`, { id });
    await connection.commit();
    return { status: 'success', roster_days: cleared, message: `Holiday removed; ${cleared} roster day(s) are normal days again.` };
  } catch (e) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    logger.error(`[HOLIDAY] delete failed: ${firstLine(e)}`);
    return { status: 'error', message: firstLine(e) };
  } finally {
    await connection?.close();
  }
};

/**
 * Stamp every current and upcoming holiday again. Picks up roster days the ERP
 * generated since the holiday was saved, and employees who joined or moved
 * into one of its branches. Never throws.
 */
export const applyAllHolidays = async () => {
  let connection;
  try {
    connection = await getDirectConnection();
    await ensureHolidayTables(connection);
    const r = await connection.execute(
      `SELECT HOLIDAY_ID, COMPC, TO_CHAR(HOLIDAY_FROM, 'YYYY-MM-DD'), TO_CHAR(HOLIDAY_TO, 'YYYY-MM-DD'), REASON
         FROM LMS_HOLIDAY
        WHERE HOLIDAY_TO >= TRUNC(SYSDATE) - 7`,
      {}, { outFormat: OUT_ARRAY },
    );
    let total = 0;
    for (const [id, compc, from, to, reason] of r.rows ?? []) {
      total += await stampHoliday(connection, { id, compc, from, to, reason });
    }
    await connection.commit();
    if ((r.rows ?? []).length) logger.info(`[HOLIDAY] re-applied ${r.rows.length} holiday(s), ${total} roster day(s)`);
    return total;
  } catch (e) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    logger.error(`[HOLIDAY] re-apply failed: ${firstLine(e)}`);
    return 0;
  } finally {
    await connection?.close();
  }
};
