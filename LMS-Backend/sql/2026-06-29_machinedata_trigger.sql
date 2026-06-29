-- ============================================================================
-- ATTENDANCE_RECORDS -> MACHINEDATA trigger (shift-aware, 1-hour check-out rule)
-- ============================================================================
-- Mirrors app attendance marks into MACHINEDATA (the ERP machine-punch feed),
-- now with:
--   * COMPC / BRNCH resolved from the employee master,
--   * SHIFT taken from SHIFT_HEAD for that company/branch (prefer exact branch,
--     then the General 'G' shift),
--   * Check-IN written on insert (earliest mark — ATTENDANCE_RECORDS keeps min),
--   * Check-OUT written ONLY when EXIT is at least 60 minutes after check-in,
--     so a quick second mark never produces a check-out punch.
-- Does not change the existing ATTENDANCE_RECORDS columns/flow.
-- ============================================================================

CREATE OR REPLACE TRIGGER TRG_ATTEN_REC_INTO_MACHINE_DATA
AFTER INSERT OR UPDATE ON ATTENDANCE_RECORDS
FOR EACH ROW
DECLARE
  v_compc NUMBER;
  v_brnch NUMBER;
  v_shift VARCHAR2(20);
  v_mins  NUMBER;
BEGIN
  -- Company / branch of the employee (from the employee master).
  BEGIN
    SELECT TO_NUMBER(UNIT_ID),
           TO_NUMBER(REGEXP_SUBSTR(LOCATION, '^[0-9]+'))
      INTO v_compc, v_brnch
      FROM HR_EMP_MASTER
     WHERE EMPCODE = :NEW.EMPCODE AND ROWNUM = 1;
  EXCEPTION WHEN OTHERS THEN v_compc := NULL; v_brnch := NULL; END;

  -- Shift for that company/branch from SHIFT_HEAD: prefer the exact branch,
  -- then the General (G) shift, then anything configured for the company.
  BEGIN
    SELECT shift INTO v_shift FROM (
      SELECT shift
        FROM SHIFT_HEAD
       WHERE compc = v_compc
       ORDER BY CASE WHEN brnch = v_brnch THEN 0 ELSE 1 END,
                CASE WHEN shift = 'G' THEN 0 ELSE 1 END,
                shift
    ) WHERE ROWNUM = 1;
  EXCEPTION WHEN OTHERS THEN v_shift := NULL; END;

  IF INSERTING THEN
    -- Check-IN: the earliest mark (ATTENDANCE_RECORDS already keeps the min).
    IF :NEW.ENTRY_TIME IS NOT NULL THEN
      INSERT INTO MACHINEDATA
        (EMP_CODE, ADATE, HH, MM, STATUS, TERMINAL, POSTED, IP, FILE_FROM, MACHINENUM, COMPC, BRNCH, SHIFT)
      VALUES
        (:NEW.EMPCODE, TO_CHAR(:NEW.ATTENDANCE_DATE, 'DD-MON-RR'),
         SUBSTR(:NEW.ENTRY_TIME,1,2), SUBSTR(:NEW.ENTRY_TIME,4,2),
         'IN', :NEW.DEVICE_TYPE, 'N', :NEW.CLIENT_IP, 'APP', :NEW.DEVICE_ID,
         v_compc, v_brnch, v_shift);
    END IF;

  ELSIF UPDATING THEN
    -- Check-OUT: only when an EXIT exists AND it is at least 60 minutes after the
    -- check-in. A quick second mark (which never sets EXIT >= 1h) produces no OUT.
    IF :NEW.EXIT_TIME IS NOT NULL
       AND :NEW.ENTRY_TIME IS NOT NULL
       AND REGEXP_LIKE(:NEW.ENTRY_TIME, '^[0-9][0-9]:[0-9][0-9]$')
       AND REGEXP_LIKE(:NEW.EXIT_TIME,  '^[0-9][0-9]:[0-9][0-9]$') THEN
      v_mins := (TO_NUMBER(SUBSTR(:NEW.EXIT_TIME,1,2))*60 + TO_NUMBER(SUBSTR(:NEW.EXIT_TIME,4,2)))
              - (TO_NUMBER(SUBSTR(:NEW.ENTRY_TIME,1,2))*60 + TO_NUMBER(SUBSTR(:NEW.ENTRY_TIME,4,2)));
      IF v_mins < 0 THEN v_mins := v_mins + 1440; END IF;  -- overnight
      IF v_mins >= 60 THEN
        INSERT INTO MACHINEDATA
          (EMP_CODE, ADATE, HH, MM, STATUS, TERMINAL, POSTED, IP, FILE_FROM, MACHINENUM, COMPC, BRNCH, SHIFT)
        VALUES
          (:NEW.EMPCODE, TO_CHAR(:NEW.ATTENDANCE_DATE, 'DD-MON-RR'),
           SUBSTR(:NEW.EXIT_TIME,1,2), SUBSTR(:NEW.EXIT_TIME,4,2),
           'OUT', :NEW.DEVICE_TYPE, 'N', :NEW.CLIENT_IP, 'APP', :NEW.DEVICE_ID,
           v_compc, v_brnch, v_shift);
      END IF;
    END IF;
  END IF;
END;
