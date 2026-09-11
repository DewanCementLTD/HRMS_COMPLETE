-- ============================================================
-- HR_EMP_MASTER.INIT_PASWD — the INITIAL password HR sets
-- ------------------------------------------------------------
-- EMPLOYEE is an updatable VIEW over HR_EMP_MASTER, so the employee's own
-- password change (/auth/change-password writes EMPLOYEE.USER_PASWD) lands in
-- the very same column the HRMS form shows as "Initial Password". There was
-- nowhere to keep the initial value.
--
-- INIT_PASWD holds it separately:
--   USER_PASWD  -> the LIVE login password (employee may change it)
--   INIT_PASWD  -> the INITIAL password HR set (only HR changes it)
--
-- The HRMS form reads and writes INIT_PASWD; "Reset password" copies
-- INIT_PASWD over USER_PASWD. The API falls back to USER_PASWD when this
-- column is absent, so the app keeps working if this script hasn't been run.
-- ============================================================

ALTER TABLE HR_EMP_MASTER ADD (INIT_PASWD VARCHAR2(100));

-- Seed it with each employee's current password: for anyone who has never
-- changed theirs, that IS the initial one HR issued.
UPDATE HR_EMP_MASTER SET INIT_PASWD = USER_PASWD WHERE INIT_PASWD IS NULL;

COMMIT;
