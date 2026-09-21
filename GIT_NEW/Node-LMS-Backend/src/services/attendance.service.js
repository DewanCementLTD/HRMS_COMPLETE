/**
 * Attendance service — smart check-in / check-out logic.
 *
 * Direct port of the FastAPI LMS-Backend (services/attendance_service.py +
 * repositories/attendance_repository.py). Reads and writes attendance ONLY via
 * ATTENDANCE_RECORDS — DUTY_ROSTER is ERP-owned and never touched here, so late/
 * overtime/absent/shift are reported as 0/empty (same as FastAPI).
 *
 * Smart logic (IN = earliest mark, OUT = latest mark):
 *   1. No record / no IN yet → CHECK IN  (sets ENTRY_TIME)
 *   2. Has an IN             → CHECK OUT (extends EXIT_TIME to this latest mark)
 */

import oracledb from 'oracledb';
import { getDirectConnection } from '../config/database.js';
import { cardInt } from '../utils/conversionHelpers.js';
import { saveAttendanceOriginPoint } from './location.service.js';
import { deriveRosterDay } from '../utils/rosterStatus.js';
import { isActiveStatus, LEFT_EMPLOYEE_MESSAGE } from '../utils/employeeStatus.js';

import { logger } from '../utils/logger.js';
const OBJ = { outFormat: oracledb.OUT_FORMAT_OBJECT };

// ---------------------------------------------------------------------------
// Small helpers (mirror _now_hhmm / _btrunc / _hhmm_to_min / _later_hhmm / ...)
// ---------------------------------------------------------------------------

/** Current time as HH:MI (24h) string, using app-server local time. */
const nowHHMM = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Today as YYYY-MM-DD in app-server local time — the same day boundary the
 *  attendance queries use (TRUNC(SYSDATE)), not UTC. */
const todayYmd = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Truncate a string so its UTF-8 encoding fits in maxBytes (Oracle VARCHAR2
 *  columns are sized in BYTES), dropping any trailing partial multibyte char. */
const btrunc = (s, maxBytes) => {
  if (s === null || s === undefined) return null;
  const buf = Buffer.from(String(s), 'utf-8').subarray(0, maxBytes);
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
};

/** Minutes-since-midnight for an "HH:MI" string, or null. */
const hhmmToMin = (s) => {
  try {
    const [h, m] = String(s).trim().slice(0, 5).split(':');
    const hi = parseInt(h, 10);
    const mi = parseInt(m, 10);
    if (Number.isNaN(hi) || Number.isNaN(mi)) return null;
    return hi * 60 + mi;
  } catch {
    return null;
  }
};

/** Return whichever of two "HH:MI" strings is the later time of day. */
const laterHHMM = (a, b) => {
  const ma = hhmmToMin(a);
  const mb = hhmmToMin(b);
  if (ma === null) return b;
  if (mb === null) return a;
  return ma >= mb ? a : b;
};

/** Minutes between two HH:MI strings. If exit is earlier than entry the shift
 *  crossed midnight (e.g. 20:00 -> 04:00), so add a full day. */
const timeSpentMinutes = (entry, exit_) => {
  const e = hhmmToMin(entry);
  const x = hhmmToMin(exit_);
  if (e === null || x === null) return 0;
  let diff = x - e;
  if (diff < 0) diff += 1440;
  return Math.max(diff, 0);
};

/** Normalise a raw TMS_DUTY_ROSTER_V row into the AttendanceRecord shape the
 *  frontend expects, adding cleaned times, a status label and boolean flags. */
const shapeRosterRow = (rec) => {
  if (rec.roster_date instanceof Date) {
    const y = rec.roster_date.getFullYear();
    const m = String(rec.roster_date.getMonth() + 1).padStart(2, '0');
    const d = String(rec.roster_date.getDate()).padStart(2, '0');
    rec.roster_date = `${y}-${m}-${d}`;
  }

  // Status and remarks come from the one shared derivation (utils/rosterStatus.js)
  // so this report, the HR attendance screen and the Reports pack cannot drift.
  const d = deriveRosterDay(rec);
  const worked = d.in_time && d.out_time ? timeSpentMinutes(d.in_time, d.out_time) : 0;

  rec.in_time = d.in_time;
  rec.out_time = d.out_time;
  rec.w_hrs = Math.floor(worked / 60);
  rec.w_mnt = worked % 60;
  rec.late_hrs = 0;
  rec.late_mnt = 0;
  rec.ot_hrs = 0;
  rec.ot_mnt = 0;
  rec.absent_days = d.is_absent ? 1 : 0;
  rec.half_day = (rec.morning_half_day ?? 0) + (rec.ear_out_half_day ?? 0);
  rec.morning_late = String(rec.morning_late ?? '').trim() || null;
  rec.early_out_late = String(rec.early_out_late ?? '').trim() || null;

  rec.status = d.status;
  rec.status_flags = d.flags;
  rec.is_late = d.is_late;
  rec.is_absent = d.is_absent;
  rec.is_half_day = d.is_half_day;
  rec.is_morning_late = d.is_morning_late;
  rec.is_morning_half_day = d.is_morning_half_day;
  rec.is_leave = d.is_leave;
  rec.is_holiday = d.is_holiday;
  rec.is_rest = d.is_rest;
  rec.leave_type = d.leave_type;
  rec.leave_desc = d.leave_desc;
  rec.roster_remarks = d.roster_remarks;
  rec.leave_remarks = d.leave_remarks;
  rec.remarks = d.remarks;

  delete rec.morning_half_day;
  delete rec.ear_out_half_day;
  return rec;
};

const ROSTER_SELECT = `
    TRUNC(ROSTER_DATE)      AS "roster_date",
    DAY_NAME                AS "day_name",
    ROSTER_SHIFT            AS "roster_shift",
    HOLIDAY_FK              AS "holiday_fk",
    ROSTER_MONTH            AS "roster_month",
    IN_TIME                 AS "in_time",
    OUT_TIME                AS "out_time",
    ABSENT                  AS "absent",
    MORNING_LATE            AS "morning_late",
    EARLY_OUT_LATE          AS "early_out_late",
    MORNING_HALF_DAY        AS "morning_half_day",
    EAR_OUT_HALF_DAY        AS "ear_out_half_day",
    LEAVE_REMARKS           AS "leave_remarks",
    ROSTER_REMARKS          AS "roster_remarks",
    LEAVE_TYPE_FK           AS "leave_type_fk",
    LEAVE_APPLICATION_FK    AS "leave_application_fk",
    LEAVE_DAYS              AS "leave_days",
    (SELECT MIN(t.LEAVE_TYPE) FROM LEAVE_TYPES t
      WHERE t.LEAVE_TYPE_PK = TMS_DUTY_ROSTER_V.LEAVE_TYPE_FK) AS "leave_type",
    (SELECT MIN(t.LEAVE_DESC) FROM LEAVE_TYPES t
      WHERE t.LEAVE_TYPE_PK = TMS_DUTY_ROSTER_V.LEAVE_TYPE_FK) AS "leave_desc"
`;

// Transient DB errors that should be retried rather than dropped: MAX(PK)+1 id
// races (unique-violation) on concurrent check-ins, plus deadlock/serialization.
const TRANSIENT_DB_ERRORS = ['ORA-00001', 'ORA-00060', 'ORA-08177'];

const isTransientDbError = (err) => {
  const msg = String(err?.message ?? err);
  return TRANSIENT_DB_ERRORS.some((code) => msg.includes(code));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run fn(); on a transient DB error retry a few times with a small backoff.
 *  Re-throws on the last try or on a non-transient error. */
const runWithRetry = async (fn, attempts = 5, what = '') => {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransientDbError(e) || i === attempts - 1) throw e;
      logger.info(
        `[ATTENDANCE] transient error${what ? ' on ' + what : ''}, retry ${i + 1}/${attempts}: ${e.message ?? e}`,
      );
      await sleep(50 * (i + 1));
    }
  }
};

// ---------------------------------------------------------------------------
// DB layer (mirror attendance_repository.py)
// ---------------------------------------------------------------------------

/** Today's ATTENDANCE_RECORDS row for this card, or null. */
const getTodayRecord = async (card_no) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `
      SELECT ID              AS "id",
             ENTRY_TIME       AS "entry_time",
             EXIT_TIME        AS "exit_time",
             TO_CHAR(CARD_NO) AS "card_no"
      FROM ATTENDANCE_RECORDS
      WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
        AND TRUNC(ATTENDANCE_DATE) = TRUNC(SYSDATE)
      ORDER BY ID DESC
      `,
      { card: card_no, card_int: cardInt(card_no) },
      OBJ,
    );
    const row = result.rows?.[0];
    if (!row) return null;
    return {
      id: row.id,
      entry_time: (row.entry_time ?? '').trim(),
      exit_time: (row.exit_time ?? '').trim(),
      card_no: row.card_no ?? card_no,
      source: 'attendance_records',
    };
  } finally {
    await connection?.close();
  }
};

/** Look up EMPCODE for a CARD_NO from EMPLOYEE, falling back to the card itself. */
const getEmpcode = async (card_no) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `SELECT EMPCODE AS "empcode" FROM EMPLOYEE
       WHERE TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int`,
      { card: card_no, card_int: cardInt(card_no) },
      OBJ,
    );
    const row = result.rows?.[0];
    return row ? row.empcode : card_no;
  } finally {
    await connection?.close();
  }
};

/**
 * Does this card belong to a real employee, and do they still work here?
 *
 * Returns { found, active }. Employment status lives on HR_EMP_MASTER, so this
 * reaches across from EMPLOYEE — a card with no master row is treated as active
 * rather than locked out, since the missing row is a data gap, not a departure.
 */
const employeeMarkability = async (card_no) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `SELECT h.STATUS AS "status", h.NAME AS "name"
         FROM EMPLOYEE e
         LEFT JOIN HR_EMP_MASTER h ON h.EMPCODE = e.EMPCODE
        WHERE TO_CHAR(e.CARD_NO) = :card OR TO_CHAR(e.CARD_NO) = :card_int
        FETCH FIRST 1 ROWS ONLY`,
      { card: String(card_no), card_int: cardInt(card_no) },
      OBJ,
    );
    const row = result.rows?.[0];
    if (!row) return { found: false, active: false };
    return { found: true, active: isActiveStatus(row.status), name: row.name };
  } catch (e) {
    // A lookup that could not run is not proof of anything; let the mark
    // proceed and be judged by whether the row actually persists.
    logger.info(`[ATTENDANCE] employee status check failed for ${card_no}: ${e.message ?? e}`);
    return { found: true, active: true };
  } finally {
    await connection?.close();
  }
};

/**
 * Upsert today's ATTENDANCE_RECORDS row (the app's only attendance store).
 * MERGE prevents duplicate rows for the same card/day and keeps the EARLIEST
 * mark as ENTRY_TIME.
 *
 * A MERGE failure is fatal to the mark. It used to be logged and swallowed, and
 * the caller was told "Checked in successfully" — but the app is online-only:
 * it queues nothing and keeps no local pending record, so a success it cannot
 * back up with a stored row is a punch that silently never happened. The ORA
 * text stays in the log; the employee gets a sentence they can act on.
 */
const insertCheckIn = async (card_no, empcode, opts = {}) => {
  const {
    latitude = null,
    longitude = null,
    accuracy = null,
    address = null,
    formatted_address = null,
    timestamp = null,
    device_id = null,
    device_model = null,
    app_version = null,
    attendance_type = 'check_in',
  } = opts;

  let connection;
  try {
    connection = await getDirectConnection();
    const now = nowHHMM();

    const params = {
      empcode,
      card_no,
      entry_time: now,
      att_type: attendance_type,
      latitude: latitude ? String(latitude) : null,
      longitude: longitude ? String(longitude) : null,
      accuracy: accuracy ? String(accuracy) : null,
      address: address ? btrunc(address, 100) : null,
      formatted_address: formatted_address ? btrunc(formatted_address, 400) : null,
      ts: timestamp ? btrunc(timestamp, 400) : null,
      device_id: device_id ? btrunc(device_id, 400) : null,
      device_model: device_model ? btrunc(device_model, 400) : null,
      app_version: app_version ? btrunc(app_version, 400) : null,
    };

    try {
      await runWithRetry(
        () =>
          connection.execute(
            `
            MERGE INTO ATTENDANCE_RECORDS ar
            USING (SELECT :card_no AS cno, TRUNC(SYSDATE) AS adate FROM DUAL) src
            ON (ar.CARD_NO = src.cno
                AND TRUNC(ar.ATTENDANCE_DATE) = src.adate
                AND ar.EXIT_TIME IS NULL)
            WHEN MATCHED THEN
                UPDATE SET ar.ENTRY_TIME        = CASE
                               WHEN ar.ENTRY_TIME IS NULL THEN :entry_time
                               WHEN :entry_time < ar.ENTRY_TIME THEN :entry_time
                               ELSE ar.ENTRY_TIME END,
                           ar.ATTENDANCE_TYPE   = :att_type,
                           ar.LATITUDE          = :latitude,
                           ar.LONGITUDE         = :longitude,
                           ar.ACCURACY          = :accuracy,
                           ar.ADDRESS           = :address,
                           ar.FORMATTED_ADDRESS = :formatted_address,
                           ar.TIMESTAMP         = :ts,
                           ar.DEVICE_ID         = :device_id,
                           ar.DEVICE_MODEL      = :device_model,
                           ar.APP_VERSION       = :app_version
            WHEN NOT MATCHED THEN
                INSERT (EMPCODE, CARD_NO, ENTRY_TIME,
                        ATTENDANCE_DATE, ATTENDANCE_TYPE,
                        LATITUDE, LONGITUDE, ACCURACY,
                        ADDRESS, FORMATTED_ADDRESS,
                        TIMESTAMP, DEVICE_ID, DEVICE_MODEL,
                        APP_VERSION)
                VALUES (
                    :empcode, :card_no, :entry_time,
                    TRUNC(SYSDATE), :att_type,
                    :latitude, :longitude, :accuracy,
                    :address, :formatted_address,
                    :ts, :device_id, :device_model,
                    :app_version
                )
            `,
            params,
            { autoCommit: false },
          ),
        5,
        'ATTENDANCE_RECORDS',
      );
    } catch (arErr) {
      logger.error(
        `[ATTENDANCE_RECORDS] MERGE failed for card=${card_no}: ${arErr.message ?? arErr}`,
      );
      try {
        await connection.rollback();
      } catch {
        /* ignore */
      }
      return {
        status: 'error',
        message: 'Attendance could not be saved in HRMS. Please try again or contact HR.',
      };
    }

    await connection.commit();

    // LOCATION_TRACKS — record the marking location as the day's first track
    // point. Best-effort: any failure here must not affect the attendance result.
    if (latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined) {
      try {
        await saveAttendanceOriginPoint(card_no, latitude, longitude, accuracy);
      } catch (locErr) {
        logger.info(`[CHECK_IN] LOCATION_TRACKS origin point failed (non-fatal): ${locErr.message ?? locErr}`);
      }
    }

    return {
      status: 'success',
      message: 'Checked in successfully',
      action: 'check_in',
      marked_at: now,
      location_verified: latitude !== null && latitude !== undefined,
    };
  } catch (e) {
    try {
      await connection?.rollback();
    } catch {
      /* ignore */
    }
    logger.info(`[CHECK_IN] Fatal error for card=${card_no}: ${e.message ?? e}`);
    return { status: 'error', message: String(e.message ?? e) };
  } finally {
    await connection?.close();
  }
};

/**
 * Extend today's row's EXIT_TIME to the LATEST mark; ENTRY_TIME stays earliest.
 * The check-out location is stored in the dedicated CHECKOUT_* columns, only
 * overwritten when the latest mark actually carries a location.
 */
const updateCheckOut = async (recordId, entryTime, opts = {}) => {
  const {
    current_out = null,
    checkout_lat = null,
    checkout_long = null,
    checkout_address = null,
  } = opts;

  let connection;
  try {
    connection = await getDirectConnection();
    const now = nowHHMM();
    const outTime = laterHHMM(now, current_out);
    const spent = timeSpentMinutes(entryTime, outTime);

    const params = { exit_time: outTime, time_spent: spent, rid: recordId };
    let locSet = '';
    if (checkout_lat !== null || checkout_long !== null || checkout_address !== null) {
      params.co_lat = checkout_lat !== null && checkout_lat !== undefined ? String(checkout_lat) : null;
      params.co_long = checkout_long !== null && checkout_long !== undefined ? String(checkout_long) : null;
      params.co_addr = checkout_address ? btrunc(checkout_address, 400) : null;
      locSet =
        ',\n                CHECKOUT_LATS    = :co_lat,' +
        '\n                CHECKOUT_LONGS   = :co_long,' +
        '\n                CHECKOUT_ADDRESS = :co_addr';
    }

    await runWithRetry(
      () =>
        connection.execute(
          `
          UPDATE ATTENDANCE_RECORDS
          SET EXIT_TIME  = :exit_time,
              EXIT_DATE  = SYSDATE,
              TIME_SPENT = :time_spent${locSet}
          WHERE ID = :rid
          `,
          params,
          { autoCommit: false },
        ),
      5,
      'ATTENDANCE_RECORDS checkout',
    );

    await connection.commit();
    return {
      status: 'success',
      message: `Checked out successfully (${spent} min)`,
      action: 'check_out',
      marked_at: outTime,
      time_spent: spent,
      location_verified: true,
    };
  } catch (e) {
    try {
      await connection?.rollback();
    } catch {
      /* ignore */
    }
    return { status: 'error', message: String(e.message ?? e) };
  } finally {
    await connection?.close();
  }
};

// ---------------------------------------------------------------------------
// Overnight shift detection (mirror get_open_overnight_record)
// ---------------------------------------------------------------------------

// Minimum minutes after check-in before a mark counts as check-out.
// Earlier marks are treated as no-ops. Mirrors FastAPI's MIN_CHECKOUT_GAP_MIN.
const MIN_CHECKOUT_GAP_MIN = 60;

/** For a NIGHT-shift worker, return a still-open check-in from a PRIOR day
 *  that the current (after-midnight) mark should close, or null. */
const getOpenOvernightRecord = async (card_no) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `SELECT ID, ENTRY_TIME, TO_CHAR(CARD_NO) AS CARD_NO, EMPCODE,
              TO_CHAR(ATTENDANCE_DATE, 'YYYY-MM-DD') AS RDATE,
              (SYSDATE - (TRUNC(ATTENDANCE_DATE)
                          + TO_NUMBER(SUBSTR(ENTRY_TIME,1,2))/24
                          + TO_NUMBER(SUBSTR(ENTRY_TIME,4,2))/1440)) * 24 AS HRS_SINCE_IN
       FROM ATTENDANCE_RECORDS
       WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
         AND ENTRY_TIME IS NOT NULL AND EXIT_TIME IS NULL
         AND TRUNC(ATTENDANCE_DATE) < TRUNC(SYSDATE)
         AND REGEXP_LIKE(ENTRY_TIME, '^[0-9][0-9]:[0-9][0-9]$')
       ORDER BY ID DESC
       FETCH FIRST 1 ROWS ONLY`,
      { card: card_no, card_int: cardInt(card_no) },
      OBJ,
    );
    const row = result.rows?.[0];
    if (!row) return null;

    const hrs = row.HRS_SINCE_IN;
    if (hrs === null || hrs === undefined || hrs < 1 || hrs > 16) return null;

    // Check if the shift was overnight (time_to < time_from)
    const shiftResult = await connection.execute(
      `SELECT sh.TIME_FROM, sh.TIME_TO
       FROM SHIFT_HEAD sh
       WHERE sh.COMPC = (SELECT TO_NUMBER(MAX(UNIT_ID)) FROM HR_EMP_MASTER WHERE EMPCODE = :emp)
         AND sh.SHIFT = (
               SELECT MIN(ROSTER_SHIFT) FROM DUTY_ROSTER
                WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int
                       OR TO_CHAR(EMP_FK) = :card)
                  AND TRUNC(ROSTER_DATE) = TO_DATE(:rdate, 'YYYY-MM-DD'))
         AND ROWNUM = 1`,
      { emp: row.EMPCODE, card: card_no, card_int: cardInt(card_no), rdate: row.RDATE },
      OBJ,
    );
    const sh = shiftResult.rows?.[0];
    if (!sh) return null;

    const timeFrom = (sh.TIME_FROM ?? '').trim();
    const timeTo = (sh.TIME_TO ?? '').trim();
    if (!timeFrom || !timeTo || timeTo >= timeFrom) return null;

    return {
      id: row.ID,
      entry_time: (row.ENTRY_TIME ?? '').trim(),
      exit_time: '',
      card_no: row.CARD_NO || card_no,
      source: 'attendance_records',
    };
  } catch (e) {
    logger.info(`[OVERNIGHT] lookup failed for card=${card_no}: ${e.message ?? e}`);
    return null;
  } finally {
    await connection?.close();
  }
};

// ---------------------------------------------------------------------------
// Smart attendance (mirror smart_mark_attendance)
// ---------------------------------------------------------------------------

/**
 * Did the ERP actually take this punch?
 *
 * ATTENDANCE_RECORDS is only the app's own store. What HR, the web panel and
 * every report read is DUTY_ROSTER, which the punch reaches through two ERP
 * triggers (MACHINEDATA -> IMPORT_DATA -> DUTY_ROSTER). Those triggers can
 * decline a punch — for a year they filed any check-in after the branch's
 * CHANGE_ST hour as a check-out — and nothing noticed, because the app only
 * ever checked its own table. 499 employee-days went missing that way before
 * anybody chased it.
 *
 * So every check-in now reads the roster back. This does not change what the
 * employee is told: their punch IS saved, and the mark stays a success. It
 * raises the alarm on the server, where it belongs, and hands the caller a flag
 * HR tooling can list.
 */
const verifyPostedToRoster = async (card_no, action) => {
  if (action !== 'check_in') return null;
  let connection;
  try {
    connection = await getDirectConnection();
    const r = await connection.execute(
      `SELECT IN_TIME AS "in_time", OUT_TIME AS "out_time"
         FROM DUTY_ROSTER
        WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
          AND TRUNC(ROSTER_DATE) = TRUNC(SYSDATE)
        FETCH FIRST 1 ROWS ONLY`,
      { card: String(card_no), card_int: cardInt(card_no) },
      OBJ,
    );
    const row = r.rows?.[0];
    // No roster row at all is a different (pre-existing) condition — the day
    // was never rostered — and not something this check should cry wolf about.
    if (!row) return null;
    if (String(row.in_time ?? '').trim()) return true;

    logger.error(
      `[ATTENDANCE_NOT_POSTED] card=${card_no} checked in but DUTY_ROSTER.IN_TIME is still empty` +
        `${String(row.out_time ?? '').trim() ? ` (the ERP filed it as an OUT at ${row.out_time})` : ''}` +
        ' — this day will read as ABSENT in HRMS until it is corrected',
    );
    return false;
  } catch (e) {
    logger.info(`[ATTENDANCE] roster verification failed for ${card_no}: ${e.message ?? e}`);
    return null;
  } finally {
    await connection?.close();
  }
};

const markAttendance = async (card_no, attendance_type = 'check_in', opts = {}) => {
  // A card nobody works under cannot be marked. Without this the punch reached
  // the MERGE, where an ERP trigger rejected it for having no company — and the
  // employee was still told they were checked in.
  const markability = await employeeMarkability(card_no);
  if (!markability.found) {
    logger.warn(`[ATTENDANCE] mark refused: no employee for card=${card_no}`);
    return {
      status: 'error',
      message: 'This card is not registered as an employee. Attendance not marked.',
    };
  }

  // Someone who has left keeps their history but stops accruing new attendance.
  // Nothing checked this before, and eight people who had already left punched
  // in the thirty days to 2026-09-15.
  if (!markability.active) {
    logger.warn(`[ATTENDANCE] mark refused: card=${card_no} is not an active employee`);
    return { status: 'error', message: LEFT_EMPLOYEE_MESSAGE };
  }

  const record = await getTodayRecord(card_no);
  const checkInOpts = {
    latitude: opts.latitude,
    longitude: opts.longitude,
    accuracy: opts.accuracy,
    address: opts.address,
    formatted_address: opts.formatted_address,
    timestamp: opts.timestamp,
    device_id: opts.device_id,
    device_model: opts.device_model,
    app_version: opts.app_version,
    attendance_type,
  };

  if (record === null) {
    // No record for today. Check for overnight shift closure first.
    const overnight = await getOpenOvernightRecord(card_no);
    if (overnight !== null) {
      logger.info(
        `[ATTENDANCE] card=${card_no} → overnight check-out, closing prior shift (in ${overnight.entry_time})`,
      );
      const coAddr = opts.formatted_address || opts.address || null;
      return updateCheckOut(overnight.id, overnight.entry_time, {
        current_out: null,
        checkout_lat: opts.latitude,
        checkout_long: opts.longitude,
        checkout_address: coAddr,
      });
    }

    logger.info(`[ATTENDANCE] card=${card_no} → no record today, checking in`);
    const empcode = await getEmpcode(card_no);
    return insertCheckIn(card_no, empcode, checkInOpts);
  }

  const entry = record.entry_time; // "" when ENTRY_TIME is NULL in DB
  const exit_ = record.exit_time; // "" when EXIT_TIME is NULL in DB

  if (entry) {
    // 60-minute double-tap guard: if no exit yet and < 60 min since check-in,
    // treat as a no-op (keep checked in) to prevent accidental checkouts.
    if (!exit_) {
      const minsSinceIn = timeSpentMinutes(entry, nowHHMM());
      if (minsSinceIn < MIN_CHECKOUT_GAP_MIN) {
        logger.info(
          `[ATTENDANCE] card=${card_no} → mark ${minsSinceIn}min after check-in (<${MIN_CHECKOUT_GAP_MIN}), keeping checked-in (no check-out yet)`,
        );
        return {
          status: 'success',
          action: 'noop',
          message: 'Already checked in',
          marked_at: entry,
          location_verified: opts.latitude !== null && opts.latitude !== undefined,
        };
      }
    }

    // Already has an IN → this (later) mark becomes/extends the check-out.
    logger.info(
      `[ATTENDANCE] card=${card_no} → has entry (${entry}, out=${exit_ || '-'}), updating check-out`,
    );
    const coAddr = opts.formatted_address || opts.address || null;
    return updateCheckOut(record.id, entry, {
      current_out: exit_ || null,
      checkout_lat: opts.latitude,
      checkout_long: opts.longitude,
      checkout_address: coAddr,
    });
  }

  // Row exists but ENTRY_TIME empty (pre-generated roster row, no clock-in yet).
  logger.info(`[ATTENDANCE] card=${card_no} → row exists but no ENTRY_TIME, checking in`);
  const empcode = await getEmpcode(card_no);
  return insertCheckIn(card_no, empcode, checkInOpts);
};

/**
 * What today looks like for one employee, and what the next tap would do.
 *
 * The app was deriving this from the month report (report-range for today ->
 * today), which answers "what does the roster say" — the wrong question after
 * the ERP started filing late check-ins as check-outs, and a heavy call for one
 * day. This answers "what has this person actually punched today", straight
 * from ATTENDANCE_RECORDS.
 *
 * `next_action` matters most: the 60-minute rule that decides whether the next
 * tap checks the employee out lives in this service, and the app should not
 * have to reimplement it to know whether to show a confirmation.
 */
export const getTodayAttendanceState = async (card_no) => {
  const record = await getTodayRecord(card_no);
  const now = nowHHMM();

  if (!record || !record.entry_time) {
    return {
      card_no: String(card_no),
      date: todayYmd(),
      state: 'NOT_MARKED',
      check_in_time: null,
      check_out_time: null,
      attendance_id: null,
      minutes_since_check_in: null,
      next_action: 'check_in',
      next_action_needs_confirmation: false,
      server_time: now,
    };
  }

  const checkedOut = Boolean(record.exit_time);
  const minsSinceIn = timeSpentMinutes(record.entry_time, now);

  // A tap before the gap has elapsed is a no-op, not a check-out — so the app
  // should not warn about ending the day when nothing would happen.
  const nextAction = minsSinceIn < MIN_CHECKOUT_GAP_MIN ? 'noop' : 'check_out';

  return {
    card_no: record.card_no ?? String(card_no),
    date: todayYmd(),
    state: checkedOut ? 'CHECKED_OUT' : 'CHECKED_IN',
    check_in_time: record.entry_time,
    check_out_time: record.exit_time || null,
    attendance_id: record.id != null ? String(record.id) : null,
    minutes_since_check_in: minsSinceIn,
    /** 'check_out' | 'noop' — what a tap right now would do. */
    next_action: nextAction,
    /** True when a tap would end the working day, so ask first. */
    next_action_needs_confirmation: nextAction === 'check_out',
    minutes_until_check_out_allowed:
      nextAction === 'noop' ? Math.max(MIN_CHECKOUT_GAP_MIN - minsSinceIn, 0) : 0,
    server_time: now,
  };
};

/**
 * Mark attendance, then confirm the ERP took it.
 *
 * The confirmation is deliberately outside the mark: it never changes the
 * outcome and never throws, so a punch that is saved stays saved even if the
 * check itself fails. `posted_to_erp` is true / false / null (not applicable or
 * not checkable) and is additive — a client that ignores it behaves as before.
 */
export const smartMarkAttendance = async (card_no, attendance_type = 'check_in', opts = {}) => {
  const result = await markAttendance(card_no, attendance_type, opts);
  if (result.status !== 'success') return result;

  try {
    result.posted_to_erp = await verifyPostedToRoster(card_no, result.action);
  } catch (e) {
    logger.info(`[ATTENDANCE] roster verification skipped for ${card_no}: ${e.message ?? e}`);
    result.posted_to_erp = null;
  }
  return result;
};

// ---------------------------------------------------------------------------
// Reports — sourced from TMS_DUTY_ROSTER_V (the ERP duty-roster view), mirror
// FastAPI's attendance_repository.py get_attendance_report / _range / _summary.
//
// The view carries the ERP's own per-person-per-day roster with the derived
// status flags the app cannot compute itself:
//   MORNING_LATE / EARLY_OUT_LATE = 'Y'  -> late      (shown yellow)
//   MORNING_HALF_DAY / EAR_OUT_HALF_DAY  -> half day  (shown orange)
//   ABSENT = 1 with no punch             -> absent    (shown red)
// CARD_NO in the view is the full company-qualified card (e.g. 100011.2).
// ---------------------------------------------------------------------------

/** Single-day roster row for a card. date_str: ORDS-style 'DD-MON-YYYY'. */
export const getAttendanceReport = async (card_no, date_str) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `
      SELECT ${ROSTER_SELECT}
      FROM TMS_DUTY_ROSTER_V
      WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
        AND TRUNC(ROSTER_DATE) = TO_DATE(:dt, 'DD-MON-YYYY')
      ORDER BY ROSTER_DATE
      `,
      { card: card_no, card_int: cardInt(card_no), dt: date_str },
      OBJ,
    );
    return (result.rows ?? []).map(shapeRosterRow);
  } catch (e) {
    if (String(e.message ?? e).includes('ORA-00942')) return [];
    throw e;
  } finally {
    await connection?.close();
  }
};

/** Fetch one employee's roster rows in a date range from TMS_DUTY_ROSTER_V.
 *  from_date/to_date: 'YYYY-MM-DD'. Each row carries the ERP late / half-day /
 *  absent flags so the report can colour late (yellow), half-day (orange) and
 *  absent (red). */
export const getAttendanceReportRange = async (card_no, from_date, to_date) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `
      SELECT ${ROSTER_SELECT}
      FROM TMS_DUTY_ROSTER_V
      WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
        AND TRUNC(ROSTER_DATE) BETWEEN
            TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
      ORDER BY ROSTER_DATE
      `,
      { card: card_no, card_int: cardInt(card_no), from_d: from_date, to_d: to_date },
      OBJ,
    );
    return (result.rows ?? []).map(shapeRosterRow);
  } catch (e) {
    if (String(e.message ?? e).includes('ORA-00942')) return [];
    throw e;
  } finally {
    await connection?.close();
  }
};

/** Aggregate one employee's roster over a date range from TMS_DUTY_ROSTER_V.
 *  Present = has a punch; Absent = flagged absent with no punch; Late / Half-Day
 *  are counted from the ERP flags. from_date / to_date: 'YYYY-MM-DD'. */
export const getAttendanceSummary = async (card_no, from_date, to_date) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const card_int = cardInt(card_no);
    const result = await connection.execute(
      `
      WITH r AS (
          SELECT
              CASE WHEN IN_TIME  IS NOT NULL AND TRIM(IN_TIME)  <> ':'
                   THEN 1 ELSE 0 END                          AS has_in,
              CASE WHEN OUT_TIME IS NOT NULL AND TRIM(OUT_TIME) <> ':'
                   THEN 1 ELSE 0 END                          AS has_out,
              NVL(ABSENT, 0)                                  AS absent,
              CASE WHEN UPPER(NVL(MORNING_LATE, ' ')) = 'Y'
                     OR UPPER(NVL(EARLY_OUT_LATE, ' ')) = 'Y'
                   THEN 1 ELSE 0 END                          AS is_late,
              CASE WHEN NVL(MORNING_HALF_DAY, 0) > 0
                     OR NVL(EAR_OUT_HALF_DAY, 0) > 0
                   THEN 1 ELSE 0 END                          AS is_half
          FROM TMS_DUTY_ROSTER_V
          WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
            AND TRUNC(ROSTER_DATE) BETWEEN
                TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
      )
      SELECT
          COUNT(*)                                                     AS "total_days",
          SUM(CASE WHEN has_in = 1 OR has_out = 1 THEN 1 ELSE 0 END)   AS "present",
          SUM(CASE WHEN has_in = 1 AND has_out = 0 THEN 1 ELSE 0 END)  AS "incomplete",
          0                                                            AS "total_minutes",
          0                                                            AS "late_minutes",
          0                                                            AS "overtime_minutes",
          SUM(CASE WHEN absent = 1 AND has_in = 0 AND has_out = 0
                   THEN 1 ELSE 0 END)                                  AS "absent_days",
          SUM(is_late)                                                 AS "late_days",
          SUM(is_half)                                                 AS "half_days"
      FROM r
      `,
      { card: card_no, card_int, from_d: from_date, to_d: to_date },
      OBJ,
    );
    return result.rows?.[0] ?? {};
  } catch (e) {
    if (String(e.message ?? e).includes('ORA-00942')) return {};
    throw e;
  } finally {
    await connection?.close();
  }
};

export const getRosterEmployeeName = async (card_no) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `
      SELECT UNIQUE h.NAME AS "emp_name"
      FROM TMS_DUTY_ROSTER_V d
      JOIN HR_EMP_MASTER h ON h.EMPCODE = d.EMP_FK
      WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
      `,
      { card: card_no, card_int: cardInt(card_no) },
      OBJ
    );
    return result.rows?.[0]?.emp_name ?? null;
  } catch (e) {
    logger.error({ err: e }, `[ROSTER] Error fetching employee name for ${card_no}`);
    return null;
  } finally {
    await connection?.close();
  }
};

export const getPdfEmployeeDetails = async (card_no) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const sql = `
      SELECT
        h.NAME                                     AS "emp_name",
        h.EMPCODE                                  AS "empcode",
        d.DEPT_NAME                                AS "department",
        dg.DESG_DESC                               AS "designation",
        e.STATUS                                   AS "status",
        h."MOBILE#"                                AS "mobile_no",
        ci.DESCR                                   AS "comp_name",
        ci.IMG                                     AS "comp_img"
      FROM HR_EMP_MASTER h
      LEFT JOIN EMPLOYEE     e  ON e.EMPCODE   = h.EMPCODE
      LEFT JOIN HR_DEPT      d  ON d.DEPT_NO   = h.DEPT_NO  AND TO_CHAR(d.COMPC) = TO_CHAR(h.UNIT_ID)
      LEFT JOIN HR_DESG      dg ON dg.DESG_CD  = h.DESG_CD  AND TO_CHAR(dg.COMPC) = TO_CHAR(h.UNIT_ID)
      LEFT JOIN COMPANY_INFO ci ON ci.COMPC    = h.UNIT_ID
      WHERE TO_CHAR(e.CARD_NO) = :card_no
         OR h."ATDTCARD#"      = :card_no
         OR h.EMPCODE          = :card_no
      FETCH FIRST 1 ROWS ONLY
    `;
    const result = await connection.execute(sql, { card_no }, OBJ);
    return result.rows?.[0] ?? null;
  } catch (e) {
    logger.error({ err: e }, `[ROSTER] Error fetching employee details for ${card_no}`);
    return null;
  } finally {
    await connection?.close();
  }
};


