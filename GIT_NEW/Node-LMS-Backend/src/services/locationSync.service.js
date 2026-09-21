import oracledb from 'oracledb';

import { getDirectConnection } from '../config/database.js';
import { isActiveStatus } from '../utils/employeeStatus.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Offline location sync
//
// The phone now writes every GPS fix to SQLite first and uploads when it can,
// so an upload is a replay of history rather than a live event. Three things
// follow from that, and they drive everything below:
//
//   1. The same fix will arrive more than once. The phone retries whenever a
//      response is lost, and it cannot tell "the insert failed" from "the
//      insert worked and the reply went missing". CLIENT_EVENT_ID (the phone's
//      own UUID) plus a unique index makes the second arrival a no-op.
//
//   2. RECORDED_AT is when the PHONE saw the fix; SYNCED_AT is when this server
//      stored it. A point captured at 10:00 and uploaded at 14:30 keeps 10:00.
//      Overwriting RECORDED_AT would silently rewrite the trail to the moment
//      the employee happened to regain signal.
//
//   3. One bad point must not cost the batch. A phone that has been offline for
//      days may hold hundreds of points, and rejecting all of them because one
//      has a corrupt latitude would strand the rest forever — the phone would
//      retry the same batch and fail the same way. Each point is reported on
//      individually.
//
// LOCATION_TRACKS stays the single master table for trail points.
// ---------------------------------------------------------------------------

const OUT_OBJECT = 4002;
const OUT_ARRAY = 4001;

/** Numeric prefix of a dotted, company-qualified card ("100002.1" → "100002"). */
const cardInt = (cardNo) => {
  const s = String(cardNo ?? '').trim();
  return s.includes('.') ? s.split('.')[0] : s;
};

const pad2 = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Null Island and its neighbours.
 *
 * A phone with no fix sometimes reports exactly 0,0 rather than failing. That
 * is not a place any employee works, and letting it through would put every
 * such employee in the Gulf of Guinea on the HR map. The app is expected not to
 * send a fabricated point at all; this is the backstop.
 */
const isNullIsland = (lat, lng) => Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001;

/**
 * Check one point, returning an error code or null.
 *
 * Codes are stable strings rather than prose so the Flutter side can branch on
 * them — in particular to tell "this will never be accepted, stop retrying and
 * drop it" (everything here) from a transport failure (worth retrying).
 */
export const validatePoint = (p) => {
  // Checked before Number(), which turns null, '' and false into 0 — a missing
  // longitude would otherwise be accepted as a point on the prime meridian.
  const missing = (v) => v === null || v === undefined || v === '' || typeof v === 'boolean';
  if (missing(p.latitude) || missing(p.longitude)) return 'INVALID_COORDINATES';

  const lat = Number(p.latitude);
  const lng = Number(p.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'INVALID_COORDINATES';
  if (lat < -90 || lat > 90) return 'LATITUDE_OUT_OF_RANGE';
  if (lng < -180 || lng > 180) return 'LONGITUDE_OUT_OF_RANGE';
  if (isNullIsland(lat, lng)) return 'FABRICATED_COORDINATES';

  if (p.accuracy !== null && p.accuracy !== undefined && p.accuracy !== '') {
    const acc = Number(p.accuracy);
    // Negative accuracy is meaningless; the upper bound rejects a "fix" so
    // vague it locates the employee to the wrong city.
    if (!Number.isFinite(acc) || acc < 0 || acc > 100000) return 'INVALID_ACCURACY';
  }

  if (!parseRecordedAt(p.recorded_at)) return 'INVALID_RECORDED_AT';
  return null;
};

/**
 * Parse the phone's capture time into the naive Oracle timestamp string this
 * table already stores.
 *
 * The offset is stripped rather than converted, matching resolveRecordedAt in
 * location.service.js — every timestamp in LOCATION_TRACKS is local wall-clock,
 * and converting these to UTC would put new rows on a different clock from the
 * 16,000 already there. Unlike that function this one returns null on garbage
 * instead of quietly substituting "now": a point whose time cannot be trusted
 * is worse than no point, because it lands in the trail at the wrong moment.
 */
export const parseRecordedAt = (value) => {
  if (!value) return null;
  let s = String(value).trim();
  s = s.replace(/(?:[Zz]|[+-]\d{2}:?\d{2})$/, '');
  s = s.replace(/[Tt]/, ' ').trim();
  if (!s.includes('.')) s += '.000000';
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+$/.test(s)) return null;

  // Reject a date the calendar does not have (2026-02-31) and anything absurdly
  // far from now — a phone with a broken clock would otherwise poison reports.
  const [datePart, timePart] = s.split(' ');
  const [y, mo, d] = datePart.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;

  const [hh, mi, ss] = timePart.split(/[:.]/).map(Number);
  if (hh > 23 || mi > 59 || ss > 59) return null;

  return s;
};

/** The YYYY-MM-DD the point belongs to — the phone's, or the capture date. */
const resolveAttendanceDate = (p, recordedAt) => {
  const given = String(p.attendance_date ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(given)) return given;
  return recordedAt.slice(0, 10);
};

// ---------------------------------------------------------------------------
// Batch sync
// ---------------------------------------------------------------------------

const ORA_UNIQUE_VIOLATION = 'ORA-00001';

/**
 * Store a batch of captured points for one card, idempotently.
 *
 * Each point is inserted in its own statement and committed with the batch, so
 * one rejected point neither rolls back its neighbours nor aborts the run. The
 * unique index on CLIENT_EVENT_ID is what makes a replay safe: rather than
 * checking for an existing row first (which two concurrent uploads of the same
 * point would both pass), the insert is attempted and ORA-00001 is read as
 * "already stored" — the database decides, not a race between two reads.
 *
 * Returns one result per submitted point, in the order they were sent:
 *   SYNCED         — stored now
 *   ALREADY_SYNCED — stored by an earlier upload; server_id is the original row
 *   REJECTED       — will never be accepted; the phone should drop it
 */
export const syncLocationBatch = async (cardNo, points) => {
  const results = [];
  if (!Array.isArray(points) || points.length === 0) {
    return { results, counts: { synced: 0, already_synced: 0, rejected: 0 } };
  }

  let connection;
  try {
    connection = await getDirectConnection();

    // Points arriving twice inside a single batch: the first wins and the rest
    // resolve against it, so a duplicated UUID in one payload behaves exactly
    // as it would across two uploads.
    const seenInBatch = new Map();

    for (const p of points) {
      const clientEventId = String(p.client_event_id ?? '').trim();

      if (!clientEventId) {
        results.push({
          client_event_id: null,
          status: 'REJECTED',
          reason: 'MISSING_CLIENT_EVENT_ID',
        });
        continue;
      }

      const problem = validatePoint(p);
      if (problem) {
        results.push({ client_event_id: clientEventId, status: 'REJECTED', reason: problem });
        continue;
      }

      if (seenInBatch.has(clientEventId)) {
        results.push({
          client_event_id: clientEventId,
          status: 'ALREADY_SYNCED',
          server_id: seenInBatch.get(clientEventId),
        });
        continue;
      }

      const recordedAt = parseRecordedAt(p.recorded_at);
      const attendanceDate = resolveAttendanceDate(p, recordedAt);

      try {
        const res = await connection.execute(
          `INSERT INTO LOCATION_TRACKS
             (ID, CARD_NO, LATITUDE, LONGITUDE, ACCURACY,
              RECORDED_AT, SYNCED_AT, ATTENDANCE_DATE, CLIENT_EVENT_ID)
           VALUES
             (LOCATION_TRACKS_SEQ.NEXTVAL, :card_no, :lat, :lng, :acc,
              TO_TIMESTAMP(:rec_at, 'YYYY-MM-DD HH24:MI:SS.FF6'),
              SYSTIMESTAMP,
              TO_DATE(:att_date, 'YYYY-MM-DD'),
              :ceid)
           RETURNING ID INTO :out_id`,
          {
            card_no: String(cardNo),
            lat: Number(p.latitude),
            lng: Number(p.longitude),
            acc:
              p.accuracy === null || p.accuracy === undefined || p.accuracy === ''
                ? null
                : Number(p.accuracy),
            rec_at: recordedAt,
            att_date: attendanceDate,
            ceid: clientEventId,
            out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
          },
          { autoCommit: false },
        );

        const serverId = Number(res.outBinds.out_id[0]);
        seenInBatch.set(clientEventId, serverId);
        results.push({ client_event_id: clientEventId, status: 'SYNCED', server_id: serverId });
      } catch (e) {
        const msg = String(e.message ?? e);

        if (msg.includes(ORA_UNIQUE_VIOLATION)) {
          // Already stored by an earlier upload. Hand back the original row's
          // ID so the phone can mark its local copy synced and stop retrying.
          const existing = await connection.execute(
            `SELECT ID FROM LOCATION_TRACKS WHERE CLIENT_EVENT_ID = :ceid`,
            { ceid: clientEventId },
            { outFormat: OUT_ARRAY },
          );
          results.push({
            client_event_id: clientEventId,
            status: 'ALREADY_SYNCED',
            server_id: existing.rows?.[0]?.[0] ?? null,
          });
          continue;
        }

        // Anything else is this server's problem, not the point's. Report it as
        // FAILED — distinct from REJECTED — so the phone keeps the record and
        // retries rather than deleting data we simply failed to store.
        logger.error(`[LOCATION_SYNC] insert failed for ${clientEventId}: ${msg}`);
        results.push({
          client_event_id: clientEventId,
          status: 'FAILED',
          reason: 'SERVER_ERROR',
        });
      }
    }

    await connection.commit();

    const counts = {
      synced: results.filter((r) => r.status === 'SYNCED').length,
      already_synced: results.filter((r) => r.status === 'ALREADY_SYNCED').length,
      rejected: results.filter((r) => r.status === 'REJECTED').length,
      failed: results.filter((r) => r.status === 'FAILED').length,
    };
    logger.info(
      `[LOCATION_SYNC] card=${cardNo} synced=${counts.synced} dup=${counts.already_synced} ` +
        `rejected=${counts.rejected} failed=${counts.failed}`,
    );

    return { results, counts };
  } catch (e) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    throw e;
  } finally {
    await connection?.close();
  }
};

// ---------------------------------------------------------------------------
// Tracking state
// ---------------------------------------------------------------------------

/** "HH:MM" now, matching how ATTENDANCE_RECORDS stores its times. */
const nowHHMM = () => {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** Minutes since midnight for "HH:MM", or null. */
export const toMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
};

/**
 * Today's shift window and attendance state for one card.
 *
 * The shift CODE comes from DUTY_ROSTER — that is the authority for which shift
 * the person is on today, and a bulk shift change rewrites it. The shift TIMES
 * mostly do not: DUTY_ROSTER has SHIFT_START_TIME and SHIFT_END_TIME columns,
 * but 73,303 of the last 74,633 rows leave them null, so relying on them alone
 * would leave the shift window unknown for 98% of employees and every checkout
 * would be read as final. SHIFT_HEAD holds the configured window per company,
 * branch and shift code, and fills the gap.
 *
 * The roster's own times still win where present, because a per-day override is
 * a deliberate statement about that day.
 */
const getShiftAndAttendance = async (connection, cardNo) => {
  const binds = { card: String(cardNo), card_int: cardInt(cardNo) };

  const roster = await connection.execute(
    `SELECT d.ROSTER_SHIFT                          AS "shift",
            NVL(d.SHIFT_START_TIME, sh.TIME_FROM)   AS "shift_start",
            NVL(d.SHIFT_END_TIME,   sh.TIME_TO)     AS "shift_end",
            d.LEAVE_TYPE_FK                         AS "leave_type_fk",
            d.HOLIDAY_FK                            AS "holiday_fk",
            CASE WHEN d.SHIFT_END_TIME IS NULL AND sh.TIME_TO IS NOT NULL
                 THEN 'SHIFT_HEAD' ELSE 'ROSTER' END AS "shift_time_source"
       FROM DUTY_ROSTER d
       LEFT JOIN SHIFT_HEAD sh
              ON TO_CHAR(sh.COMPC) = TO_CHAR(d.COMPC)
             AND TO_CHAR(sh.BRNCH) = TO_CHAR(d.BRNCH)
             AND TRIM(sh.SHIFT)    = TRIM(d.ROSTER_SHIFT)
      WHERE (TO_CHAR(d.CARD_NO) = :card OR TO_CHAR(d.CARD_NO) = :card_int)
        AND TRUNC(d.ROSTER_DATE) = TRUNC(SYSDATE)
      FETCH FIRST 1 ROWS ONLY`,
    binds,
    { outFormat: OUT_OBJECT },
  );

  const attendance = await connection.execute(
    `SELECT ID         AS "id",
            ENTRY_TIME AS "entry_time",
            EXIT_TIME  AS "exit_time"
       FROM ATTENDANCE_RECORDS
      WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
        AND TRUNC(ATTENDANCE_DATE) = TRUNC(SYSDATE)
      ORDER BY ID DESC
      FETCH FIRST 1 ROWS ONLY`,
    binds,
    { outFormat: OUT_OBJECT },
  );

  const r = roster.rows?.[0] ?? {};
  const a = attendance.rows?.[0] ?? {};
  const trim = (v) => String(v ?? '').trim();

  return {
    shift: trim(r.shift) || null,
    shift_start: trim(r.shift_start) || null,
    shift_end: trim(r.shift_end) || null,
    shift_time_source: trim(r.shift_time_source) || null,
    on_leave: r.leave_type_fk !== null && r.leave_type_fk !== undefined,
    is_holiday: r.holiday_fk !== null && r.holiday_fk !== undefined,
    attendance_id: a.id ?? null,
    entry_time: trim(a.entry_time) || null,
    exit_time: trim(a.exit_time) || null,
  };
};

/**
 * Whether a checkout ends the working day.
 *
 * The system allows repeated checkouts and treats the latest as the effective
 * one, so a checkout on its own says nothing about whether the employee is
 * finished — 15:00 on a 09:00–17:00 shift is somebody stepping out, not going
 * home, and they may well check in again. Tracking must survive that.
 *
 * A checkout is FINAL only once the shift itself is over. Until then it is
 * INTERMEDIATE and tracking pauses rather than stops, so the app can resume on
 * the next check-in without a fresh session.
 *
 * An overnight shift (end at or before start, e.g. branch 17's 13:00–02:30)
 * cannot be judged by comparing clock times alone: 14:00 is numerically "after"
 * 02:30 but is one hour INTO the shift, and 03:00 is numerically "before" it
 * but the shift has finished. Such a shift is over only in the gap between its
 * end and its next start — 02:30 to 12:59 here — which is both halves of the
 * problem: it does not stop tracking during the evening, and it does not leave
 * a night worker's checkout INTERMEDIATE for ever.
 */
export const isShiftOver = (shiftEnd, shiftStart, nowMins) => {
  const end = toMinutes(shiftEnd);
  if (end === null) return null; // no shift end configured — unknowable

  const start = toMinutes(shiftStart);
  if (start !== null && end <= start) {
    // Crosses midnight: finished once we are past the end but not yet at the
    // next start.
    return nowMins >= end && nowMins < start;
  }

  return nowMins >= end;
};

/**
 * The complete tracking picture for one card: is tracking on, how often should
 * the phone sample, and should it be running right now.
 *
 * `tracking_state` is what the app acts on:
 *   ACTIVE  — capture on the configured interval
 *   PAUSED  — checked out but the shift is still running; stop capturing, keep
 *             the session, resume on the next check-in
 *   STOPPED — nothing more expected today; end the session
 *
 * Everything already synchronised stays synchronised in every state; PAUSED and
 * STOPPED govern capture, never upload. A phone holding a backlog should always
 * finish uploading it.
 */
export const getTrackingState = async (cardNo) => {
  let connection;
  try {
    connection = await getDirectConnection();

    // HR's own configuration, read from the same columns the existing
    // /location-tracking/settings endpoint serves — this does not duplicate it.
    const cfg = await connection.execute(
      `SELECT h.EMPCODE           AS "empcode",
              h.NAME              AS "name",
              h.STATUS            AS "status",
              NVL(h.TRACK_LOCATION, 'N')  AS "track_location",
              h.TRACK_LOCATION_HR AS "track_location_hr"
         FROM HR_EMP_MASTER h
         LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
        WHERE TO_CHAR(e.CARD_NO) = :card
           OR TO_CHAR(e.CARD_NO) = :card_int
           OR TO_CHAR(h."ATDTCARD#") = :card2
           OR h.EMPCODE = :card3
        FETCH FIRST 1 ROWS ONLY`,
      {
        card: String(cardNo),
        card_int: cardInt(cardNo),
        card2: String(cardNo),
        card3: String(cardNo),
      },
      { outFormat: OUT_OBJECT },
    );

    const c = cfg.rows?.[0];
    if (!c) return { status: 'error', message: `Employee ${cardNo} not found`, code: 404 };

    // Someone who has left is not tracked, whatever TRACK_LOCATION still says.
    // 28 employees marked Left were still carrying TRACK_LOCATION = 'Y', and
    // nothing read their employment status, so their phones kept reporting.
    // Deriving it here means HR does not have to remember to switch the flag
    // off as well as marking the person Left.
    const employed = isActiveStatus(c.status);
    const trackingEnabled =
      employed && String(c.track_location ?? 'N').trim().toUpperCase() === 'Y';
    // TRACK_LOCATION_HR is configured in hours; the app wants minutes. The
    // existing settings endpoint floors it at 1, and so does this.
    const intervalHours = Math.max(1, Number(c.track_location_hr) || 2);
    const intervalMinutes = intervalHours * 60;

    const s = await getShiftAndAttendance(connection, cardNo);
    const nowMins = toMinutes(nowHHMM());
    const shiftOver = isShiftOver(s.shift_end, s.shift_start, nowMins);

    // Attendance state, in the vocabulary the attendance service already uses.
    let attendanceStatus = 'NOT_CHECKED_IN';
    if (s.entry_time && s.exit_time) attendanceStatus = 'CHECKED_OUT';
    else if (s.entry_time) attendanceStatus = 'CHECKED_IN';

    let checkoutState = 'NONE';
    let trackingState = 'STOPPED';
    let isFinalCheckout = false;

    if (!trackingEnabled) {
      // HR has tracking off for this employee: nothing else matters.
      trackingState = 'STOPPED';
      if (attendanceStatus === 'CHECKED_OUT') {
        checkoutState = shiftOver === false ? 'INTERMEDIATE' : 'FINAL';
        isFinalCheckout = checkoutState === 'FINAL';
      }
    } else if (attendanceStatus === 'CHECKED_IN') {
      trackingState = 'ACTIVE';
      checkoutState = 'NONE';
    } else if (attendanceStatus === 'CHECKED_OUT') {
      // The rule this whole endpoint exists for. `shiftOver === false` means we
      // positively know the shift is still running; null means no shift end is
      // configured, and then a checkout is taken at face value rather than
      // tracking somebody indefinitely.
      if (shiftOver === false) {
        checkoutState = 'INTERMEDIATE';
        trackingState = 'PAUSED';
        isFinalCheckout = false;
      } else {
        checkoutState = 'FINAL';
        trackingState = 'STOPPED';
        isFinalCheckout = true;
      }
    } else {
      // Never checked in today — nothing to track yet.
      trackingState = 'STOPPED';
      checkoutState = 'NONE';
    }

    return {
      status: 'success',
      data: {
        card_no: String(cardNo),
        emp_code: c.empcode ?? null,
        employee_name: String(c.name ?? '').trim(),

        tracking_enabled: trackingEnabled,
        tracking_state: trackingState,
        /**
         * False when the employee has left. Tracking is then off regardless of
         * the TRACK_LOCATION flag, and tracking_state is STOPPED. Uploads are
         * deliberately NOT blocked: a phone may still hold this morning's
         * points from while the person was employed, and those belong in the
         * record.
         */
        employment_active: employed,
        interval_minutes: intervalMinutes,
        // Kept so callers of the existing settings endpoint see the same unit.
        track_location_hr: intervalHours,

        attendance_status: attendanceStatus,
        attendance_id: s.attendance_id,
        check_in_time: s.entry_time,
        latest_checkout: s.exit_time,
        checkout_state: checkoutState,
        is_final_checkout: isFinalCheckout,

        shift: s.shift,
        shift_start: s.shift_start,
        shift_end: s.shift_end,
        // 'ROSTER' when the day carries its own times, 'SHIFT_HEAD' when they
        // come from the branch's configured window. Diagnostic only.
        shift_time_source: s.shift_time_source,
        shift_over: shiftOver,
        on_leave: s.on_leave,
        is_holiday: s.is_holiday,

        server_time: nowHHMM(),
      },
    };
  } finally {
    await connection?.close();
  }
};

/**
 * Which of a set of client event IDs this server already holds.
 *
 * The phone calls this when its local state is in doubt — after a reinstall, or
 * when a batch response was lost entirely — so it can settle what still needs
 * uploading without sending everything again.
 */
export const getSyncedEventIds = async (cardNo, clientEventIds) => {
  const ids = [...new Set((clientEventIds ?? []).map((i) => String(i).trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  let connection;
  try {
    connection = await getDirectConnection();

    // Bound by name in chunks: the values stay data, and no IN list exceeds
    // Oracle's 1000-expression limit however long the phone's backlog is.
    const found = [];
    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const binds = { card: String(cardNo), card_int: cardInt(cardNo) };
      const names = slice.map((id, n) => {
        binds[`e${n}`] = id;
        return `:e${n}`;
      });
      const res = await connection.execute(
        `SELECT CLIENT_EVENT_ID, ID
           FROM LOCATION_TRACKS
          WHERE CLIENT_EVENT_ID IN (${names.join(', ')})
            AND (CARD_NO = :card OR CARD_NO = :card_int)`,
        binds,
        { outFormat: OUT_ARRAY },
      );
      for (const [ceid, id] of res.rows ?? []) {
        found.push({ client_event_id: ceid, server_id: Number(id) });
      }
    }
    return found;
  } finally {
    await connection?.close();
  }
};
