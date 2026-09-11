-- ---------------------------------------------------------------------------
-- Offline location sync — idempotency support on LOCATION_TRACKS
--
-- The mobile app now writes every GPS fix to SQLite first and uploads later, so
-- the same point can legitimately be sent more than once: the phone retries
-- whenever a response is lost. CLIENT_EVENT_ID is the phone's own UUID for a
-- fix, and the unique index is what makes a retry a no-op instead of a
-- duplicate row.
--
-- Nullable on purpose. Oracle's B-tree unique indexes do not index all-NULL
-- keys, so the 16,646 rows already in the table and the older app builds still
-- using POST /auth/location/batch (which sends no UUID) keep working untouched.
--
-- Safe to re-run: every statement checks for its own object first.
-- ---------------------------------------------------------------------------

-- 1. The client's own identifier for a captured fix.
DECLARE
  n NUMBER;
BEGIN
  SELECT COUNT(*) INTO n
    FROM USER_TAB_COLS
   WHERE TABLE_NAME = 'LOCATION_TRACKS' AND COLUMN_NAME = 'CLIENT_EVENT_ID';
  IF n = 0 THEN
    EXECUTE IMMEDIATE 'ALTER TABLE LOCATION_TRACKS ADD (CLIENT_EVENT_ID VARCHAR2(100))';
  END IF;
END;
/

-- 2. One row per client event. This is the whole idempotency guarantee: a
--    replayed upload raises ORA-00001 and the service reports the point as
--    already synchronised rather than inserting it again.
DECLARE
  n NUMBER;
BEGIN
  SELECT COUNT(*) INTO n
    FROM USER_INDEXES
   WHERE INDEX_NAME = 'LOCATION_TRACKS_CEID_UX';
  IF n = 0 THEN
    EXECUTE IMMEDIATE
      'CREATE UNIQUE INDEX LOCATION_TRACKS_CEID_UX ON LOCATION_TRACKS (CLIENT_EVENT_ID)';
  END IF;
END;
/

-- 3. A single source of row IDs.
--    The table has no trigger and the existing insert derives its ID from
--    SELECT NVL(MAX(ID),0)+n, which two concurrent uploads can resolve to the
--    same number — precisely the situation batch sync creates when several
--    phones come back online together. The sequence starts above the current
--    maximum so it can never collide with what is already stored.
DECLARE
  n       NUMBER;
  max_id  NUMBER;
BEGIN
  SELECT COUNT(*) INTO n FROM USER_SEQUENCES WHERE SEQUENCE_NAME = 'LOCATION_TRACKS_SEQ';
  IF n = 0 THEN
    SELECT NVL(MAX(ID), 0) + 1 INTO max_id FROM LOCATION_TRACKS;
    EXECUTE IMMEDIATE
      'CREATE SEQUENCE LOCATION_TRACKS_SEQ START WITH ' || max_id || ' INCREMENT BY 1 NOCACHE NOCYCLE';
  END IF;
END;
/

-- 4. Sync-status lookups scan by card and recorded_at (the "what have I already
--    got for this employee" query the phone's reconciliation relies on).
DECLARE
  n NUMBER;
BEGIN
  SELECT COUNT(*) INTO n
    FROM USER_INDEXES
   WHERE INDEX_NAME = 'LT_CARD_RECORDED_IDX';
  IF n = 0 THEN
    EXECUTE IMMEDIATE
      'CREATE INDEX LT_CARD_RECORDED_IDX ON LOCATION_TRACKS (CARD_NO, RECORDED_AT)';
  END IF;
END;
/

COMMIT;
