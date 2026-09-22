/**
 * Session window — the single place that answers "which attendance session(s)
 * (if any) does this moment belong to, and when does each end?"
 *
 * Added 2026-09-22 to stop location points leaking into days an employee
 * never checked in on: previously POST /auth/location/batch stamped every
 * point with ATTENDANCE_DATE = TRUNC(SYSDATE) (the day it ARRIVED), and the
 * HR reports filtered only on that column — so a point synced on Wednesday
 * showed up on Wednesday's map even if the employee's session was Monday's,
 * or nonexistent that day at all.
 *
 * The rule (confirmed by the business):
 *   A session runs from check-in until whichever comes first:
 *     - checkout (always wins, whenever it happens)
 *     - cutoff = shift end + TRACKING_GRACE_MINUTES, when there is no checkout
 *
 * ── Multiple check-in/checkout pairs in one day (2026-09-22) ───────────────
 * ATTENDANCE_RECORDS is not one row per card per day: insertCheckIn's MERGE
 * only matches a row whose EXIT_TIME IS NULL, so once a pair is checked out a
 * later punch that same day opens a NEW row rather than reusing the closed
 * one (attendance.service.js). A day can therefore have several closed pairs
 * plus, at most, one still-open final pair (only the newest row can have a
 * NULL EXIT_TIME — a new row is only ever created once the previous one is
 * closed). getSessionWindows() returns one window per pair, in punch order;
 * a point belongs to the day if it falls inside ANY of them, never just the
 * first or the last.
 *
 * ── Boundary slack (2026-09-22) ─────────────────────────────────────────
 * IN_TIME/EXIT_TIME are minute precision; RECORDED_AT is to the second, and
 * the app takes a final fix right after the server confirms a checkout — a
 * checkout stored as "18:00" can have a legitimate fix at 18:00:45. Matching
 * (isWithinWindow / isWithinAnyWindow) therefore allows BOUNDARY_SLACK_MINUTES
 * (2, matching the app's own pre-check-in allowance) on both ends of every
 * pair's window. The *_at / *_utc_naive fields stay the true, unslacked
 * instants for display (tracking_cutoff_at etc.) — only match_start/
 * match_end_utc_naive carry the slack, so what the app and HR are TOLD a
 * cutoff is never quietly drifts by 2 minutes.
 *
 * ── Timezones ────────────────────────────────────────────────────────────
 * This app server (and Oracle) run in Asia/Karachi (UTC+5) local time:
 *   - ATTENDANCE_RECORDS.ENTRY_TIME / EXIT_TIME       -> local "HH:MI"
 *   - DUTY_ROSTER.SHIFT_START_TIME / SHIFT_END_TIME   -> local "HH:MI"
 *   - SHIFT_HEAD.TIME_FROM / TIME_TO                  -> local "HH:MI"
 * But LOCATION_TRACKS.RECORDED_AT is NOT local: the app sends UTC ISO-8601
 * ("...Z"), and the ingest code (resolveRecordedAt / parseRecordedAt) strips
 * the "Z" instead of converting, so the naive TIMESTAMP column ends up
 * holding literal UTC wall time. Every comparison here works in that same
 * "UTC-naive" representation — local times are converted to it (by
 * subtracting the fixed 5h offset; Pakistan has no DST) before being
 * compared against RECORDED_AT, and never the other way around.
 */

import { getDirectConnection } from '../config/database.js';
import { cardInt } from '../utils/conversionHelpers.js';
import { logger } from '../utils/logger.js';

const OBJ = { outFormat: 4002 };

// Asia/Karachi has no daylight saving, so this is a fixed offset.
const TZ_OFFSET_HOURS = 5;

// One setting, confirmed by HR at 120 minutes. Overridable via .env without a
// code change; do not hard-code a shift's own grace anywhere else.
export const TRACKING_GRACE_MINUTES =
  Number.isFinite(Number(process.env.TRACKING_GRACE_MINUTES)) &&
  Number(process.env.TRACKING_GRACE_MINUTES) > 0
    ? Number(process.env.TRACKING_GRACE_MINUTES)
    : 120;

// Matches the app's own pre-check-in allowance. This is clock-skew/last-fix
// tolerance, not a business setting like the grace period, so it is not
// re-derived per shift — but it is still env-overridable for consistency.
export const BOUNDARY_SLACK_MINUTES =
  Number.isFinite(Number(process.env.TRACKING_BOUNDARY_SLACK_MINUTES)) &&
  Number(process.env.TRACKING_BOUNDARY_SLACK_MINUTES) >= 0
    ? Number(process.env.TRACKING_BOUNDARY_SLACK_MINUTES)
    : 2;

// Unknown-shift fallback, in hours — mirrors the app's own cap so both sides
// agree on a session's outer bound when the shift can't be resolved.
const UNKNOWN_SHIFT_FALLBACK_HOURS = 18;

const p2 = (n) => String(n).padStart(2, '0');

/** Minutes-since-midnight for an "HH:MI" string, or null. */
const hhmmToMin = (s) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(mi) || h > 23 || mi > 59) return null;
  return h * 60 + mi;
};

/** "YYYY-MM-DD" + N days (N may be negative), calendar-safe. */
export const addDaysYmd = (ymd, days) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`;
};

/**
 * Convert a LOCAL (Asia/Karachi) calendar date + "HH:MI" (+ optional day
 * offset, for shift ends that land on the next day) into the UTC-naive
 * "YYYY-MM-DD HH:MM:SS" string RECORDED_AT is stored as.
 */
export const localToUtcNaive = (ymd, hhmm, dayOffset = 0) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mi] = String(hhmm).slice(0, 5).split(':').map(Number);
  const asUtc = Date.UTC(y, m - 1, d + dayOffset, hh, mi, 0);
  const utc = new Date(asUtc - TZ_OFFSET_HOURS * 3600 * 1000);
  return (
    `${utc.getUTCFullYear()}-${p2(utc.getUTCMonth() + 1)}-${p2(utc.getUTCDate())} ` +
    `${p2(utc.getUTCHours())}:${p2(utc.getUTCMinutes())}:${p2(utc.getUTCSeconds())}`
  );
};

/** Same inputs, formatted as ISO-8601 with the local +05:00 offset — for API responses. */
export const localIsoWithOffset = (ymd, hhmm, dayOffset = 0) => {
  const targetYmd = dayOffset ? addDaysYmd(ymd, dayOffset) : ymd;
  const [hh, mi] = String(hhmm).slice(0, 5).split(':').map(Number);
  return `${targetYmd}T${p2(hh)}:${p2(mi)}:00+05:00`;
};

/** The UTC-naive "YYYY-MM-DD HH:MM:SS" moment a UTC-naive string + N minutes lands on (N may be negative). */
const addMinutesToUtcNaive = (utcNaiveStr, minutes) => {
  const iso = utcNaiveStr.replace(' ', 'T') + 'Z';
  const dt = new Date(new Date(iso).getTime() + minutes * 60 * 1000);
  return (
    `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())} ` +
    `${p2(dt.getUTCHours())}:${p2(dt.getUTCMinutes())}:${p2(dt.getUTCSeconds())}`
  );
};

/** UTC-naive string -> ISO-8601 with +05:00, for API responses. */
const utcNaiveToLocalIso = (utcNaiveStr) => {
  const iso = utcNaiveStr.replace(' ', 'T') + 'Z';
  const local = new Date(new Date(iso).getTime() + TZ_OFFSET_HOURS * 3600 * 1000);
  return (
    `${local.getUTCFullYear()}-${p2(local.getUTCMonth() + 1)}-${p2(local.getUTCDate())}T` +
    `${p2(local.getUTCHours())}:${p2(local.getUTCMinutes())}:${p2(local.getUTCSeconds())}+05:00`
  );
};

/** The Asia/Karachi calendar date ("YYYY-MM-DD") a UTC-naive RECORDED_AT-style
 *  string falls on locally — i.e. what "today" means for that point. */
export const utcNaiveToLocalYmd = (utcNaiveStr) => {
  const iso = utcNaiveStr.replace(' ', 'T') + 'Z';
  const local = new Date(new Date(iso).getTime() + TZ_OFFSET_HOURS * 3600 * 1000);
  return `${local.getUTCFullYear()}-${p2(local.getUTCMonth() + 1)}-${p2(local.getUTCDate())}`;
};

/** Current instant as a UTC-naive "YYYY-MM-DD HH:MM:SS" string (comparable to RECORDED_AT). */
export const nowUtcNaive = () => {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ` +
    `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`
  );
};

// How far before the shift's own start a check-in can be and still be
// trusted to belong to that shift. Beyond this the shift is almost certainly
// stale/wrong for this employee today (e.g. rostered on nights, working
// days) rather than a genuine early arrival — see the guard below.
const SHIFT_MISMATCH_THRESHOLD_MINUTES = 180;

/** Build one pair's window object from its raw local times. Internal. */
const buildWindow = (cardNo, rosterDateYmd, entry, exit_, shiftStart, shiftEnd, dutyHrs, shiftCode) => {
  const checkInUtcNaive = localToUtcNaive(rosterDateYmd, entry, 0);
  const checkInIso = localIsoWithOffset(rosterDateYmd, entry, 0);

  const checkInMin = hhmmToMin(entry);
  const startMinForGuard = shiftStart ? hhmmToMin(shiftStart) : null;
  const endMinForGuard = shiftEnd ? hhmmToMin(shiftEnd) : null;

  // The shift-end-derived cutoff, computed whenever the shift end is known —
  // BEFORE deciding whether to trust it, so the late-check-in guard below can
  // compare the check-in against it.
  let normalCutoffUtcNaive = null;
  let normalCutoffIso = null;
  if (endMinForGuard !== null) {
    // Overnight when the shift end is at/before its start (e.g. 20:30-08:30);
    // that puts the shift's end, and so the cutoff, on the NEXT day.
    let dayOffset = startMinForGuard !== null && endMinForGuard <= startMinForGuard ? 1 : 0;
    let cutoffMin = endMinForGuard + TRACKING_GRACE_MINUTES;
    if (cutoffMin >= 1440) {
      dayOffset += 1;
      cutoffMin -= 1440;
    }
    const cutoffHHMM = `${p2(Math.floor(cutoffMin / 60))}:${p2(cutoffMin % 60)}`;
    normalCutoffUtcNaive = localToUtcNaive(rosterDateYmd, cutoffHHMM, dayOffset);
    normalCutoffIso = localIsoWithOffset(rosterDateYmd, cutoffHHMM, dayOffset);
  }

  // Two directions of the same problem: the check-in doesn't fit the
  // roster's shift for today, so its end cannot be trusted.
  //   EARLY  — check-in is way before the shift even starts (rostered on
  //            nights, working days: 07:33 in against a 20:00 start).
  //   LATE   — check-in is already at/after the shift-derived cutoff (a
  //            09:00-17:00 day-shift check-in at 21:00 gets handed a cutoff
  //            of 19:00, already in the past — tracking would silently never
  //            start, the mirror image of the early case).
  // A legitimate early arrival (<=3h before start) or an on-time/late one
  // within the shift is untouched either way.
  const earlyMismatch =
    startMinForGuard !== null &&
    checkInMin !== null &&
    startMinForGuard - checkInMin > SHIFT_MISMATCH_THRESHOLD_MINUTES;
  const lateMismatch = normalCutoffUtcNaive !== null && checkInUtcNaive >= normalCutoffUtcNaive;
  const shiftMismatch = earlyMismatch || lateMismatch;

  let cutoffUtcNaive, cutoffIso, shiftKnown;

  if (normalCutoffUtcNaive !== null && !shiftMismatch) {
    shiftKnown = true;
    cutoffUtcNaive = normalCutoffUtcNaive;
    cutoffIso = normalCutoffIso;
  } else if (shiftMismatch) {
    // The roster's shift does not fit this check-in — trusting its end would
    // hand out either a 20+ hour cutoff (early case) or one already in the
    // past (late case). Use check-in + the shift's own configured duration
    // (DUTY_HRS) instead of its clock end, or the same 18h fallback as a
    // fully unknown shift when even that isn't available. shift_known stays
    // true: the shift WAS resolved, just not trusted for its end time.
    shiftKnown = true;
    const durationMin = dutyHrs !== null && dutyHrs > 0 ? dutyHrs * 60 : UNKNOWN_SHIFT_FALLBACK_HOURS * 60;
    const durationLabel =
      dutyHrs !== null && dutyHrs > 0 ? `DUTY_HRS(${dutyHrs}h)` : `${UNKNOWN_SHIFT_FALLBACK_HOURS}h fallback`;
    const reason = earlyMismatch
      ? `check-in is ${startMinForGuard - checkInMin}min before shift start (> ${SHIFT_MISMATCH_THRESHOLD_MINUTES}min threshold)`
      : `check-in (${entry}) is at/after the shift-derived cutoff (${normalCutoffIso})`;
    logger.warn(
      `[SESSION_WINDOW] shift mismatch: card=${cardNo} roster_date=${rosterDateYmd} ` +
        `check_in=${entry} shift=${shiftCode ?? '?'} shift_start=${shiftStart ?? '?'} ` +
        `shift_end=${shiftEnd ?? '?'} — ${reason}; using check-in + ${durationLabel} + grace instead. ` +
        `HR should check this employee's roster for today.`,
    );
    cutoffUtcNaive = addMinutesToUtcNaive(checkInUtcNaive, durationMin + TRACKING_GRACE_MINUTES);
    cutoffIso = utcNaiveToLocalIso(cutoffUtcNaive);
  } else {
    // Unknown shift — check-in + 18h, matching the app's own fallback so
    // both sides agree even before this ships everywhere.
    shiftKnown = false;
    logger.warn(
      `[SESSION_WINDOW] no shift found for card=${cardNo} roster_date=${rosterDateYmd}; ` +
        `falling back to check-in + ${UNKNOWN_SHIFT_FALLBACK_HOURS}h`,
    );
    cutoffUtcNaive = addMinutesToUtcNaive(checkInUtcNaive, UNKNOWN_SHIFT_FALLBACK_HOURS * 60);
    cutoffIso = utcNaiveToLocalIso(cutoffUtcNaive);
  }

  let checkoutUtcNaive = null;
  let checkoutIso = null;
  if (exit_ && hhmmToMin(exit_) !== null) {
    const entryMin = hhmmToMin(entry);
    const exitMin = hhmmToMin(exit_);
    // A checkout time smaller than the check-in time crossed midnight.
    const exitDayOffset = exitMin < entryMin ? 1 : 0;
    checkoutUtcNaive = localToUtcNaive(rosterDateYmd, exit_, exitDayOffset);
    checkoutIso = localIsoWithOffset(rosterDateYmd, exit_, exitDayOffset);
  }

  // Checkout always wins when present; otherwise the window runs to cutoff.
  // These are the TRUE instants — reported to callers as-is.
  const windowEndUtcNaive = checkoutUtcNaive ?? cutoffUtcNaive;
  const windowEndIso = checkoutIso ?? cutoffIso;

  return {
    card_no: String(cardNo),
    attendance_date: rosterDateYmd,
    check_in_at: checkInIso,
    check_in_utc_naive: checkInUtcNaive,
    checkout_at: checkoutIso,
    checkout_utc_naive: checkoutUtcNaive,
    cutoff_at: cutoffIso,
    cutoff_utc_naive: cutoffUtcNaive,
    window_end_at: windowEndIso,
    window_end_utc_naive: windowEndUtcNaive,
    has_checkout: Boolean(checkoutUtcNaive),
    shift_known: shiftKnown,
    // True when the roster's shift end was distrusted because the check-in
    // didn't fit it (see SHIFT_MISMATCH_THRESHOLD_MINUTES above). Internal —
    // not surfaced through any API response; every current caller only picks
    // named fields (cutoff_at, attendance_date, ...) off this object.
    shift_mismatch: shiftMismatch,
    // Matching bounds only — true instants +/- BOUNDARY_SLACK_MINUTES, so a
    // fix taken just before check-in or just after a checkout/cutoff (minute-
    // precision punch, second-precision GPS) still counts. Never used for
    // display: tracking_cutoff_at etc. always report cutoff_at, unslacked.
    match_start_utc_naive: addMinutesToUtcNaive(checkInUtcNaive, -BOUNDARY_SLACK_MINUTES),
    match_end_utc_naive: addMinutesToUtcNaive(windowEndUtcNaive, BOUNDARY_SLACK_MINUTES),
  };
};

/**
 * Every attendance session (check-in/checkout pair) for one card on one LOCAL
 * roster date, oldest first. [] when there was no check-in that day at all.
 *
 * A day can hold several pairs (attendance.service.js opens a new
 * ATTENDANCE_RECORDS row once the previous one is checked out) plus, at most,
 * one still-open final pair — only the newest row can have a NULL EXIT_TIME.
 * Every closed pair always has both ENTRY_TIME and EXIT_TIME set.
 *
 * @param {string} cardNo
 * @param {string} rosterDateYmd  "YYYY-MM-DD", LOCAL (Asia/Karachi) calendar date
 * @param {object} [connArg]      an open connection to reuse (batch callers)
 */
export const getSessionWindows = async (cardNo, rosterDateYmd, connArg = null) => {
  const connection = connArg || (await getDirectConnection());
  try {
    const binds = { card: String(cardNo), card_int: cardInt(cardNo), rdate: rosterDateYmd };

    // ALL of this day's punches — not just the latest. ATTENDANCE_RECORDS is
    // the app's only attendance store (mirrors attendance.service.js).
    const att = await connection.execute(
      `SELECT ENTRY_TIME AS "entry_time", EXIT_TIME AS "exit_time"
         FROM ATTENDANCE_RECORDS
        WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :card_int)
          AND TRUNC(ATTENDANCE_DATE) = TO_DATE(:rdate, 'YYYY-MM-DD')
        ORDER BY ID ASC`,
      binds,
      OBJ,
    );
    const pairs = (att.rows ?? [])
      .map((a) => ({
        entry: String(a.entry_time ?? '').trim(),
        exit_: String(a.exit_time ?? '').trim() || null,
      }))
      .filter((p) => p.entry && hhmmToMin(p.entry) !== null);
    if (pairs.length === 0) return []; // no check-in that day -> no session

    // Shift window: DUTY_ROSTER's per-day snapshot first, SHIFT_HEAD fallback
    // via ROSTER_SHIFT + this row's own COMPC/BRNCH — shift codes repeat
    // across company/branch, so both sides of the join must match on them.
    // One shift per roster day, shared by every pair that day. DUTY_HRS
    // (2026-09-22) is the shift's configured duration — used only as the
    // mismatch guard's fallback below; DUTY_ROSTER's own DUTY_HRS is
    // essentially never populated in practice (0/846 rows today), so this
    // NVLs to SHIFT_HEAD's the same way start/end already do.
    const roster = await connection.execute(
      `SELECT d.ROSTER_SHIFT                          AS "shift_code",
              NVL(d.SHIFT_START_TIME, sh.TIME_FROM)   AS "shift_start",
              NVL(d.SHIFT_END_TIME,   sh.TIME_TO)     AS "shift_end",
              NVL(d.DUTY_HRS,         sh.DUTY_HRS)    AS "duty_hrs"
         FROM DUTY_ROSTER d
         LEFT JOIN SHIFT_HEAD sh
                ON TO_CHAR(sh.COMPC) = TO_CHAR(d.COMPC)
               AND TO_CHAR(sh.BRNCH) = TO_CHAR(d.BRNCH)
               AND TRIM(sh.SHIFT)    = TRIM(d.ROSTER_SHIFT)
        WHERE (TO_CHAR(d.CARD_NO) = :card OR TO_CHAR(d.CARD_NO) = :card_int)
          AND TRUNC(d.ROSTER_DATE) = TO_DATE(:rdate, 'YYYY-MM-DD')
        FETCH FIRST 1 ROWS ONLY`,
      binds,
      OBJ,
    );
    const r = roster.rows?.[0];
    const shiftCode = String(r?.shift_code ?? '').trim() || null;
    const shiftStart = String(r?.shift_start ?? '').trim() || null;
    const shiftEnd = String(r?.shift_end ?? '').trim() || null;
    const dutyHrs = r?.duty_hrs !== null && r?.duty_hrs !== undefined ? Number(r.duty_hrs) : null;

    return pairs.map((p) =>
      buildWindow(cardNo, rosterDateYmd, p.entry, p.exit_, shiftStart, shiftEnd, dutyHrs, shiftCode),
    );
  } finally {
    if (!connArg) await connection?.close();
  }
};

/**
 * Convenience for callers that only care about the CURRENT session (check-in
 * response, /location-tracking/settings, tracking-state) — the latest pair,
 * or null when there is none. Never used for ingest/history/summary, which
 * must check every pair (getSessionWindows + isWithinAnyWindow).
 */
export const getLatestSessionWindow = async (cardNo, rosterDateYmd, connArg = null) => {
  const windows = await getSessionWindows(cardNo, rosterDateYmd, connArg);
  return windows.length ? windows[windows.length - 1] : null;
};

/**
 * Is a point recorded at `recordedAtUtcNaive` (a "YYYY-MM-DD HH:MM:SS[.ff]"
 * UTC-naive string, e.g. from resolveRecordedAt/parseRecordedAt) inside this
 * ONE window, allowing BOUNDARY_SLACK_MINUTES on both ends?
 */
export const isWithinWindow = (window, recordedAtUtcNaive) => {
  if (!window) return false;
  const point = String(recordedAtUtcNaive).slice(0, 19); // drop fractional seconds
  return point >= window.match_start_utc_naive && point <= window.match_end_utc_naive;
};

/** Is the point inside ANY of this day's windows (see getSessionWindows)? */
export const isWithinAnyWindow = (windows, recordedAtUtcNaive) =>
  (windows ?? []).some((w) => isWithinWindow(w, recordedAtUtcNaive));

/**
 * Derived open/closed status for a (latest) session window, evaluated against
 * "now". missing_checkout is true only once the cutoff has actually passed
 * with no checkout recorded — never invented, never assumed before the
 * deadline. Uses the TRUE cutoff (no boundary slack): slack is for accepting
 * a late GPS fix near an already-decided boundary, not for deciding whether
 * the boundary has been crossed.
 */
export const sessionStatus = (window, nowUtcNaiveStr = nowUtcNaive()) => {
  if (!window) return { open: false, closed: false, missing_checkout: false };
  if (window.has_checkout) return { open: false, closed: true, missing_checkout: false };
  const pastCutoff = nowUtcNaiveStr >= window.cutoff_utc_naive;
  return { open: !pastCutoff, closed: pastCutoff, missing_checkout: pastCutoff };
};
