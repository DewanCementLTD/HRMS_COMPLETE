/**
 * One-off repair: re-derive LOCATION_TRACKS.ATTENDANCE_DATE from each row's
 * own RECORDED_AT + the employee's actual attendance session(s), instead of
 * the day the point happened to be uploaded (or, for the pre-2026-09-22 rows
 * this targets, the raw Pakistan-calendar-day of RECORDED_AT that
 * TRG_LOCATION_TRACKS_ATT_DATE used to force on every row unconditionally).
 *
 * READ-ONLY. This script only SELECTs from Oracle and writes local files. It
 * does not run any UPDATE/DELETE against the database. Nothing is applied
 * until a human reviews the output and explicitly runs the generated APPLY
 * script.
 *
 * 2026-09-22 (second pass): uses getSessionWindows (a day can hold several
 * check-in/checkout pairs — a point counts if it falls in ANY of them) and
 * BOUNDARY_SLACK_MINUTES (a point within 2 minutes of a punch, either side,
 * still counts — IN_TIME/OUT_TIME are minute precision, RECORDED_AT is to
 * the second). Rows still outside every window are broken down by WHY:
 *   NO_CHECKIN      -- no session at all that local day (or the previous one)
 *   BEFORE_CHECKIN  -- earlier than the nearest session's check-in
 *   AFTER_CHECKOUT  -- later than the nearest session's checkout
 *   AFTER_CUTOFF    -- later than the nearest session's shift-end+grace cutoff (no checkout)
 * plus, per row: minutes to the nearest boundary, and whether that day had
 * more than one check-in/checkout pair.
 *
 * Output, following the db_backups/ convention:
 *   db_backups/LOCATION_TRACKS_ATTENDANCE_DATE_backup_<ts>.csv
 *     One row per record examined that is NOT already correct: either
 *     changed (has a NEW value) or OUT_OF_WINDOW (flagged, with REASON,
 *     MINUTES_TO_BOUNDARY and MULTI_PUNCH_DAY, never given a NEW value).
 *   db_backups/LOCATION_TRACKS_ATTENDANCE_DATE_RESTORE_<ts>.sql
 *     One UPDATE per changed row, setting ATTENDANCE_DATE back to its OLD
 *     value. Run this to undo the APPLY script.
 *   db_backups/LOCATION_TRACKS_ATTENDANCE_DATE_APPLY_<ts>.sql
 *     One UPDATE per changed row, setting ATTENDANCE_DATE to its NEW
 *     (session-derived) value. This is the actual repair; not run by this
 *     script and not to be run without sign-off. OUT_OF_WINDOW rows are
 *     NEVER included -- no session claims them, so there is no correct value
 *     to set, and deleting them is a separate, later decision.
 *
 * Prerequisite: TRG_LOCATION_TRACKS_ATT_DATE must already be the 2026-09-22
 * "only fill when NULL" version before the APPLY script runs -- otherwise the
 * trigger recomputes ATTENDANCE_DATE from RECORDED_AT on every UPDATE and
 * silently overwrites the very value this script is setting.
 *
 * Usage:  node scripts/repair_location_tracks_attendance_date.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDirectConnection } from '../src/config/database.js';
import {
  getSessionWindows,
  isWithinAnyWindow,
  addDaysYmd,
  utcNaiveToLocalYmd,
} from '../src/services/sessionWindow.service.js';

const OUT_DIR = path.join(process.cwd(), 'db_backups');
fs.mkdirSync(OUT_DIR, { recursive: true });

const ts = (() => {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
})();

const csvPath = path.join(OUT_DIR, `LOCATION_TRACKS_ATTENDANCE_DATE_backup_${ts}.csv`);
const restorePath = path.join(OUT_DIR, `LOCATION_TRACKS_ATTENDANCE_DATE_RESTORE_${ts}.sql`);
const applyPath = path.join(OUT_DIR, `LOCATION_TRACKS_ATTENDANCE_DATE_APPLY_${ts}.sql`);

const csvEscape = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const sqlDate = (ymd) => `TO_DATE('${ymd}', 'YYYY-MM-DD')`;

/** Minutes between two UTC-naive "YYYY-MM-DD HH:MM:SS" strings (b - a). */
const minutesBetween = (a, b) => {
  const pa = new Date(a.replace(' ', 'T') + 'Z').getTime();
  const pb = new Date(b.replace(' ', 'T') + 'Z').getTime();
  return (pb - pa) / 60000;
};

/**
 * Classify a point that matched NO window, against the nearest boundary of
 * every window it was checked against (today's candidate day + the previous
 * one). Returns { reason, minutesToBoundary } or { reason: 'NO_CHECKIN',
 * minutesToBoundary: null } when there was no session at all to compare to.
 */
const classifyMiss = (recordedAtSec, allWindows) => {
  if (allWindows.length === 0) return { reason: 'NO_CHECKIN', minutesToBoundary: null };

  let best = null; // { reason, minutes }
  for (const w of allWindows) {
    let reason, minutes;
    if (recordedAtSec < w.check_in_utc_naive) {
      reason = 'BEFORE_CHECKIN';
      minutes = minutesBetween(recordedAtSec, w.check_in_utc_naive);
    } else if (recordedAtSec > w.window_end_utc_naive) {
      reason = w.has_checkout ? 'AFTER_CHECKOUT' : 'AFTER_CUTOFF';
      minutes = minutesBetween(w.window_end_utc_naive, recordedAtSec);
    } else {
      // Inside the TRUE (unslacked) bounds but still reported as a miss is a
      // contradiction (match bounds are only ever wider) -- skip defensively.
      continue;
    }
    if (best === null || minutes < best.minutes) best = { reason, minutes };
  }
  return best
    ? { reason: best.reason, minutesToBoundary: Math.round(best.minutes * 10) / 10 }
    : { reason: 'NO_CHECKIN', minutesToBoundary: null };
};

async function main() {
  const connection = await getDirectConnection();
  const windowsCache = new Map(); // "card|date" -> window[]

  const windowsFor = async (cardNo, ymd) => {
    const key = `${cardNo}|${ymd}`;
    if (windowsCache.has(key)) return windowsCache.get(key);
    const w = await getSessionWindows(cardNo, ymd, connection);
    windowsCache.set(key, w);
    return w;
  };

  console.log('Reading LOCATION_TRACKS...');
  const result = await connection.execute(
    `SELECT ID, CARD_NO,
            TO_CHAR(RECORDED_AT, 'YYYY-MM-DD HH24:MI:SS') AS RECORDED_AT_UTC,
            TO_CHAR(ATTENDANCE_DATE, 'YYYY-MM-DD') AS OLD_ATTENDANCE_DATE
       FROM LOCATION_TRACKS
      ORDER BY ID`,
    {},
    { outFormat: 4002 },
  );
  const rows = result.rows ?? [];
  console.log(`${rows.length} rows to examine.`);

  const csvLines = [
    'ID,CARD_NO,OLD_ATTENDANCE_DATE,NEW_ATTENDANCE_DATE,RECORDED_AT_UTC,FLAG,REASON,MINUTES_TO_BOUNDARY,MULTI_PUNCH_DAY',
  ];
  const restoreLines = [
    '-- RESTORE: undoes LOCATION_TRACKS_ATTENDANCE_DATE_APPLY_' + ts + '.sql',
    '-- Prerequisite: none beyond the APPLY script having run -- the 2026-09-22',
    '-- trigger (TRG_LOCATION_TRACKS_ATT_DATE) only fills ATTENDANCE_DATE when',
    "-- NULL, so it will not interfere with this UPDATE's explicit value.",
  ];
  const applyLines = [
    '-- APPLY: re-derive LOCATION_TRACKS.ATTENDANCE_DATE from each row\'s own',
    '-- session(s) (see repair_location_tracks_attendance_date.mjs for how).',
    '-- Prerequisite: TRG_LOCATION_TRACKS_ATT_DATE must be the 2026-09-22',
    "-- \"only fill when NULL\" version, or it will silently overwrite this",
    '-- UPDATE\'s value on the way in.',
    '-- Rows flagged OUT_OF_WINDOW in the matching backup CSV are NOT included',
    '-- here -- no session claims them, so there is no correct value to set;',
    '-- they need a human decision (see the CSV), not an automatic one.',
  ];

  let changed = 0;
  let unchanged = 0;
  let outOfWindow = 0;
  const reasonCounts = { NO_CHECKIN: 0, BEFORE_CHECKIN: 0, AFTER_CHECKOUT: 0, AFTER_CUTOFF: 0 };
  let within5min = 0;
  let onMultiPunchDay = 0;

  let examined = 0;
  for (const r of rows) {
    examined++;
    const id = r.ID;
    const cardNo = r.CARD_NO;
    const recordedAtUtc = r.RECORDED_AT_UTC; // "YYYY-MM-DD HH:MM:SS", UTC-naive
    const oldDate = r.OLD_ATTENDANCE_DATE;

    const localYmd = utcNaiveToLocalYmd(recordedAtUtc);
    const prevYmd = addDaysYmd(localYmd, -1);

    const windowsToday = await windowsFor(cardNo, localYmd);
    const windowsPrev = await windowsFor(cardNo, prevYmd);

    let newDate = null;
    if (isWithinAnyWindow(windowsToday, recordedAtUtc)) newDate = localYmd;
    else if (isWithinAnyWindow(windowsPrev, recordedAtUtc)) newDate = prevYmd;

    if (!newDate) {
      outOfWindow++;
      const allWindows = [...windowsPrev, ...windowsToday];
      const { reason, minutesToBoundary } = classifyMiss(recordedAtUtc, allWindows);
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
      if (minutesToBoundary !== null && minutesToBoundary <= 5) within5min++;
      const multiPunch = windowsToday.length > 1 || windowsPrev.length > 1;
      if (multiPunch) onMultiPunchDay++;

      csvLines.push(
        [
          id, cardNo, oldDate, '', recordedAtUtc, 'OUT_OF_WINDOW',
          reason, minutesToBoundary ?? '', multiPunch ? 'Y' : 'N',
        ].map(csvEscape).join(','),
      );
      continue;
    }

    if (newDate === oldDate) {
      unchanged++;
      continue; // not a "changed record" -- convention says one row per CHANGED record
    }

    changed++;
    csvLines.push(
      [id, cardNo, oldDate, newDate, recordedAtUtc, '', '', '', ''].map(csvEscape).join(','),
    );
    restoreLines.push(`UPDATE LOCATION_TRACKS SET ATTENDANCE_DATE = ${sqlDate(oldDate)} WHERE ID = ${id};`);
    applyLines.push(`UPDATE LOCATION_TRACKS SET ATTENDANCE_DATE = ${sqlDate(newDate)} WHERE ID = ${id};`);

    if (changed % 2000 === 0) console.log(`...${changed} changed so far (${examined}/${rows.length} examined)`);
  }

  restoreLines.push('COMMIT;');
  applyLines.push('COMMIT;');

  fs.writeFileSync(csvPath, csvLines.join('\n') + '\n', 'utf-8');
  fs.writeFileSync(restorePath, restoreLines.join('\n') + '\n', 'utf-8');
  fs.writeFileSync(applyPath, applyLines.join('\n') + '\n', 'utf-8');

  console.log('\n--- Summary ---');
  console.log('Total rows examined:      ', rows.length);
  console.log('Changed (needs repair):   ', changed);
  console.log('Unchanged (already right):', unchanged);
  console.log('Out of every window:      ', outOfWindow, '(flagged only, not touched)');
  console.log('  by reason:');
  for (const [reason, n] of Object.entries(reasonCounts)) {
    console.log(`    ${reason.padEnd(14)} ${n}`);
  }
  console.log('  within 5 min of a boundary:', within5min);
  console.log('  on a multi-punch-pair day: ', onMultiPunchDay);
  console.log('\nWrote:');
  console.log(' ', csvPath);
  console.log(' ', restorePath);
  console.log(' ', applyPath);

  await connection.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
