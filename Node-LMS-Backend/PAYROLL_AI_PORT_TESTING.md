# Frontend Navigation & Testing Guide for All Payroll & Payroll-Entries Endpoints

This guide details the exact **UI navigation steps**, **screen components**, and **user actions** required to test every single API endpoint in the **Node.js Payroll Backend** directly from the **LMS-Web** frontend.

---

## Base Application URL & Prerequisites

- **Frontend App URL**: `http://localhost:3000/payroll`
- **Required Role**: HR Admin user (e.g., `admin_card_no` query param is automatically passed by `AuthContext`).

---

## Area 1: Configuration (`/payroll` → "Configuration" Card)

### Tab 1: **Period Opening** (`PeriodOpeningPanel.tsx`)

#### Navigation Steps:

1. Go to `http://localhost:3000/payroll`.
2. Click the **"Configuration"** card (top-level group).
3. Select the **"Period Opening"** tab.

#### API Endpoints & UI Actions:

- **1. `GET /payroll/financial-years`**

  - **Triggers**: Automatically on panel load or clicking the **"Refresh"** button.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L35>)
  - **[DONE]**
- **2. `POST /payroll/financial-years`**

  - **UI Action**: Click **"+ Add Year"**, fill in *From Date*, *To Date*, *Code*, *Description*, check *Auto-generate 12 periods*, then click **"Save"**.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L37>)
  - **[DONE]**
- **3. `PUT /payroll/financial-years/:rule_id`**

  - **UI Action**: Go to **Configuration** → **Period Opening**, click **"Edit"** on a Financial Year row, update Code / Dates / Description, then click **"Save"**.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L39>)
  - **[DONE]**
- **4. `PATCH /payroll/financial-years/:rule_id/status`**

  - **UI Action**: Click **"Open"** or **"Close"** link in the *Actions* column of a Financial Year row.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L41>)
  - **[DONE]**
- **5. `GET /payroll/periods`**

  - **Triggers**: Automatically when a Financial Year row is selected.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L44>)
  - **[]DONE]**
- **6. `POST /payroll/periods`**

  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L46>)
  - ```Markdown
    Why it is not called in the UI:
    When an admin creates a Financial Year via "+ Add Year" on the Period Opening tab (Configuration → Period Opening), the form includes the checkbox:
    ☑ Auto-generate 12 periods (auto_periods: true)
    Submitting that form calls POST /payroll/financial-years, which instructs the backend to automatically create all 12 monthly periods for that financial year in a single operation.
    Because monthly periods are auto-generated during Financial Year creation, the frontend UI does not provide (or require) a separate "+ Add Single Period" button to trigger POST /payroll/periods.
    ```
  - **[SKIPED]**
- **7. `PATCH /payroll/periods/:period/status`**

  - **UI Action**: In the Monthly Periods table, click **"Open" / "Close"** or **"Block" / "Unblock"** under the *Actions* column.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L48>)
  - **[DONE]**

---

### Tab 2: **Tax Slabs** (`TaxSlabPanel.tsx`)

#### Navigation Steps:

1. Go to `http://localhost:3000/payroll`.
2. Click **"Configuration"** card → Select **"Tax Slabs"** tab.

#### API Endpoints & UI Actions:

- **8. `GET /payroll/tax-masters`**

  - **Triggers**: On panel load or clicking **"Refresh"**.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L52>)
  - **[DONE]**
- **9. `POST /payroll/tax-masters`**

  - **UI Action**: Click **"+ Add Tax Slab"**, enter *Description* & *Fiscal Year*, click **"Save"**.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L54>)
  - **[DONE]**
- **10. `PATCH /payroll/tax-masters/:tax_id/status`**

  - **UI Action**: Click **"Open"** or **"Close"** on a Tax Master row.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L56>)
  - **[DONE]**
- **11. `DELETE /payroll/tax-masters/:tax_id`**

  - **UI Action**: Click trash/delete icon on a Tax Master row.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L58>)
  - **[DONE]**
- **12. `GET /payroll/tax-masters/:tax_id/details`**

  - **Triggers**: When clicking on a Tax Master row to expand its details.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L60>)
  - **[DONE]**
- **13. `POST /payroll/tax-masters/:tax_id/details`**

  - **UI Action**: Inside expanded details, click **"+ Add Slab Range"**, fill *Slab From*, *Slab To*, *Rate %*, *Fixed Tax*, then click **"Save"**.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L62>)
  - **[DONE]**
- **14. `DELETE /payroll/tax-masters/:tax_id/details/:srno`**

  - **UI Action**: Click trash icon on an individual slab range row.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L64>)
  - **[DONE]**

---

## Area 2: Loans (`/payroll` → "Loans" Card)

### Tab 1: **Loans** (`LoanPanel.tsx`)

#### Navigation Steps:

1. Go to `http://localhost:3000/payroll`.
2. Click **"Loans"** card → Select **"Loans"** tab.

#### API Endpoints & UI Actions:

- **15. `GET /payroll/loan-types`**

  - **Triggers**: Panel load (populates loan type dropdown & manage types modal).
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L68>)
  - **[DONE]**
- **16. `POST /payroll/loan-types`**

  - **UI Action**: Click **"Manage Loan Types"** button → Enter *Description* → Click **"Add"**.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L70>)
  - **[DONE]**
- **17. `DELETE /payroll/loan-types/:loan_cd`**

  - **UI Action**: Inside *Manage Loan Types* modal, click trash icon next to a loan type.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L72>)
  - **[DONE]**
- **18. `GET /payroll/loans`**

  - **Triggers**: Panel load or typing employee code in filter input.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L75>)
  - **[DONE]**
- **19. `POST /payroll/loans`**

  - **UI Action**: Click **"+ Issue Loan"**, select *Employee*, *Loan Type*, *Amount*, *Instalment Amount*, click **"Save"**.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L77>)
  - **[DONE]**
- **20. `PUT /payroll/loans/:doc`**

  - **UI Action**: Click edit icon on a loan row → Modify details → Click **"Update"**.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L79>)
  - **[DONE]**
- **21. `DELETE /payroll/loans/:doc`**

  - **UI Action**: Click trash/delete icon on a loan row.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L81>)
  - **[DONE]**

---

### Tab 2: **Loan Recovery** (`LoanRecoveryPanel.tsx`)

#### Navigation Steps:

1. Go to `http://localhost:3000/payroll`.
2. Click **"Loans"** card → Select **"Loan Recovery"** tab.

#### API Endpoints & UI Actions:

- **22. `GET /payroll-entry/open-periods`**

  - **Triggers**: Panel load (verifies company has an open period).
  - **Service File**: [payrollEntryService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollEntryService.ts#L42>)
  - Should it show loans only forr  that open period or all ?
  - Currently shows all **[ISSUE]**
- **23. `GET /payroll-entry/recovery-types`**

  - **Triggers**: Panel load (populates Recovery Type dropdown: Cash, Salary, Write-off).
  - **Service File**: [payrollEntryService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollEntryService.ts#L44>)
  - **[DONE]**
- **24. `GET /payroll-entry/loans`**

  - **Triggers**: Panel load (fetches recoverable loans list).
  - **Service File**: [payrollEntryService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollEntryService.ts#L52>)
  - **[DONE]**
- **25. `GET /payroll-entry/loan-recoveries`**

  - **Triggers**: Panel load or selecting a specific loan.
  - **Service File**: [payrollEntryService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollEntryService.ts#L54>)
  - **[DONE]**
- **26. `POST /payroll-entry/loan-recoveries`**

  - **UI Action**: Select a loan → Fill *Recovery Amount*, *Type*, *Remarks* → Click **"Record Recovery"**.
  - **Service File**: [payrollEntryService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollEntryService.ts#L56>)
  - **[DONE]**
- **27. `DELETE /payroll-entry/loan-recoveries?rowid=...`**

  - **UI Action**: Click trash/delete icon on a recovery ledger entry.
  - **Service File**: [payrollEntryService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollEntryService.ts#L58>)
  - **[DONE]**

---

## Area 3: Monthly Inputs (`/payroll` → "Monthly Inputs" Card)

### Tab 1: **Allowances** (`MonthlyAllowancePanel.tsx`)

#### Navigation Steps:

1. Go to `http://localhost:3000/payroll`.
2. Click **"Monthly Inputs"** card → Select **"Allowances"** tab.

#### API Endpoints & UI Actions:

- **28. `GET /payroll-entry/allowance-types`**

  - **Triggers**: Panel load (populates Allowance Type dropdown).
  - **Service File**: [payrollEntryService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollEntryService.ts#L46>)
  - **[DONE]**
- **29. `GET /payroll-entry/allowances`**

  - **Triggers**: Panel load or filtering by employee code.
  - **Service File**: [payrollEntryService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollEntryService.ts#L62>)
  - **[DONE]**
- **30. `POST /payroll-entry/allowances`**

  - **UI Action**: Enter *Employee Code*, select *Allowance Type*, enter *Amount*, click **"Add / Update Allowance"**.
  - **Service File**: [payrollEntryService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollEntryService.ts#L64>)
  - **[DONE]**
- **31. `DELETE /payroll-entry/allowances?empcode=...&allowance_id=...`**

  - **UI Action**: Click trash icon on an allowance row.
  - **Service File**: [payrollEntryService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollEntryService.ts#L66>)
  - **[DONE]**

---

### Tab 2: **Deductions** (`MonthlyDeductionPanel.tsx`)

#### Navigation Steps:

1. Go to `http://localhost:3000/payroll`.
2. Click **"Monthly Inputs"** card → Select **"Deductions"** tab.

#### API Endpoints & UI Actions:

- **32. `GET /payroll-entry/deduction-types`**

  - **Triggers**: Panel load (populates Deduction Type dropdown).
  - **Service File**: [payrollEntryService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollEntryService.ts#L48>)
  - **[DONE]**
- **33. `GET /payroll-entry/deductions`**

  - **Triggers**: Panel load or filtering by employee.
  - **Service File**: [payrollEntryService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollEntryService.ts#L70>)
  - **[DONE]**
- **34. `POST /payroll-entry/deductions`**

  - **UI Action**: Enter *Employee Code*, select *Deduction Type*, enter *Amount*, click **"Add / Update Deduction"**.
  - **Service File**: [payrollEntryService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollEntryService.ts#L72>)
  - **[DONE]**
- **35. `DELETE /payroll-entry/deductions?empcode=...&deduction_id=...`**

  - **UI Action**: Click trash icon on a deduction row.
  - **Service File**: [payrollEntryService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollEntryService.ts#L74>)
  - **[DONE]**

---

### Tab 3: **Absent Days** (`AbsentDaysPanel.tsx`)

#### Navigation Steps:

1. Go to `http://localhost:3000/payroll`.
2. Click **"Monthly Inputs"** card → Select **"Absent Days"** tab.

#### API Endpoints & UI Actions:

- **36. `GET /payroll-entry/absent-days`**

  - **Triggers**: Panel load (fetches absent records for open period).
  - **Service File**: [payrollEntryService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollEntryService.ts#L78>)
  - **[DONE]**
- **37. `GET /payroll-entry/absent-days/employee`**

  - **Triggers**: Entering an employee code in the entry form to fetch current absent days.
  - **Service File**: [payrollEntryService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollEntryService.ts#L80>)
  - **[DONE]**
- **38. `POST /payroll-entry/absent-days`**

  - **UI Action**: Enter *Employee Code* & *Absent Days count*, click **"Save Absent Days"**.
  - **Service File**: [payrollEntryService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollEntryService.ts#L82>)
  - **[DONE]**
- **39. `DELETE /payroll-entry/absent-days?empcode=...`**

  - **UI Action**: Click trash icon on an absent days row.
  - **Service File**: [payrollEntryService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollEntryService.ts#L84>)
  - **[DONE]**

---

## Area 4: Salary (`/payroll` → "Salary" Card)

### Tab 1: **Salary / Payslips** (`SalaryPanel.tsx` & `Payslip.tsx`)

#### Navigation Steps:

1. Go to `http://localhost:3000/payroll`.
2. Click **"Salary"** card → Select **"Salary / Payslips"** tab.

#### API Endpoints & UI Actions:

- **40. `GET /payroll/salary/open-period`**

  - **Triggers**: Panel load (displays current active open period info banner).
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L116>)
  - **[DONE]**
- **41. `GET /payroll/salary/periods`**

  - **Triggers**: Panel load (populates Period dropdown filter).
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L107>)
  - **[DONE]**
- **42. `GET /payroll/salary/sheet`**

  - **Triggers**: Selecting a Period from the dropdown.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L109>)
  - **[DONE]**
- **43. `POST /payroll/salary/process`**

  - **UI Action**: Click **"Run Salary Process"** button in banner → Confirm modal dialog.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L119>)
  - **[DONE]**
- **44. `GET /payroll/salary/payslip`**

  - **UI Action**: Click **"View Payslip"** button on an employee row in the salary table.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L111>)
  - **[DONE]**

---

## Area 5: Reports (`/payroll` → "Reports" Card)

### Tab 1: **Pay Register** (`PayRegisterPanel.tsx`)

#### Navigation Steps:

1. Go to `http://localhost:3000/payroll`.
2. Click **"Reports"** card → Select **"Pay Register"** tab.

#### API Endpoints & UI Actions:

- **45. `GET /payroll/pay-register/periods`**

  - **Triggers**: Panel load (populates Pay Register period selector).
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L139>)
  - **[DONE]**
- **46. `GET /payroll/pay-register`**

  - **Triggers**: Selecting a period from the dropdown or clicking **"Generate Register"**.
  - **Service File**: [payrollService.ts](<file:///e:/SYSNOVIX_LMS/%5BLIVE%5D%20HRMS_COMPLETE/LMS-Web/src/services/payrollService.ts#L144>)
  - **[DONE]**

---

*Guide generated for `LMS-Web` testing against `Node-LMS-Backend`.*
