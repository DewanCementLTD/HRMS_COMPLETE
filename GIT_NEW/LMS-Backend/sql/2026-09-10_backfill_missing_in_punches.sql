-- ============================================================================
-- Backfill: check-ins the ERP filed as check-outs (see
-- 2026-09-10_attendance_in_out_intent.sql for the cause)
-- ============================================================================
-- Every affected day looks the same: ATTENDANCE_RECORDS has the employee's
-- ENTRY_TIME, but their DUTY_ROSTER row has IN_TIME null (and usually OUT_TIME
-- holding that same check-in time), so the day reads as Absent.
--
-- This re-posts the missing punch through the ERP's own pipeline — MACHINEDATA
-- -> AFTR_IMP_DATA_SET_ROSTER -> DUTY_ROSTER — rather than writing IN_TIME by
-- hand. The trigger sets IN_DATE, IN_DT_TM, SHIFT_START_TIME, HALF_DAY_TIME and
-- clears ABSENT_DAYS / SANDWICH / ROSTER_REMARKS in the same step, so the
-- corrected day is indistinguishable from one that posted correctly. Writing
-- DUTY_ROSTER.IN_TIME directly would leave every one of those derived columns
-- stale, and the absent flag still set.
--
-- RUN THE TRIGGER FIX FIRST. Re-posting before it is in place is harmless (this
-- script forces STATUS='IN' itself) but new punches would keep going wrong.
--
-- Order: (1) preview, (2) backfill, (3) verify. Adjust :from_date / :to_date.
-- The re-post is idempotent in effect — AFTR_IMP_DATA_SET_ROSTER only fills
-- IN_TIME "WHERE in_time IS NULL" — but it does add a MACHINEDATA row each
-- time, so run it once per range.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. PREVIEW — who gets corrected, and to what
-- ---------------------------------------------------------------------------
SELECT h.NAME                     AS employee,
       ar.EMPCODE                 AS empcode,
       (SELECT MIN(l.DESCR) FROM COM_LOCATION l
         WHERE TRIM(l.LCODE) = TRIM(h.LOCATION))            AS branch,
       TO_CHAR(ar.ATTENDANCE_DATE, 'YYYY-MM-DD')            AS day,
       ar.ENTRY_TIME              AS app_check_in,
       dr.IN_TIME                 AS roster_in_now,
       dr.OUT_TIME                AS roster_out_now
  FROM ATTENDANCE_RECORDS ar
  JOIN HR_EMP_MASTER h  ON h.EMPCODE = ar.EMPCODE
  JOIN DUTY_ROSTER   dr ON TO_CHAR(dr.CARD_NO) = TO_CHAR(ar.CARD_NO)
                       AND TRUNC(dr.ROSTER_DATE) = TRUNC(ar.ATTENDANCE_DATE)
 WHERE ar.ENTRY_TIME IS NOT NULL
   AND REGEXP_LIKE(ar.ENTRY_TIME, '^[0-9][0-9]:[0-9][0-9]$')
   AND dr.IN_TIME IS NULL
   AND ar.ATTENDANCE_DATE BETWEEN TO_DATE('&from_date', 'YYYY-MM-DD')
                              AND TO_DATE('&to_date',   'YYYY-MM-DD')
 ORDER BY branch, employee, day;

-- ---------------------------------------------------------------------------
-- 2. BACKFILL — re-post each missing check-in as an IN punch
-- ---------------------------------------------------------------------------
INSERT INTO MACHINEDATA
  (EMP_CODE, ADATE, HH, MM, STATUS, TERMINAL, POSTED, IP,
   FILE_FROM, MACHINENUM, COMPC, BRNCH, SHIFT)
SELECT ar.EMPCODE,
       TO_CHAR(ar.ATTENDANCE_DATE, 'DD-MON-RR'),
       SUBSTR(ar.ENTRY_TIME, 1, 2),
       SUBSTR(ar.ENTRY_TIME, 4, 2),
       'IN',
       NULL, 'N', NULL,
       -- Marked distinctly so this correction is auditable later.
       'APP-FIX',
       NULL,
       dr.COMPC, dr.BRNCH, dr.ROSTER_SHIFT
  FROM ATTENDANCE_RECORDS ar
  JOIN DUTY_ROSTER dr ON TO_CHAR(dr.CARD_NO) = TO_CHAR(ar.CARD_NO)
                     AND TRUNC(dr.ROSTER_DATE) = TRUNC(ar.ATTENDANCE_DATE)
 WHERE ar.ENTRY_TIME IS NOT NULL
   AND REGEXP_LIKE(ar.ENTRY_TIME, '^[0-9][0-9]:[0-9][0-9]$')
   AND dr.IN_TIME IS NULL
   AND dr.COMPC IS NOT NULL
   AND dr.BRNCH IS NOT NULL
   AND ar.ATTENDANCE_DATE BETWEEN TO_DATE('&from_date', 'YYYY-MM-DD')
                              AND TO_DATE('&to_date',   'YYYY-MM-DD');

-- COMMIT;   -- uncomment once the preview and the row count look right

-- ---------------------------------------------------------------------------
-- 3. VERIFY — should return no rows for the range once the backfill commits
-- ---------------------------------------------------------------------------
SELECT COUNT(*) AS still_missing
  FROM ATTENDANCE_RECORDS ar
  JOIN DUTY_ROSTER dr ON TO_CHAR(dr.CARD_NO) = TO_CHAR(ar.CARD_NO)
                     AND TRUNC(dr.ROSTER_DATE) = TRUNC(ar.ATTENDANCE_DATE)
 WHERE ar.ENTRY_TIME IS NOT NULL
   AND dr.IN_TIME IS NULL
   AND ar.ATTENDANCE_DATE BETWEEN TO_DATE('&from_date', 'YYYY-MM-DD')
                              AND TO_DATE('&to_date',   'YYYY-MM-DD');
