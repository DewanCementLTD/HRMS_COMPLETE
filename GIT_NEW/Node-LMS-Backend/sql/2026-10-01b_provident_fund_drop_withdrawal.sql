-- ============================================================================
-- PROVIDENT FUND — drop HR_PF_WITHDRAWAL
-- ============================================================================
-- Permanent withdrawals are now read from HR_LOAN_MST (loan type 16,
-- PERMANENT WITHDRAWAL-PF), entered from the payroll Loans screen, so the
-- separate table created by the first version of 2026-10-01_provident_fund.sql
-- is no longer used. Run only where that first version was applied.
-- ============================================================================

DROP TABLE HR_PF_WITHDRAWAL;
