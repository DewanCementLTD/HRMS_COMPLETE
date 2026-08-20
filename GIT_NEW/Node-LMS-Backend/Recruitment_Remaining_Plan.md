# Port the 8 remaining Recruitment AI/CV endpoints to Node.js (drop-in parity)

## Context

`FASTAPI_VS_NODE_FULL_AUDIT.md` §4.3 lists **8/37 recruitment endpoints still unported**: the AI pipeline & CV-upload surface. The other 29 recruitment endpoints are already ported (`Node-LMS-Backend/src/{routes,controllers,services,models}/recruitment.*`). Goal: implement these 8 in Node so their behavior — routes, query/body params, SQL, filesystem layout, JSON field names, status codes, error envelopes — is **byte-for-byte equivalent** to FastAPI, making Node a true drop-in replacement behind the same `/api` rewrite.

The 8 endpoints (FastAPI paths, all under `/recruitment`):

| # | Method | Path | Nature |
|---|---|---|---|
| 1 | POST | `/candidates/upload-cvs` | File write + `_scope.json` (no AI in request) |
| 2 | GET | `/candidates/cv-status` | Filesystem scan (no AI) |
| 3 | POST | `/candidates/{candidate_id}/cv` | File write + DB (no AI) |
| 4 | GET | `/candidates/{candidate_id}/cv` | File serve (no AI) |
| 5 | POST | `/candidates/{candidate_id}/apply` | DB insert + **inline LLM** (background) |
| 6 | POST | `/jobs/{job_id}/match` | Keyword rank (no AI) + optional `deep=true` **inline LLM** |
| 7 | GET | `/jobs/{job_id}/top-candidates` | DB read (no AI) |
| 8 | GET | `/applications/{app_id}/evaluation` | DB read (no AI) |

### Key architectural finding (drives the whole plan)

The bulk CV AI pipeline — PDF text extraction (PyMuPDF), Tesseract OCR, the `watchdog` daemon (`AI/cv_watcher.py`), and the Gemini batch scoring — is a **standalone Python process** that communicates with the backend **only through the shared `EMP_DOCS` filesystem + the Oracle DB**, never over HTTP. FastAPI's upload endpoints just drop PDFs + a `_scope.json` sidecar into `EMP_DOCS/<Company>/<Branch?>/RECRUITMENT_CVS/<job|pool>/`; the watcher picks them up, scores them, and writes `RECRUITMENT_CANDIDATES/APPLICATIONS/AI_EVALUATIONS` rows. `cv-status`, `top-candidates`, and `evaluation` then read that output.

**Decisions (confirmed with user):**
1. **The Python watcher stays Python, unchanged.** Node's upload endpoints write into the identical folders with the identical `_scope.json`; the existing watcher (already launched by `start_all.bat`) consumes Node's uploads exactly as it consumes FastAPI's. No PyMuPDF/OCR/watchdog reimplementation. **This is only correct if Node points `EMP_DOCS_ROOT` at the shared production tree** (see Prereq A).
2. **The two inline-LLM endpoints (5 `apply`, 6 `match?deep=true`) are ported to Node `@google/genai`.** Both score a candidate's **reconstructed profile text** (built from DB rows, never the PDF), so no file parsing is needed — just a text→JSON Gemini call mirroring `AI/cv_evaluator.py`.

---

## Prerequisites (must land before/with the endpoints)

### A. Fix storage root + add config (`Node-LMS-Backend/.env` and `src/services/documents.service.js`)
This is audit bug §5.5 (currently UNRESOLVED) and is a **hard blocker** for drop-in: Node's `DOCS_ROOT` defaults to `E:\...\Node-LMS-Backend\EMP_PHOTOS` ([documents.service.js:28](Node-LMS-Backend/src/services/documents.service.js#L28)) while FastAPI + the watcher use `C:\Erp_Systems\HRMS_LMS_APP\EMP_DOCS`. If unfixed, Node writes CVs where the watcher never looks → CVs are never processed.
- Add to `Node-LMS-Backend/.env` (values, not committed secrets):
  - `EMP_DOCS_ROOT=C:\Erp_Systems\HRMS_LMS_APP\EMP_DOCS`
  - `GEMINI_API_KEY=<from AI/.env — do NOT hardcode/commit>`
  - `CV_MODEL=gemma-4-31b-it` (matches live `AI/.env`; default `gemini-2.5-flash-lite`)
  - `TOP_K=3` (matches live `AI/.env`; fallback 10)
  - `CV_MAX_WORKERS=8`
- These mirror `AI/config.py`. Node reads them via `process.env.*` at point of use (existing convention — no central config module).

### B. Add dependency
- `npm i @google/genai` (the Node equivalent of Python `google-genai`; the audit target is **Google Gemini/Gemma, not Anthropic**). Confirmed absent from `package.json`. `multer ^2.2.0` is already present.

### C. Export shared path helpers
`safeName`, `DOCS_ROOT`, `DOCS_BASE`, and the `UNIT_MST`/`COM_LOCATION` name-lookup already exist in [documents.service.js](Node-LMS-Backend/src/services/documents.service.js) and already mirror Python's `_safe_name`/`_emp_unit_branch` exactly. **Export `DOCS_ROOT`, `DOCS_BASE`, `safeName`** (DOCS_ROOT/DOCS_BASE are already exported; export `safeName`) so recruitment reuses them rather than re-deriving folder logic — guarantees path parity with the watcher.

---

## Implementation

### 1. Multer wiring (`src/middlewares/upload.middleware.js`)
- Keep existing `uploadSingleFile = upload.single('file')` (used by endpoint 3).
- Add `export const uploadCvArray = upload.array('files', 20);` (memory storage) for endpoint 1. `MAX_BULK_CVS = 20`.

### 2. Service layer (`src/services/recruitment.service.js`)
Add functions mirroring `repositories/recruitment_repository.py`, reusing the module's established connection lifecycle (`getDirectConnection()` + `finally close()`), named binds, `rToInt`, `lowerKeys`, CLOB `fetchInfo`/`readLob`, and `RETURNING ... INTO` BIND_OUT patterns. **Reuse existing sequence/`SELECT NVL(MAX,0)+1` id-generation already in the file.**

Path/filesystem helpers (port 1:1, reuse exported `DOCS_ROOT`/`safeName`):
- `companyBranchParts(connection, compc, brnch)` ← `_company_branch_parts` (repo:2160) — `[<Company>, <Branch?>]`, branch omitted when NULL, `UNIT_MST.UNIT_NAME`/`COM_LOCATION.DESCR` via `safeName`.
- `jobCvDirs(job_id)` ← repo:2187 — `{buffer_dir: DOCS_ROOT/…/RECRUITMENT_CVS/<job_id>, archive_dir: …/CV_Archive/<job_id>, job_folder, compc, brnch}`.
- `poolCvDirs(compc, brnch)` ← repo:2216 — same with literal `pool` folder.
- `getJobScope(job_id)` ← repo:1986 — `{job_id, job_title, compc, brnch}` or null (ORA-00904 fallback).
- `candidateCvTarget(candidate_id, ext)` ← repo:1283 — `{abs_dir, abs_path, rel_path, old_abs_path}`; path `EMP_DOCS/<Company>/<Branch?>/RECRUITMENT_CVS/cand_{id}.{ext}` (**note: directly in `RECRUITMENT_CVS`, no subfolder — watcher ignores it by design**).
- `cvStatusInDirs(buffer_dir, archive_dir, filenames)` ← repo:2239 — per-file `{state, score}` where state ∈ `unreadable|scored|profiled|failed|processing|unknown`, reading `<stem>.error.json` / `<stem>.json` (`evaluation.overall_score`) / `<stem>.dberror.json` / buffer presence.

DB helpers (port 1:1):
- `setCandidateCv(candidate_id, file_name, rel_path)` ← repo:1354.
- `getCandidateCvPath(candidate_id)` ← repo:1379 — returns `[CV_FILE_NAME, CV_FILE_PATH]`.
- `createApplicationForCandidate(candidate_id, job_id, source)` ← repo:1900 (+ `_findOrCreateApplicationTx` repo:1570) — reuse-or-insert PENDING app, `{status, application_id, created}`.
- `getCandidateCvText(candidate_id)` ← repo:1928 — reconstruct profile text blob (`Name/Preferred Job Title/Location/Summary/Skills/Experience/Education`) → `{text, detected_job_title, name, mobile, email}`.
- `buildJobJdText(job_id)` ← repo:2131 — assemble JD lines from job record.
- `storeEvaluation(app_id, evaluation, stats, total_seconds)` ← repo:1965 + `_storeEvaluationTx` (repo:1600): insert `RECRUITMENT_AI_EVALUATIONS` (`PROCESSED_AT = NVL(TO_DATE(:pat,'YYYY-MM-DD"T"HH24:MI:SS'), SYSDATE)`) + strength/weakness child rows; ensure `RECRUITMENT_AI_*_SEQ`.
- `getApplicationEvaluation(app_id)` ← repo:1717 — latest eval + strengths + weaknesses; **exact lowercased keys**: `evaluation_id, application_id, compatibility, technical_match, experience_match, overall_score, recommendation, summary, model_name, prompt_tokens, output_tokens, total_tokens, total_seconds, llm_seconds, processed_at, strengths[], weaknesses[]`.
- `matchCandidatesForJob(job_id, top, compc, brnch)` ← repo:1781 — Stage-1 keyword scoring: `skill=10×|skill∩req|, title=6×|pref∩title|, exp=1×|exp∩jd|`, drop ≤0, sort `(-score, id)`, annotate `existing_application_id`/`ai_overall_score`. Port `_tokenize`+`_MATCH_STOPWORDS` (repo:1763) and `_candidateScopeFilter` verbatim. Returns `{status, job_id, job_title, pool_size, matched, returned, candidates[]}`.
- `rankJobApplicants(job_id, top_k, compc, brnch)` ← repo:2024 — rank applicants by latest AI `overall_score` (`NULLS LAST`), `counts{}`, `_scoreBand` (≥75 strong / ≥40 review / weak), `ai_flagged=band==='review'`. Exact candidate keys per repo:2092.

Inline-LLM orchestration (mirror `services/recruitment_service.py`):
- `evaluateApplication(app_id, candidate_id, job_id)` ← svc:42 — `getCandidateCvText` → `buildJobJdText` → `cvEvaluator.evaluateCv(text, jd, detected_job_title)` → `storeEvaluation(app_id, assessment.evaluation, stats, total)`.
- `matchCandidatesDeep(...)` ← `_deep_evaluate` svc:232 — run shortlist concurrently (`Promise` pool sized `CV_MAX_WORKERS`, mirroring the ThreadPoolExecutor), materialize applications (`source="Talent Match (deep)"`), `storeEvaluation`, mutate entries with `existing_application_id/ai_overall_score/ai_recommendation`, per-candidate failure → `deep_error` (logged, not thrown), then re-sort `(-(ai||-1), -score, id)`, set `deep=true`. Non-deep sets `deep=false`.

### 3. New Gemini evaluator (`src/services/cvEvaluator.service.js`)
Port `AI/cv_evaluator.py` `_run_llm`/`evaluate_cv`/`extract_metrics` to `@google/genai`:
- `new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })`, model `process.env.CV_MODEL`.
- Config: `temperature:0`, `maxOutputTokens:8192`, and — when capabilities allow — `responseMimeType:'application/json'` + `responseSchema` (the `CandidateAssessmentSchema` shape: `{metrics{contact_info,preferred_job_title,profile_summary,education[],experience[],skills[]}, evaluation{compatibility,technical_match,experience_match,overall_score,strengths[],weaknesses[],recommendation,summary}}`), plus thinking-disabled where supported.
- Port: capability seeding/degradation (`_seed_caps`/`_degrade_caps` — Gemma disables system_instruction/json_mode/thinking), retry/backoff w/ jitter (`LLM_MAX_RETRIES=6`, honor server `retryDelay`), output-token escalation (`LLM_MAX_TOKEN_ESCALATIONS=2`), defensive JSON extraction (`_extract_json`: fenced/brace fallback), `MAX_TEXT_CHARS=40000` truncation.
- `evaluateCv(text, jd, detectedTitle)` → `{assessment:{metrics,evaluation}, stats:{model, llm_seconds, json_mode, schema_valid, prompt_tokens, output_tokens, total_tokens}}`. Only `evaluate_cv` (full assessment) is strictly needed for endpoints 5/6; `extract_metrics` optional (watcher covers pool extraction).

### 4. Controllers (`src/controllers/recruitment.controller.js`)
Add handlers reusing existing `handleResult`, `_getScope`, `resolveFilterLists`, and the `{ detail }` error envelope. Port the router helpers:
- `_resolveAdminScope` (router:510), `_resolveDropDirs` (router:522 — resolves job vs pool dirs, enforces scope with 404s, `fs.mkdirSync(buffer_dir,{recursive:true})`, writes `_scope.json` = `{compc, brnch, job_id}`), `_safeCvFilename` (router:75 — `{sanitized_stem}_{Date.now()}.pdf`), `_requireCandidateAccess` (already exists for the 29).
- **Endpoint 1** `uploadCvs`: validate `files` present & ≤20; per-file write from `req.files[i].buffer` (non-PDF → `{queued:false, error:"Only PDF CVs can be AI-screened"}`, not fatal); return `{status:"success", job_id, queued, total, results[]}`.
- **Endpoint 2** `cvStatus`: `_resolveDropDirs` (re-writes `_scope.json`) → `cvStatusInDirs` → `{job_id, files:{}}`.
- **Endpoint 3** `uploadCandidateCv`: ext ∈ `{pdf,doc,docx,txt,rtf}` (else 400), `candidateCvTarget`, remove old file, write buffer, `setCandidateCv`, `{status:"success", cv_file_name}`.
- **Endpoint 4** `downloadCandidateCv`: `getCandidateCvPath` → resolve vs `DOCS_BASE` → 404 if missing/not-on-disk → `res.set('Content-Disposition', `${inline?'inline':'attachment'}; filename="${fname}"`)` + `res.sendFile(absPath)` (documents-module pattern).
- **Endpoint 5** `applyCandidate`: `createApplicationForCandidate` → **fire-and-forget** `Promise.resolve().then(() => evaluateApplication(...)).catch(log)` (this mirrors FastAPI `BackgroundTasks` semantics exactly — in-process, returns immediately, lost on crash; **BullMQ/Redis is not needed and would be a behavior change**) → `{status:"success", application_id, created, evaluating:true, message:"Application created — AI is scoring the candidate for this job."}`.
- **Endpoint 6** `matchCandidates`: query `top` (default 20, 1–200), `deep` (default false) → `matchCandidatesForJob`; if `deep` → `matchCandidatesDeep`; 404 on `status==="error"`.
- **Endpoint 7** `topCandidates`: `top_k` default = `TOP_K` env (fallback 10) → `rankJobApplicants`; 404 on error.
- **Endpoint 8** `getApplicationEvaluation`: `getApplication` (404 "Application not found") → `getApplicationEvaluation` (404 "This application has not been AI-evaluated yet") → return eval dict.

### 5. Routes (`src/routes/recruitment.routes.js`) + schemas (`src/models/recruitment.schema.js`)
- Declare literal candidate paths **before** `/candidates/:candidate_id` param routes (upload-cvs, cv-status come first) — matches Express routing and the existing convention.
- Middleware order: router-level `requireHrAdmin` already applies module-wide and reads `admin_card_no` from **query** (present on all 8), so it runs fine before multer. For upload routes chain `uploadCvArray`/`uploadSingleFile` → `validate(schema)` → controller (multer populates `req.files`/`req.file` before `validate`).
- Add zod schemas (`z.object({ query, body, params })`): `uploadCvsSchema` (query `admin_card_no` required, `job_id?`, `compc?`, `brnch?`), `cvStatusSchema` (+ `files` string), `candidateCvSchema` (params `candidate_id` `z.coerce.number()`), `applySchema` (body `{job_id:int, source?, notes?}`), `matchSchema` (query `top`/`deep` coerced), `topCandidatesSchema` (`top_k?`), `evaluationSchema` (params `app_id`). Multipart text-field/query coercion follows `documents.schema.js` (`z.coerce`, `boolFromQuery`).

---

## Files to create / modify
- **Modify** `src/services/recruitment.service.js` — add ~16 functions above.
- **Create** `src/services/cvEvaluator.service.js` — Gemini port.
- **Modify** `src/controllers/recruitment.controller.js` — 8 handlers + router helpers.
- **Modify** `src/routes/recruitment.routes.js` — 8 routes.
- **Modify** `src/models/recruitment.schema.js` — 7 schemas.
- **Modify** `src/middlewares/upload.middleware.js` — `uploadCvArray`.
- **Modify** `src/services/documents.service.js` — export `safeName` (fix `EMP_DOCS_ROOT` default already keyed off env).
- **Modify** `Node-LMS-Backend/.env`, `package.json` — config + `@google/genai`.

---

## Parity gotchas (must match exactly)
1. **`_scope.json`** written by BOTH upload-cvs and cv-status, shape `{"compc":int|null,"brnch":int|null,"job_id":int|null}`.
2. **Filename divergence**: bulk → `{stem}_{ms}.pdf` in `RECRUITMENT_CVS/<job|pool>/`; single → `cand_{id}.{ext}` directly in `RECRUITMENT_CVS/` (watcher ignores single by grandparent-name rule).
3. **Scope semantics**: company strict (`COMPC IN (...)`), branch = selected OR NULL; every scoped query falls back to unscoped on `ORA-00904`.
4. **All response keys lowercased** (`col.lower()` in Python) — match field names verbatim (`ai_note`=summary, `score_band`, `ai_flagged`, etc.).
5. **Error envelope**: business/auth/runtime → `{ detail }`; zod validation → `{ status:"ERROR", message, errors }` (existing `validate` middleware — do not change).
6. **`apply` returns before scoring finishes** (`evaluating:true`); scoring uses STORED profile text, never the PDF.
7. **`top_k` / model / workers** come from env mirroring `AI/.env` (`TOP_K=3`, `CV_MODEL=gemma-4-31b-it`).

---

## Verification
1. **Config**: start Node with `EMP_DOCS_ROOT`, `GEMINI_API_KEY`, `CV_MODEL`, `TOP_K` set; confirm `DOCS_ROOT` resolves to the shared prod tree.
2. **Upload → watcher round-trip** (proves drop-in): with the Python `cv_watcher.py` running, `POST /recruitment/candidates/upload-cvs?admin_card_no=<hr>&job_id=<J>` with 1–2 sample PDFs (`AI/Resume/*.pdf`). Confirm files land in `EMP_DOCS/<Company>/<Branch?>/RECRUITMENT_CVS/<J>/` alongside `_scope.json`; watch the watcher window process them; then `GET /candidates/cv-status?...&files=<saved_as>` transitions `processing → scored`, and `GET /jobs/<J>/top-candidates` + `GET /applications/<app>/evaluation` show the row the watcher wrote.
3. **Diff against FastAPI**: hit the same routes on FastAPI (`:8001`) and Node with identical inputs; JSON keys/values, status codes, and `Content-Disposition` must match. Compare `candidateCvTarget` paths and `_scope.json` bytes.
4. **Single CV**: `POST /candidates/{id}/cv` then `GET /candidates/{id}/cv?inline=true` — round-trips the file; verify old file replaced.
5. **Inline LLM (endpoint 5/6)**: `POST /candidates/{id}/apply` returns immediately with `evaluating:true`; poll `GET /applications/{app_id}/evaluation` until the eval appears; `POST /jobs/{id}/match?deep=true` returns candidates re-ranked by `ai_overall_score`. Confirm `RECRUITMENT_AI_EVALUATIONS`/`_STRENGTHS`/`_WEAKNESSES` rows written with correct `MODEL_NAME`.
6. **Scope/auth**: non-HR `admin_card_no` → 403 `{detail:"HR admin access required"}`; out-of-scope candidate/job → 404; oversized bulk (>20) → 400.
