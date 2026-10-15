-- ============================================================================
-- Company 1 — reset payroll + PF ledger so July, August and September 2026 can
-- be processed again from scratch (requested 2026-10-02).
-- ============================================================================
-- Backup of every row touched: C:\ERP_SYSTEMS\HRMS_LMS_APP\backups\
--   payroll_reset_unit1_20261002\*.json  (taken before this script ran)
-- Kept: HR_PF_BALANCES (ERP PF openings), loans, attendance, other companies.
-- Company 1's financial year is rule 4: Jul = 96, Aug = 97, Sep = 98. The
-- duplicate rule-6 periods (48-51) stay closed and unused.
-- ============================================================================

-- 1. Finalised salary — July (48 and 96) and August (97)
DELETE FROM HR_SALARY_PROCESS_FINAL        WHERE UNIT_ID = 1 AND "PERIOD#" IN (48, 96, 97);
DELETE FROM HR_SALARY_PROCESS_MASTER_FINAL WHERE UNIT_ID = 1 AND "PERIOD#" IN (48, 96, 97);

-- 2. Draft salary (September, period 98)
DELETE FROM HR_SALARY_PROCESS        WHERE UNIT_ID = 1;
DELETE FROM HR_SALARY_PROCESS_MASTER WHERE UNIT_ID = 1;

-- 3. PF ledger setup / postings for company 1
DELETE FROM HR_PF_YEAR_LINE   WHERE UNIT_ID = 1;
DELETE FROM HR_PF_YEAR        WHERE UNIT_ID = 1;
DELETE FROM HR_PF_OPENING     WHERE UNIT_ID = 1;
DELETE FROM HR_PF_PROFIT_RATE WHERE UNIT_ID = 1;
DELETE FROM HR_PF_MEMBER      WHERE UNIT_ID = 1;
DELETE FROM HR_PF_SETTINGS    WHERE UNIT_ID = 1;

-- 4. July inputs were entered on the duplicate period 48 — move them to 96 (rule 4)
UPDATE HR_MONTHLY_ALLOW SET "PERIOD#" = 96, RULE_ID = 4 WHERE UNIT_ID = 1 AND "PERIOD#" = 48;
UPDATE HR_MONTHLY_DED   SET "PERIOD#" = 96              WHERE UNIT_ID = 1 AND "PERIOD#" = 48;
UPDATE HR_ABSENT_DAYS   SET "PERIOD#" = 96              WHERE UNIT_ID = 1 AND "PERIOD#" = 48;

-- 5. Only July open; August / September closed until their turn
UPDATE HR_ATTND_PERIOD SET STATUS = 'O', USR_DATE_UPD = SYSDATE WHERE UNIT_ID = 1 AND "PERIOD#" = 96;
UPDATE HR_ATTND_PERIOD SET STATUS = 'C', USR_DATE_UPD = SYSDATE WHERE UNIT_ID = 1 AND "PERIOD#" IN (97, 98);

COMMIT;
