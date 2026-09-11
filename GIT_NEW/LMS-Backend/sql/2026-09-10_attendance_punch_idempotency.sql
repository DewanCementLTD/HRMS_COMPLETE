-- ---------------------------------------------------------------------------
-- Attendance punch idempotency — LMS_PUNCH_EVENT
--
-- The mobile app now sends a CLIENT_EVENT_ID (its own UUID) with every punch and
-- retries the SAME id when a response goes missing. Without a server-side
-- record of what that id already did, a retry is simply a second punch — and
-- because the server turns a second tap more than 60 minutes after check-in
-- into a check-OUT, that retry can end the employee's day. 14 employee-days in
-- the 30 days to 2026-09-10 carry a 60-150 minute "work day", which is what
-- that looks like in the data.
--
-- Why a separate table rather than a column on ATTENDANCE_RECORDS: one
-- attendance row holds BOTH the check-in and the check-out for a day, so it has
-- nowhere to keep two different event ids. This table is the record of
-- attempts; ATTENDANCE_RECORDS stays the record of attendance.
--
-- RESULT_JSON holds the exact response the first attempt produced, so a replay
-- is answered with the original answer instead of being processed again.
--
-- Rows are disposable: the service deletes anything older than a week. Nothing
-- reads them except the replay check.
--
-- Safe to re-run: every statement checks for its own object first.
-- ---------------------------------------------------------------------------

-- 1. One row per punch attempt, keyed by the phone's own event id.
DECLARE
  n NUMBER;
BEGIN
  SELECT COUNT(*) INTO n FROM USER_TABLES WHERE TABLE_NAME = 'LMS_PUNCH_EVENT';
  IF n = 0 THEN
    EXECUTE IMMEDIATE '
      CREATE TABLE LMS_PUNCH_EVENT (
        CLIENT_EVENT_ID  VARCHAR2(100) NOT NULL,
        CARD_NO          VARCHAR2(30),
        ATTENDANCE_DATE  DATE,
        STATE            VARCHAR2(20) DEFAULT ''IN_PROGRESS'' NOT NULL,
        HTTP_STATUS      NUMBER,
        RESULT_JSON      CLOB,
        CREATED_AT       DATE DEFAULT SYSDATE NOT NULL,
        COMPLETED_AT     DATE,
        CONSTRAINT LMS_PUNCH_EVENT_PK PRIMARY KEY (CLIENT_EVENT_ID)
      )';
  END IF;
END;
/

-- 2. Housekeeping lookup (delete-by-age) and per-employee diagnostics.
DECLARE
  n NUMBER;
BEGIN
  SELECT COUNT(*) INTO n FROM USER_INDEXES WHERE INDEX_NAME = 'LMS_PUNCH_EVENT_AGE_IX';
  IF n = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX LMS_PUNCH_EVENT_AGE_IX ON LMS_PUNCH_EVENT (CREATED_AT)';
  END IF;

  SELECT COUNT(*) INTO n FROM USER_INDEXES WHERE INDEX_NAME = 'LMS_PUNCH_EVENT_CARD_IX';
  IF n = 0 THEN
    EXECUTE IMMEDIATE 'CREATE INDEX LMS_PUNCH_EVENT_CARD_IX ON LMS_PUNCH_EVENT (CARD_NO, ATTENDANCE_DATE)';
  END IF;
END;
/

-- Verify
SELECT table_name FROM user_tables  WHERE table_name = 'LMS_PUNCH_EVENT';
SELECT index_name FROM user_indexes WHERE table_name = 'LMS_PUNCH_EVENT';
