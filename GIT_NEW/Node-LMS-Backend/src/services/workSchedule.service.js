/**
 * Employee work schedule — the roster the mobile app shows on the profile
 * screen, and the source of the clock times a half-day leave is booked against.
 *
 * HRMS keeps this in two places, and neither alone is enough:
 *   DUTY_ROSTER  — one row per employee per day, carrying the shift CODE for
 *                  that day ('R' = REST) and, on a small minority of rows,
 *                  per-day SHIFT_START_TIME / SHIFT_END_TIME overrides.
 *   SHIFT_HEAD   — the configured window for a shift code within a company and
 *                  branch: TIME_FROM / TIME_TO, LATE_START_TM (the moment a
 *                  punch counts as late — the grace period is the gap between
 *                  the two) and HALF_DAY_TM (where HRMS itself splits a day).
 *
 * The roster is read over a window around today rather than for a single date,
 * because a weekly off is a pattern, not a property of one row: a day is a
 * weekly off when it is REST on at least half of its occurrences in the window,
 * which keeps a one-off rest day out of the answer.
 */

import { getDirectConnection } from '../config/database.js';
import { logger } from '../utils/logger.js';

const OUT_OBJECT = 4002;

/** Days of roster history / future read to infer the weekly pattern. */
const WINDOW_DAYS_BACK = 56;
const WINDOW_DAYS_FORWARD = 14;

/** A day counts as a weekly off when it is REST at least this often. */
const REST_RATIO = 0.5;

/** Used only where the roster says nothing at all — never to replace it. */
const DEFAULT_SCHEDULE = {
  shift_start_time: '09:30',
  shift_end_time: '18:00',
  grace_minutes: 0,
};

const cardIntStr = (cardNo) => {
  const s = String(cardNo ?? '').trim();
  return s.includes('.') ? s.split('.')[0] : s;
};

/** 'HH:mm' (or 'HH:mm:ss') -> minutes since midnight, or null. */
export const hhmmToMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
};

/** Minutes since midnight -> 'HH:mm' (wraps past midnight for night shifts). */
export const minutesToHhmm = (mins) => {
  if (mins === null || mins === undefined || !Number.isFinite(mins)) return null;
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Normalise a stored time to 'HH:mm', dropping anything unparseable. */
const normHhmm = (v) => minutesToHhmm(hhmmToMinutes(v));

/**
 * Company and branch for a card. EMPLOYEE is the identity table for attendance
 * and leave (its COMPC/BRNCH match SHIFT_HEAD's own columns); HR_EMP_MASTER's
 * UNIT_ID / LOCATION is the fallback for cards EMPLOYEE does not carry.
 */
const resolveScope = async (connection, cardNo) => {
  const binds = { card: String(cardNo), card_int: cardIntStr(cardNo) };
  try {
    const r = await connection.execute(
      `SELECT COMPC AS "compc", BRNCH AS "brnch", EMPCODE AS "empcode"
         FROM EMPLOYEE
        WHERE TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int
        FETCH FIRST 1 ROWS ONLY`,
      binds,
      { outFormat: OUT_OBJECT },
    );
    if (r.rows?.[0]) return r.rows[0];
  } catch (e) {
    logger.info(`[SCHEDULE] EMPLOYEE scope lookup failed for ${cardNo}: ${e.message ?? e}`);
  }

  try {
    const r = await connection.execute(
      `SELECT UNIT_ID AS "compc", LOCATION AS "brnch", EMPCODE AS "empcode", SHIFT AS "shift"
         FROM HR_EMP_MASTER
        WHERE EMPCODE = :card OR "ATDTCARD#" = :card
        FETCH FIRST 1 ROWS ONLY`,
      { card: String(cardNo) },
      { outFormat: OUT_OBJECT },
    );
    if (r.rows?.[0]) return r.rows[0];
  } catch (e) {
    logger.info(`[SCHEDULE] HR_EMP_MASTER scope lookup failed for ${cardNo}: ${e.message ?? e}`);
  }

  return {};
};

/**
 * Roster rows around today, one per day.
 *
 * TRUNC(d) - TRUNC(d,'IW') + 1 gives 1 = Monday … 7 = Sunday without depending
 * on the session's NLS territory, which TO_CHAR(date, 'D') does.
 */
const loadRosterWindow = async (connection, cardNo) => {
  try {
    const r = await connection.execute(
      `SELECT TRUNC(ROSTER_DATE) - TRUNC(ROSTER_DATE, 'IW') + 1 AS "iso_day",
              TRIM(ROSTER_SHIFT)                                AS "shift",
              SHIFT_START_TIME                                  AS "start_time",
              SHIFT_END_TIME                                    AS "end_time",
              HOLIDAY_FK                                        AS "holiday_fk",
              COMPC                                             AS "compc",
              BRNCH                                             AS "brnch"
         FROM DUTY_ROSTER
        WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
          AND ROSTER_DATE BETWEEN TRUNC(SYSDATE) - :back AND TRUNC(SYSDATE) + :fwd`,
      {
        card: String(cardNo),
        card_int: cardIntStr(cardNo),
        back: WINDOW_DAYS_BACK,
        fwd: WINDOW_DAYS_FORWARD,
      },
      { outFormat: OUT_OBJECT },
    );
    return r.rows ?? [];
  } catch (e) {
    logger.info(`[SCHEDULE] DUTY_ROSTER window read failed for ${cardNo}: ${e.message ?? e}`);
    return [];
  }
};

/**
 * The SHIFT_HEAD row for a shift code, narrowing from the employee's own
 * company+branch outwards: a branch may define its own window for 'G', and only
 * when it does not should the company-wide (then any) definition be used.
 */
const loadShiftHead = async (connection, shift, compc, brnch) => {
  if (!shift) return null;
  const hasCompc = compc !== null && compc !== undefined;
  const hasBrnch = brnch !== null && brnch !== undefined;

  const attempts = [
    {
      skip: !hasCompc || !hasBrnch,
      sql: `SELECT * FROM SHIFT_HEAD
             WHERE TRIM(SHIFT) = :s AND TO_CHAR(COMPC) = TO_CHAR(:c) AND TO_CHAR(BRNCH) = TO_CHAR(:b)
             ORDER BY SHIFT_HEAD_PK FETCH FIRST 1 ROWS ONLY`,
      binds: { s: shift, c: compc, b: brnch },
    },
    {
      skip: !hasCompc,
      sql: `SELECT * FROM SHIFT_HEAD
             WHERE TRIM(SHIFT) = :s AND TO_CHAR(COMPC) = TO_CHAR(:c)
             ORDER BY SHIFT_HEAD_PK FETCH FIRST 1 ROWS ONLY`,
      binds: { s: shift, c: compc },
    },
    {
      skip: false,
      sql: `SELECT * FROM SHIFT_HEAD
             WHERE TRIM(SHIFT) = :s
             ORDER BY SHIFT_HEAD_PK FETCH FIRST 1 ROWS ONLY`,
      binds: { s: shift },
    },
  ];

  for (const a of attempts) {
    if (a.skip) continue;
    try {
      const r = await connection.execute(a.sql, a.binds, { outFormat: OUT_OBJECT });
      const row = r.rows?.[0];
      if (row && (row.TIME_FROM || row.TIME_TO)) return row;
    } catch (e) {
      logger.info(`[SCHEDULE] SHIFT_HEAD lookup failed for shift=${shift}: ${e.message ?? e}`);
    }
  }
  return null;
};

/**
 * The employee's own roster, in the shape the mobile app reads.
 *
 * Returns null when the card matches no roster row and no shift definition at
 * all — the caller then omits the block rather than sending a made-up schedule.
 */
export const getWorkSchedule = async (cardNo, existingConnection = null) => {
  const connection = existingConnection ?? (await getDirectConnection());
  try {
    const scope = await resolveScope(connection, cardNo);
    const rows = await loadRosterWindow(connection, cardNo);

    // ---- Weekly offs: REST on at least half of that weekday's occurrences ----
    const total = new Map();
    const rest = new Map();
    const shiftCounts = new Map();

    for (const row of rows) {
      const iso = Number(row.iso_day);
      if (!Number.isFinite(iso) || iso < 1 || iso > 7) continue;
      const shift = String(row.shift ?? '').trim().toUpperCase();
      total.set(iso, (total.get(iso) ?? 0) + 1);
      // A public holiday is deliberately not counted as REST: it falls on one
      // calendar day, and counting it would turn a single Tuesday holiday into
      // "Tuesdays off" for an employee who works every Tuesday.
      if (shift === 'R') {
        rest.set(iso, (rest.get(iso) ?? 0) + 1);
      } else if (shift) {
        shiftCounts.set(shift, (shiftCounts.get(shift) ?? 0) + 1);
      }
    }

    const weeklyOffDays = [...total.keys()]
      .filter((iso) => (rest.get(iso) ?? 0) / total.get(iso) >= REST_RATIO)
      .sort((a, b) => a - b);

    // ---- Dominant shift code ----
    let dominantShift = null;
    let best = 0;
    for (const [code, n] of shiftCounts) {
      if (n > best) {
        best = n;
        dominantShift = code;
      }
    }
    if (!dominantShift && scope.shift) dominantShift = String(scope.shift).trim().toUpperCase();

    // ---- Times: a per-day roster override outranks the branch's window ----
    const rosterCompc = rows.find((r) => r.compc !== null && r.compc !== undefined)?.compc;
    const rosterBrnch = rows.find((r) => r.brnch !== null && r.brnch !== undefined)?.brnch;
    const compc = scope.compc ?? rosterCompc ?? null;
    const brnch = scope.brnch ?? rosterBrnch ?? null;

    const head = await loadShiftHead(connection, dominantShift, compc, brnch);

    const overrideRow = rows.find(
      (r) =>
        String(r.shift ?? '').trim().toUpperCase() === dominantShift &&
        (r.start_time || r.end_time),
    );

    const startTime = normHhmm(overrideRow?.start_time) ?? normHhmm(head?.TIME_FROM) ?? null;
    const endTime = normHhmm(overrideRow?.end_time) ?? normHhmm(head?.TIME_TO) ?? null;

    // ---- Grace: the gap between the shift start and the "late" threshold ----
    let graceMinutes = null;
    const startMins = hhmmToMinutes(startTime);
    const lateMins = hhmmToMinutes(head?.LATE_START_TM);
    if (startMins !== null && lateMins !== null) {
      const diff = lateMins - startMins;
      if (diff >= 0 && diff < 240) graceMinutes = diff;
    }

    if (!startTime && !endTime && !weeklyOffDays.length && !dominantShift) return null;

    return {
      shift: dominantShift,
      shift_start_time: startTime ?? DEFAULT_SCHEDULE.shift_start_time,
      shift_end_time: endTime ?? DEFAULT_SCHEDULE.shift_end_time,
      weekly_off_days: weeklyOffDays,
      grace_minutes: graceMinutes ?? DEFAULT_SCHEDULE.grace_minutes,
      // HRMS has no per-employee "flexible timing" setting; every employee is
      // held to a shift window, so this stays false until one is added.
      flexible_timing: false,
      /** HRMS's own half-day cut-off for this shift, when the branch sets one. */
      half_day_time: normHhmm(head?.HALF_DAY_TM),
      /**
       * True when the roster genuinely alternates shifts, which the flat
       * one-shift contract above cannot express. A stray day on another code —
       * a single night cover in two months — is not that, so this only trips
       * when the dominant shift covers less than 80% of the working days.
       */
      shift_varies_by_day: best > 0 && best / [...shiftCounts.values()].reduce((a, b) => a + b, 0) < 0.8,
    };
  } finally {
    if (!existingConnection) await connection?.close();
  }
};

/**
 * The clock window a half-day leave covers, for one employee's own shift.
 *
 * The two sessions meet at the midpoint of the employee's own shift: first half
 * = the morning session, second half = the afternoon one. SHIFT_HEAD.HALF_DAY_TM
 * is deliberately NOT the split — it is the hour after which an ARRIVAL is
 * docked as a half day (11:00 on an 08:00-17:00 shift), so splitting there
 * would book a "half" day of three hours against one of six.
 *
 * The app never sends clock times; it names a session, and this turns the
 * session into the times HRMS stores.
 */
export const getHalfDayWindow = async (cardNo, session, connection = null) => {
  const second = String(session ?? '').toLowerCase().startsWith('second');

  let schedule = null;
  try {
    schedule = await getWorkSchedule(cardNo, connection);
  } catch (e) {
    logger.info(`[SCHEDULE] half-day window fell back to defaults for ${cardNo}: ${e.message ?? e}`);
  }

  const startMins =
    hhmmToMinutes(schedule?.shift_start_time) ?? hhmmToMinutes(DEFAULT_SCHEDULE.shift_start_time);
  let endMins = hhmmToMinutes(schedule?.shift_end_time) ?? hhmmToMinutes(DEFAULT_SCHEDULE.shift_end_time);
  // A night shift ends the next calendar day; unwrap it so the midpoint is sane.
  if (endMins <= startMins) endMins += 1440;

  const splitMins = startMins + Math.round((endMins - startMins) / 2);

  const fromMins = second ? splitMins : startMins;
  const toMins = second ? endMins : splitMins;

  return {
    session: second ? 'second_half' : 'first_half',
    from_time: minutesToHhmm(fromMins),
    to_time: minutesToHhmm(toMins),
    hours: Math.round(((toMins - fromMins) / 60) * 100) / 100,
  };
};
