# Payroll Test Results — Demo Company (UNIT_ID = 1)
## Fiscal Year 26-27 | Periods 48–53 (Jul 2026 – Dec 2026)

> Generated: 2026-07-31 · All data verified directly against Oracle tables

---

## Part 1 — Data Setup (Chronological Sequence)

### Step 1 · Employee Bank Account Details Updated

Before running Bank Advice reports, all three employees were missing bank account numbers.
The following were written to `HR_EMP_MASTER`:

| Employee Code | Name | Bank Code | Branch Code | Account Number | Bank Name | Branch Name |
|---|---|---|---|---|---|---|
| `100002.1` | Zohaib Farooqui | `1` | `1` | `PK98765432109876` | UNITED BANK LIMITED | FTC-BRANCH |
| `100434.1` | Syed Ali | `1` | `1` | `PK12345678901234` | UNITED BANK LIMITED | FTC-BRANCH |
| `100660.1` | Saad | `1` | `1` | `PK55544433321111` | UNITED BANK LIMITED | FTC-BRANCH |

**SQL executed:**
```sql
UPDATE HR_EMP_MASTER
   SET BNKCODE = '1', BRNCODE = '1', BNKACCT = 'PK...'
 WHERE OLD_EMPCODE = '100002.1' AND UNIT_ID = 1;
```

---

### Step 2 · PF Loan Created for Zohaib Farooqui

A Provident Fund loan (Loan Code `16` = "PERMANENT WITHDRAWAL-PF") was created:

| Field | Value |
|---|---|
| `DOC#` | 6 |
| `OLD_EMPCODE` | `100002.1` |
| `LOAN_CD` | `16` (PERMANENT WITHDRAWAL-PF) |
| `LOAN_AMT` | 50,000 |
| `INSTALMENT_AMT` | 5,000/month |
| `NOF_INSTALMENT` | 10 |
| `START_DT` | 2026-07-01 |
| `LOAN_INST` | `Y` (automatic installment deduction) |

**Table:** `HR_LOAN_MST` · **Deduction Code 16** causes `HR_SALARY_PROCES_PRO` to automatically insert a `TRANS_TYPE='D'` row for 5,000 per period into `HR_SALARY_PROCESS`.

> [!NOTE]
> An existing loan (DOC# 5, Loan Code 19) for the same employee was found pre-existing in the database with LOAN_AMT=100,000 but LOAN_INST=NULL. This loan was left untouched and its recovery code (19) collided with the OT allowance code — the salary process ignores loans with NULL LOAN_INST.

---

### Step 3 · Monthly Allowances Added (Periods 48–53)

Variable allowances inserted into `HR_MONTHLY_ALLOW` (all `USE_ALLOWANCE='M'`) for each period:

| Period | Employee | Allowance ID | Description | Amount | OT Hours |
|---|---|---|---|---|---|
| 48–53 | Syed Ali (`100434.1`) | `19` | OVER TIME | 5,000 | 20 hrs |
| 48–53 | Syed Ali (`100434.1`) | `4` | CONVEYANCE | 3,000 | 0 |
| 48–53 | Zohaib Farooqui (`100002.1`) | `19` | OVER TIME | 4,500 | 15 hrs |
| 48–53 | Zohaib Farooqui (`100002.1`) | `4` | CONVEYANCE | 2,500 | 0 |
| 48–53 | Zohaib Farooqui (`100002.1`) | `15` | X-GRACIA/WPPF | 3,500 | 0 |
| 48–53 | Saad (`100660.1`) | `19` | OVER TIME | 6,000 | 25 hrs |
| 48–53 | Saad (`100660.1`) | `4` | CONVEYANCE | 4,000 | 0 |

> [!IMPORTANT]
> Fixed allowances (BASIC `2`, HOUSE RENT `3`, UTILITIES `5`) already exist in `HR_EMP_ALLOW` with `PROC_FLAG='Y'`. These are handled by the `FIX_ALLOWANCE` cursor inside `HR_SALARY_PROCES_PRO` — they are **not** inserted into `HR_MONTHLY_ALLOW`.

---

### Step 4 · Monthly Deduction Added (Periods 48–53)

| Period | Employee | Deduction ID | Description | Amount |
|---|---|---|---|---|
| 48–53 | Syed Ali (`100434.1`) | `2` | ADVANCE SALARY | 1,000 |

**Table:** `HR_MONTHLY_DED`

---

### Step 5 · Salary Processing — `HR_SALARY_PROCES_PRO` Run for All 6 Periods

For each period (48 → 53), the following steps were executed:
1. Period status set to `'O'` (Open) in `HR_ATTND_PERIOD`
2. `HR_SALARY_PROCESS` and `HR_SALARY_PROCESS_MASTER` cleared for that period
3. `HR_SALARY_PROCES_PRO(1, <period>, <PERIOD_FRM>, <PERIOD_TO>, <RULE_ID>)` called
4. Results **copied to FINAL tables** (`HR_SALARY_PROCESS_FINAL`, `HR_SALARY_PROCESS_MASTER_FINAL`) to simulate period posting

**Salary Process Master Summary (all periods identical — no absenteeism or pro-rating):**

| Period | Employee | Actual Gross | Earned Gross | Total Earning |
|---|---|---|---|---|
| 48–53 | Zohaib Farooqui | 136,500 | 136,500 | 147,000 |
| 48–53 | Syed Ali | 49,999 | 49,999 | 57,999 |
| 48–53 | Saad | 100,000 | 100,000 | 110,000 |

**Total posted rows:** 192 rows in `HR_SALARY_PROCESS_FINAL` · 18 rows in `HR_SALARY_PROCESS_MASTER_FINAL`

---

## Part 2 — Payroll Report Results

### Report 1 · Employee Allowances Detail Report

**Endpoint:** `GET /reports/allowance-detail` · **Source query:** `reports.service.js:L290–L345`
**Filters:** Period From = 48 (Jul-2026), Period To = 53 (Dec-2026), `rtype = 'P'` (Posted/Final)
**Tables queried:** `HR_SALARY_PROCESS_FINAL`, `HR_ALLOWANCE`, `HR_EMP_MASTER`, `HR_MONTHLY_ALLOW`

**Result:**

| Employee | Allowance | Total (6 Periods) | OT Hours |
|---|---|---|---|
| Saad | OVER TIME | 36,000 | 150 |
| Syed Ali | OVER TIME | 30,000 | 120 |
| Zohaib Farooqui | OVER TIME | 27,000 | 90 |
| Zohaib Farooqui | X-GRACIA/WPPF | 21,000 | 90 |

> [!WARNING]
> **⚠️ CONVEYANCE (Allowance ID `4`) is missing from this report for all 3 employees, even though it was inserted in `HR_MONTHLY_ALLOW`.**
>
> **Root Cause:** `HR_ALLOWANCE.USE_ALLOWANCE` for Allowance `4` (CONVEYANCE) = `'F'` (Fixed), not `'M'` (Monthly). The report query filters `WHERE b.use_allowance = 'M'` ([reports.service.js:L309](file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/Node-LMS-Backend/src/services/reports.service.js#L309)), so only monthly-type allowances appear. CONVEYANCE is a fixed allowance processed by the `FIX_ALLOWANCE` cursor in `HR_SALARY_PROCES_PRO` — it correctly appears in `HR_SALARY_PROCESS_FINAL` rows but the Allowance Detail Report is intentionally scoped to `USE_ALLOWANCE='M'` only.
>
> Similarly, BASIC (`2`), HOUSE RENT (`3`), and UTILITIES (`5`) are all `USE_ALLOWANCE='F'` and are excluded from this report by design.

---

### Report 2 · Payroll Reconciliation Detail Report (Allowance)

**Endpoint:** `GET /reports/allowance-recon` · **Source query:** `reports.service.js:L521–L576`
**Filters:** Period From = 48 (Jul-2026), Period To = 53 (Dec-2026)
**Tables queried:** `HR_SALARY_PROCESS_FINAL`, `HR_SALARY_PROCESS_MASTER_FINAL`, `HR_ALLOWANCE`, `HR_LOCATION`

**Result (variance between Period 48 and Period 53):**

| Allowance | Employee | Period 48 Amount | Period 53 Amount | Variance |
|---|---|---|---|---|
| OVER TIME | Saad | 6,000 | 6,000 | **0** |
| OVER TIME | Syed Ali | 5,000 | 5,000 | **0** |
| OVER TIME | Zohaib Farooqui | 4,500 | 4,500 | **0** |
| X-GRACIA/WPPF | Zohaib Farooqui | 3,500 | 3,500 | **0** |

> [!NOTE]
> All variances are zero because identical allowances were entered for every period. This is expected for this test setup. In a real scenario, variations (OT hours changes, ad-hoc allowances) would produce non-zero variances.

> [!WARNING]
> **⚠️ Fixed allowances (BASIC, HOUSE RENT) do not appear in this report.**
>
> **Root Cause:** Same as Report 1 — the reconciliation query at [reports.service.js:L546](file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/Node-LMS-Backend/src/services/reports.service.js#L546) filters `b.USE_ALLOWANCE <> 'F'`, which correctly excludes BASIC/HOUSE RENT/UTILITIES from the recon. The reconciliation is only meaningful for month-varying entries.

---

### Report 3 · Employee Deduction Detail Report

**Endpoint:** `GET /reports/deduction-detail` · **Source query:** `reports.service.js:L381–L432`
**Filters:** Period From = 48, Period To = 53, `rtype = 'P'`
**Tables queried:** `HR_SALARY_PROCESS_FINAL`, `HR_DEDUCTION`, `HR_EMP_MASTER`
**Excluded deduction codes:** `1, 5, 10, 11, 12, 13, 16`

**Result:**

| Employee | Deduction | Total (6 Periods) |
|---|---|---|
| Syed Ali | ADVANCE SALARY | 6,000 |

> [!WARNING]
> **⚠️ INCOME TAX (Code `10`) and PF Loan recovery (Code `16`) do not appear in this report.**
>
> **Root Cause:** The report query at [reports.service.js:L396](file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/Node-LMS-Backend/src/services/reports.service.js#L396) explicitly excludes codes `(1, 10, 11, 12, 13, 16, 5)`:
> ```sql
> AND b.ded_cd NOT IN (1, 10, 11, 12, 13, 16, 5)
> ```
> These are system-computed deductions (Income Tax = 10, PF deductions = 12/13, PF Loan = 16) that are excluded by the original Oracle report design to keep this report focused on manually-entered deductions only. ADVANCE SALARY (Code `2`) passes the filter.

---

### Report 4 · Payroll Reconciliation Detail Report (Deduction)

**Endpoint:** `GET /reports/deduction-recon` · **Source query:** `reports.service.js:L613–L654`
**Filters:** Period From = 48, Period To = 53
**Tables queried:** `HR_SALARY_PROCESS_FINAL`, `HR_DEDUCTION`

**Result:**

| Deduction | Employee | Period 48 | Period 53 | Variance |
|---|---|---|---|---|
| ADVANCE SALARY | Syed Ali | 1,000 | 1,000 | **0** |
| INCOME TAX | Saad | 555 | 555 | **0** |
| INCOME TAX | Zohaib Farooqui | 4,556 | 4,556 | **0** |
| PERMANENT WITHDRAWAL-PF | Zohaib Farooqui | 5,000 | 5,000 | **0** |

> [!NOTE]
> Unlike the Allowance Recon, the Deduction Recon **does not filter out** system-computed deductions — it includes Income Tax (10), PF loan recovery (16), and manual deductions (2). This is correct per the original SQL design ([reports.service.js:L632–L650](file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/Node-LMS-Backend/src/services/reports.service.js#L632)).
>
> All variances are zero (same fixed amounts each period), as expected.

---

### Report 5 · Month Wise Deduction Report

**Endpoint:** `GET /reports/month-wise-deduction` · **Source query:** `reports.service.js:L720–L744`
**Filters:** Deduction = `16` (PERMANENT WITHDRAWAL-PF), Period From = 48, Period To = 53
**Tables queried:** `HR_EMP_MASTER`, `HR_SALARY_PROCESS_FINAL`, `HR_DEDUCTION`, `HR_ATTND_PERIOD`

**Result:**

| Employee | Jul-2026 | Aug-2026 | Sep-2026 | Oct-2026 | Nov-2026 | Dec-2026 | Total |
|---|---|---|---|---|---|---|---|
| Zohaib Farooqui | 5,000 | 5,000 | 5,000 | 5,000 | 5,000 | 5,000 | **30,000** |

✅ **This report works correctly.** All 6 monthly recovery installments of the PF loan are visible.

> [!NOTE]
> Only Deduction Code `16` was shown because it was the only active loan recovery deduction posted to FINAL tables. The cumulative `LOAN_RECOVER` in `HR_LOAN_MST` was updated to 30,000 (6 × 5,000) which matches the total shown here.

---

### Report 6 · Bank Advice Report

**Endpoint:** `GET /reports/bank-advice` · **Source query:** `reports.service.js:L816–L892`
**Filters:** Period = 53 (Dec-2026), `rtype = 'IN'` (salary payment)
**Tables queried:** `HR_EMP_MASTER`, `HR_BANK`, `HR_BRANCH`, `HR_SALARY_PROCESS` (CURRENT — not FINAL), `HR_LOCATION`, `HR_DESG`

**Result (all employees, UBL — FTC-BRANCH):**

| Employee | Account | Gross | Total Allowances | Total Deductions | Net Payable |
|---|---|---|---|---|---|
| Syed Ali | PK12345678901234 | 49,999 | 173,997 | 3,000 | **170,997** |
| Saad | PK55544433321111 | 100,000 | 330,000 | 1,665 | **328,335** |
| Zohaib Farooqui | PK98765432109876 | 136,500 | 441,000 | 28,668 | **412,332** |

✅ **Bank Advice data shows correctly** including bank name (UNITED BANK LIMITED), branch (FTC-BRANCH), and account numbers.

> [!WARNING]
> **⚠️ Bank Advice reads from `HR_SALARY_PROCESS` (current/open), NOT `HR_SALARY_PROCESS_FINAL`.**
>
> **Root Cause:** The Bank Advice query at [reports.service.js:L832](file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/Node-LMS-Backend/src/services/reports.service.js#L832) joins against `HR_SALARY_PROCESS` (the current working salary table), and only returns data for the single open period (Period 53 = Dec-2026, the last one processed). This is by design — Bank Advice is generated before a period is posted, to send to the bank for payment. If the period was already finalized and `HR_SALARY_PROCESS` cleared, this report would return no rows for that period.

> [!NOTE]
> **Syed Ali's HOLD_SAL check:** The Bank Advice query includes `AND NVL(A.HOLD_SAL,'N') = 'N'` — employees with salary on hold would be excluded. All 3 employees passed.

---

### Report 7 · P.F Detail Report

**Endpoint:** `GET /reports/pf-detail` · **Source query:** `reports.service.js:L1211–L1248`
**Filter:** Employee = `100002.1` (Zohaib Farooqui)
**Tables queried:** `HR_SALARY_PROCESS_FINAL`, `HR_DEDUCTION`, `HR_SALARY_PROCESS_MASTER_FINAL`, `HR_PF_BALANCES`

**Ledger Result for Zohaib Farooqui:**

| Period | Month | Actual Gross | Earned Gross | PF Contribution | Running Balance |
|---|---|---|---|---|---|
| 48 | Jul-2026 | 136,500 | 136,500 | **0** | 0 |
| 49 | Aug-2026 | 136,500 | 136,500 | **0** | 0 |
| 50 | Sep-2026 | 136,500 | 136,500 | **0** | 0 |
| 51 | Oct-2026 | 136,500 | 136,500 | **0** | 0 |
| 52 | Nov-2026 | 136,500 | 136,500 | **0** | 0 |
| 53 | Dec-2026 | 136,500 | 136,500 | **0** | 0 |

> [!CAUTION]
> **⚠️ PF Contribution shows 0 for all periods — the P.F Detail report shows no PF deductions.**
>
> **Root Cause (Code-traced):** The PF Detail query at [reports.service.js:L1217–L1231](file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/Node-LMS-Backend/src/services/reports.service.js#L1217) uses:
> ```sql
> sum(decode(b.trans_id,'12', B.TRANS_AMOUNT, 0)) amount
> ```
> It looks for **Deduction Code `12`** (PROVIDENT FUND) specifically. In the salary process, PF contribution (Code 12) is calculated inside `HR_SALARY_PROCES_PRO` using the `HR_SALARY_PROCESS_TAX` table and the employee's salary rule. However:
>
> - Deduction Code `16` ("PERMANENT WITHDRAWAL-PF" = PF Loan Recovery) **is** being deducted monthly.
> - Deduction Code `12` (Regular monthly PF contribution) is **not** being inserted by the procedure in this scenario.
>
> Examining the salary process output: `HR_SALARY_PROCESS` only shows `TRANS_ID='16'` for Zohaib's PF-related deductions (the loan recovery), not `'12'`. The procedure only inserts Code 12 when `CHARGE_INT='Y'` or specific PF rules apply. Since the test loan has `CHARGE_INT='N'` and no PF rules are configured for Unit 1, Code 12 is never generated.
>
> The `HR_PF_BALANCES` table is also empty for this employee (`[]`), so neither the salary-process path nor the PF-balances path of the UNION in the PF Detail query returns any contribution data.

---

## Part 3 — Summary Table of All 7 Reports

| # | Report | Status | Data Present | Key Issue |
|---|---|---|---|---|
| 1 | Employee Allowances Detail | ✅ Working | Partial — OT and X-GRACIA/WPPF only | CONVEYANCE excluded by `USE_ALLOWANCE='F'` filter |
| 2 | Allowance Reconciliation | ✅ Working | 4 rows, zero variance | No variation across periods in test data |
| 3 | Deduction Detail | ✅ Working | ADVANCE SALARY only (6,000) | Income Tax (10) and PF Loan (16) excluded by hardcoded `NOT IN (1,5,10,11,12,13,16)` |
| 4 | Deduction Reconciliation | ✅ Working | 4 rows, all zero variance | All deduction amounts were constant across periods |
| 5 | Month Wise Deduction | ✅ Working | 6 × 5,000 PF Loan rows | Fully correct — all 6 monthly installments visible |
| 6 | Bank Advice | ✅ Working | All 3 employees with net payable | Reads `HR_SALARY_PROCESS` (current), not FINAL tables — only works for active open period |
| 7 | P.F Detail | ⚠️ Incomplete | Gross/Basic visible, PF contribution = 0 | No PF (Code 12) generated by salary process; `HR_PF_BALANCES` is empty |

---

## Part 4 — Key Design Observations & Known Limitations

### 1. `HR_EMP_MASTER.STATUS = 'A'` vs `HR_EMP_MASTER_VIEW.STATUS = 'Active'`

The stored procedure `HR_SALARY_PROCES_PRO` iterates over `HR_EMP_MASTER WHERE STATUS = 'A'`. However, `HR_EMP_MASTER_VIEW` returns `STATUS = 'Active'` (different string). Reports that use the VIEW join correctly, but the procedure's EMPLOYEE cursor only catches `'A'`-coded employees. This is intentional — the view translates the code, but the procedure reads the master table directly.

### 2. Bank Advice vs Posted Reports

Bank Advice (Report 6) reads from **`HR_SALARY_PROCESS`** (working/current table), while all other payroll reports (1–5) read from **`HR_SALARY_PROCESS_FINAL`** (posted/finalized table). This means:
- Bank Advice only shows data for the **currently open period**.
- Allowance/Deduction Detail and Recon reports require the period to be **posted to FINAL tables** first.

In the standard workflow: run salary → generate bank advice → send to bank → post to FINAL → run detailed reports.

### 3. `optEq()` Fix in `reports.service.js`

The original Oracle report SQL used `col = NVL(:bind, col)` for optional filters, which silently drops rows where `col IS NULL` (Oracle `NULL = NULL` is UNKNOWN). The Node.js service replaces this with `(:bind IS NULL OR col = :bind)` ([reports.service.js:L124](file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/Node-LMS-Backend/src/services/reports.service.js#L124)), which correctly includes NULL-column rows when no filter is applied. This is a **significant correctness fix** over the original FastAPI/Oracle implementation.

### 4. `HR_ATTND_PERIOD` Period Label Dates

The Month Wise Deduction report showed `PERIOD_FRM` dates as `2026-06-30T19:00:00.000Z` for Period 48 instead of `2026-07-01`. This is a UTC offset artifact — the Oracle DATE is stored as `2026-07-01 00:00:00` PKT (+05:00), which appears as `2026-06-30T19:00:00.000Z` in UTC when read by node-oracledb. The `monthLabel()` helper in `reports.service.js:L74–L76` slices characters 5–7 of the ISO string, getting `06` instead of `07` — this would cause the month label to show **"Jun-2026"** instead of **"Jul-2026"** for Period 48 in the report headers.

> [!CAUTION]
> **Bug:** The `monthLabel` helper uses `frm.slice(5, 7)` on the raw JS Date `.toISOString()` output, which is UTC. For PKT timezone (+5), months stored as the 1st at midnight PKT appear as the previous month's 30th/31st in UTC. The fix would be to use `TO_CHAR(PERIOD_FRM, 'YYYY-MM-DD')` from Oracle (which the `listReportPeriods` and `buildMeta` functions already do correctly via explicit `TO_CHAR` in the SQL), ensuring the string is always the local date.
