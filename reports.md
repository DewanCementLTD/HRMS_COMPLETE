# HRMS & Payroll System Architecture, Technical Challenges, and Resolutions

## Executive Summary

This document provides a comprehensive technical overview of the HRMS and Payroll system, documenting all architectural discoveries, database schema quirks, PL/SQL stored procedure hardcoding, report discrepancies, UI bugs, and their mitigations.

---

## 1. Database Architecture & Schema Findings

### A. Global vs. Unit-Scoped Master Setup Tables

* **`HR_DEDUCTION` (Deduction Master)**

  * **Clarified Architecture:** Management confirmed that `HR_DEDUCTION` is a **Global Shared Setup Master** across all companies/units (`UNIT_ID = 1` or `NULL`).
  * **Standard Deduction Codes (Global `UNIT_ID = 1`):**
    * Code `1` — `EOBI`
    * Code `2` — `ADVANCE SALARY`
    * Code `10` — `INCOME TAX`
    * Code `11` — `INCOME TAX SURCHARGE`
    * Code `12` — `PROVIDENT FUND`
    * Code `17` — `ALLOWNCES TAX`
  * **Resolution:** All dropdowns (`listDeductionTypes`) and manual entries must query and insert under `UNIT_ID = 1` or `NULL` so deductions remain unified without duplicates across all units.
* **`HR_ALLOWANCE` (Allowance Master)**

  * **Schema Finding:** `HR_ALLOWANCE` does NOT contain a `UNIT_ID` or `COMPC` column. It is a 100% global lookup table shared by all companies (defining `BASIC`, `HOUSE RENT`, `CONVEYANCE`, `UTILITIES`, etc.).
  * **Unit Scoping:** Unit-level allowance assignments happen in `HR_EMP_ALLOW` and `HR_SALARY_PROCESS`, not in `HR_ALLOWANCE`.
* **`HR_EMP_ALLOW` & `HR_EMP_ALLOW_VIEW` (Employee Allowance Assignment)**

  * Stores employee-level allowance assignments. `HR_EMP_ALLOW_VIEW` is a legacy view that aggregates allowances by pivot:
    * `ALLOWANCE_ID = 3` — House Rent (`H_R`)
    * `ALLOWANCE_ID = 4` — Conveyance (`CONV`)
    * `ALLOWANCE_ID = 5` — Utilities (`UT`)
    * `ALLOWANCE_ID = 17` — FPO (`FPO`)
* IK EMPLOYEE KI CORRESPONDING ENTERY AGR HR_EMP_ALLOW MA HOGI TAB HI WHO "All ACTIVE EMPLOYEE DETAIL REPORT" MA DEKHAY GA
* **`HR_SALARY_PROCESS` vs. `HR_SALARY_PROCESS_FINAL`**

  * **`HR_SALARY_PROCESS` & `HR_SALARY_PROCESS_MASTER`**: Stores **active draft salary run results** for Open periods.
  * **`HR_SALARY_PROCESS_FINAL` & `HR_SALARY_PROCESS_MASTER_FINAL`**: Stores **closed/posted historical salary results** after month-end posting.
  * HR_SALARY_PROCESS_FINAL MA KHABHI DATA A HI NAHI RAHA HA (CHAHIYE RUN SALARY PROCESS PROC run KARLO DATA _FINAL MA INSERT NAHI HO RAHA US MA TU
    JO REPORT IS PER DEPENDENT HAIN WHO SAHI SE NAHI RUN HON GI (See txt files to understand what thoese reports are))

---

## 2. Major Technical Challenges & Mitigations

### Challenge 1: Month-Wise Deduction Report Returning "No Records Found"

* **Symptom:** Month-Wise Deduction Report showed empty rows for current active periods even though salary had been processed.
* **Root Cause:** The backend service (`reports.service.js`) was hardcoded to query `HR_SALARY_PROCESS_FINAL` (the posted table WHICH IS NEVER FILLED IN THE PROGRAMS LIFE TIME). Current open period calculations reside in `HR_SALARY_PROCESS`.
* **Mitigation:** Updated `getMonthWiseDeductionReport` to perform a `UNION ALL` across `HR_SALARY_PROCESS` (draft) and `HR_SALARY_PROCESS_FINAL` (posted). Now reports work seamlessly for both draft and closed periods. (THIS WAS NOT DONE IN THE ORIGINAL SQL QUERY, )

---

### Challenge 2: Hardcoded Transaction IDs in Oracle DB Stored Procedure (`Hr_salary_proces_pro`)

* **Symptom:** When running salary process for Unit 2, Income Tax was saved under Code `10` instead of Unit 2's local tax code `29`. Filtering Unit 2's Tax in reports returned 0 rows.
* **Root Cause:** The Oracle stored procedure `Hr_salary_proces_pro` hardcodes Unit 1 transaction IDs during calculation:
  * **Income Tax:** Hardcoded `TRANS_ID = '10'`
  * **Provident Fund:** Hardcoded `TRANS_ID = '12'`
  * **EOBI:** Hardcoded `TRANS_ID = '1'`
  * **Basic / HR / Conv / Utilities:** Hardcoded `TRANS_ID = 2, 3, 4, 5`
* **Mitigation:** Unified deduction management around `UNIT_ID = 1` global codes:
  1. Updated `listDeductionTypes` to serve global `UNIT_ID = 1` master deductions.
  2. Re-mapped manual entries in `HR_MONTHLY_DED` and `HR_SALARY_PROCESS` to standard global codes (`2` for Advance Salary, `12` for Provident Fund).

---

### Challenge 3: Active Employee Detail Report Showing Only 3 Employees (vs. 600 in HRMS)

* **Symptom:** The Active Employee Detail Report showed only 3 employees for Unit 2 (and Unit 1), whereas the HRMS Tab showed 600+ active employees.
* **Root Cause:** Legacy Oracle View **`HR_EMP_MASTER_VIEW`** used strict `INNER JOIN`s on four tables:
  1. `hr_emp_allow_view b` (`a.old_empcode = b.old_empcode AND a.unit_id = b.unit_id`)
  2. `hr_location e` (`a.location = e.loc_id`)
  3. `hr_desg c` (`a.desg_cd = c.desg_cd AND a.unit_id = c.compc`)
  4. `hr_dept d` (`a.dept_no = d.dept_no AND a.unit_id = d.compc`)
     Because 586 employees lacked records in `HR_EMP_ALLOW`, the inner join dropped them all.
* **Mitigation:**
  1. Batch-inserted default allowance setup rows into `HR_EMP_ALLOW` (`ALLOWANCE_ID = 3`) for all active employees.
  2. Validated and updated `LOCATION` codes in `HR_EMP_MASTER`.
  3. **Result:** Employee count in `HR_EMP_MASTER_VIEW` jumped from **3 to 581+ active employees**.

### Challenge 4: Bank Advice Report Total Salary Mismatch

* **Symptom:** Net payable totals in Bank Advice Report differed from payslips.
* **Root Cause:** Joining `HR_DESG` without scoping `c.compc = a.unit_id` caused Cartesian multiplication on designation rows shared across companies.
* **Mitigation:** Added company scoping `(c.compc = a.unit_id OR c.compc IS NULL)` to `HR_DESG` joins.

---

### Challenge 5: React Error `Rendered fewer hooks than expected` on Tab Navigation

* **Symptom:** Switching HRMS tabs (`Locations`, `Setup`, `Attendance`) caused a React runtime error.
* **Root Cause:** A `useEffect` hook for edit form population was declared **after** early return statements (`if (section === "locations") return ...`). When switching sections, the early return skipped the `useEffect`, violating React rules of hooks.
* **Mitigation:** Moved `useEffect` above all conditional return guards in `page.tsx`.

---

### Challenge 6: Employee Edit Form Re-filling with Previous Data

* **Symptom:** Editing employee A, returning to list, and clicking edit on employee B displayed employee A's pre-filled data.
* **Root Cause:** Render guard `form.name === ""` evaluated to `FALSE` on employee B because `form.name` was still set to `"Employee A"`.
* **Mitigation:**
  1. Added `setForm({ ...EMPTY_FORM })` and `ctrl.clearSelection()` on `startEdit` and `goList`.
  2. Wrapped form population in `useEffect([view, ctrl.selectedEmployee])`.

---

## 3. System Caveats & Assumptions

1. **Tax Year Cycle:** PL/SQL tax formulas assume a July to June fiscal tax cycle (`12 - month_number`).
2. **Deduction Master Creation:** New deduction types must be saved with `UNIT_ID = 1` or `NULL` to remain globally available.
3. **Draft Processing behavior:** Running the salary process executes `DELETE FROM HR_SALARY_PROCESS WHERE UNIT_ID = munit` at startup.
4. **Report Query Pattern:** Active draft reports query `HR_SALARY_PROCESS`, while historical posted reports query `HR_SALARY_PROCESS_FINAL`. Using `UNION ALL` bridges both states.
