# Audit — Recruitment AI/CV Port (8 endpoints): walkthrough.md vs. code vs. FastAPI

**Date:** 2026-07-21
**Scope:** Verify the claims in `Node-LMS-Backend/walkthrough.md` against the actual Node code, and verify the Node code against the LIVE FastAPI source (`[LIVE] HRMS_COMPLETE/LMS-Backend`). No code was modified — this is a findings-only report.

**Files reviewed (Node):** `src/services/cvEvaluator.service.js`, `src/services/recruitment.service.js` (new tail, lines ~2078–2872 + `applyCandidateToJob` @304), `src/controllers/recruitment.controller.js` (new handlers @401–669), `src/routes/recruitment.routes.js`, `src/middlewares/upload.middleware.js`, `.env`, `package.json`.
**Files referenced (FastAPI):** `routers/recruitment_router.py`, `services/recruitment_service.py`, `repositories/recruitment_repository.py`, `AI/cv_evaluator.py`, `AI/config.py`.

---

## 1. Verdict

The scaffolding is largely faithful — routes, config, path builders, most SQL, and the request/response envelopes match FastAPI well. **However, the walkthrough's central claim of "byte-for-byte parity" is not accurate.** There are **two CRITICAL defects that break the two AI endpoints (`apply`, deep `match`) and the candidate-CV file naming**, one **HIGH** scope-enforcement gap, plus several medium/low parity deviations.

Root cause of most CRITICAL issues: **a systematic escape-sequence flattening** — every `\n`, `\s`, `\d`, and `\.` in string/regex literals lost its backslash and became a bare `n`/`s`/`d`/`.`. This was confirmed at the byte level with `od -c` (e.g. `recruitment.service.js:2361` is literally `parts.join("n")`, not `"\n"`). It affects both `cvEvaluator.service.js` and the new functions in `recruitment.service.js`.

| Severity | Count | Endpoints affected |
|---|---|---|
| 🔴 Critical | 2 | 5 (apply), 6 (deep match), 3 (upload CV), 4 (download CV) |
| 🟠 High | 1 | 3, 4, 5 (candidate scope) |
| 🟡 Medium | 4 | 5, 6, general |
| 🟢 Low / caveat | 6 | docs, config, security |

---

## 2. Walkthrough claims — verification

| # | walkthrough.md claim | Verdict | Note |
|---|---|---|---|
| 1 | "byte-for-byte parity with the Python FastAPI logic" | ❌ **False** | Newlines/regex flattened; `_scope.json` whitespace differs; several logic gaps below. |
| 2 | `cvEvaluator.service.js` ports `AI/cv_evaluator.py` (caps model, retry+backoff+jitter, token escalation) | ⚠️ **Partial** | Structure ported, but prompt newlines and the `retryDelay` regex are broken; `thinkingConfig` never sent; `schema_valid`/pydantic coercion not ported. |
| 3 | `CandidateAssessmentSchema` "matching the backend metrics precisely" | ✅ Mostly | Shape matches. But it is also (incorrectly) used for `metricsOnly`; see F6. |
| 4 | Path resolving `candidateCvTarget`, `jobCvDirs`, `poolCvDirs` "using `_safe_name` exactly" | ⚠️ **Partial** | `jobCvDirs`/`poolCvDirs`/`companyBranchParts` are faithful and reuse `safeName`. `candidateCvTarget` extension logic is **broken** (F1e). |
| 5 | `matchCandidatesForJob`, `matchCandidatesDeep`, `rankJobApplicants` (score buckets strong/review/weak) | ⚠️ **Partial** | Shallow match + rank are faithful. Deep match's persistence is broken via F2. Buckets correct. |
| 6 | "8 endpoints exposed & mapped" | ✅ True | All 8 routes present and wired ([recruitment.routes.js:20-21,29,58-62](src/routes/recruitment.routes.js)). |
| 7 | Tables inserted/updated: `RECRUITMENT_CANDIDATES/APPLICATIONS/AI_EVALUATIONS/AI_STRENGTHS/AI_WEAKNESSES` | ⚠️ **Partial** | `storeEvaluation` SQL is correct, but evaluations are written with `APPLICATION_ID = undefined` due to F2, so they are **not linked to the application**. |
| 8 | "server starts successfully (`node src/index.js`)" | ✅ Plausible | Defects are runtime/logic, not syntax. |
| 9 | Note: "Deep evaluation operates on Promises without awaiting resolution before returning 200" | ❌ **Misleading** | This is true only of **apply** (fire-and-forget, correct). **Deep match awaits** `Promise.all` before returning (also correct — matches FastAPI's blocking ThreadPoolExecutor). The note conflates the two. |

---

## 3. Findings

### 🔴 CRITICAL

#### F1 — Escape sequences flattened (`\n`/`\s`/`\d`/`\.` → `n`/`s`/`d`/`.`) — systemic
Confirmed via `od -c`. Instances:

- **(a) LLM prompts** — [cvEvaluator.service.js:159,163,177,179,183](src/services/cvEvaluator.service.js). Every intended newline is a literal `n`. e.g. line 177 emits `...profile.nn${extractionTask}nn--- CV TEXT START ---n...`. FastAPI (`cv_evaluator.py:_build_prompt`) uses real `\n`. Prompt still functions (LLM is tolerant) but is not parity and degrades formatting.
- **(b) `extractJson` fallback regex** — [cvEvaluator.service.js:194,202](src/services/cvEvaluator.service.js). `/```(?:json)?s*({[sS]*?})s*```/` and `/{[sS]*}/` — `s`/`[sS]` match the literal letters, **not** whitespace/any-char. So the fenced-JSON and brace-extraction fallbacks are non-functional; only the primary `JSON.parse(rawText)` works. FastAPI's `_extract_json` (regex `\s*`, `[\s\S]`) recovers JSON wrapped in prose/markdown — Node cannot. Matters most for `gemma-4-31b-it` (the **configured** model), which runs with `json_mode=false` and is the exact case where models emit fenced/prefixed JSON.
- **(c) `retryDelay` regex** — [cvEvaluator.service.js:225](src/services/cvEvaluator.service.js). `/retryDelay['"]?s*:s*['"]?(d+)/` — `d+` matches literal `d`, not digits; never captures the server-suggested delay. On HTTP 429 the backoff falls through to the exponential default instead of honoring the server's `retryDelay` (FastAPI `_sleep_before_retry`).
- **(d) Reconstructed CV text & JD text** — [recruitment.service.js:2341,2342,2345,2354,2361](src/services/recruitment.service.js) (`getCandidateCvText`) and [2379,2380,2385](src/services/recruitment.service.js) (`buildJobJdText`). `parts.join("n")` / `lines.join("n")` join sections with a literal `n` instead of a newline, and section labels like `"nSummary:n..."`, `"nExperience:"` embed `n`. The profile text fed to Gemini for endpoints 5 & 6 is corrupted (words run together with `n`), diverging from FastAPI (`get_candidate_cv_text`, `build_job_jd_text`).
- **(e) Candidate CV extension stripping — genuinely broken** — [recruitment.service.js:2263](src/services/recruitment.service.js): `const cleanExt = (ext || "bin").replace(/^.+/, "").toLowerCase();`. The intended `/^\.+/` (strip leading dots, mirroring Python `lstrip('.')`) became `/^.+/`, which matches the **entire** string → `cleanExt` is always `""`. Result: `candidateCvTarget` builds `cand_<id>.` (no extension). Endpoint 3 writes the file with no extension and stores that path; endpoint 4 serves it (self-consistent within Node) but **diverges from FastAPI's `cand_<id>.pdf`**, and `res.sendFile` cannot infer a MIME type. (Note: the sibling `.replace(/^./, "")` at controller:509 and :583 coincidentally works, because `path.extname()` always returns a leading dot and `^.` removes exactly that one char.)

**Impact:** functional degradation of the AI prompts and evaluation quality; broken JSON-recovery fallback for the configured Gemma model; wrong 429 backoff; extensionless candidate CV files.

#### F2 — `apply` / deep `match` write evaluations that are not linked to an application
[recruitment.service.js:2329-2332](src/services/recruitment.service.js) `createApplicationForCandidate` delegates to `applyCandidateToJob` ([:304-353](src/services/recruitment.service.js)), which returns `{ status: "success" }` — **no `application_id`, no `created`** — and **errors ("This candidate has already applied to this job") when an application already exists**.

FastAPI's apply/deep path uses a **different** function: `create_application_for_candidate` → `_find_or_create_application_tx` (`recruitment_repository.py:1570,1900`), which **reuses** any existing application and returns `{status, application_id, created}` via `RETURNING APP_ID`. Node aliased the wrong Python function (`apply_candidate_to_job` @repo:1394, the strict "error on duplicate" one used by the unrelated `svc_apply_candidate`).

Consequences:
- **Endpoint 5 (`POST /candidates/{id}/apply`)**: controller reads `result.application_id` → **`undefined`**. Response returns `application_id: undefined`, and the background `evaluateApplication(undefined, candidate_id, job_id)` calls `storeEvaluation(undefined, …)` → inserts a row with `APPLICATION_ID = NULL` (or fails) — **the AI evaluation is orphaned, never retrievable via `GET /applications/{app_id}/evaluation`**. This is the core purpose of the endpoint.
- **Re-apply**: FastAPI reuses (returns `created:false`, re-scores same app); Node returns **400** "already applied".
- **Endpoint 6 (`POST /jobs/{id}/match?deep=true`)**: [recruitment.service.js:2838-2844](src/services/recruitment.service.js) — `app.application_id` is `undefined` → `storeEvaluation(undefined, …)` (orphaned); and if the candidate already had an application, `applyCandidateToJob` returns error → `entry.deep_error` set, no re-evaluation. FastAPI persists on the reused application.

---

### 🟠 HIGH

#### F3 — Missing candidate company/branch scope enforcement on 3 endpoints
FastAPI gates candidate-scoped routes with `_require_candidate_access(...)` → **404 "Candidate not found"** when the candidate's company/branch is outside the admin's scope (`recruitment_router.py:704,746,776`). The existing Node `getCandidate`/`updateCandidate` reproduce this inline. The three new candidate endpoints do **not**:

- `applyCandidate` ([controller:642](src/controllers/recruitment.controller.js)) — no scope check at all.
- `uploadCandidateCv` ([controller:575](src/controllers/recruitment.controller.js)) — computes `_getScope` but **never uses `final_c/final_b`** to gate (dead read).
- `downloadCandidateCv` ([controller:617](src/controllers/recruitment.controller.js)) — does not call `_getScope`; any HR admin can download any candidate's CV across companies.

There is also no `candidateInScope` service function (Python `candidate_in_scope`, repo:942) ported. **Impact:** cross-company data access / write; deviates from FastAPI's isolation.

---

### 🟡 MEDIUM

#### F4 — `thinkingConfig` never sent
[cvEvaluator.service.js:235-249](src/services/cvEvaluator.service.js) `makeConfig` omits the thinking-budget config entirely (a `// might skip` comment). FastAPI sets `thinking_config=ThinkingConfig(thinking_budget=0)` when `caps.thinking` (`cv_evaluator.py:_make_config`) — the single biggest latency win on gemini-2.5 models — and relies on it to trigger `degradeCaps('thinking')`. No effect for the **configured** `gemma-4-31b-it` (seeded `thinking:false`), but diverges for the `gemini-2.5-flash-lite` default and leaves `degradeCaps('thinking')` unreachable.

#### F5 — `schema_valid` hardcoded; no pydantic-equivalent validation/coercion
[cvEvaluator.service.js:327](src/services/cvEvaluator.service.js) sets `schema_valid: true` unconditionally. FastAPI runs `schema.model_validate(...).model_dump()` and sets `schema_valid=False` on mismatch, and coerces near-misses via `LenientInt` (float→`round`) / `LenientStr` (`cv_evaluator.py:45-51,450-456`). Node keeps the raw parsed JSON. For `gemma-4-31b-it` (json_mode off, no server-side schema), float scores/extra fields are not normalized; downstream `rToInt` (parseInt) **truncates** where Python **rounds** (see F-Low-2).

#### F6 — `extractMetrics` uses the full assessment schema
[cvEvaluator.service.js:252,344-346](src/services/cvEvaluator.service.js) passes `CandidateAssessmentSchema` even for `metricsOnly`. FastAPI selects `CandidateMetricsSchema` for metrics-only (`cv_evaluator.py:372`). Latent only — none of the 8 endpoints call `extractMetrics` (the two AI endpoints use `evaluateCv`; profile-only extraction is the Python watcher's job), so no live impact, but it is a real deviation.

#### F7 — No bounds validation on `top` / `top_k` / `deep`
`matchCandidates` and `topCandidates` read `top`/`deep`/`top_k` straight from `req.query` with no zod schema; FastAPI enforces `Query(..., ge=1, le=200)` and boolean coercion (`recruitment_router.py:164-165,189`). Out-of-range values aren't rejected (they're clamped by `Math.max(...,0)` / slice, so no crash, but a `top=9999` is honored where FastAPI returns 422).

---

### 🟢 LOW / CAVEATS

1. **`_scope.json` whitespace differs** — [controller:496](src/controllers/recruitment.controller.js) `JSON.stringify({...})` produces `{"compc":1,"brnch":null,"job_id":5}`; Python `json.dump` produces `{"compc": 1, ...}` (spaces). The Python watcher parses either fine, so functionally equal — but it is a concrete counterexample to "byte-for-byte."
2. **`rToInt` truncates floats** — [recruitment.service.js](src/services/recruitment.service.js) `parseInt(v,10)`; Python `_r_to_int` rounds. Affects AI scores from non-schema-enforced models (see F5).
3. **Config duplicated across two `.env` files** — Node `.env` now carries `TOP_K=3`, `CV_MODEL=gemma-4-31b-it`, `CV_MAX_WORKERS=8`, mirroring `AI/.env`. Correct today, but a drift risk: `topCandidates` default and the evaluator model must stay in sync with the Python side by hand.
4. **Committed secret** — `Node-LMS-Backend/.env` contains a **real `GEMINI_API_KEY`** value. Confirm `.env` is git-ignored; the plan explicitly called for not hardcoding/committing the key (GitHub push protection would block it). Rotate if it has been committed.
5. **`PROCESSED_AT`** — Node `storeEvaluation` hardcodes `SYSDATE`; FastAPI uses `NVL(TO_DATE(:pat,…), SYSDATE)`. For endpoints 5/6 `processed_at` is always None → `SYSDATE` both ways, so parity holds for this port (the `:pat` path is only exercised by the Python watcher, which is unchanged).
6. **Doc accuracy** — beyond claim #1 and #9 above, the walkthrough's "Validation Results" imply full behavioral verification, but the apply/deep-match evaluation-linking defect (F2) would surface only against a live DB, which does not appear to have been exercised end-to-end.

---

## 4. What is correct (parity achieved)

- **Config & deps**: `EMP_DOCS_ROOT` correctly set to the shared prod path `C:\Erp_Systems\HRMS_LMS_APP\EMP_DOCS` (fixes audit bug §5.5); `@google/genai ^2.12.0` and `multer ^2.2.0` present; `uploadCvArray = upload.array('files', 20)` added.
- **Routing**: all 8 routes wired; literal candidate paths declared before `/:candidate_id`; router-level `requireHrAdmin` works because `admin_card_no` arrives via query on every endpoint (runs fine before multer).
- **Path builders**: `companyBranchParts`, `jobCvDirs`, `poolCvDirs` faithfully mirror the Python folder logic and reuse `safeName`/`DOCS_ROOT` → path parity with the watcher (except the `candidateCvTarget` extension bug, F1e).
- **SQL ports**: `storeEvaluation` (+ strengths/weaknesses), `getApplicationEvaluation`, `matchCandidatesForJob` (10/6/1 weighting, stopwords, LISTAGG, ORA-00904 fallback), `rankJobApplicants` (NULLS LAST, counts, `_scoreBand`, `ai_note`/`score_band`/`ai_flagged`), `cvStatusInDirs`, `setCandidateCv`, `getCandidateCvPath` — all match FastAPI, with lowercased keys.
- **Upload/serve flow**: `safeCvFilename` (`{stem}_{ms}.pdf`), `writeCvToBuffer` (non-PDF → `queued:false`), `resolveDropDirs` (job vs pool, 404 scope gates, `_scope.json`, `mkdirSync`), `downloadCandidateCv` (`res.sendFile` + Content-Disposition) mirror the FastAPI handlers.
- **Concurrency semantics**: `apply` is fire-and-forget (matches FastAPI `BackgroundTasks` exactly); deep `match` awaits its worker batches before returning (matches FastAPI's blocking ThreadPoolExecutor). No BullMQ introduced — correct.

---

## 5. Suggested remediation order (for when code changes are authorized)

1. **F1 (escape flattening)** — global fix: restore `\n` in all prompt/text builders (`cvEvaluator` `buildPrompt`; `recruitment.service` `getCandidateCvText`, `buildJobJdText`), and restore `\s`/`\d`/`\S`/`\.` in the four regexes (`extractJson` ×2, `sleepBeforeRetry`, `candidateCvTarget` cleanExt). A repo-wide scan for `join("n")`, `[sS]`, `(d+)`, `/^.+/` will surface them.
2. **F2** — repoint `createApplicationForCandidate` at a faithful port of `_find_or_create_application_tx` (reuse existing app, `RETURNING APP_ID`, return `application_id` + `created`); do not reuse `applyCandidateToJob`.
3. **F3** — add the candidate-in-scope 404 gate to `applyCandidate`, `uploadCandidateCv`, `downloadCandidateCv` (mirror `getCandidate`).
4. **F4–F7** — thinking config, `schema_valid`/coercion, metrics-only schema, query bounds.
5. **Low** — rotate/ignore the API key; document the single-source-of-truth for `TOP_K`/`CV_MODEL`.

---

## 6. Fixes applied (2026-07-21)

All code fixes below were made and syntax-verified (`node --check` on every changed file; schema + evaluator modules import cleanly; bound-rejection tested).

| Finding | Status | What changed |
|---|---|---|
| **F1 escape flattening** | ✅ Fixed | Restored `\n` in all prompt/text builders (`cvEvaluator.buildPrompt`; `getCandidateCvText`; `buildJobJdText`) and `\s`/`\d`/`\.` in every affected regex (`extractJson` ×2, `sleepBeforeRetry` retryDelay, `candidateCvTarget` cleanExt `/^\.+/`). Also fixed the two controller `/^\./` ext regexes (were coincidentally working). |
| **F2 orphaned evaluations** | ✅ Fixed | `createApplicationForCandidate` rewritten as a faithful port of `create_application_for_candidate` + `_find_or_create_application_tx`: reuses an existing application (returns `created:false`) or inserts via `RETURNING APP_ID`, always returning `{status, application_id, created}`. `apply` and deep `match` now link evaluations to the correct application; re-apply reuses instead of 400. |
| **F3 candidate scope** | ✅ Fixed | Added `_requireCandidateAccess(req,res,id)` helper (mirrors FastAPI `_require_candidate_access` + the existing `getCandidate` check) and applied it to `applyCandidate`, `uploadCandidateCv`, `downloadCandidateCv`. |
| **F4 thinkingConfig** | ✅ Fixed | `makeConfig` now sets `thinkingConfig:{thinkingBudget:0}` when `caps.thinking`. |
| **F5 schema_valid/coercion** | ✅ Fixed | Added `normalizeAssessment`/`coerceInt` (pydantic-lite): rounds float scores, stringifies numeric phone, and sets `stats.schema_valid` from actual conformance instead of hardcoded `true`. |
| **F6 metrics schema** | ✅ Fixed | `runLlm` now selects `CandidateMetricsSchema` for `metricsOnly` (derived from the assessment schema's `metrics` node) instead of always the full schema. |
| **F7 query bounds** | ✅ Fixed | Added `matchQuerySchema` / `topCandidatesQuerySchema` (`z.coerce.number().int().min(1).max(200)`, `top` default 20) and wired `validate()` on `POST /jobs/:job_id/match` and `GET /jobs/:job_id/top-candidates`. |
| Low-1 (`buildJobJdText`) | ✅ Fixed | `min_experience_years` guard now `!== null && !== undefined` (matches Python `is not None`). |

### New finding discovered during remediation

**N1 — Notification template `_render` also had flattened escapes** (`recruitment.service.js:1741-1742`, part of the previously-"ported" 29 endpoints, not the 8). The Python `_render` post-processing (`notification_repository.py:364-365`) collapses trailing whitespace and blank-line runs; the Node port had `out.replace(/[ t]+n/g, "n")` and `out.replace(/n{3,}/g, "nn")` — i.e. `\t`/`\n` flattened, so the cleanup was inert **and** it would substitute literal `n` characters into rendered notification bodies. **Fixed** to `out.replace(/[ \t]+\n/g, "\n")` and `out.replace(/\n{3,}/g, "\n\n")`. This means the notification-message rendering used by the interview/notification-selections flow was previously producing malformed text.

### Still open (require an environment/ops decision, not a code fix)
- **Committed secret**: `Node-LMS-Backend/.env` still contains a real `GEMINI_API_KEY`. Confirm `.env` is git-ignored and rotate the key if it was ever committed.
- **`TOP_K`/`CV_MODEL` duplicated** across Node `.env` and `AI/.env` — keep in sync manually.
- **Cosmetic**: the Node evaluation prompt keeps item-2 on a single line where the Python prompt wraps it across indented lines — semantically identical, not corrected.
