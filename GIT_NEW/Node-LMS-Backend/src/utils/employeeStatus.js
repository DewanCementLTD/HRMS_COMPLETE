/**
 * Employment status — the one place that decides who is still an employee.
 *
 * HR_EMP_MASTER.STATUS has exactly two meanings now:
 *
 *   'A'  Active — works here. Can log in, mark attendance, be tracked.
 *   'L'  Left   — no longer works here. Cannot log in, cannot mark attendance,
 *                 location tracking is off. The record stays for history.
 *
 * Two legacy codes are still in the data and are treated as Left:
 *   'D'  61 employees, every one with a resignation date on file.
 *   'I'  the old "Inactive", which never actually stopped anybody — until this
 *        module, nothing anywhere checked STATUS at all, so people marked
 *        Inactive or Left kept logging in and punching. Eight of them punched
 *        in the thirty days to 2026-09-15.
 *
 * A NULL status counts as Active, matching the dashboard queries that have
 * always read `STATUS = 'A' OR STATUS IS NULL`: a missing status is a gap in the
 * record, and a gap must not lock somebody out of their own attendance.
 */

export const EMPLOYEE_STATUS = Object.freeze({
  ACTIVE: 'A',
  LEFT: 'L',
});

/** The only two options HR may choose between. */
export const EMPLOYEE_STATUS_OPTIONS = Object.freeze([
  { code: 'A', label: 'Active' },
  { code: 'L', label: 'Left' },
]);

/** Legacy codes that mean the person no longer works here. */
export const LEGACY_LEFT_CODES = Object.freeze(['D', 'I']);

/** Every code that should be read as "has left", including the legacy ones. */
export const LEFT_CODES = Object.freeze([EMPLOYEE_STATUS.LEFT, ...LEGACY_LEFT_CODES]);

const clean = (raw) => String(raw ?? '').trim().toUpperCase();

/**
 * Is this person still employed?
 *
 * Only 'A' and an absent status qualify. Anything else — 'L', the legacy 'D'
 * and 'I', or a code nobody recognises — is treated as having left, because the
 * safe reading of an unknown status is "do not grant access".
 */
export const isActiveStatus = (raw) => {
  const s = clean(raw);
  return s === '' || s === EMPLOYEE_STATUS.ACTIVE;
};

/**
 * Fold any stored status into the two-value world.
 * Returns 'A' or 'L' — never null, never a legacy code.
 */
export const normalizeStatus = (raw) =>
  isActiveStatus(raw) ? EMPLOYEE_STATUS.ACTIVE : EMPLOYEE_STATUS.LEFT;

/**
 * Validate a status coming from a client. Accepts the two real codes and folds
 * the legacy ones; rejects anything else so a typo cannot invent a third state.
 */
export const parseStatusInput = (raw) => {
  const s = clean(raw);
  if (!s) return null; // "not supplied" — the caller decides what that means
  if (s === EMPLOYEE_STATUS.ACTIVE || s === EMPLOYEE_STATUS.LEFT) return s;
  if (LEGACY_LEFT_CODES.includes(s)) return EMPLOYEE_STATUS.LEFT;
  return undefined; // invalid
};

/** What the employee is told when their record is not active. */
export const LEFT_EMPLOYEE_MESSAGE =
  'This employee record is marked as Left, so it no longer has access. Please contact HR.';
