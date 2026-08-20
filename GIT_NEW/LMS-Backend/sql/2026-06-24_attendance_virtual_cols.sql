-- ============================================================================
-- ATTENDANCE_RECORDS — add derived display columns (IN_DT, OUT_DT, TOTAL_HOURS)
-- ============================================================================
-- Adds three VIRTUAL (generated) columns that present existing attendance data
-- in a friendlier format. They are computed at read time from ENTRY_TIME /
-- EXIT_TIME / ATTENDANCE_DATE / TIME_SPENT, so:
--   * every existing row shows a value immediately (no backfill needed),
--   * every future check-in / check-out fills them automatically,
--   * they can never get out of sync, and
--   * the application write path is untouched (the app's MERGE/UPDATE use
--     explicit column lists that do not include these — virtual columns cannot
--     be written to).
--
-- IN_DT / OUT_DT were originally pre-added as empty physical VARCHAR2(50)
-- columns; this drops those and re-adds them as virtual. If they do not exist
-- on the target environment, just skip the DROP.
-- ============================================================================

-- Remove the empty physical placeholders (safe: they were unpopulated and
-- unreferenced). Comment this out if IN_DT/OUT_DT do not already exist.
ALTER TABLE ATTENDANCE_RECORDS DROP (IN_DT, OUT_DT);

-- Check-in date-time: ATTENDANCE_DATE + ENTRY_TIME, formatted DD-MON-YY HH24:MI.
ALTER TABLE ATTENDANCE_RECORDS ADD (
  IN_DT VARCHAR2(30) GENERATED ALWAYS AS (
    CASE WHEN ATTENDANCE_DATE IS NOT NULL
          AND REGEXP_LIKE(ENTRY_TIME, '^[0-9]{2}:[0-9]{2}$')
         THEN TO_CHAR(
                TRUNC(ATTENDANCE_DATE)
                + TO_NUMBER(SUBSTR(ENTRY_TIME, 1, 2)) / 24
                + TO_NUMBER(SUBSTR(ENTRY_TIME, 4, 2)) / 1440,
                'DD-MON-YY HH24:MI', 'NLS_DATE_LANGUAGE=ENGLISH')
    END
  ) VIRTUAL
);

-- Check-out date-time comes from the EXIT_DATE column (a real DATE = the actual
-- check-out instant; the app sets it on check-out and OUT_DT formats it).
-- Backfill EXIT_DATE for existing completed rows from ATTENDANCE_DATE + EXIT_TIME,
-- rolling to the next day for overnight shifts (EXIT_TIME < ENTRY_TIME).
UPDATE ATTENDANCE_RECORDS
   SET EXIT_DATE = TRUNC(ATTENDANCE_DATE)
                 + TO_NUMBER(SUBSTR(EXIT_TIME, 1, 2)) / 24
                 + TO_NUMBER(SUBSTR(EXIT_TIME, 4, 2)) / 1440
                 + CASE WHEN EXIT_TIME < ENTRY_TIME THEN 1 ELSE 0 END
 WHERE EXIT_DATE IS NULL
   AND REGEXP_LIKE(EXIT_TIME, '^[0-9]{2}:[0-9]{2}$');
COMMIT;

-- OUT_DT is simply EXIT_DATE formatted DD-MON-YY HH24:MI.
ALTER TABLE ATTENDANCE_RECORDS ADD (
  OUT_DT VARCHAR2(30) GENERATED ALWAYS AS (
    TO_CHAR(EXIT_DATE, 'DD-MON-YY HH24:MI', 'NLS_DATE_LANGUAGE=ENGLISH')
  ) VIRTUAL
);

-- Total worked time as HRS:MINS (zero-padded HH:MM) from TIME_SPENT (minutes).
ALTER TABLE ATTENDANCE_RECORDS ADD (
  TOTAL_HOURS VARCHAR2(20) GENERATED ALWAYS AS (
    CASE WHEN TIME_SPENT IS NOT NULL
         THEN LPAD(TO_CHAR(FLOOR(TIME_SPENT / 60)), 2, '0') || ':'
              || LPAD(TO_CHAR(MOD(TIME_SPENT, 60)), 2, '0')
    END
  ) VIRTUAL
);
