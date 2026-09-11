-- ============================================================================
-- Clear the OUT_TIME left behind by the misfiled check-ins
-- ============================================================================
-- Run AFTER 2026-09-10_attendance_in_out_intent.sql and the Aug->Sep backfill.
--
-- While the old trigger was filing late check-ins as check-outs, each of those
-- punches wrote DUTY_ROSTER.OUT_TIME. The backfill restored the missing
-- IN_TIME, but that bogus OUT_TIME is still sitting there — so the day now
-- reads "checked in 12:41, checked out 12:41", i.e. present for zero hours.
--
-- These 279 rows (107 employees, 2026-08-01 .. 2026-09-10) are identified by
-- three conditions together, which no genuine day satisfies:
--   * the roster's OUT_TIME is exactly equal to its IN_TIME, and
--   * the app's own ATTENDANCE_RECORDS row for that day has EXIT_TIME NULL,
--     i.e. the employee never actually checked out.
-- Verified before writing this: zero rows in that range have OUT_TIME = IN_TIME
-- together with a real check-out in the app, so nothing genuine is in scope.
--
-- After this the day reads "checked in, no check-out", which is what happened.
-- ============================================================================

-- 1. PREVIEW — expect 279 rows / 107 employees
SELECT COUNT(*) AS rows_to_clear, COUNT(DISTINCT dr.CARD_NO) AS employees
  FROM DUTY_ROSTER dr
  JOIN ATTENDANCE_RECORDS ar ON TO_CHAR(ar.CARD_NO) = TO_CHAR(dr.CARD_NO)
                            AND TRUNC(ar.ATTENDANCE_DATE) = TRUNC(dr.ROSTER_DATE)
 WHERE dr.IN_TIME IS NOT NULL
   AND dr.OUT_TIME = dr.IN_TIME
   AND ar.EXIT_TIME IS NULL
   AND TRUNC(dr.ROSTER_DATE) BETWEEN DATE '2026-08-01' AND DATE '2026-09-10';

-- 2. SAFETY CHECK — must return 0. If it does not, STOP: a real check-out would
--    be in scope and the WHERE clause below needs tightening first.
SELECT COUNT(*) AS genuine_checkouts_in_scope
  FROM DUTY_ROSTER dr
  JOIN ATTENDANCE_RECORDS ar ON TO_CHAR(ar.CARD_NO) = TO_CHAR(dr.CARD_NO)
                            AND TRUNC(ar.ATTENDANCE_DATE) = TRUNC(dr.ROSTER_DATE)
 WHERE dr.IN_TIME IS NOT NULL
   AND dr.OUT_TIME = dr.IN_TIME
   AND ar.EXIT_TIME IS NOT NULL
   AND TRUNC(dr.ROSTER_DATE) BETWEEN DATE '2026-08-01' AND DATE '2026-09-10';

-- 3. CLEAR
UPDATE DUTY_ROSTER dr
   SET OUT_TIME  = NULL,
       OUT_DATE  = NULL,
       OUT_DT_TM = NULL,
       W_HRS     = NULL,
       W_MNT     = NULL
 WHERE dr.IN_TIME IS NOT NULL
   AND dr.OUT_TIME = dr.IN_TIME
   AND TRUNC(dr.ROSTER_DATE) BETWEEN DATE '2026-08-01' AND DATE '2026-09-10'
   AND EXISTS (SELECT 1
                 FROM ATTENDANCE_RECORDS ar
                WHERE TO_CHAR(ar.CARD_NO) = TO_CHAR(dr.CARD_NO)
                  AND TRUNC(ar.ATTENDANCE_DATE) = TRUNC(dr.ROSTER_DATE)
                  AND ar.EXIT_TIME IS NULL);

-- Check the row count matches step 1 before committing.
-- COMMIT;

-- 4. VERIFY — step 1 should now return 0, and the number of days carrying a
--    check-in must be unchanged (this only clears check-OUTs).
SELECT COUNT(*) AS days_with_a_check_in
  FROM DUTY_ROSTER
 WHERE IN_TIME IS NOT NULL
   AND TRUNC(ROSTER_DATE) BETWEEN DATE '2026-08-01' AND DATE '2026-09-10';
