-- ---------------------------------------------------------------------------
-- ROLLBACK SNAPSHOT — TRG_ATTEN_REC_INTO_MACHINE_DATA as it stood in production
-- immediately before 2026-09-10_attendance_in_out_intent.sql was applied.
--
-- This is the CHANGE_ST clock-window version that filed any check-in made after
-- the branch cut-off as a check-out. Kept only so the change can be reversed
-- exactly; do not apply it as a fix.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER TRG_ATTEN_REC_INTO_MACHINE_DATA
  AFTER INSERT OR UPDATE ON ATTENDANCE_RECORDS
  FOR EACH ROW
DECLARE
  v_compc NUMBER;
  v_brnch NUMBER;
  v_shift VARCHAR2(20);
  v_mins  NUMBER;
  emp     number;
  TF      VARCHAR2(10);
  TT      VARCHAR2(10);
  DR      NUMBER;
  CS      VARCHAR2(10);
  STATS1  VARCHAR2(10) := 'NA';
  STATS2  VARCHAR2(10) := 'NA';
BEGIN
  -- Company / branch of the employee (from the employee master).
  BEGIN
    SELECT to_number(old_empcode), UNIT_ID, LOCATION
      INTO emp, v_compc, v_brnch
      FROM HR_EMP_MASTER
     WHERE EMPCODE = :NEW.EMPCODE;
  EXCEPTION
    WHEN OTHERS THEN
      v_compc := NULL;
      v_brnch := NULL;
  END;

  -- Shift code = the person's assigned shift for that date, taken from their
  -- DUTY_ROSTER row (matched by card or EMP_FK). SHIFT_HEAD then provides that
  -- shift's timings (used downstream for late / half-day / check-out windows).
  BEGIN
    SELECT MIN(ROSTER_SHIFT)
      INTO v_shift
      FROM DUTY_ROSTER
     WHERE CARD_NO = emp
       AND ROSTER_DATe = :NEW.ATTENDANCE_DATE;
  EXCEPTION
    WHEN OTHERS THEN
      v_shift := NULL;
  END;

  -- Fallback when the roster has no shift for that day: the company/branch
  -- default from SHIFT_HEAD (prefer exact branch, then General 'G').
  IF v_shift IS NULL THEN
    BEGIN
      SELECT shift
        INTO v_shift
        FROM (SELECT shift
                FROM SHIFT_HEAD
               WHERE compc = v_compc
               ORDER BY CASE
                          WHEN brnch = v_brnch THEN
                           0
                          ELSE
                           1
                        END,
                        CASE
                          WHEN shift = 'G' THEN
                           0
                          ELSE
                           1
                        END,
                        shift)
       WHERE ROWNUM = 1;
    EXCEPTION
      WHEN OTHERS THEN
        v_shift := NULL;
    END;
  END IF;
  ---------------------------  CHK SHIFT   
  BEGIN
    SELECT T.ALLOW_IN_TIME, T.TIME_TO, DIFF_HRS DURATION, T.CHNGST
      INTO TF, TT, DR, CS
      FROM (SELECT T.*,
                   (CASE
                     WHEN TO_DATE(T.TIME_TO, 'HH24:MI') <
                          TO_DATE(T.ALLOW_IN_TIME, 'HH24:MI') THEN
                      TO_DATE(T.TIME_TO, 'HH24:MI') + 1
                     ELSE
                      TO_DATE(T.TIME_TO, 'HH24:MI')
                   END - TO_DATE(T.ALLOW_IN_TIME, 'HH24:MI')) * 24 AS DIFF_HRS,
                   T.Change_St CHNGST
              FROM SHIFT_HEAD T
             WHERE compc = v_compc
               AND BRNCH = v_brnch
               AND SHIFT = v_shift) T;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      NULL;
  END;

  -------------------------------------------

  IF :NEW.ENTRY_TIME BETWEEN TF AND CS THEN
    STATS1 := 'IN';
  ELSe
    STATS1 := 'OUT';
  
  end if;

  if :NEW.EXIT_TIME BETWEEN TF AND CS THEN
    STATS2 := 'IN';
  ELSE
    STATS2 := 'OUT';
  END IF;

  if :NEW.ENTRY_TIME <> :old.ENTRY_TIME OR :old.ENTRY_TIME IS NULL
  
   then
    INSERT INTO MACHINEDATA
      (EMP_CODE,
       ADATE,
       HH,
       MM,
       STATUS,
       TERMINAL,
       POSTED,
       IP,
       FILE_FROM,
       MACHINENUM,
       COMPC,
       BRNCH,
       SHIFT)
    VALUES
      (:NEW.EMPCODE,
       TO_CHAR(:NEW.ATTENDANCE_DATE, 'DD-MON-RR'),
       SUBSTR(:NEW.ENTRY_TIME, 1, 2),
       SUBSTR(:NEW.ENTRY_TIME, 4, 2),
       STATS1,
       :NEW.DEVICE_TYPE,
       'N',
       :NEW.CLIENT_IP,
       'APP',
       :NEW.DEVICE_ID,
       v_compc,
       v_brnch,
       v_shift);
  elsif :NEW.exit_TIME <> :old.exit_TIME OR :old.EXIT_TIME IS NULL then
    INSERT INTO MACHINEDATA
      (EMP_CODE,
       ADATE,
       HH,
       MM,
       STATUS,
       TERMINAL,
       POSTED,
       IP,
       FILE_FROM,
       MACHINENUM,
       COMPC,
       BRNCH,
       SHIFT)
    VALUES
      (:NEW.EMPCODE,
       TO_CHAR(:NEW.ATTENDANCE_DATE, 'DD-MON-RR'),
       SUBSTR(:NEW.EXIT_TIME, 1, 2),
       SUBSTR(:NEW.EXIT_TIME, 4, 2),
       STATS2,
       :NEW.DEVICE_TYPE,
       'N',
       :NEW.CLIENT_IP,
       'APP',
       :NEW.DEVICE_ID,
       v_compc,
       v_brnch,
       v_shift);
  end if;

END;

/
