# CV Recruitment Pipeline

Automated CV screening: HR drops PDF CVs into a job's `CV_Buffer` folder, a
filesystem watcher picks them up, extracts the text (OCR only when needed),
has an LLM score each candidate against the job description, writes one
evaluation JSON per CV into `Eval`, and moves the processed PDF to
`CV_Archive`.

## Folder layout

```
Recruitment/
└── <company_id>/            e.g. 1, 2, ...
    ├── CV_Buffer/
    │   └── <job_id>/         e.g. J-001  ← HR drops CV PDFs here
    │       └── job_description.txt       ← per-job JD (plain text)
    ├── CV_Archive/
    │   └── <job_id>/                     ← processed PDFs are moved here
    └── Eval/
        └── <job_id>/                     ← <cv_name>.json per processed CV
```

New companies/jobs need no code change — just create the folders (the watcher
watches the whole `Recruitment/` tree recursively and creates `Eval`/
`CV_Archive` job subfolders on demand).

## Running

```
python cv_watcher.py
```

Leave it running. It does a catch-up scan of all buffers on startup, then
processes new arrivals automatically. Bulk drops (50+ PDFs) are debounced into
a single batch and processed with `MAX_WORKERS` (default 8) concurrent
workers. Logs go to the console and `pipeline.log`.

## Extraction strategy (text-first, OCR-fallback)

1. Direct text extraction per page with **PyMuPDF** — fast, free, no OCR.
2. Pages with fewer than `MIN_CHARS_PER_PAGE` extractable characters are
   treated as scanned images and rasterized through **Tesseract OCR**.
3. The text is parsed into sections (summary, education, experience, skills,
   projects, ...) and the candidate's preferred job title is heuristically
   detected, then everything is sent as *raw text* to the LLM — no PDF upload
   round-trip.

OCR therefore only runs on the minority of CVs that are actually scans.
Tesseract binary install (one-time):
`winget install -e --id UB-Mannheim.TesseractOCR`

## Speed configuration

- Model: `gemini-2.5-flash-lite` (fastest hosted tier), thinking disabled,
  `temperature=0`, schema-constrained JSON output, capped output tokens.
  Override with the `CV_MODEL` env var or in `AI/.env` (loaded automatically;
  real environment variables win over `.env` entries).
- A single CV takes ~4–5 s on flash-lite; a 50-CV bulk drop finishes in
  roughly 7 LLM round-trips of wall time with the default 8 workers
  (`CV_MAX_WORKERS`).
- Transient API errors (503 etc.) are retried with exponential backoff;
  429s honor the server-suggested retry delay.

## Model compatibility (Gemini vs Gemma)

Gemma API models (e.g. `gemma-4-31b-it`) accept fewer request parameters than
the gemini-2.5 series: no `system_instruction`, no JSON mode
(`response_mime_type`/`response_schema`), no `thinking_config`. The evaluator
seeds per-family capabilities (see `_seed_caps` in `cv_evaluator.py`) and also
degrades them at runtime on `INVALID_ARGUMENT`, so unknown models converge on
a working config by themselves. When JSON mode is off, the schema is spelled
out in the prompt and the reply is fence-stripped, parsed and normalized
through pydantic (`schema_valid` in the output JSON flags hard mismatches).
Note: each model has its own free-tier quota bucket, so switching `CV_MODEL`
is also the workaround when one model's daily quota is exhausted. Gemma 31B
is noticeably slower per CV (~45-50 s) than flash-lite (~4-5 s).

## Database integration (Talent Pool)

When a CV finishes processing the pipeline also persists it into the recruitment
DB, so evaluations show up in the HRMS UI — not just as `Eval` JSON files. One
CV becomes, in a **single transaction**:

```
candidate (permanent, deduped)  ->  application (candidate x job)  ->  evaluation
RECRUITMENT_CANDIDATES              RECRUITMENT_APPLICATIONS          RECRUITMENT_AI_EVALUATIONS
  + EDUCATION / EXPERIENCE / SKILLS                                    + AI_STRENGTHS / AI_WEAKNESSES
```

- **Candidates are never duplicated.** A CV is matched to an existing candidate
  by normalized email, then mobile, *within the same company*. A re-upload
  refreshes the profile + CV pointer and **replaces** the education/experience/
  skills rows from the fresh extraction; it stores a *new* evaluation on the
  *same* application. New person → new candidate row.
- **Folder → JOB_ID mapping:** the CV_Buffer job folder's digits are the numeric
  `RECRUITMENT_JOBS.JOB_ID` (`J-001` → 1, `21` → 21), and the company folder is
  the `COMPC`. The candidate is stamped with the *job's* company/branch (the job
  row is authoritative), keeping pool scoping consistent.
- **Shared code, two processes.** Persistence lives in the backend at
  `repositories/recruitment_repository.py` (`persist_cv_evaluation`) so the
  watcher process and the FastAPI API use the exact same functions. The watcher
  adds the backend root to `sys.path` to import it; that import chain uses
  `oracledb` only and never touches FastAPI app state.
- **Work is never lost on a DB failure.** The DB write happens *after* the PDF is
  archived and the Eval JSON is written. If it fails (e.g. the folder maps to a
  non-existent job), the CV is still archived + JSON'd and a `<cv>.dberror.json`
  marker is dropped next to the Eval JSON for replay.
- Sequences for the AI tables (`RECRUITMENT_AI_EVAL_SEQ`, `…_STRENGTH_SEQ`,
  `…_WEAKNESS_SEQ`) are created idempotently at first use.

### Related API endpoints (backend)

| Endpoint | Purpose |
|---|---|
| `POST /recruitment/candidates/upload-cv` | Queue a PDF into a job's CV_Buffer (the watcher then screens it) |
| `POST /recruitment/jobs/{job_id}/match?top=20&deep=false` | Rank the whole talent pool for a job (Stage 1 keyword score; `deep=true` also runs the shortlist through this evaluator) |
| `GET /recruitment/applications/{app_id}/evaluation` | The latest evaluation + strengths + weaknesses for an application |

## Output JSON

Each `Eval/<job_id>/<cv>.json` contains:

- `pipeline` — model, latency, token usage
- `extraction` — method (`text` / `ocr` / `mixed`), OCR'd pages, detected
  sections, detected job title
- `metrics` — contact info, preferred job title, education, experience, skills
- `evaluation` — compatibility / technical / experience / overall scores
  (0-100), strengths, weaknesses, recommendation, summary

Failures leave the PDF in `CV_Buffer`, are retried once, and then produce a
`<cv>.error.json` in `Eval` so stuck CVs are visible.

## Modules

| File | Purpose |
|---|---|
| `config.py` | All tunables (paths, model, workers, thresholds, API key) |
| `cv_extractor.py` | PyMuPDF text extraction, OCR fallback, section parsing, job-title detection |
| `cv_evaluator.py` | Pydantic schemas + speed-tuned LLM call |
| `cv_pipeline.py` | Per-CV pipeline + concurrent batch processing |
| `cv_watcher.py` | Watchdog-based folder watcher (entrypoint) |

Set `GEMINI_API_KEY` in the environment rather than relying on the fallback
key in `config.py`. `Google.py` is the old upload-the-whole-PDF prototype,
kept for reference.
