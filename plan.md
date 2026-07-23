# Cut LMS-Web over from the FastAPI backend to the Node backend

## Context

`LMS-Web` (Next.js, port 3000) currently talks to the FastAPI backend `LMS-Backend` at
`http://163.61.91.221:8001`. The whole API surface has been re-implemented in
`Node-LMS-Backend` (Express 5 + `oracledb`), and we now want the web app served by Node instead.

**The good news — the frontend needs almost no changes.** Every network call in `LMS-Web` goes
through the relative path `/api/...` ([api.ts:2](LMS-Web/src/services/api.ts#L2),
[documentService.ts:3](LMS-Web/src/services/documentService.ts#L3),
[CompanyLogo.tsx:5](LMS-Web/src/components/ui/CompanyLogo.tsx#L5), plus a few inline
`fetch("/api/...")` calls in `recruitmentService.ts`). There is **not a single hardcoded backend
host, port, or `NEXT_PUBLIC_API_URL` reference anywhere in `LMS-Web/src`** — verified by grep. All
of it is resolved by the single rewrite rule in [next.config.ts:8-19](LMS-Web/next.config.ts#L8-L19).
So the cutover is fundamentally *"repoint one rewrite"*, not a frontend refactor.

**The blocker.** An automated route-table diff of all 13 FastAPI routers against
`Node-LMS-Backend/src/routes/` gives:


|                                       | count                                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| FastAPI routes                        | 175                                                                                                           |
| Node routes                           | 133                                                                                                           |
| **Exact path+method matches**         | **129**                                                                                                       |
| **In FastAPI, missing in Node**       | **46 — all of them `/payroll/*` (28) and `/payroll-entry/*` (18)**                                           |
| Extra in Node (mobile-only, harmless) | 4 (`/app/test-logs`, `/auth/emergency-contact/{c}`, `/auth/leave-types/{c}`, `/auth/location/my-history/{c}`) |

Path parity outside payroll is exact — no typos, no prefix drift. But
`LMS-Web/src/app/(auth)/payroll/` (PayRegisterPanel, SalaryPanel, LoanPanel, TaxSlabPanel,
PeriodOpeningPanel, AbsentDaysPanel, MonthlyAllowancePanel, MonthlyDeductionPanel,
LoanRecoveryPanel, Payslip) uses **all 46** of those endpoints, and `payroll_entry_router` is one of
only two routers the web uses at 100%.

**Chosen approach (confirmed with the user): hybrid split-proxy.** Run Node on **8003** alongside
FastAPI on **8001**, and split the Next.js rewrite so `/api/payroll*` and `/api/payroll-entry*`
keep going to FastAPI while all 129 ported routes go to Node. Outcome: the switch ships today with
zero payroll risk and instant rollback (edit one line), payroll gets ported later, and FastAPI is
retired by deleting two rewrite rules.

---

## Changes

### 1. `LMS-Web/next.config.ts` — split the rewrite (the actual cutover)

Rewrite rules are matched in order, so the two payroll rules must come **first**. Note
`/payroll-entry` must be its own rule — `/payroll/:path*` will not match it.

```ts
async rewrites() {
  // Payroll + payroll-entry are not ported to Node yet (46 endpoints) — keep
  // them on FastAPI. Delete these two rules once Node serves /payroll*.
  const legacyUrl = process.env.LEGACY_BACKEND_URL || "http://127.0.0.1:8001";
  // Everything else is served by Node-LMS-Backend.
  const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8003";
  return [
    { source: "/api/payroll-entry/:path*", destination: `${legacyUrl}/payroll-entry/:path*` },
    { source: "/api/payroll/:path*",       destination: `${legacyUrl}/payroll/:path*` },
    { source: "/api/:path*",               destination: `${backendUrl}/:path*` },
  ];
}
```

### 2. `LMS-Web/.env`

```
NEXT_PUBLIC_API_URL=http://163.61.91.221:8001   # unused by src/, keep or drop
BACKEND_URL=http://127.0.0.1:8003               # Node
LEGACY_BACKEND_URL=http://127.0.0.1:8001        # FastAPI, payroll only
```

Use loopback rather than the public `163.61.91.221` — the existing comment in `next.config.ts`
already warns that the proxy target must be locally reachable and not loop through NAT.
**Rewrites are read at build time, so `npm run build` must be re-run after this change** (the
`start_all.bat` frontend window already builds before starting).

### 3. `Node-LMS-Backend/.env` — port and file roots

```
PORT=8003
NODE_ENV=production
APK_DIR="C:\Erp_Systems\HRMS_LMS_APP\GIT_NEW\LMS-Backend\static\apk"
COMP_LOGO_ROOT="C:\Erp_Systems\HRMS_LMS_APP\COMP_LOGO"
ORACLE_CLIENT_LIB_DIR="C:\oraclexe\app\oracle\product\11.2.0\server\bin"
```

- `EMP_DOCS_ROOT` is already correct and shared with FastAPI — no change.
- `APK_DIR` matters because `Node-LMS-Backend/static/apk/` is **empty** while the live
  `app-latest.apk` (80 MB) sits under `LMS-Backend/static/apk/`
  ([appVersion.controller.js:18](Node-LMS-Backend/src/controllers/appVersion.controller.js#L18)).
- `COMP_LOGO_ROOT` default already matches FastAPI's, but set it explicitly so both agree.
- Consider bumping `poolMax` in [database.js:22](Node-LMS-Backend/src/config/database.js#L22) later:
  during the hybrid phase both backends hold Oracle sessions concurrently.

### 4. `Node-LMS-Backend/src/config/database.js` — don't hard-exit on Oracle client

[database.js:5-10](Node-LMS-Backend/src/config/database.js#L5-L10) hardcodes an Oracle 11.2 XE
Instant Client path and calls `process.exit(1)` if it isn't there. FastAPI has no such dependency —
`core/database.py` uses `python-oracledb` in thin mode. If that directory doesn't exist on the
production host, Node will refuse to boot. Read the path from `ORACLE_CLIENT_LIB_DIR`, and on
failure log a warning and continue into node-oracledb's thin mode instead of exiting — thin mode
still connects if the DB is 12.1+. Verify which mode actually works against the target DB before
cutting over (§Verification step 1).

### 5. `Node-LMS-Backend/src/index.js` — release the startup probe connection

[index.js:15](Node-LMS-Backend/src/index.js#L15) calls `getDirectConnection()` to prove the DB is up
and never releases it, permanently leaking one pooled connection. Wrap it in
`try { ... } finally { await conn.close(); }`.

### 6. `Node-LMS-Backend/src/app.js` — JSON 404 handler

[app.js`](Node-LMS-Backend/src/app.js) has a `{detail}`error handler but no 404 handler, so an unmatched path returns Express's HTML page.`apiRequest()`in [api.ts:31](LMS-Web/src/services/api.ts#L31) does`response.json().catch(...)`and would surface the generic "Request failed". Add, after`app.use('/', routes)` and before the error handler:

```js
app.use((req, res) => res.status(404).json({ detail: `Not Found: ${req.method} ${req.originalUrl}` }));
```

This turns any missed route into a clearly labelled failure during testing rather than a mystery.
Also note `home.routes.js` exists but is never mounted in `routes/index.js` — leave as is.

### 7. `start_all.bat` — launch Node alongside the others

Add a fifth window mirroring the existing pattern, and add `8003` to the port-kill loop in step 2:

```bat
echo Starting Node LMS Backend on port 8003...
start "Node Backend" cmd /k "cd /d C:\Erp_Systems\HRMS_LMS_APP\GIT_NEW\Node-LMS-Backend && npm start"
```

Keep the FastAPI (8001), CV Watcher, and Face (8002) windows exactly as they are — the CV watcher is
still required, since Node's bulk-CV upload deliberately drops files for the Python
`cv_watcher.py` to pick up, and the 8002 face microservice is unported by design.

### 8. `Node-LMS-Backend/.gitignore` / commit

`Node-LMS-Backend/` is currently untracked (`?? Node-LMS-Backend/` in git status) and its `.env`
contains live DB credentials and a Gemini API key. Before committing, confirm the root
[.gitignore](.gitignore) excludes `Node-LMS-Backend/.env`, `node_modules/`, `logs/`, `EMP_DOCS/`,
`EMP_PHOTOS/`, and `resume.pdf`.

---

## Known gaps to fix before FastAPI can be switched off entirely

Not blockers for this web cutover, but they must be closed before mobile traffic or payroll moves.

1. **Payroll + payroll-entry (46 endpoints).** Port in dependency order: `/payroll/periods` and
   `/payroll/financial-years` first (they are the locking gate every payroll-entry write checks),
   then all 18 `/payroll-entry/*`, then tax-masters/loans/pay-register, and
   `POST /payroll/salary/process` last — it invokes the Oracle PL/SQL procedure
   `HR_SALARY_PROCES_PRO`, which commits inside the DB. Source of truth:
   [payroll_router.py](LMS-Backend/routers/payroll_router.py),
   [payroll_entry_router.py](LMS-Backend/routers/payroll_entry_router.py) and their three
   repositories (`payroll_repository.py`, `payroll_entry_repository.py`,
   `payroll_register_repository.py`, `salary_repository.py`). Follow the existing Node layering —
   `routes/*.routes.js` → `controllers/*.controller.js` → `services/*.service.js`, with Zod schemas
   in `models/` and scope resolution reused from
   [adminRights.service.js](Node-LMS-Backend/src/services/adminRights.service.js) (`resolveFilterLists`),
   exactly as `hrms` and `recruitment` do.
2. **`POST /auth/attendance/face` is missing the face-identity guard.** FastAPI
   [attendance_router.py:43-68](LMS-Backend/routers/attendance_router.py#L43-L68) calls
   `identify_scanned_card(frames)` against the 8002 service and marks *whoever was actually
   scanned*, rejecting with `FACE_NOT_RECOGNIZED` when identity is not confident. Node's
   [attendance.controller.js:20-59](Node-LMS-Backend/src/controllers/attendance.controller.js#L20-L59)
   ignores `frames` entirely and marks the submitted `card_no`. This is buddy-punching exposure. It
   post-dates `FASTAPI_VS_NODE_FULL_AUDIT.md`, added in commit c56a145. The web never calls this
   endpoint, so the hybrid cutover is unaffected — but it must be ported before any mobile client
   is pointed at Node.
3. **Recruitment company-scoping fallback.** Per §4.3 of the audit, FastAPI silently defaults an
   invalid/blank company on `create_job`/`create_candidate` to the admin's first allowed company,
   while Node returns 403. If the recruitment UI relies on that fallback it will now fail — watch
   for it in testing.

---

## Verification

Run in order; each step is independently checkable.

1. **Node boots and reaches Oracle.** `cd Node-LMS-Backend && npm start` → expect
   "Oracle Connection Pool initialized successfully" and "running ... on http://localhost:8003".
   If Oracle thick-mode init fails, resolve §4 before continuing.
2. **Backend-to-backend diff on read paths.** With both up, hit the same endpoint on each and
   compare JSON — these cover the highest-risk SQL:
   `/auth/dashboard/100660.1`, `/auth/profile/100002.1`,
   `/auth/attendance/summary?emp_pk=100660.1&from_date=...&to_date=...`,
   `/hrms/dashboard`, `/hrms/employees/search`, `/reference/departments`,
   `/auth/location/report/summary?...&compc=1`. Example URLs are already documented inline in
   [auth.routes.js](Node-LMS-Backend/src/routes/auth.routes.js) and
   `Node-LMS-Backend/requests.http`. Diff 8001 vs 8003 responses.
3. **Rebuild and start the web.** `cd LMS-Web && npm run build && npm run start` — required, since
   rewrites are baked in at build time.
4. **Click through every page** at `localhost:3000`, watching the browser Network tab for non-2xx
   and the Node `logs/` output: login → dashboard → attendance (summary + range report + PDF
   download) → leave apply/status → profile → HR employee search → HRMS (all panels: employees,
   duty roster, shifts, setup/reference CRUD, location, ID cards) → recruitment (jobs, candidates,
   applications, interviews, offers, analytics) → **payroll (must still work — proves the split
   proxy is routing correctly)**.
5. **Exercise the binary/multipart paths specifically** — these bypass `apiRequest()` and are the
   most likely to behave differently between `multer`/`res.sendFile` and FastAPI's `UploadFile`/
   `FileResponse`: employee photo upload + display, document upload/download/delete, company logo
   render, attendance report PDF, CV upload (then confirm the CV Watcher window picks the file up
   from `EMP_DOCS\...\CV_Buffer\` and that `/recruitment/candidates/cv-status` transitions), and
   candidate CV download (inline and attachment).
6. **Confirm the split.** In the Network tab, every `/api/payroll*` request should be answered by
   FastAPI and everything else by Node — cross-check against the two `logs/` streams. A quick proof:
   stop the Node process and verify *only* the payroll page still works.
7. **Rollback drill.** Set `BACKEND_URL=http://127.0.0.1:8001`, rebuild, confirm the app is fully
   back on FastAPI. Confirming this takes ~1 minute is what makes the cutover safe to attempt.
