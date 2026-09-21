/**
 * Per-branch roster defaults, and applying them to the duty roster.
 *
 * Which shift a generated roster day gets is decided by the ERP's
 * INSERT_PK_ROSTER trigger, and it is hardcoded: Sunday is 'R', everything else
 * is 'G', for every company and branch alike. A site that runs nights has no
 * way to say so, short of editing every employee's every day by hand.
 *
 * This module is the answer to that. LMS_ROSTER_DEFAULT says what a branch
 * actually runs, and `applyRosterDefaults` reshapes roster days to match —
 * called automatically after the ERP generates new days, and on demand when HR
 * wants an existing date range changed.
 *
 * Two rules hold everywhere in here, and they are what make it safe to run
 * repeatedly:
 *
 *   1. A day HR has edited by hand is never touched. Both edit paths stamp
 *      DUTY_ROSTER.UPDATED, so `UPDATED IS NULL` identifies the days that are
 *      still just whatever the generator produced. 88 of the 50,311 future rows
 *      are hand-edited today; those stay exactly as they are.
 *
 *   2. Approved leave and public holidays are never overwritten. A day someone
 *      is on leave is not a day to reassign a shift to.
 */

import { getDirectConnection } from '../config/database.js';
import { logger } from '../utils/logger.js';

const OUT_OBJECT = 4002;

/** What the ERP trigger produces, and therefore what we fall back to. */
export const FALLBACK_SHIFT = 'G';
export const REST_SHIFT = 'R';
export const DEFAULT_REST_DAYS = '7'; // Sunday — identical to today's behaviour

/** '6,7' -> [6, 7]; anything unparseable -> Sunday, never an empty week. */
export const parseRestDays = (raw) => {
  const days = String(raw ?? '')
    .split(/[,\s]+/)
    .map((d) => Number(String(d).trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  const unique = [...new Set(days)].sort((a, b) => a - b);
  // Seven rest days would roster nobody to work at all; treat that as a
  // mistake rather than obediently emptying the schedule.
  return unique.length && unique.length < 7 ? unique : [7];
};

export const formatRestDays = (days) => parseRestDays(days).join(',');

/**
 * The configured defaults, one row per company/branch.
 * `compc`/`brnch` narrow the list; omit both for everything.
 */
export const listRosterDefaults = async (compc = null, brnch = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const params = {};
    let where = '';
    if (compc !== null && compc !== undefined && String(compc).trim() !== '') {
      where += ' AND TO_CHAR(d.COMPC) = TO_CHAR(:compc)';
      params.compc = String(compc).trim();
    }
    if (brnch !== null && brnch !== undefined && String(brnch).trim() !== '') {
      where += ' AND TO_CHAR(d.BRNCH) = TO_CHAR(:brnch)';
      params.brnch = String(brnch).trim();
    }

    const r = await connection.execute(
      `SELECT d.COMPC AS "compc", d.BRNCH AS "brnch",
              TRIM(d.DEFAULT_SHIFT) AS "default_shift",
              d.REST_DAYS AS "rest_days",
              d.UPDATED_BY AS "updated_by",
              TO_CHAR(d.UPDATED_AT, 'YYYY-MM-DD HH24:MI') AS "updated_at",
              (SELECT MIN(l.DESCR) FROM COM_LOCATION l WHERE TRIM(l.LCODE) = TRIM(TO_CHAR(d.BRNCH))) AS "branch_name",
              (SELECT MIN(sh.SHIFT_DESC) FROM SHIFT_HEAD sh
                WHERE sh.COMPC = d.COMPC AND sh.BRNCH = d.BRNCH
                  AND TRIM(sh.SHIFT) = TRIM(d.DEFAULT_SHIFT))                  AS "shift_desc"
         FROM LMS_ROSTER_DEFAULT d
        WHERE 1 = 1 ${where}
        ORDER BY d.COMPC, d.BRNCH`,
      params,
      { outFormat: OUT_OBJECT },
    );
    return (r.rows ?? []).map((row) => ({
      ...row,
      rest_days: parseRestDays(row.rest_days),
    }));
  } finally {
    await connection?.close();
  }
};

/** The default for one branch, or null when it has never been configured. */
export const getRosterDefault = async (connection, compc, brnch) => {
  try {
    const r = await connection.execute(
      `SELECT TRIM(DEFAULT_SHIFT) AS "default_shift", REST_DAYS AS "rest_days"
         FROM LMS_ROSTER_DEFAULT
        WHERE TO_CHAR(COMPC) = TO_CHAR(:c) AND TO_CHAR(BRNCH) = TO_CHAR(:b)`,
      { c: String(compc), b: String(brnch) },
      { outFormat: OUT_OBJECT },
    );
    const row = r.rows?.[0];
    if (!row) return null;
    return { default_shift: row.default_shift, rest_days: parseRestDays(row.rest_days) };
  } catch (e) {
    // A missing table means the migration has not been run: behave exactly as
    // before rather than failing a roster build over a configuration feature.
    logger.info(`[ROSTER_DEFAULT] lookup failed for ${compc}/${brnch}: ${e.message ?? e}`);
    return null;
  }
};

/**
 * Save a branch's default. The shift must be one the branch actually runs —
 * offering a shift with no SHIFT_HEAD row would leave the roster pointing at
 * timings that do not exist, which is how the late/half-day rules go blank.
 * 'R' is accepted because every branch has a rest day whether or not SHIFT_HEAD
 * spells it out.
 */
export const saveRosterDefault = async (compc, brnch, defaultShift, restDays, updatedBy = null) => {
  const shift = String(defaultShift ?? '').trim().toUpperCase().slice(0, 1);
  if (!shift) return { status: 'error', message: 'Pick a default shift' };
  if (shift === REST_SHIFT) {
    return { status: 'error', message: 'The rest day is set separately — pick a working shift here' };
  }
  if (compc === null || compc === undefined || String(compc).trim() === '') {
    return { status: 'error', message: 'Company is required' };
  }
  if (brnch === null || brnch === undefined || String(brnch).trim() === '') {
    return { status: 'error', message: 'Branch is required' };
  }

  let connection;
  try {
    connection = await getDirectConnection();

    const known = await connection.execute(
      `SELECT COUNT(*) AS "n" FROM SHIFT_HEAD
        WHERE TO_CHAR(COMPC) = TO_CHAR(:c) AND TO_CHAR(BRNCH) = TO_CHAR(:b) AND TRIM(SHIFT) = :s`,
      { c: String(compc), b: String(brnch), s: shift },
      { outFormat: OUT_OBJECT },
    );
    if (!Number(known.rows?.[0]?.n)) {
      return {
        status: 'error',
        message: `Shift ${shift} is not defined for this branch — add it under Setup → Shifts first`,
      };
    }

    await connection.execute(
      `MERGE INTO LMS_ROSTER_DEFAULT t
       USING (SELECT TO_NUMBER(:c) AS COMPC, TO_NUMBER(:b) AS BRNCH FROM DUAL) s
          ON (t.COMPC = s.COMPC AND t.BRNCH = s.BRNCH)
       WHEN MATCHED THEN UPDATE SET
            t.DEFAULT_SHIFT = :shift, t.REST_DAYS = :rest,
            t.UPDATED_BY = :usr, t.UPDATED_AT = SYSDATE
       WHEN NOT MATCHED THEN
            INSERT (COMPC, BRNCH, DEFAULT_SHIFT, REST_DAYS, UPDATED_BY, UPDATED_AT)
            VALUES (TO_NUMBER(:c), TO_NUMBER(:b), :shift, :rest, :usr, SYSDATE)`,
      {
        c: String(compc),
        b: String(brnch),
        shift,
        rest: formatRestDays(restDays ?? DEFAULT_REST_DAYS),
        usr: String(updatedBy ?? '').slice(0, 50) || null,
      },
      { autoCommit: true },
    );

    return { status: 'success', message: 'Default shift saved' };
  } catch (e) {
    logger.error({ err: e }, `[ROSTER_DEFAULT] save failed for ${compc}/${brnch}`);
    return { status: 'error', message: 'The default shift could not be saved. Please try again.' };
  } finally {
    await connection?.close();
  }
};

/**
 * Reshape roster days to a branch's default.
 *
 * @param compc, brnch   the branch to act on
 * @param fromDate/toDate  'YYYY-MM-DD' range (inclusive)
 * @param options.shift      override the configured default (the mass-change case)
 * @param options.restDays   override the configured rest days
 * @param options.untouchedOnly  true (default) leaves hand-edited days alone
 * @param options.updatedBy  stamped on rows this changes, when it is a
 *                           deliberate mass change rather than the automatic
 *                           post-generation pass
 */
export const applyRosterDefaults = async (
  compc, brnch, fromDate, toDate,
  { shift = null, restDays = null, untouchedOnly = true, updatedBy = null, connection: existing = null } = {},
) => {
  const connection = existing ?? (await getDirectConnection());
  try {
    let workingShift = String(shift ?? '').trim().toUpperCase().slice(0, 1) || null;
    let rest = restDays ? parseRestDays(restDays) : null;

    if (!workingShift || !rest) {
      const cfg = await getRosterDefault(connection, compc, brnch);
      if (!cfg) {
        // No configuration and no override: nothing to impose. The ERP's own
        // default stands, which is the behaviour every branch had before.
        return { status: 'skipped', reason: 'no default configured', working_days: 0, rest_days: 0 };
      }
      workingShift = workingShift ?? cfg.default_shift;
      rest = rest ?? cfg.rest_days;
    }

    const binds = {
      c: String(compc),
      b: String(brnch),
      from_d: fromDate,
      to_d: toDate,
      shift: workingShift,
    };
    // Rest days are bound one placeholder each — never interpolated — so the
    // list stays data.
    const restPlaceholders = rest.map((_, i) => `:rd${i}`).join(', ');
    rest.forEach((d, i) => { binds[`rd${i}`] = d; });

    const untouched = untouchedOnly ? 'AND UPDATED IS NULL' : '';
    const stamp = updatedBy ? ', UPDATED = :usr' : '';
    if (updatedBy) binds.usr = String(updatedBy).slice(0, 50);

    // Leave and holidays are never reassigned: the day is already spoken for.
    const PROTECTED = 'AND LEAVE_TYPE_FK IS NULL AND HOLIDAY_FK IS NULL';
    const ISO_DAY = "TRUNC(ROSTER_DATE) - TRUNC(ROSTER_DATE, 'IW') + 1";
    const SCOPE = `
       WHERE TO_CHAR(COMPC) = TO_CHAR(:c)
         AND TO_CHAR(BRNCH) = TO_CHAR(:b)
         AND TRUNC(ROSTER_DATE) BETWEEN TO_DATE(:from_d,'YYYY-MM-DD') AND TO_DATE(:to_d,'YYYY-MM-DD')
         ${PROTECTED} ${untouched}`;

    // Working days: everything that is not a configured rest day.
    const work = await connection.execute(
      `UPDATE DUTY_ROSTER SET ROSTER_SHIFT = :shift ${stamp}
        ${SCOPE}
          AND ${ISO_DAY} NOT IN (${restPlaceholders})
          AND TRIM(ROSTER_SHIFT) <> :shift`,
      binds,
      { autoCommit: false },
    );

    // Rest days: the configured weekdays become 'R'.
    const restBinds = { ...binds, shift: REST_SHIFT };
    const restRows = await connection.execute(
      `UPDATE DUTY_ROSTER SET ROSTER_SHIFT = :shift ${stamp}
        ${SCOPE}
          AND ${ISO_DAY} IN (${restPlaceholders})
          AND TRIM(ROSTER_SHIFT) <> :shift`,
      restBinds,
      { autoCommit: false },
    );

    if (!existing) await connection.commit();

    return {
      status: 'success',
      shift: workingShift,
      rest_days: rest,
      working_days: work.rowsAffected ?? 0,
      rest_days_set: restRows.rowsAffected ?? 0,
    };
  } catch (e) {
    if (!existing) {
      try { await connection.rollback(); } catch { /* ignore */ }
    }
    logger.error({ err: e }, `[ROSTER_DEFAULT] apply failed for ${compc}/${brnch}`);
    return { status: 'error', message: 'The roster could not be updated. Please try again.' };
  } finally {
    if (!existing) await connection?.close();
  }
};

/**
 * Apply every configured branch default across a date window.
 *
 * Runs after the ERP generates new roster days, so the days it just created
 * carry the branch's real shift instead of the hardcoded 'G'. Only ever touches
 * days nobody has edited, so running it repeatedly changes nothing new.
 */
export const applyAllRosterDefaults = async (fromDate, toDate) => {
  let connection;
  try {
    connection = await getDirectConnection();
    let configured;
    try {
      const r = await connection.execute(
        `SELECT COMPC AS "compc", BRNCH AS "brnch" FROM LMS_ROSTER_DEFAULT ORDER BY COMPC, BRNCH`,
        {},
        { outFormat: OUT_OBJECT },
      );
      configured = r.rows ?? [];
    } catch (e) {
      logger.info(`[ROSTER_DEFAULT] no defaults table yet, skipping: ${e.message ?? e}`);
      return { status: 'skipped', branches: 0 };
    }
    if (!configured.length) return { status: 'skipped', branches: 0 };

    let working = 0;
    let restSet = 0;
    for (const { compc, brnch } of configured) {
      const res = await applyRosterDefaults(compc, brnch, fromDate, toDate, { connection });
      if (res.status === 'success') {
        working += res.working_days;
        restSet += res.rest_days_set;
      }
    }
    await connection.commit();

    if (working || restSet) {
      logger.info(
        `[ROSTER_DEFAULT] applied branch defaults over ${fromDate}..${toDate}: ` +
          `${working} working day(s), ${restSet} rest day(s) across ${configured.length} branch(es)`,
      );
    }
    return { status: 'success', branches: configured.length, working_days: working, rest_days_set: restSet };
  } catch (e) {
    logger.error({ err: e }, '[ROSTER_DEFAULT] applying all defaults failed');
    return { status: 'error', message: String(e.message ?? e) };
  } finally {
    await connection?.close();
  }
};
