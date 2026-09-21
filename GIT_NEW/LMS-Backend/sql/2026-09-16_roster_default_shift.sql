-- ============================================================================
-- Per-branch roster defaults — LMS_ROSTER_DEFAULT
-- ============================================================================
-- Every roster day's shift is currently decided by one hardcoded IF in the
-- INSERT_PK_ROSTER trigger:
--
--     IF UPPER(:new.day_name) = 'SUNDAY' THEN 'R' ELSE 'G' END IF;
--
-- identically for every company and branch. Of 838 employees with future
-- rosters, 832 are on G+R and the six exceptions were all set by hand. No
-- company whose real shift is anything but General can express that.
--
-- This table holds what each company/branch actually runs. The backend applies
-- it after CREATE_DUTY_ROSTER_PRO generates new days, and HR can also apply it
-- to a date range on demand (the "mass shift change").
--
--   DEFAULT_SHIFT  the working-day shift code, e.g. 'G' or 'N'. Must exist in
--                  SHIFT_HEAD for that company/branch.
--   REST_DAYS      ISO weekday numbers, comma separated: 1 = Monday … 7 = Sunday.
--                  Defaults to '7' (Sunday), which is exactly what the trigger
--                  does today, so a branch with no row behaves as it always has.
--
-- Nothing is applied to a day HR has edited by hand: DUTY_ROSTER.UPDATED is set
-- by both edit paths, and rows carrying it are always left alone.
--
-- Safe to re-run.
-- ============================================================================

DECLARE
  n NUMBER;
BEGIN
  SELECT COUNT(*) INTO n FROM USER_TABLES WHERE TABLE_NAME = 'LMS_ROSTER_DEFAULT';
  IF n = 0 THEN
    EXECUTE IMMEDIATE '
      CREATE TABLE LMS_ROSTER_DEFAULT (
        COMPC          NUMBER        NOT NULL,
        BRNCH          NUMBER        NOT NULL,
        DEFAULT_SHIFT  VARCHAR2(10)  NOT NULL,
        REST_DAYS      VARCHAR2(20)  DEFAULT ''7'' NOT NULL,
        UPDATED_BY     VARCHAR2(50),
        UPDATED_AT     DATE DEFAULT SYSDATE NOT NULL,
        CONSTRAINT LMS_ROSTER_DEFAULT_PK PRIMARY KEY (COMPC, BRNCH)
      )';
  END IF;
END;
/

-- Verify
SELECT table_name FROM user_tables WHERE table_name = 'LMS_ROSTER_DEFAULT';
SELECT * FROM LMS_ROSTER_DEFAULT ORDER BY COMPC, BRNCH;
