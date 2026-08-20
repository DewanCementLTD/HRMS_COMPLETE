# Reports Module — real SQL, full filters, company/branch scoping, print-faithful PDFs

## Context

The `/reports` section was scaffolded by an external tool. It looks plausible but is not wired to
anything real:

- **`Node-LMS-Backend/src/services/reports.service.js` returns hardcoded mock arrays** — every one of
  the 9 report functions is a literal `return [ {...}, {...} ]`. No Oracle query is ever run.
- **Filters are missing.** The UI exposes only a hardcoded 4-option Period dropdown
  (`202607`/`202606`/…, which aren't even real `PERIOD#` values) and an allowance/deduction
  sub-category select. There is no designation, designation-group, department, grade, employee,
  gross-range, employee-status or period-**range** filter, even though the source Oracle queries
  bind all of them.
- **Company/branch scope is cosmetic.** `page.tsx` passes `compc`/`brnch` into the query string, but
  the backend ignores them entirely. An HR user on "Demo company / Karachi branch" sees the same
  fixture rows as anyone else.
- **Wide tables overflow.** `deduction-detail`, `active-employees` and `month-wise-deduction` have
  8–15 columns; several render without a scroll container, and the page layout doesn't follow the
  conventions used by `/payroll` and `/hrms`.
- **The print sheet is hardcoded** — "Dewan Cement Limited", "KARACHI", "Page 1 of 1",
  "JUL-27-26 02:55 PM" are string literals, and several report bodies don't match the reference
  output in `./Reports/`.

The 9 `.txt` files in the repo root are the authoritative Oracle report queries pulled from the
legacy ERP. The goal is to make `/reports` a real, filterable, correctly-scoped module whose printed
output matches `./Reports/*.jpeg`.

### Decisions confirmed with the user

| Question | Decision |
|---|---|
| `codename('LOC_ID'/'PERIOD#', …)` returns `NULL` in this DB; `HR_EMP_MASTER_VIEW.sec_nm` does not exist | Keep the query logic, add `NVL(codename(...), <join>)` fallbacks; `NULL AS sec_nm` so Section renders blank instead of ORA-00904 |
| `:MRTYPE`/`:mrtypr` = `'P'` (`HR_SALARY_PROCESS_FINAL`) vs `'C'` (`HR_SALARY_PROCESS`) | Expose as a **"Salary Data: Current / Posted (Final)"** filter, default **Current** |
| PDF generation | Keep browser `window.print()` + HTML print sheet; make it faithful to `./Reports` |
| PDF header company name | Use `user.selected_company.name` + selected branch + resolved period label + live run timestamp |

### Verified against the live DB (read-only probe)

- All referenced objects exist: `HR_SALARY_PROCESS`, `HR_SALARY_PROCESS_FINAL`,
  `HR_SALARY_PROCESS_MASTER(_FINAL)`, `HR_PF_BALANCES`, `HR_EMP_MASTER_VIEW`, `HR_EMP_DAYS`,
  `HR_TRANS_MST`, `HR_LOAN_MST`, `HR_ALLOWANCE`, `HR_DEDUCTION`, `HR_BANK`, `HR_BRANCH`,
  `HR_LOCATION`, and the `CODENAME` function.
- `HR_DESG.DESG_GRP` exists (currently one value, `'1'`).
- `HR_EMP_MASTER_VIEW.STATUS` values are `'Active'` / `'Other'` — matches `a.status = 'Active'`.
- `HR_SALARY_PROCESS_FINAL` is **empty**; `HR_SALARY_PROCESS` has rows for `UNIT_ID` 1 (period 88)
  and 3 (period 36). Expect "Posted (Final)" to return zero rows until payroll is posted.
- `codename('ORG',…)` → `"Demmy ORG"`, `codename('COPYR',…)` → `"Powered By AIO SOLUTIONS"` both
  work; only the `LOC_ID` / `PERIOD#` forms return `NULL`.

---

## Part 1 — Backend: real SQL

### 1.1 `Node-LMS-Backend/src/services/reports.service.js` (full rewrite)

Delete all mock data. Each function opens a pooled connection via `getDirectConnection()` from
`src/config/database.js`, runs the query from the corresponding root `.txt` file with named binds,
and closes in `finally` — the same shape as `payroll.service.js:getPayRegister()`
([payroll.service.js:1156](Node-LMS-Backend/src/services/payroll.service.js#L1156)), which is the
closest existing analogue and should be used as the reference implementation (bind building,
`OUT_FORMAT_OBJECT`, `lowerKeys`, pivot into `allow_cols`/`ded_cols`).

| Service fn | Source `.txt` | Binds |
|---|---|---|
| `getAllowanceDetailReport` | `Allowance List.txt` | `p_period1`, `p_period2`, `munitid`, `mlocatin`, `mempcd`, `mrtypr` |
| `getDeductionDetailReport` | `employee deduction detail.txt` | `p_period1`, `p_period2`, `munitid`, `mlocatin`, `mempcd`, `mrtype` |
| `getAllowanceReconReport` | `Payroll Reconciliation Detail Report (Allwoance ).txt` | `mpf`, `mpt`, `munit`, `memp` |
| `getDeductionReconReport` | `Dedudction Variance.txt` | `mpf`, `mpt`, `munit`, `memp` |
| `getMonthWiseDeductionReport` | `Month wise deduction report.txt` | `md_cd` (**required**), `mdt1`, `mdt2`, `empcd`, `mdept`, `mloc`, `munit` |
| `getBankAdviceReport` | `BAnk Advice.txt` | `mperiod`, `munit` (**both required**), `mlocation`, `mdesh_ord`, `maid1`, `mrtype` (`IN`/`OT`) |
| `getAbsentSuppReport` | `Employee Absent and Supplimentary Days Report.txt` | `mpf`, `munit`, `mloc`, `mdept` |
| `getActiveEmployeesReport` | `Employee Detail (Active).txt` | `empcode`, `mrtype` (`A`/`U`/`C`), `mloc`, `mstats`, `g1`, `g2`, `munit`, `mdesg1`, `mdeptno`, `mdesg`, `mgradde` |
| `getPfDetailReport` | `PF Detail.txt` (both queries) | `munit`, `memp` (**required**), plus `empcode` for the loan query |

**Rules for transcribing the SQL**

- Copy `query 1` from each file verbatim. Do not re-order joins, re-name binds, change `NVL(...)`
  optional-filter idioms, or drop the `UNION ALL` branches — the `:mrtypr='P'` / `:mrtypr='C'`
  guards are what select the FINAL vs CURRENT table and must survive.
- **Only** these deviations, per the confirmed decisions:
  - `codename('LOC_ID', c.location, null)` → `NVL(codename('LOC_ID', c.location, null), <loc join>)`,
    adding `HR_LOCATION` to the FROM list keyed on `LOC_ID` (and to the `GROUP BY`).
  - `codename('PERIOD#', …)` in period labels → resolved in JS from `HR_ATTND_PERIOD.PERIOD_FRM`
    (see §1.2) instead of in SQL.
  - `Employee Detail (Active).txt`: `sec_nm` → `NULL AS sec_nm` in all three `UNION ALL` branches.
- **`query 2` in each file is dropped.** Those are `FROM DUAL` header-label statements built on
  `codename('ORG')`, `DECODE(:mloc, null, 'ALL Locations', …)` etc. The Node layer builds an
  equivalent `meta` object from the already-resolved company/branch/period/filter labels, which is
  both cheaper and gives correct labels where `codename` returns `NULL`.
- **Recon reports need display labels.** `Payroll Reconciliation Detail Report (Allwoance ).txt`
  selects only `OLD_EMPCODE, UNIT_ID, TRANS_ID` and amounts, but the reference PDF shows employee
  names and an allowance-name section header. Wrap the file's query **unchanged** as an inline view
  and join `HR_EMP_MASTER` (name) and `HR_ALLOWANCE` (`allowance_desc`) on the outside — the
  filtering and `GROUP BY … HAVING` logic stays byte-identical.

**Response shaping** (services return shaped objects, not raw rows):

- `allowance-detail`, `deduction-detail` — pivot to one row per employee. Return
  `{ columns: string[], rows: [{ code, employee_name, location, values: Record<string, number>, total }], grand_total }`.
  Reuse the `allowCols` / `colSortKey` / `orderCols` pattern from
  [payroll.service.js:1146-1255](Node-LMS-Backend/src/services/payroll.service.js#L1146-L1255) so
  columns order by numeric `trans_id` exactly as the pay register does.
- `month-wise-deduction` — pivot on `period#`; `columns` = the period labels in the selected range,
  plus a `total` per row.
- `allowance-recon`, `deduction-recon` — group by `trans_id`; return
  `{ groups: [{ trans_id, descr, rows: [...], totals: {from, to, variance} }] }` to drive the
  "Total Of L.F.A" section footer.
- `bank-advice` — group by bank → branch; `salary_payable = t_all - t_ded`; per-group and grand totals.
- `pf-detail` — merge the two `UNION ALL` halves by `period#` into one ledger, compute the running
  `balance`, and return `{ employee_header, ledger, account_summary, pw_withdrawals }`. The
  `employee_header` (code/name/unit/department/designation) comes from `HR_EMP_MASTER_VIEW`;
  `account_summary.loan_against_pf` comes from `query 2` (`HR_LOAN_MST`, `LOAN_CD = 16`).
- `absent-supp`, `active-employees` — flat rows, sequence number assigned in JS.

Every function also returns a `meta` block: `{ company_name, unit_id, location_name, period_label,
period_to_label, filter_labels: {designation, department, grade, employee, …}, generated_at }`,
consumed by the print sheet header.

### 1.2 New lookups endpoint

Add to the same service:

- `listReportPeriods(unitId)` — `SELECT "PERIOD#", SCODE, STATUS, TO_CHAR(PERIOD_FRM,'YYYY-MM-DD')
  FROM HR_ATTND_PERIOD WHERE UNIT_ID = :u ORDER BY PERIOD_FRM DESC`, returning
  `{ period, label, status }` with `label` formatted `Mon-YYYY` from `PERIOD_FRM`. **All** periods,
  not just open ones — the reports need historical ranges, unlike
  `payrollEntry.service.js:listOpenPeriods` which filters `STATUS='O'`.
- `listDesgGroups(compc)` — `SELECT DISTINCT DESG_GRP FROM HR_DESG WHERE DESG_GRP IS NOT NULL
  ORDER BY 1` (verified present).

Exposed as `GET /reports/lookups` → `{ periods, desg_groups }` in one round trip.

Everything else already exists and must be reused rather than reimplemented:
`/reference/designations`, `/reference/departments`, `/reference/grades`, `/reference/emp-statuses`,
`/reference/banks`, `/payroll-entry/allowance-types`, `/payroll-entry/deduction-types`.

### 1.3 `reports.controller.js` — enforce company/branch server-side

This is what makes the sidebar selection actually filter the data. Reuse the existing helpers from
[`src/utils/payrollShared.js`](Node-LMS-Backend/src/utils/payrollShared.js) exactly as
`payrollEntry.controller.js` does:

```js
const { admin_card_no, compc, brnch, ...filters } = res.locals.validated.query;
const unitId   = await resolveCompany(admin_card_no, compc);   // → UNIT_ID
const location = await resolveBranch(admin_card_no, compc, brnch); // → LOCATION, null = all
```

`resolveCompany` clamps the requested company to the admin's rights (falling back to their first
allowed company), and `resolveBranch` returns `null` when the sidebar is on "All Branches" — which is
exactly the `NVL(:mloc, a.location)` semantics the report SQL already uses. `compc` → `UNIT_ID` and
`brnch` → `LOCATION` is the established mapping across this codebase (see
[hrmsFilters.js:41,48](Node-LMS-Backend/src/utils/hrmsFilters.js#L41)).

The resolved unit/location are passed as the `:munit*` / `:mloc*` binds; the client cannot widen
them. Report-specific filters (designation, department, period range, …) are applied **on top**.

### 1.4 `reports.schema.js` — per-report validation

Replace the single permissive `reportQuerySchema` with one schema per route so required binds are
enforced at the edge (`validate` already returns FastAPI-shaped 422s). Shared base:
`admin_card_no` (required), `compc`, `brnch`. Then per report:

- range reports: `period_from`, `period_to` (coerced ints, required), `rtype` enum `['C','P']`
- `month-wise-deduction`: `deduction_id` **required**
- `bank-advice`: `period` **required**, `bank_code`, `desg_grp`, `rtype` enum `['IN','OT']`
- `pf-detail`: `empcode` **required**
- `active-employees`: `rtype` enum `['A','U','C']`, `gross_from`, `gross_to`, `emp_status`,
  `grade_cd`, `desg_cd`, `desg_grp`, `dept_no`
- `absent-supp`: `period` required, `dept_no`

`reports.routes.js` keeps its `validate(...) → requireHrAdmin → controller` order; only the schema
per route changes, plus the new `GET /lookups`.

---

## Part 2 — Frontend

### 2.1 `LMS-Web/src/services/reportService.ts`

Replace the single `ReportFilterParams` with per-report param types mirroring the new schemas, add
`fetchReportLookups(adminCardNo, compc)`, and type the responses (`PivotReport`, `GroupedReport`,
`PfDetailReport`, …) instead of `any[]`. Keep the existing `buildQuery` + `apiRequest` idiom.

### 2.2 `app/(auth)/reports/page.tsx` — layout consistent with the rest of the app

Adopt the `/payroll` page structure ([payroll/page.tsx](LMS-Web/src/app/(auth)/payroll/page.tsx)),
which is the site convention: `PageHeader` → Level-1 area cards (`grid grid-cols-2 lg:grid-cols-4
gap-3`) for **Payroll Reports** / **General Reports** → Level-2 tab row for the individual report →
panel. This replaces the current bespoke indigo tab bar and pill strip.

Keep the existing HR-admin guard, row-selection state, `printableData` derivation and
`ReportPrintSheet` overlay — those are sound.

### 2.3 New `app/(auth)/reports/ReportFilterBar.tsx`

Data-driven from a per-report filter descriptor so each report shows only its own controls:

| Report | Filters |
|---|---|
| allowance-detail | Period **From–To**, Salary Data (C/P), Employee |
| deduction-detail | Period **From–To**, Salary Data (C/P), Employee |
| allowance-recon | Period From, Period To, Employee |
| deduction-recon | Period From, Period To, Employee |
| month-wise-deduction | Deduction Type *(required)*, Period From–To, Department, Employee |
| bank-advice | Period *(required)*, Designation Group, Bank, Type (In/Other) |
| absent-supp | Period *(required)*, Department |
| active-employees | Status (All Active / Confirmed / Un-Confirmed), Designation, Designation Group, Department, Grade, Employee Status, Gross From–To, Employee |
| pf-detail | Employee *(required)* |

Rules:
- **Company and branch are not editable here.** Render them as read-only chips
  (`user.selected_company.name` / `user.selected_branch?.name ?? "All Branches"`) with a hint that
  they follow the sidebar, so the inherited scope is visible. Changing the sidebar re-fires the
  fetch (`activeCompany`/`activeBranch` are already in `loadReport`'s dependency array).
- Period dropdowns are populated from `GET /reports/lookups`, **not** hardcoded — the real
  `PERIOD#` values here are 1..99 with `Mon-YYYY` labels, so the current `202607` options never
  matched anything.
- Guard From ≤ To; default To = latest period, From = To.
- Designation / department / grade / status dropdowns reuse `referenceService.fetch*`; allowance and
  deduction types reuse `payrollEntryService.fetchAllowanceTypes` / `fetchDeductionTypes`. Use the
  existing `SearchableSelect` for the employee picker.
- Explicit **Apply** button (reports are expensive) plus **Reset**.

### 2.4 Horizontal scrolling + table consistency

Wrap every report table in the container the rest of the app uses (`DutyRosterPanel.tsx:124`,
`SetupPanel.tsx:188`):

```tsx
<div className="overflow-x-auto rounded-2xl border border-gray-200 shadow-sm bg-white">
  <table className="min-w-full text-xs border-collapse"> … </table>
</div>
```

For the wide ones — `deduction-detail`, `allowance-detail`, `active-employees`,
`month-wise-deduction` — also: `whitespace-nowrap` on header and data cells so columns stop
wrapping into unreadable stacks, and `sticky left-0 bg-white z-10` on the checkbox + Code columns so
the employee stays visible while scrolling. Because the pivot columns are now dynamic (derived from
`columns` in the response), the current hardcoded `<th>` blocks per report id in `page.tsx` are
replaced by a map over `columns`.

### 2.5 `ReportPrintSheet.tsx` — match `./Reports` exactly

Replace the hardcoded `periodLabel = "Jul-2026"`, `unitName = "KARACHI"`, `locationName = "Karachi
Factory"`, `"Dewan Cement Limited"`, `"Page 1 of 1"` and `"JUL-27-26 02:55 PM"` with values from the
response `meta` + auth context. Render the company logo via the existing `CompanyLogo` component
(`compc={activeCompany}`), as `PayRegisterPanel` does.

Per-report header treatments taken from the reference images:

- **Absent & Supplementary** / **Allowance Detail** / **Deduction Detail** — centred blue company
  name, black bold title, "For the Month of <label>" (or "<from> to <to>"), green left badges
  (location / unit / "ALL Employee"), right `Page N of M` + `DD-MON-YY hh:mm AM`.
- **Bank Advice** — red title, red "ALL Designations" + green unit badges; per bank/branch a
  yellow-green band showing branch name / bank name / branch code; yellow **Total:** footer row;
  "Authorizg Signatory" rule at the bottom.
- **Month Wise Deduction** — left-aligned blue company + red title + "From <a> to <b>"; boxed
  green right block with underlined Unit / Location / Department / Report Type lines; right-aligned
  date and `Page N of M`.
- **Payroll Reconciliation (Allowance / Deduction)** — black company + title, underlined unit,
  "Report run on: <long date>"; one bordered section per allowance/deduction with a centred blue
  caption and a blue **Total Of \<NAME\>** footer row.
- **Active Employee Detail** — red title, red/green left badges, landscape.
- **P.F Detail** — blue company, red underlined title, two-column employee header
  (Code/Name + Department, Unit + Designation), grey-header ledger with a **Total** row, the
  **FOR ACCOUNT DEPARTMENT** summary box (with the blue **Toat P.F** row), and the **P.W Date /
  P.W Amount** box.

Print CSS: keep the `body * { visibility: hidden }` / `#printable-report-area` isolation already
there, but set `@page { size: A4 landscape }` for `active-employees`, `deduction-detail`,
`allowance-detail` and `month-wise-deduction`, portrait otherwise, and add
`print-color-adjust: exact` so the tinted header cells survive (same trick as
`PayRegisterPanel.tsx:286`).

---

## Known gaps to surface in the UI

- **OT Hours column** — the reference "Employee Allowances Detail Report" shows a small orange
  OT-hours column, but `Allowance List.txt` does not select it. It is dropped from both the table
  and the PDF rather than faked. Flag to the user; adding it needs a separate
  `HR_MONTHLY_ALLOWANCE.OT_HOUR` lookup.
- **Section column** — blank (`NULL AS sec_nm`) until `HR_EMP_MASTER_VIEW` gains the column.
- **Posted (Final) reports return no rows** on the current DB (`HR_SALARY_PROCESS_FINAL` is empty).
  Show the standard "No records found" empty state rather than an error.

---

## Verification

1. **Backend up**: `cd Node-LMS-Backend && npm start`; confirm the Oracle pool initialises in the log.
2. **Lookups**: `GET /reports/lookups?admin_card_no=<hr card>&compc=1` returns real `PERIOD#`
   values with `Mon-YYYY` labels and `desg_groups: ["1"]`.
3. **Per-report smoke test** — the `.http` files (`payroll.http`, `payroll_entry.http`) are the
   established pattern; add `reports.http` alongside them. Use `compc=1` with a period that has data
   (`PERIOD# = 88`) and `rtype=C`; confirm non-empty rows. Repeat with `compc=3, period=36`.
4. **Scoping proof**: call `absent-supp` twice with different `brnch` values and confirm the row sets
   differ; then call with a `compc` the admin has no rights to and confirm `resolveCompany` clamps it
   back to their allowed company rather than returning foreign data.
5. **Required-bind 422s**: `month-wise-deduction` without `deduction_id`, `pf-detail` without
   `empcode`, `bank-advice` without `period` each return `422 {detail:[{type:"missing",…}]}`.
6. **Frontend**: `cd LMS-Web && npm run dev`, open `/reports`.
   - Switch branch in the sidebar → table reloads with a different row count; the read-only chips in
     the filter bar update.
   - Change designation / department / period range → Apply → row count changes.
   - For `active-employees` and `deduction-detail`, confirm a horizontal scrollbar appears at the
     bottom of the table container and the Code column stays pinned while scrolling.
7. **PDF**: select a few rows → **Generate Report** → print preview. Compare side by side with the
   matching `./Reports/*.jpeg`: header colours and placement, column order, grid borders, group and
   total rows, page orientation.
8. `npm run lint` in `LMS-Web` and `npm run build` to catch type errors from the new typed responses.
