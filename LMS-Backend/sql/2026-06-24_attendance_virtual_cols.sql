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

-- Check-out date-time: rolls to the next day for overnight shifts (EXIT < ENTRY).
ALTER TABLE ATTENDANCE_RECORDS ADD (
  OUT_DT VARCHAR2(30) GENERATED ALWAYS AS (
    CASE WHEN ATTENDANCE_DATE IS NOT NULL
          AND REGEXP_LIKE(EXIT_TIME, '^[0-9]{2}:[0-9]{2}$')
         THEN TO_CHAR(
                TRUNC(ATTENDANCE_DATE)
                + TO_NUMBER(SUBSTR(EXIT_TIME, 1, 2)) / 24
                + TO_NUMBER(SUBSTR(EXIT_TIME, 4, 2)) / 1440
                + CASE WHEN EXIT_TIME < ENTRY_TIME THEN 1 ELSE 0 END,
                'DD-MON-YY HH24:MI', 'NLS_DATE_LANGUAGE=ENGLISH')
    END
  ) VIRTUAL
);

-- Total worked time as 'Xh Ym' from TIME_SPENT (minutes).
ALTER TABLE ATTENDANCE_RECORDS ADD (
  TOTAL_HOURS VARCHAR2(20) GENERATED ALWAYS AS (
    CASE WHEN TIME_SPENT IS NOT NULL
         THEN TO_CHAR(FLOOR(TIME_SPENT / 60), 'FM999999') || 'h '
              || TO_CHAR(MOD(TIME_SPENT, 60), 'FM99') || 'm'
    END
  ) VIRTUAL
);
