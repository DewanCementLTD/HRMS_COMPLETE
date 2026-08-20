/**
 * Shared TMS_DUTY_ROSTER_V status helpers — mirrors the FastAPI LMS-Backend
 * (repositories/attendance_repository.py): _clean_hhmm, _roster_status.
 * Used by both attendance.service.js and hrms.service.js so the two report
 * surfaces (/auth/attendance/* and /hrms/attendance/*) derive status identically.
 */

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

/** Return an 'HH:MI' string, or null for empty/':' placeholders the ERP leaves
 *  in IN_TIME / OUT_TIME when there was no punch. */
export const cleanHHMM = (s) => {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  if (!t || t === ':' || hhmmToMin(t) === null) return null;
  return t.slice(0, 5);
};

/** Minutes between two HH:MI strings. If exit is earlier than entry the shift
 *  crossed midnight, so add a full day. */
export const timeSpentMinutes = (entry, exit_) => {
  const e = hhmmToMin(entry);
  const x = hhmmToMin(exit_);
  if (e === null || x === null) return 0;
  let diff = x - e;
  if (diff < 0) diff += 1440;
  return Math.max(diff, 0);
};

/** Collapse the ERP roster flags into a single status label. Order matters:
 *  late / half-day imply the person attended, so they win over the ABSENT
 *  default; a row is only 'Absent' when flagged absent AND has no punch. */
export const rosterStatus = (inTime, outTime, absent, morningLate, earlyOutLate, halfDay) => {
  const ml = String(morningLate ?? '').trim().toUpperCase();
  const eol = String(earlyOutLate ?? '').trim().toUpperCase();
  const hasPunch = Boolean(inTime) || Boolean(outTime);
  const hd = Number(halfDay ?? 0) || 0;
  if (ml === 'Y' || eol === 'Y') return 'Late';
  if (hd > 0) return 'Half Day';
  if (absent && Number(absent) === 1 && !hasPunch) return 'Absent';
  if (hasPunch) return 'Present';
  return 'Off';
};
