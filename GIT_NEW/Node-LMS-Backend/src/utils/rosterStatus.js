/**
 * TMS_DUTY_ROSTER_V — the one place a roster day is turned into a status and a
 * printable remark.
 *
 * Every attendance and roster surface reads this view and derives its labels
 * here, so /auth/attendance/*, /hrms/attendance/*, the monthly duty roster and
 * the Reports pack can never disagree about the same day.
 *
 * ── Precedence, and why it is in this order ───────────────────────────────
 *
 *   1. LEAVE_TYPE_FK set             → "Leave (CL)"   an approved, granted day
 *   2. HOLIDAY_FK set                → "Holiday"
 *   3. ROSTER_SHIFT = 'R'            → "Off"          rostered rest day
 *   4. ABSENT = 1  or  no IN_TIME    → "Absent"
 *   5. MORNING_LATE     ('Y')        → "Morning Late"
 *   6. MORNING_HALF_DAY (has data)   → "Morning Half Day"
 *   7. EARLY_OUT_LATE   ('Y')        → "Early Out Late"
 *   8. EAR_OUT_HALF_DAY (has data)   → "Early Out Half Day"
 *   9. otherwise                     → "Present"
 *
 * Rules 1-3 sit above the rest because a day that was never a working day
 * cannot be an absence, and the data agrees: across 99,773 rows the ERP leaves
 * ABSENT null on every one of the 14,163 rest days and all 18 leave days.
 * Without those guards, "no IN_TIME means absent" would mark every Sunday and
 * every approved leave day as an absence.
 *
 * ── Status is one label; the remark is all of them ────────────────────────
 *
 * Rules 4-8 are not exclusive: a day can be absent AND late AND half-day at
 * once, and the ERP does record all three together. `status` is the first
 * label that applied — absence leads whenever ABSENT = 1 or the IN punch is
 * missing — while `flags` keeps every one of them, and the remark joins them:
 *
 *   ABSENT=1, MORNING_LATE=Y                    → "Absent — Morning Late"
 *   ABSENT=1, MORNING_LATE=Y, MORNING_HALF_DAY  → "Absent — Morning Late — Morning Half Day"
 *   MORNING_LATE=Y only                         → "Morning Late"
 *
 * So the status column stays scannable while the remark loses nothing.
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

/** An 'HH:MI' string, or null for the empty / ':' placeholders the ERP leaves
 *  in IN_TIME / OUT_TIME when there was no punch. */
export const cleanHHMM = (s) => {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  if (!t || t === ':' || hhmmToMin(t) === null) return null;
  return t.slice(0, 5);
};

/** Minutes between two HH:MI strings; a shift crossing midnight adds a day. */
export const timeSpentMinutes = (entry, exit_) => {
  const e = hhmmToMin(entry);
  const x = hhmmToMin(exit_);
  if (e === null || x === null) return 0;
  let diff = x - e;
  if (diff < 0) diff += 1440;
  return Math.max(diff, 0);
};

export const STATUS = {
  LEAVE: 'Leave',
  HOLIDAY: 'Holiday',
  OFF: 'Off',
  ABSENT: 'Absent',
  MORNING_LATE: 'Morning Late',
  MORNING_HALF_DAY: 'Morning Half Day',
  EARLY_OUT_LATE: 'Early Out Late',
  EARLY_OUT_HALF_DAY: 'Early Out Half Day',
  PRESENT: 'Present',
};

/** 'Y' in a CHAR(1) flag column. */
const isY = (v) => String(v ?? '').trim().toUpperCase() === 'Y';

/** A NUMBER flag that carries data — MORNING_HALF_DAY holds 0.5, never 0. */
const hasValue = (v) => v !== null && v !== undefined && Number(v) > 0;

/**
 * Derive everything a roster day needs for display.
 *
 * Takes the raw view columns and returns the single status label, every flag
 * that applied, and the printable remark.
 *
 * @param {object} r
 * @param {string|null} r.in_time            IN_TIME (raw or cleaned)
 * @param {string|null} r.out_time           OUT_TIME
 * @param {number|null} r.absent             ABSENT           (1 or null)
 * @param {string|null} r.morning_late       MORNING_LATE     ('Y' or null)
 * @param {number|null} r.morning_half_day   MORNING_HALF_DAY (0.5 or null)
 * @param {string|null} r.early_out_late     EARLY_OUT_LATE
 * @param {number|null} r.ear_out_half_day   EAR_OUT_HALF_DAY
 * @param {string|null} r.roster_shift       ROSTER_SHIFT     ('R' = rest)
 * @param {number|null} r.holiday_fk         HOLIDAY_FK
 * @param {number|null} r.leave_type_fk      LEAVE_TYPE_FK
 * @param {string|null} r.leave_type         e.g. 'CL'
 * @param {string|null} r.leave_desc         e.g. 'CASUAL LEAVE'
 * @param {string|null} r.leave_remarks      the employee's own reason
 * @param {string|null} r.roster_remarks     ROSTER_REMARKS
 */
export const deriveRosterDay = (r = {}) => {
  const inTime = cleanHHMM(r.in_time);
  const outTime = cleanHHMM(r.out_time);

  const onLeave = r.leave_type_fk !== null && r.leave_type_fk !== undefined;
  const isHoliday = r.holiday_fk !== null && r.holiday_fk !== undefined;
  const isRest = String(r.roster_shift ?? '').trim().toUpperCase() === 'R';

  const morningLate = isY(r.morning_late);
  const morningHalfDay = hasValue(r.morning_half_day);
  const earlyOutLate = isY(r.early_out_late);
  const earlyOutHalfDay = hasValue(r.ear_out_half_day);
  const absentFlag = Number(r.absent ?? 0) === 1;
  const noPunchIn = !inTime;

  const leaveType = String(r.leave_type ?? '').trim();
  const leaveDesc = String(r.leave_desc ?? '').trim();
  const leaveRemarks = String(r.leave_remarks ?? '').trim();
  const rosterRemarks = String(r.roster_remarks ?? '').trim();

  // Every label that applies to this day, most significant first. The status is
  // the first of them; the remark is all of them, so a day that is both absent
  // and late reports both.
  const flags = [];
  if (onLeave) flags.push(leaveType ? `${STATUS.LEAVE} (${leaveType})` : STATUS.LEAVE);
  else if (isHoliday) flags.push(STATUS.HOLIDAY);
  else if (isRest) flags.push(STATUS.OFF);
  else {
    // Absence leads whenever the ERP flags it or the IN punch is missing, and
    // the late / half-day flags are collected alongside rather than instead —
    // a day that is absent AND late reports both in the remark.
    if (absentFlag || noPunchIn) flags.push(STATUS.ABSENT);
    if (morningLate) flags.push(STATUS.MORNING_LATE);
    if (morningHalfDay) flags.push(STATUS.MORNING_HALF_DAY);
    if (earlyOutLate) flags.push(STATUS.EARLY_OUT_LATE);
    if (earlyOutHalfDay) flags.push(STATUS.EARLY_OUT_HALF_DAY);
    if (flags.length === 0) flags.push(STATUS.PRESENT);
  }

  const status = flags[0];
  const isAbsent = status === STATUS.ABSENT;

  // What prints in the Remarks column. A leave day leads with the leave and the
  // employee's own reason; everything else leads with the derived flags, and
  // the roster's own remark is appended when it adds something.
  let remarks;
  if (onLeave) {
    remarks = [leaveDesc || leaveType, leaveRemarks, rosterRemarks].filter(Boolean).join(' — ');
  } else if (status === STATUS.PRESENT) {
    // Nothing noteworthy happened; only the roster's own note is worth showing.
    remarks = rosterRemarks || null;
  } else {
    const derived = flags.join(' — ');
    // Skip a roster remark that just repeats what the flags already say.
    const adds = rosterRemarks && rosterRemarks.toUpperCase() !== derived.toUpperCase();
    remarks = adds ? `${derived} — ${rosterRemarks}` : derived;
  }

  return {
    status,
    flags,
    remarks: remarks || null,
    in_time: inTime,
    out_time: outTime,
    is_leave: onLeave,
    is_holiday: isHoliday,
    is_rest: isRest,
    is_absent: isAbsent,
    is_late: morningLate || earlyOutLate,
    is_half_day: morningHalfDay || earlyOutHalfDay,
    is_morning_late: morningLate,
    is_morning_half_day: morningHalfDay,
    is_present: status === STATUS.PRESENT,
    leave_type: leaveType || null,
    leave_desc: leaveDesc || null,
    leave_remarks: leaveRemarks || null,
    roster_remarks: rosterRemarks || null,
  };
};

/**
 * Status label only.
 *
 * Kept because both attendance surfaces already call a function of this name;
 * it now delegates so there is exactly one implementation of the rules.
 */
export const rosterStatus = (rec) => deriveRosterDay(rec).status;
