# Business Requirements Document (BRD)
## HRMS / LMS — Human Resource & Leave Management System

---

### Document Control

| Field | Detail |
|---|---|
| **Document Title** | HRMS / LMS — Business Requirements Document |
| **Owner** | Dewan Cement Limited — HR & IT |
| **Solution Provider** | Sysnovix — ERP & IT Solutions |
| **Version** | 1.0 |
| **Status** | Baseline |
| **Classification** | Internal / Confidential |
| **Audience** | HR Management, IT, Payroll, Branch Administrators, Project Sponsors |

> This document describes **what** the system does and the business rules it enforces. It is solution-aware but vendor-neutral in intent: it captures the business knowledge so the platform can be operated, audited, extended, or re-implemented without loss of institutional knowledge.

---

## 1. Executive Summary

The HRMS/LMS is a multi-company, web-and-mobile Human Resource platform that manages the complete employee lifecycle for Dewan Cement Limited and its associated business units (e.g., **Dewan Cement Limited – Karachi**, **Chef & Butler**, **Hasan Foods**, and others). It unifies employee records, biometric (face) and GPS-based attendance, leave, the full monthly payroll cycle, recruitment, and statutory/management reporting under a single role-based system.

The platform consists of:

- A **web portal** for HR administrators and self-service employees.
- A **mobile (Android) application** for employees to mark attendance via face recognition and to view their own data.
- A **face-recognition service** that performs 1:1 verification and 1:N identification.
- An **Oracle database** that is shared with the organisation's existing ERP, allowing the HRMS to reuse and respect ERP-owned master and payroll data.

The system's guiding principles are: **one source of truth per data domain**, **strict company/branch data isolation**, **accuracy of attendance and payroll**, and **operational simplicity** for branch-level staff.

---

## 2. Purpose & Scope

### 2.1 Purpose
To provide a single, authoritative system for HR operations across all business units, replacing manual and fragmented processes for attendance capture, leave handling, payroll preparation, and HR reporting, while integrating cleanly with the organisation's ERP.

### 2.2 In Scope
- Employee master data management (multi-company, multi-branch).
- Biometric (face) + geolocation attendance capture via mobile.
- Continuous/periodic location tracking with geofencing.
- Monthly duty-roster viewing (sourced from ERP).
- Leave application, balances and status.
- Full monthly payroll preparation: period control, monthly inputs (allowances, deductions, absences), loans and recoveries, tax slabs, salary processing, payslips, and the Pay Register report.
- Master / reference data setup per company and branch (including shift configuration).
- Employee ID card generation.
- Document and photo management.
- Recruitment (jobs, applications, interviews, offers).
- HR dashboards and analytics.
- Mobile application version control / forced-update enforcement.

### 2.3 Out of Scope (current baseline)
- General-ledger / financial accounting postings (owned by ERP).
- Bank disbursement file generation (unless explicitly added later).
- Performance appraisal and training management (future phases).
- Computation of duty-roster late/overtime/absent **flags** inside the app — these remain ERP-computed (see §8 and §10).

---

## 3. Business Context & Objectives

| # | Business Objective | How the System Delivers It |
|---|---|---|
| O1 | Accurate, tamper-resistant attendance | Face recognition + GPS location captured at each mark; smart in/out logic |
| O2 | Eliminate buddy-punching | 1:1 face verification against the logged-in employee |
| O3 | Field-staff accountability | Periodic GPS tracking with per-employee interval and geofencing |
| O4 | Correct, timely payroll | Period-controlled monthly cycle, ERP salary processing, and a reconciled Pay Register |
| O5 | Strong data governance | Company/branch-scoped access enforced server-side on every request |
| O6 | Self-service | Employees view attendance, leave balances, payslips, and profile on mobile/web |
| O7 | Operational continuity | Reuse of ERP master/payroll data; no duplicate maintenance |
| O8 | Auditable HR operations | Centralised records, role-based actions, and printable reports/IDs |

---

## 4. Stakeholders & User Roles

| Role | Description | Key Capabilities |
|---|---|---|
| **HR Administrator** | HR/payroll staff for one or more companies/branches | Full employee management, attendance review, payroll, setup, reports, ID cards |
| **HR Administrator (Salary-restricted)** | HR admin without salary visibility | All HR functions except viewing/editing salary figures |
| **Branch Administrator** | HR admin scoped to specific branch(es) | Same as HR admin, limited to assigned company + branches |
| **Employee (Self-Service)** | Any active employee with a profile | Mark attendance (mobile), view own attendance/leave/payslip/profile, apply for leave, change password |
| **System / Integration** | ERP and scheduled processes | Populate ERP-owned data (duty roster, pay register); salary processing procedure |

**Access model:** A user's company rights (`SEC_USERCMPN`) and branch rights (`SEC_USERBRCH`) determine the data they can see and act on. Every server endpoint re-validates these rights; a selected company/branch is honoured only if it falls within the user's granted rights, otherwise it falls back to the user's first authorised scope.

---

## 5. Solution Architecture Overview

| Component | Technology | Responsibility |
|---|---|---|
| **Web Portal** | Next.js (React) | HR admin and employee self-service UI |
| **Mobile App** | Android | Employee face attendance + self-service |
| **Core API** | FastAPI (Python), service on port 8001 | Auth, HRMS, attendance, payroll, leave, reference, documents |
| **Face Service** | FastAPI + InsightFace + FAISS, service on port 8002 | Face enrolment, verification (1:1), identification (1:N) |
| **Database** | Oracle (shared with ERP) | Single source of truth; HRMS and ERP tables co-resident |
| **Storage** | File system / DB | Employee photos, documents, company logos |

**Integration stance:** The HRMS **owns** its operational data (its attendance store, face embeddings, location tracks, setup data) and **reads** ERP-owned data where the ERP is authoritative (duty roster, processed pay register). The HRMS does not write ERP-owned tables.

---

## 6. Functional Requirements by Module

### 6.1 Authentication, Access & Multi-Company Security
- **Login** by employee card number / username and password; supports both ERP security users and employee profiles.
- On login the system resolves the user's **authorised companies and branches**, HR-admin flag, salary-edit permission, and whether employee self-service features are available.
- **Company/branch context switching** for users with rights to more than one; all subsequent data is scoped to the active selection.
- **Change password**; **lookup by phone** for support flows.
- **BR:** Every data request is independently authorised server-side; UI scope is never trusted on its own.

### 6.2 Employee Master (HRMS)
- Create, edit, and view employees with full personal, employment, salary, banking, and access details (name, father/husband, CNIC, DOB, contact, department, designation, grade, employee status, unit/company, branch/location, appointment/confirmation dates, bank & account, NTN, qualification, reporting officer, blood group, marital status, religion, working hours).
- **Directory** with status tabs (Active/Inactive/Left), free-text search, and department/gender filters.
- **CSV and PDF export** of the directory, branded with the **company name** (not a generic placeholder).
- Per-employee actions: **Edit, Attendance Report, Duty Roster, ID Card, Location**.
- **BR:** Branch/Location is mandatory at registration — without it the employee will not appear under any branch or be counted in branch attendance.
- **BR:** Salary figures are visible/editable only to users with salary permission; others see them read-only or hidden.

### 6.3 Attendance (Face + GPS)
- Employees mark attendance from the mobile app; each mark captures **face frames + GPS coordinates + address + device metadata**.
- **Face check:** 1:1 **verification** against the logged-in employee's enrolled face.
- **Smart in/out logic:** the **earliest** mark of the day is the check-in (Time In = min); the **latest** mark is the check-out (Time Out = max). Repeated or accidental marks only push the check-out forward; the check-in never moves earlier than the first mark.
- **Check-in location** and **check-out location** are stored **separately** (distinct latitude/longitude/address), so each day's record retains both where the person started and where they finished.
- HR admins view attendance via **bulk summary** (per employee, per period) and **details** (one row per employee per present day), filtered by company/branch.
- Employees view their own **attendance report** (date range) and **summary** (present, incomplete, working time).
- **BR:** The HRMS attendance store is the authoritative source for app-captured attendance. Concepts the app cannot compute from raw in/out (late, overtime, absent classification, shift-based deductions) are ERP/duty-roster concepts and are presented as zero/blank in app-only views.

### 6.4 Location Tracking
- Per-employee toggle to **enable tracking** and set a **tracking interval** (hours).
- Periodic GPS points are recorded; the **attendance-marking location** is recorded as the day's origin point.
- **Geofence** and tracking-settings endpoints support boundary/behaviour configuration.
- HR can view an employee's **location history** map/list.

### 6.5 Duty Roster (read-only)
- Per-employee **Monthly Duty Roster** view mirroring the ERP form: Roster Date, Shift (e.g., G = General, R = Rest), Day Name, Time In/Out, First-Half (Late, Half-Day), Second-Half (Late, Half-Day), Absent/Early-Out, and Remarks.
- **Month selector** (lists months available for the employee), **Print**, and **inline editing** of the **Shift** (from the shift master LOV) and **Remarks** per day.
- Each edit records **who updated it and when** (shown in an *Updated By* column).
- **BR:** Sourced from the ERP-owned duty roster. The ERP computes shift assignment and the late/half-day/early-out flags. The HRMS may **amend the Shift and Remarks** of an existing roster day on explicit HR action (update by primary key only — never inserts), stamping the auditor; all other roster values (in/out, late/half-day/early-out, totals) remain ERP-computed and are displayed as-is.

### 6.6 Leave Management
- Employee **leave balances**, **apply for leave**, and **leave status** tracking via self-service.
- HR visibility of leave within dashboards.
- **BR:** Leave types/balances follow the organisation's existing leave policy as maintained in the shared database.

### 6.7 Payroll — Configuration
- **Financial years** and **period opening**: define and open the payroll period that monthly inputs and processing apply to.
- **Tax slabs**: maintain tax master records and slab details used during salary computation.
- **BR:** Monthly inputs and salary processing act on the **open period**; only one logical open period drives the current cycle.
- **BR:** The organisation's pay cycle runs **26th of the previous month to the 25th of the current month** (reflected in attendance presets and period handling).

### 6.8 Payroll — Monthly Inputs
- **Monthly Allowances** and **Monthly Deductions** entry per employee for the open period.
- **Absent Days** entry (links to payroll absence handling).
- **Loans**: issue loans (amount, instalments, interest, dates, cheque details) and record **loan recoveries/adjustments**.
- **BR:** These inputs feed the salary processing run for the open period.

### 6.9 Payroll — Salary Processing & Payslips
- **Run Salary Process** executes the ERP salary procedure for the company's open period, rebuilding the full salary breakdown and replacing any prior processed salary for that period.
- **Processed Salary sheet**: per-employee actual/earned gross, total earnings, deductions and net, with search and totals.
- **Payslip** generation per employee.
- **BR:** Re-running the process for a period **replaces** that period's previously processed result.

### 6.10 Payroll — Reports: Pay Register
- A **Pay Register** report under Payroll → Reports, modelled on the legacy ERP register.
- **Company header** (logo + company name), period, unit, and employee count.
- Grid **grouped by Location → Department**, with **per-department, per-location, and grand totals**.
- **Dynamic component columns**: allowance and deduction columns are derived from the actual pay components present for the unit (component sets differ per unit), plus Total Allowance, Total Deduction, Net Pay, and a Hold-salary indicator.
- **Period picker**, name/code/department filter, and **Print** (A3 landscape, print-isolated).
- **"View Pay Register"** action appears immediately after a successful salary run and opens the report pre-set to the just-processed period.
- **BR:** Read-only from the ERP pay-register view; figures are presented exactly as the ERP computed them.

### 6.11 Setup / Master Data
- Maintain master/reference data, **scoped by company and (where applicable) branch**:
  - **Organisation:** Departments, Designations, Branches/Locations.
  - **Employee attributes:** Employee Statuses, Qualifications, Blood Groups, **Shifts**.
  - **Banking:** Banks and Bank Branches.
  - **Branding:** Company Logo (used on ID cards, payslips, reports).
- **Shift configuration:** the shift **code** is selected from a master List of Values (e.g., G, A, B, D, R, X) and the full shift definition (timings: from/to, overtime start, allow-in, late start/end, half-day start/end, Saturday set, late-sitting, early-out ranges, duty hours, day name) is stored **per company + branch**. Each shift code is configured once per company/branch.
- **BR:** Setup data respects the selected company/branch; branches and attributes are presented per company.

### 6.12 Employee ID Cards
- Branded, print-ready **employee ID card** (front + back) with company logo, employee photo, name, designation, department, card number, and key personal/employment details.
- **Back face** includes a **QR code** linking to the solution provider and a company footer.
- Designed for **physical card printing** (CR80 sizing) with print-color fidelity.

### 6.13 Documents & Photos
- Upload and serve **employee photos**, **employee documents**, and **company logos**.
- Photos/logos are used across ID cards, payslips, and reports.

### 6.14 Recruitment
- Manage **Jobs** (postings), **Applications**, **Interviews**, and **Offers**, with recruitment **analytics**.
- Supports the hire-to-onboard pipeline feeding the employee master.

### 6.15 HR Dashboard & Analytics
- Aggregated **dashboard**: total employees, present/absent counts for the day, department-wise breakdown, recent hires, upcoming birthdays, and day-over-day deltas — scoped to the selected company/branch.
- **Analytics** endpoints for trend/summary visualisations.

### 6.16 Mobile Application & Version Control
- Android app for face attendance and self-service.
- **Forced-update enforcement:** the server can block attendance from app versions below a required minimum and return an update URL; current versions pass through.

---

## 7. Cross-Cutting & Key Business Rules (Consolidated)

1. **Company/branch isolation** is enforced on every request; UI selections are validated against the user's rights server-side.
2. **Attendance store ownership:** app-captured attendance lives in the HRMS attendance store; the ERP duty roster is read-only to the app.
3. **Smart attendance:** Time In = earliest mark, Time Out = latest mark; accidental repeats only extend the out time.
4. **Separate check-in/check-out locations** are retained per day.
5. **Identity for attendance** is established by **1:1 face verification** of the logged-in employee; the system must not silently fall back to 1:N identification after login (to prevent mis-attribution).
6. **Pay cycle:** 26th → 25th; payroll acts on the **open period**.
7. **Salary re-processing replaces** the period's prior result.
8. **ERP-computed values** (duty-roster late/half-day/early-out and in/out; pay-register amounts) are displayed as-is. The one sanctioned exception is HR **editing a roster day's Shift and Remarks** from the Duty Roster screen — an audited update-by-PK, never an insert.
9. **Branding** uses the **selected company's** name and logo on all outputs (directory exports, payslips, ID cards, Pay Register).
10. **Shift definitions** are per company + branch; the code comes from the master LOV.

---

## 8. Reporting & Outputs

| Report / Output | Audience | Format | Source |
|---|---|---|---|
| Employee Directory | HR Admin | CSV, PDF (branded) | HRMS employee master |
| Attendance Report (per employee) | HR Admin / Employee | On-screen, CSV, PDF timesheet | HRMS attendance store |
| Bulk Attendance Summary / Details | HR Admin | On-screen | HRMS attendance store |
| Monthly Duty Roster | HR Admin | On-screen, Print | ERP duty roster (read-only) |
| Processed Salary Sheet | HR Admin (salary) | On-screen | ERP salary processing |
| Payslip | HR Admin / Employee | On-screen / print | ERP salary data |
| **Pay Register** | HR Admin (salary) | On-screen, Print (A3) | ERP pay-register view |
| Employee ID Card | HR Admin | Print (CR80) | HRMS master + photo + logo |
| HR Dashboard / Analytics | HR Admin | On-screen | HRMS + ERP aggregates |

---

## 9. Data Sources & Integration

- **Authoritative HRMS domains:** employee operational records, app attendance, face embeddings, location tracks, reference/setup data, documents/photos, recruitment.
- **Authoritative ERP domains (read-only to HRMS):** duty roster (shift assignment, computed late/half-day/early-out flags, roster in/out), processed pay register, and certain master codes resolved via shared lookups.
- **Shared database:** HRMS and ERP objects co-reside in Oracle; the HRMS joins to ERP master/employee views to resolve names and codes.
- **Face recognition:** enrolment stores a face embedding per employee; verification matches a live capture to that embedding; identification (1:N) is reserved for non-logged-in kiosk scenarios, not post-login marking.

---

## 10. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Security & Privacy** | Role-based access; company/branch isolation enforced server-side; biometric data stored as embeddings; least-privilege for salary data. |
| **Accuracy** | Attendance and payroll figures must reconcile to source; ERP-computed values are never altered by the app. |
| **Availability** | The attendance and self-service services must be available during working hours across branches; outages must not corrupt records. |
| **Performance** | Bulk attendance and pay register must return for a full unit/period within acceptable interactive time. |
| **Usability** | Field-staff flows (mark attendance) must be simple; HR screens must be readable and printable; UI must not distort with wide data. |
| **Portability / Print** | Reports and ID cards must print faithfully (color fidelity, correct paper sizing). |
| **Mobile compatibility** | Enforced minimum app version; graceful forced-update messaging. |
| **Maintainability** | Clear separation of HRMS-owned vs ERP-owned data; one source of truth per domain. |

---

## 11. Assumptions, Dependencies & Constraints

- **Assumptions:** The shared Oracle database and ERP remain available; employees enrol a clear face image; devices have GPS and network connectivity.
- **Dependencies:** ERP salary procedure and ERP-populated duty-roster / pay-register data; shared master code lookups; company logos uploaded per company.
- **Constraints:** ERP-owned tables are read-only to the HRMS; duty-roster late/half-day/early-out flags are only as complete as the ERP makes them; the app cannot independently recompute ERP payroll logic.

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Company / Unit** | A business entity (e.g., Dewan Cement – Karachi, Chef & Butler); identified by Unit ID |
| **Branch / Location** | A physical location belonging to a company (e.g., Head Office) |
| **HR Admin** | A user with administrative HR rights for one or more companies/branches |
| **Self-Service** | Employee-facing functions (own attendance, leave, payslip, profile) |
| **Duty Roster** | ERP-owned monthly per-employee schedule + computed attendance flags |
| **Open Period** | The payroll period currently accepting inputs/processing |
| **Pay Register** | Period payroll report listing earnings, deductions, and net per employee |
| **Shift (G/R/…)** | Daily work-pattern code (General, Rest, etc.) with timing rules |
| **Embedding** | Numerical representation of a face used for verification/identification |
| **Geofence** | Geographic boundary used to validate/track location |

---

## 13. Appendix A — Functional Module Map

| Area | Module |
|---|---|
| Access | Authentication, Company/Branch context, Profile, Change Password |
| People | Employee Master, Directory, ID Cards, Documents & Photos |
| Time | Attendance (Face + GPS), Location Tracking, Duty Roster |
| Leave | Balances, Apply, Status |
| Payroll | Period/Financial-Year config, Tax Slabs, Allowances, Deductions, Absent Days, Loans & Recovery, Salary Processing, Payslips, Pay Register |
| Setup | Departments, Designations, Branches, Employee Statuses, Qualifications, Blood Groups, Shifts, Banks, Bank Branches, Company Logo |
| Talent | Recruitment (Jobs, Applications, Interviews, Offers, Analytics) |
| Insight | HR Dashboard & Analytics |
| Platform | Mobile App Version Control / Forced Update |

---

## 14. Appendix B — Principal Data Domains (Indicative)

| Domain | Nature | Ownership |
|---|---|---|
| Employee master & profile | Operational | HRMS (joined to ERP employee views) |
| App attendance (in/out, location, device) | Operational | HRMS |
| Face embeddings | Biometric | HRMS / Face service |
| Location tracks & settings | Operational | HRMS |
| Reference / setup (departments, designations, shifts, banks, etc.) | Master | HRMS (per company/branch) |
| Duty roster (shift, flags, roster in/out) | Computed schedule | **ERP-owned**; HR may amend Shift/Remarks (audited, by-PK) |
| Payroll periods, inputs, loans, tax slabs | Operational | HRMS + ERP |
| Processed salary & Pay Register | Computed payroll | **ERP (read-only to app)** |
| Recruitment (jobs/applications/interviews/offers) | Operational | HRMS |

---

## 15. Appendix C — Future Enhancements (Candidate Backlog)

- Merge app-captured (current-month) in/out into the Duty Roster view for periods the ERP has not yet filled.
- Fixed/standardised Pay Register column template per company (mapping pay components to named buckets).
- In-app computation of late/overtime/absent from shift rules where ERP data is unavailable.
- Bank disbursement file export.
- Performance appraisal and training modules.
- Backfill of check-out location for historical records.

---

*End of Document.*
