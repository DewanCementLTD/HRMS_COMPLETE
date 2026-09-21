-- ============================================================================
-- RESIGN_CASE: write 'L' (Left) instead of the retired 'D'
-- ============================================================================
-- OPTIONAL follow-up to the two-status change (2026-09-15_employee_status_two_values.sql).
--
-- RESIGN_CASE is called by HR_SALARY_PROCES_PRO on every salary run:
--
--     update hr_emp_master set status = 'D'
--      where DTOFRESIGN is not null and status = 'A';
--
-- The rule itself is correct — somebody with a resignation date on file is not
-- an active employee — but it mints 'D', which is one of the codes the system
-- has retired. The application already reads 'D' as Left, so nothing is broken;
-- this just stops new 'D' values appearing after every payroll run, so the
-- stored data matches the two-value rule instead of relying on translation.
--
-- The behaviour is otherwise identical: same condition, same employees, same
-- meaning. Only the letter written changes.
-- ============================================================================

CREATE OR REPLACE PROCEDURE RESIGN_CASE IS
BEGIN
  UPDATE hr_emp_master
     SET status = 'L'
   WHERE dtofresign IS NOT NULL
     AND status = 'A';
END;
/

-- Fold any 'D' rows the procedure has already created.
UPDATE hr_emp_master SET status = 'L' WHERE status = 'D';
-- COMMIT;

-- VERIFY — only 'A' and 'L' should remain.
SELECT status, COUNT(*) AS employees FROM hr_emp_master GROUP BY status ORDER BY status;
