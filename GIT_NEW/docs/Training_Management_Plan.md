# Training Management (L&D) — Implementation Plan

Sources: `Training_Development_BRD.docx`, `HRMS Learning & Development and Performance Appraisal.pdf` (L&D sections 6–14, 26–30).
Status: **Implemented (all 5 phases), 2026-09-29. DDL not yet run on the database.**

Install / verify:
1. `cd Node-LMS-Backend && node scripts/run_training_ddl.mjs` — creates the 14 tables + sequences (idempotent).
2. `node scripts/training_smoke_test.mjs` — runs the whole flow on real data and deletes what it created.
3. Restart the backend and rebuild LMS-Web.

Menus: employee **My Training** (`/training`), HOD **Training Approvals** (`/training-approvals`), HR **Training** (`/training-admin`).

## 1. Decisions taken (from Q&A)

| Topic | Decision |
|---|---|
| Scope | Training (L&D) only. Performance Appraisal is a later phase; tables are designed so appraisal can feed training needs later. |
| Approval chain | Employee → HOD1 → HOD2 → HR, same pattern as leave (`HOD1/HOD2` mobiles on `EMPLOYEE`). Missing HOD steps are skipped. |
| Booking model | HR keeps a **Course catalog** and **Trainer master**, and creates **Sessions** (dates, venue/online link, capacity, cost). Approved requests are booked into a session. |
| Features in this phase | Cost tracking + budget, Attendance + Certificate PDF, Online MCQ assessment + Feedback. |
| Not in this phase | Skill matrix / gap analysis, email/SMS/WhatsApp notifications, Performance Appraisal, mobile app. |
| Platform | Web only (LMS-Web + Node-LMS-Backend). |
| Who initiates | Employee requests; HOD nominates own team; HR assigns anyone directly (no approval needed, e.g. compliance). |
| Assessment | Online MCQ: HR builds question bank per course, employee takes test on web, auto-scored. |
| Scoping | Company-wise (`COMPC`): catalog, trainers, sessions, budget are per company. |

## 2. What exists today (database findings)

**No training, course, trainer, skill, certificate or appraisal tables exist.** Everything below is new.

Reused as-is:

| Existing | Used for |
|---|---|
| `HR_EMP_MASTER` / `EMPLOYEE` | Employee identity, `DEPT_NO`, `DESG_CD`, `COMPC/BRNCH`, `HR_ADMIN` flag |
| `EMPLOYEE.HOD1 / HOD2` (mobile numbers; HOD1 set on 215 of 373, HOD2 on 4) | Approver resolution — same logic as `leaveApproval.service.js` (last-10-digit mobile match) |
| `requireHrAdmin` middleware + `admin_card_no` | HR endpoints |
| `HR_DEPT`, `HR_DESG`, `COMPANY_INFO`, company logos | Filters, reports, certificate header |
| `pdfkit` (already used for payslip/attendance PDFs) | Certificate PDF |
| `components/ui/*` (Card, Badge, Button, Modal, SearchableSelect, PageHeader) | Same look as HRMS / Leave pages |

Not reused (and why):
- `HR_INSTITUTION` — legacy 3-char codes used by qualifications, empty; external trainer's organisation is stored on the trainer row instead.
- `HR_BUDGET_TYPE/DTL` — per-employee budget design, empty; training budget needs company/department/year.
- `RPT_OFFICER` — only 68 of 373 set; approval uses HOD1/HOD2 like leave.
- `HR_FINANCIAL_YEAR` — several overlapping rows per unit; the budget uses `FY_YEAR` = start year of a July–June year instead.

## 3. Workflow

```
                ┌── Employee request ──► HOD1 ──► HOD2 ──► HR ──┐
Request/Need ───┤── HOD nominates team ─────────────────► HR ──┤──► Booked into Session
                └── HR assigns directly ───────────────────────┘
Session:  Planned ─► Open ─► In Progress ─► Completed / Cancelled
Participant: Booked ─► (Pre-test) ─► Attendance ─► Post-test ─► Feedback ─► Completed/Failed ─► Certificate
```

Request status: `SUBMITTED → PENDING_HOD2 → PENDING_HR → APPROVED → BOOKED → COMPLETED`, or `REJECTED` / `CANCELLED` at any point.

Rules:
- At submit, copy `EMPLOYEE.HOD1/HOD2` mobiles onto the request (as leave does), so later HOD changes don't move pending requests.
- No HOD → goes straight to HR. Any rejection ends the request.
- A HOD nominating their team counts as their own approval step (goes to HOD2 if they are HOD1 and HOD2 exists, else HR).
- Employee can cancel until HR acts.
- HR decision options: **Approve & book** into an existing session, **Approve** (book later), **Create session from request**, or **Reject** (remarks required).
- Booking checks session capacity (hard block) and budget (warning only, not a block).
- Certificate issued when course needs it and **attendance ≥ 80% and post-test ≥ pass % (default 70)**. Both thresholds are per course.
- Certificate number: `CERT-{COMPC}-{YYYY}-{00001}`, system generated.

## 4. New tables (Oracle, sequences for PKs like `RECRUITMENT_JOBS_SEQ`)

All tables carry `COMPC`, `CREATED_BY`, `CREATED_AT`, `UPDATED_BY`, `UPDATED_AT` (audit trail per PDF §30).

| # | Table | Key columns |
|---|---|---|
| 1 | `HR_TRAINING_CATEGORY` | `CATEGORY_ID`, `NAME`, `IS_ACTIVE` |
| 2 | `HR_TRAINER` | `TRAINER_ID`, `TRAINER_TYPE` (I=internal / E=external), `EMPCODE` (internal), `NAME`, `ORGANIZATION`, `PHONE`, `EMAIL`, `EXPERTISE`, `DEFAULT_RATE`, `IS_ACTIVE` |
| 3 | `HR_TRAINING_COURSE` | `COURSE_ID`, `COURSE_CODE` (auto `TRN-0001`), `TITLE`, `CATEGORY_ID`, `TRAINING_TYPE` (Technical/Soft Skill/Compliance/Safety/Other), `DEFAULT_MODE`, `DURATION_HRS`, `DESCRIPTION`, `CERT_REQUIRED`, `PASS_PCT` (70), `MIN_ATTEND_PCT` (80), `IS_ACTIVE` |
| 4 | `HR_TRAINING_SESSION` | `SESSION_ID`, `SESSION_CODE`, `COURSE_ID`, `TRAINER_ID`, `MODE` (Online/Physical), `VENUE`, `ONLINE_LINK`, `START_DATE`, `END_DATE`, `TIME_FROM`, `TIME_TO`, `TOTAL_HOURS`, `CAPACITY`, `DEPT_NO` (optional cost owner), `FY_ID`, `TRAINER_COST`, `VENUE_COST`, `MATERIAL_COST`, `OTHER_COST`, `STATUS` |
| 5 | `HR_TRAINING_BUDGET` | `BUDGET_ID`, `FY_ID`, `DEPT_NO` (NULL = company level), `AMOUNT` |
| 6 | `HR_TRAINING_REQUEST` | `REQUEST_ID`, `BRNCH`, `EMPCODE`, `SOURCE` (EMPLOYEE/HOD/HR), `REQUESTED_BY`, `COURSE_ID` (nullable), `REQUESTED_TOPIC` (free text when course not in catalog), `REASON`, `PRIORITY`, `PREFERRED_FROM/TO`, `HOD1_MNO`, `HOD2_MNO`, `HODn_FLAG/DATE/NAME/REMARKS`, `HR_FLAG/DATE/NAME/REMARKS`, `STATUS`, `SESSION_ID` |
| 7 | `HR_TRAINING_PARTICIPANT` | `PARTICIPANT_ID`, `SESSION_ID`, `EMPCODE`, `REQUEST_ID` (NULL when HR assigned), `STATUS` (BOOKED/COMPLETED/FAILED/NO_SHOW/WITHDRAWN), `ATTEND_PCT`, `PRE_SCORE_PCT`, `POST_SCORE_PCT`, `PASSED`, `CERT_NO`, `CERT_ISSUED_AT` — unique (`SESSION_ID`,`EMPCODE`) |
| 8 | `HR_TRAINING_ATTENDANCE` | `PARTICIPANT_ID`, `SESSION_DATE`, `STATUS` (P/A/L), `HOURS` — unique per participant+date |
| 9 | `HR_TRAINING_TEST` | `TEST_ID`, `COURSE_ID`, `TEST_KIND` (PRE/POST), `TITLE`, `TIME_LIMIT_MIN`, `PASS_PCT`, `SHUFFLE`, `MAX_ATTEMPTS` (1), `IS_ACTIVE` |
| 10 | `HR_TRAINING_QUESTION` | `QUESTION_ID`, `TEST_ID`, `SEQ`, `QUESTION_TEXT`, `OPT_A..OPT_D`, `CORRECT_OPT`, `MARKS` |
| 11 | `HR_TRAINING_ATTEMPT` | `ATTEMPT_ID`, `TEST_ID`, `PARTICIPANT_ID`, `STARTED_AT`, `SUBMITTED_AT`, `SCORE`, `TOTAL`, `PCT`, `PASSED` |
| 12 | `HR_TRAINING_ANSWER` | `ATTEMPT_ID`, `QUESTION_ID`, `SELECTED_OPT`, `IS_CORRECT` |
| 13 | `HR_TRAINING_FEEDBACK` | `FEEDBACK_ID`, `SESSION_ID`, `PARTICIPANT_ID` (NULL for trainer/HR feedback), `GIVEN_BY_TYPE` (EMPLOYEE/TRAINER/HR/MANAGER), `RATING_CONTENT`, `RATING_TRAINER`, `RATING_OVERALL` (1–5), `COMMENTS` |
| 14 | `HR_TRAINING_LOG` | `LOG_ID`, `ENTITY` (REQUEST/SESSION/PARTICIPANT), `ENTITY_ID`, `ACTION`, `OLD_VALUE`, `NEW_VALUE`, `ACTOR`, `ACTED_AT` — approval history + previous values |

Derived, not stored: session total cost (sum of 4 cost columns), participant count, improvement % (`POST − PRE`), training hours per employee (sum of attendance hours).

Correct answers are never sent to the browser; scoring happens server-side at submit, and the time limit is enforced from `STARTED_AT` on the server.

DDL goes in `Node-LMS-Backend/scripts/training_ddl.sql` and is run manually after review, like earlier schema changes.

## 5. Backend (Node-LMS-Backend)

New files, same style as existing modules:

- `src/routes/training.routes.js` → mounted at `/training`
- `src/controllers/training.controller.js`
- `src/models/training.schema.js` (zod)
- `src/services/trainingMaster.service.js` — categories, trainers, courses, budget
- `src/services/trainingRequest.service.js` — requests, HOD/HR approvals, nominations
- `src/services/trainingSession.service.js` — sessions, booking, attendance, completion and certificate numbering
- `src/services/trainingTest.service.js` — question bank, start/submit attempt, scoring
- `src/services/trainingCertificatePdf.service.js` — pdfkit certificate with company logo
- `src/services/trainingReports.service.js`

Endpoint groups:

| Who | Auth | Endpoints |
|---|---|---|
| Employee | `card_no` (same as leave) | catalog + open sessions, create/cancel request, my requests, my trainings, start/submit test, give feedback, download my certificate |
| HOD | `card_no`, matched against `HODn_MNO` | pending approvals (+ count for sidebar badge), approve/reject, nominate team member, team training history |
| HR | `requireHrAdmin` + `admin_card_no`, filtered to selected `compc` | CRUD categories/trainers/courses/budget, HR request queue + decision, sessions CRUD, book/withdraw participants, attendance grid, question bank, completion/evaluation, certificates, reports, dashboard |

## 6. Web (LMS-Web)

Sidebar entries (same role logic as today in `Sidebar.tsx`):

| Role | Menu | Page |
|---|---|---|
| Employee | **My Training** | `/training` — tabs: Request Training · My Requests · My Trainings (upcoming/completed, take test, feedback, certificate) |
| HOD | **Training Approvals** (pending badge like Leave Approvals) | `/training/approvals` — pending list, approve/reject with remarks, Nominate Team |
| HR admin | **Training** | `/training-admin` — tabs: Dashboard · Requests · Sessions · Courses · Trainers · Tests · Budget · Reports |

HR Sessions screen: list/calendar toggle; session detail has Participants (add from approved requests or search employee), Attendance grid (employee × date, P/A/L), Scores (from tests, read-only), Costs, and a **Complete Session** button that evaluates everyone and issues certificates.

Test taking: one-question-per-card page with timer, submit, result screen (score, pass/fail).

Service file: `src/services/trainingService.ts`. Components reuse `components/ui` and the HRMS panel layout.

## 7. Reports & dashboard (this phase)

HR dashboard tiles: pending requests, upcoming sessions, employees trained (FY), training hours (FY), budget used vs allocated, average feedback.

Reports (filters: FY, date range, department, course): Training Programs Conducted · Employees Trained · Training Hours · Cost Summary vs Budget (by dept) · Assessment Results (pre vs post, improvement %) · Certification Report · Trainer Performance (avg rating) · Employee Training History. Export: printable page + CSV to start.

## 8. Delivery phases (each testable on its own)

| Phase | Deliverable |
|---|---|
| 1 | DDL + sequences; HR masters: Categories, Trainers, Courses, Budget (API + HR tabs) |
| 2 | Requests & approvals: employee request, HOD approvals + nominate + sidebar badge, HR queue + decisions |
| 3 | Sessions, booking (capacity/budget checks), direct HR assignment, attendance grid |
| 4 | MCQ tests: question bank, pre/post test taking, auto-score; feedback forms |
| 5 | Session completion, certificate numbering + PDF, dashboard, reports |

## 9. Assumptions (applied as defaults — change on request)

1. Budget over-run shows a warning but does not block booking.
2. Post-test: 1 attempt by default; HR can allow a re-attempt per participant.
3. Pre-test is optional per course; if absent, improvement % is not shown.
4. Only HR can create sessions; HODs cannot.
5. Employees see only sessions of their own company; they can pick a catalog course or type a free-text topic.
6. BRD's "Finance: cost view" role is not built now (no Finance role in the system); HR sees costs.
7. A participant withdrawn/cancelled frees a seat; costs are per session, not split per participant (per-head cost shown as total ÷ participants in reports).
