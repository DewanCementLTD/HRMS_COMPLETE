-- ============================================================================
-- ATTENDANCE_RECORDS -> MACHINEDATA: file a punch by INTENT, not by the clock
-- ============================================================================
-- WHY
-- The live TRG_ATTEN_REC_INTO_MACHINE_DATA had drifted from the reviewed
-- version in 2026-06-29_machinedata_trigger.sql. The live one decided whether a
-- punch was a check-IN or a check-OUT by comparing the time of day against
-- SHIFT_HEAD.ALLOW_IN_TIME .. SHIFT_HEAD.CHANGE_ST:
--
--     IF :NEW.ENTRY_TIME BETWEEN TF AND CS THEN STATS1 := 'IN';
--     ELSE                                      STATS1 := 'OUT';
--
-- CHANGE_ST is 12:59 at most branches and 11:30 at SOORTY NOORIABAD, so every
-- employee who started work after that hour had their check-IN filed as a
-- check-OUT. AFTR_IMP_DATA_SET_ROSTER then wrote OUT_TIME and left IN_TIME
-- null — and it is the IN branch that clears ABSENT_DAYS / ROSTER_REMARKS — so
-- the person shows as Absent all day even though their punch is stored in
-- ATTENDANCE_RECORDS. That is the "attendance lag gayi but system mein show
-- nahi ho rahi" complaint: 499 employee-days across 111 employees in the 30
-- days to 2026-09-10.
--
-- That clock rule belongs to biometric hardware, where one undifferentiated
-- punch stream has to be split into ins and outs. It does not belong here: this
-- trigger only ever fires on rows the mobile app writes, and the app already
-- says which a punch is — a check-IN sets ENTRY_TIME, a check-OUT sets
-- EXIT_TIME. This restores that, which is what the 2026-06-29 version did.
--
-- ALSO FIXED HERE
--   * A repeat check-in tap could reach the EXIT branch with EXIT_TIME still
--     null, which inserted MACHINEDATA with HH/MM null; INSRT_IN_IMP_DATA_AFTR_
--     MCHN_POOL then raised ORA-01858 building its timestamp, and because that
--     TO_DATE is not guarded the exception rolled the employee's punch back
--     entirely. Every branch below now requires a well-formed HH:MI.
--   * The SHIFT_HEAD lookup selected INTO without ROWNUM = 1, so a duplicated
--     (COMPC, BRNCH, SHIFT) row would raise TOO_MANY_ROWS — uncaught, punch
--     lost. No duplicates exist today; the lookup is gone regardless, because
--     nothing below needs the shift's timings any more.
--   * When the employee master gives no COMPC, the MACHINEDATA insert is
--     skipped rather than attempted: IMPORT_DATA.COMPC is NOT NULL, so the
--     insert would fail and take the employee's punch down with it. Saving the
--     punch and missing the ERP feed beats losing both.
--
-- SAFE TO RE-RUN. Rolls back to the previous behaviour by re-running
-- 2026-06-29_machinedata_trigger.sql (or the pre-change body kept in
-- docs/, if you snapshot it first).
-- ============================================================================

CREATE OR REPLACE TRIGGER TRG_ATTEN_REC_INTO_MACHINE_DATA
AFTER INSERT OR UPDATE ON ATTENDANCE_RECORDS
FOR EACH ROW
DECLARE
  v_compc  NUMBER;
  v_brnch  NUMBER;
  v_card   NUMBER;
  v_shift  VARCHAR2(20);
  v_mins   NUMBER;
  -- The punch to post, decided once below and written once at the end. The two
  -- INSERTs this replaces were identical apart from the time and the status,
  -- which is how they drifted apart in the first place.
  v_time   VARCHAR2(10);
  v_status VARCHAR2(10);
BEGIN
  -- Company / branch / attendance card of the employee.
  BEGIN
    SELECT TO_NUMBER(OLD_EMPCODE),
           TO_NUMBER(UNIT_ID),
           TO_NUMBER(REGEXP_SUBSTR(LOCATION, '^[0-9]+'))
      INTO v_card, v_compc, v_brnch
      FROM HR_EMP_MASTER
     WHERE EMPCODE = :NEW.EMPCODE AND ROWNUM = 1;
  EXCEPTION WHEN OTHERS THEN
    v_card := NULL; v_compc := NULL; v_brnch := NULL;
  END;

  -- IMPORT_DATA.COMPC is NOT NULL. Without a company the downstream insert
  -- fails and rolls the punch back, so leave the ERP feed alone instead.
  IF v_compc IS NULL OR v_brnch IS NULL THEN
    RETURN;
  END IF;

  -- Shift code for that day, from the person's own roster row.
  BEGIN
    SELECT MIN(ROSTER_SHIFT) INTO v_shift
      FROM DUTY_ROSTER
     WHERE CARD_NO = v_card
       AND TRUNC(ROSTER_DATE) = TRUNC(:NEW.ATTENDANCE_DATE);
  EXCEPTION WHEN OTHERS THEN v_shift := NULL; END;

  -- Fallback when the roster has no shift for that day: the company/branch
  -- default from SHIFT_HEAD (prefer exact branch, then General 'G').
  IF v_shift IS NULL THEN
    BEGIN
      SELECT shift INTO v_shift FROM (
        SELECT shift
          FROM SHIFT_HEAD
         WHERE compc = v_compc
         ORDER BY CASE WHEN brnch = v_brnch THEN 0 ELSE 1 END,
                  CASE WHEN shift = 'G'     THEN 0 ELSE 1 END,
                  shift
      ) WHERE ROWNUM = 1;
    EXCEPTION WHEN OTHERS THEN v_shift := NULL; END;
  END IF;

  -- ---------------------------------------------------------------------
  -- CHECK-IN — the app set ENTRY_TIME. Filed as 'IN' whatever the hour: a
  -- shift that starts at 15:00 is still a shift starting.
  -- ---------------------------------------------------------------------
  IF :NEW.ENTRY_TIME IS NOT NULL
     AND REGEXP_LIKE(:NEW.ENTRY_TIME, '^[0-9][0-9]:[0-9][0-9]$')
     AND (INSERTING OR :OLD.ENTRY_TIME IS NULL OR :NEW.ENTRY_TIME <> :OLD.ENTRY_TIME)
  THEN
    v_time   := :NEW.ENTRY_TIME;
    v_status := 'IN';

  -- ---------------------------------------------------------------------
  -- CHECK-OUT — the app set or moved EXIT_TIME, and it is at least an hour
  -- after the check-in, so a quick second tap never posts a check-out.
  -- ---------------------------------------------------------------------
  ELSIF UPDATING
        AND :NEW.EXIT_TIME IS NOT NULL
        AND REGEXP_LIKE(:NEW.EXIT_TIME,  '^[0-9][0-9]:[0-9][0-9]$')
        AND :NEW.ENTRY_TIME IS NOT NULL
        AND REGEXP_LIKE(:NEW.ENTRY_TIME, '^[0-9][0-9]:[0-9][0-9]$')
        AND (:OLD.EXIT_TIME IS NULL OR :NEW.EXIT_TIME <> :OLD.EXIT_TIME)
  THEN
    v_mins := (TO_NUMBER(SUBSTR(:NEW.EXIT_TIME, 1, 2)) * 60 + TO_NUMBER(SUBSTR(:NEW.EXIT_TIME, 4, 2)))
            - (TO_NUMBER(SUBSTR(:NEW.ENTRY_TIME, 1, 2)) * 60 + TO_NUMBER(SUBSTR(:NEW.ENTRY_TIME, 4, 2)));
    IF v_mins < 0 THEN v_mins := v_mins + 1440; END IF;   -- overnight shift
    IF v_mins >= 60 THEN
      v_time   := :NEW.EXIT_TIME;
      v_status := 'OUT';
    END IF;
  END IF;

  -- ---------------------------------------------------------------------
  -- Post it. One INSERT for both cases, so the IN and OUT paths cannot drift
  -- apart again the way they did.
  -- ---------------------------------------------------------------------
  IF v_status IS NOT NULL THEN
    INSERT INTO MACHINEDATA
      (EMP_CODE, ADATE, HH, MM, STATUS, TERMINAL, POSTED, IP,
       FILE_FROM, MACHINENUM, COMPC, BRNCH, SHIFT)
    VALUES
      (:NEW.EMPCODE,
       TO_CHAR(:NEW.ATTENDANCE_DATE, 'DD-MON-RR'),
       SUBSTR(v_time, 1, 2),
       SUBSTR(v_time, 4, 2),
       v_status,
       :NEW.DEVICE_TYPE, 'N', :NEW.CLIENT_IP, 'APP', :NEW.DEVICE_ID,
       v_compc, v_brnch, v_shift);
  END IF;
END;
/
