-- ============================================================================
-- Absent marking must apply to every working shift, not only 'G'
-- ============================================================================
-- Required by the per-branch roster defaults (2026-09-16_roster_default_shift.sql).
--
-- CREATE_DUTY_ROSTER_PRO marks a day absent with:
--
--     AND roster_shift = 'G'
--
-- so only General-shift days are ever flagged. That was harmless while the
-- INSERT_PK_ROSTER trigger hardcoded every generated day to 'G' — but the whole
-- point of branch defaults is that a site can now run 'N' or 'A', and those
-- employees' absences would silently stop being recorded. Measured over the 30
-- days to 2026-09-15, on days with no punch, not rest, not holiday, not leave:
--
--     shift   no-punch days   marked absent   NOT marked
--     G            20,037          10,722         9,315
--     N                22               1            21
--     A                 1               0             1
--
-- The fix is to exclude rest days instead of naming one shift:
--
--     AND roster_shift <> 'R'
--
-- 'G' is still <> 'R', so nothing changes for anyone on General — this only
-- starts marking the shifts that were being skipped. Holidays and leave are
-- already excluded by the surrounding conditions, and the rule still only looks
-- at the last seven days.
--
-- EFFECT TO EXPECT: employees on non-General shifts will start accruing absent
-- days for the last seven days on the next salary/roster run. That is the
-- correct record, but it is a change in what payroll sees, so run it knowingly.
--
-- ROLLBACK: rollback/2026-09-16_CREATE_DUTY_ROSTER_PRO.before.sql holds the
-- procedure exactly as it was before this change.
--
-- This script documents the change; it is applied by replacing that single
-- condition in the live procedure body (the rest of the procedure is untouched).
-- ============================================================================

-- Confirm exactly one live occurrence before changing anything:
SELECT COUNT(*) AS live_occurrences
  FROM USER_SOURCE
 WHERE NAME = 'CREATE_DUTY_ROSTER_PRO'
   AND REGEXP_LIKE(TEXT, 'roster_shift\s*=\s*''G''', 'i');

-- Verify afterwards — should be 0 for 'G' and 1 for the new condition:
SELECT SUM(CASE WHEN REGEXP_LIKE(TEXT, 'roster_shift\s*=\s*''G''', 'i') THEN 1 ELSE 0 END) AS still_g,
       SUM(CASE WHEN REGEXP_LIKE(TEXT, 'roster_shift\s*<>\s*''R''', 'i') THEN 1 ELSE 0 END) AS now_not_rest
  FROM USER_SOURCE
 WHERE NAME = 'CREATE_DUTY_ROSTER_PRO';
