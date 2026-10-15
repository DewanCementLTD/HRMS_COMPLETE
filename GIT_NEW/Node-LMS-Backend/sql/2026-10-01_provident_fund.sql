-- ============================================================================
-- PROVIDENT FUND (PF) — profit, permanent withdrawals, PF loans, settlement
-- ============================================================================
-- Replaces the per-employee Excel statements (F-78 / F-84 / K-51 style). Every
-- figure is generated from data the system already holds; HR only declares the
-- yearly profit rate the trustees announce. No rounding anywhere — every NUMBER
-- column stores the exact computed value.
--
-- Sources (read-only, existing tables):
--   monthly contribution : finalised salary months, HR_SALARY_PROCESS_MASTER_FINAL
--                          (PF_IND 'Y', EMP_STATUS '1', confirmed by period end):
--                          (EARNED_GROSS - HR_DESG.FPO_AMOUNT) / 1.55 × 8.33%
--                          company share = employee share (100% carbon copy)
--   PF loans             : HR_LOAN_MST rows whose LOAN_CD is listed in
--                          HR_PF_SETTINGS.LOAN_CODES (default 5), recoveries from
--                          HR_LOAN_RECOVERY + LOAN_RECOVER instalment schedule
--   permanent withdrawals: HR_LOAN_MST rows of loan type 16 (PERMANENT WITHDRAWAL-PF)
--   opening balances     : HR_PF_OPENING, bulk-importable from HR_PF_BALANCES
--   exit date            : HR_EMP_MASTER.DTOFRESIGN
--
-- IDs follow the codebase convention (NVL(MAX)+1, no sequences).
-- ============================================================================

-- Per-company PF parameters. A missing row means the defaults below apply.
CREATE TABLE HR_PF_SETTINGS (
  UNIT_ID        NUMBER        NOT NULL,
  PF_DED_CODE    VARCHAR2(3)   DEFAULT '12' NOT NULL,   -- HR_SALARY_PROCESS.TRANS_ID of the PF deduction
  LOAN_CODES     VARCHAR2(200) DEFAULT '5',             -- comma list of HR_LOAN_TYPE.LOAN_CD that are PF loans
  LOAN_SPREAD    NUMBER        DEFAULT 0.01   NOT NULL,   -- PF loan markup = profit rate + spread
  ZAKAT_RATE     NUMBER        DEFAULT 0.025  NOT NULL,
  USR_ID_UPD     VARCHAR2(2),
  USR_DATE_UPD   DATE,
  CONSTRAINT HR_PF_SETTINGS_PK PRIMARY KEY (UNIT_ID)
);

-- Per-member PF flags. Zakat (2.5% of the employee part) is deducted at
-- settlement unless the member filed the exemption declaration (CZ-50 affidavit):
-- ZAKAT_EXEMPT = 'Y' with the declaration's date / reference. No row = not exempt.
CREATE TABLE HR_PF_MEMBER (
  UNIT_ID        NUMBER        NOT NULL,
  OLD_EMPCODE    VARCHAR2(8)   NOT NULL,
  ZAKAT_EXEMPT   VARCHAR2(1)   DEFAULT 'N' NOT NULL,
  DECL_DATE      DATE,
  DECL_REF       VARCHAR2(50),
  REMARKS        VARCHAR2(200),
  USR_ID_UPD     VARCHAR2(2),
  USR_DATE_UPD   DATE,
  CONSTRAINT HR_PF_MEMBER_PK PRIMARY KEY (UNIT_ID, OLD_EMPCODE),
  CONSTRAINT HR_PF_MEMBER_ZAKAT_CK CHECK (ZAKAT_EXEMPT IN ('Y', 'N'))
);

-- Yearly profit rate declared by the trustees. STATUS: D = declared, P = posted.
CREATE TABLE HR_PF_PROFIT_RATE (
  UNIT_ID        NUMBER        NOT NULL,
  FY_FROM        DATE          NOT NULL,          -- 01-JUL-yyyy
  FY_TO          DATE          NOT NULL,          -- 30-JUN-yyyy+1
  PROFIT_RATE    NUMBER        NOT NULL,          -- fraction, e.g. 0.0587
  STATUS         VARCHAR2(1)   DEFAULT 'D' NOT NULL,
  REMARKS        VARCHAR2(200),
  POSTED_ON      DATE,
  USR_ID_UPD     VARCHAR2(2),
  USR_DATE_UPD   DATE,
  CONSTRAINT HR_PF_PROFIT_RATE_PK PRIMARY KEY (UNIT_ID, FY_FROM)
);

-- One-time take-on of balances carried over from the Excel statements, as at
-- the start of AS_OF_FY (the first financial year the system computes).
-- *_DEDUCTIONS = permanent withdrawals (+ their profit) and loan interest
-- already charged in Excel, so balance = contrib + profit - deductions.
CREATE TABLE HR_PF_OPENING (
  UNIT_ID          NUMBER       NOT NULL,
  OLD_EMPCODE      VARCHAR2(8)  NOT NULL,
  AS_OF_FY         DATE         NOT NULL,
  EMP_CONTRIB      NUMBER       DEFAULT 0 NOT NULL,
  EMP_PROFIT       NUMBER       DEFAULT 0 NOT NULL,
  EMP_DEDUCTIONS   NUMBER       DEFAULT 0 NOT NULL,
  CO_CONTRIB       NUMBER       DEFAULT 0 NOT NULL,
  CO_PROFIT        NUMBER       DEFAULT 0 NOT NULL,
  CO_DEDUCTIONS    NUMBER       DEFAULT 0 NOT NULL,
  REMARKS          VARCHAR2(200),
  USR_ID_UPD       VARCHAR2(2),
  USR_DATE_UPD     DATE,
  CONSTRAINT HR_PF_OPENING_PK PRIMARY KEY (UNIT_ID, OLD_EMPCODE)
);


-- Posted (frozen) yearly statement per member. Later salary re-processing or a
-- rate change cannot alter a posted year.
CREATE TABLE HR_PF_YEAR (
  UNIT_ID          NUMBER       NOT NULL,
  OLD_EMPCODE      VARCHAR2(8)  NOT NULL,
  FY_FROM          DATE         NOT NULL,
  FY_TO            DATE         NOT NULL,
  CUTOFF_DATE      DATE         NOT NULL,          -- FY_TO, or exit date in the leaving year
  PROFIT_RATE      NUMBER       NOT NULL,
  LOAN_RATE        NUMBER       NOT NULL,
  EMP_OPENING      NUMBER, EMP_CONTRIB NUMBER, EMP_PRODUCT NUMBER, EMP_PROFIT NUMBER,
  EMP_WITHDRAWN    NUMBER, LOAN_INTEREST NUMBER, EMP_CLOSING NUMBER,
  CO_OPENING       NUMBER, CO_CONTRIB  NUMBER, CO_PRODUCT  NUMBER, CO_PROFIT  NUMBER,
  CO_WITHDRAWN     NUMBER, CO_CLOSING  NUMBER,
  LOAN_OPENING     NUMBER, LOAN_PRODUCT NUMBER, LOAN_CLOSING NUMBER,
  POSTED_ON        DATE,
  USR_ID_UPD       VARCHAR2(2),
  CONSTRAINT HR_PF_YEAR_PK PRIMARY KEY (UNIT_ID, OLD_EMPCODE, FY_FROM)
);

-- The lines behind each posted year (the Excel "MONTH / P.F / DAYS / PRODUCT" grid).
-- LINE_TYPE: OPEN, CONTRIB, WITHDRAW, LOAN_OPEN, LOAN_DISB, LOAN_REC
CREATE TABLE HR_PF_YEAR_LINE (
  UNIT_ID          NUMBER       NOT NULL,
  OLD_EMPCODE      VARCHAR2(8)  NOT NULL,
  FY_FROM          DATE         NOT NULL,
  LINE_NO          NUMBER       NOT NULL,
  LINE_TYPE        VARCHAR2(10) NOT NULL,
  VALUE_DATE       DATE,
  "PERIOD#"        NUMBER,
  REF_DOC          NUMBER,
  EARNED_GROSS     NUMBER, FPO NUMBER, BASIC NUMBER,
  EMP_AMT          NUMBER, CO_AMT NUMBER, DAYS NUMBER,
  EMP_PRODUCT      NUMBER, CO_PRODUCT NUMBER,
  CONSTRAINT HR_PF_YEAR_LINE_PK PRIMARY KEY (UNIT_ID, OLD_EMPCODE, FY_FROM, LINE_NO)
);
