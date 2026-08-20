"""
Central configuration for the CV recruitment pipeline.

Folder layout (relative to this file):
    Recruitment/
        <company_id>/               e.g. 1, 2, ...
            CV_Buffer/<job_id>/     HR drops CV PDFs here (e.g. J-001)
            CV_Archive/<job_id>/    processed CVs are moved here
            Eval/<job_id>/          one evaluation JSON per processed CV
"""

import os
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
AI_ROOT = Path(__file__).resolve().parent

# HR drops CVs under the shared employee-documents tree, NOT inside the repo:
#   EMP_DOCS/<Company>/<Branch>/RECRUITMENT_CVS/<job_id>/<cv>.pdf   (drop zone)
#   EMP_DOCS/<Company>/<Branch>/CV_Archive/<job_id>/                (processed)
# so the watcher must watch EMP_DOCS. Path (and the EMP_DOCS_ROOT override) match
# the backend's document_repository.DOCS_ROOT.
RECRUITMENT_ROOT = Path(os.environ.get(
    "EMP_DOCS_ROOT", r"C:\Erp_Systems\HRMS_LMS_APP\EMP_DOCS",
))


# ---------------------------------------------------------------------------
# .env loading (no python-dotenv dependency)
# ---------------------------------------------------------------------------
def _load_env_file() -> None:
    """Load KEY=VALUE pairs from AI/.env into os.environ.
    Real environment variables always win over .env entries."""
    env_file = AI_ROOT / ".env"
    if not env_file.is_file():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file()

BUFFER_DIR_NAME = "RECRUITMENT_CVS"   # HR's drop zone (per company/branch/job)
ARCHIVE_DIR_NAME = "CV_Archive"       # sibling of RECRUITMENT_CVS; processed CVs land here
EVAL_DIR_NAME = "CV_Archive"          # eval JSON audit files sit next to the archived PDF

# Size of the AI shortlist ("top K candidates for a job"). Configured in AI/.env.
TOP_K = int(os.environ.get("TOP_K", "10"))

# ---------------------------------------------------------------------------
# LLM (Google GenAI)
# ---------------------------------------------------------------------------
# Prefer the environment variable; the literal fallback keeps local testing working.
GEMINI_API_KEY = os.environ.get(
    "GEMINI_API_KEY"
)

# Speed-first default. flash-lite is the fastest hosted Gemini tier and, with
# thinking disabled + temperature 0 + JSON schema, gives the lowest latency
# per CV. Override with the CV_MODEL env var to trade speed for quality
# (e.g. "gemini-2.5-flash" or "gemma-4-31b-it").
MODEL_NAME = os.environ.get("CV_MODEL", "gemini-2.5-flash-lite")

# Output cap. A cap only bounds worst-case latency -- unused headroom costs
# nothing -- but a cap that is too low truncates the JSON mid-stream on long
# multi-page CVs and the parse fails. 8192 fits even very long CVs; if a
# response still comes back truncated, the evaluator doubles the budget and
# retries (see LLM_MAX_TOKEN_ESCALATIONS).
MAX_OUTPUT_TOKENS = 8192
LLM_MAX_TOKEN_ESCALATIONS = 2

LLM_MAX_RETRIES = 6             # transient errors (429/5xx) get real backoff, so more attempts
LLM_RETRY_BACKOFF_BASE = 2      # seconds; exponential, with jitter

# Raw CV text sent to the model is truncated to this many characters.
# ~40k chars ≈ 10k tokens covers CVs of ~12+ pages; flash models ingest
# prompt tokens near-instantly so this has negligible latency impact.
MAX_TEXT_CHARS = 40_000

# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------
# A page yielding fewer extractable characters than this is considered a
# scanned image and is routed through the Tesseract OCR fallback.
MIN_CHARS_PER_PAGE = 80

OCR_DPI = 220                   # rasterization DPI for OCR (higher = slower, marginally better)
OCR_LANG = "eng"

# Optional explicit path to tesseract.exe if it is not on PATH.
TESSERACT_CMD = os.environ.get(
    "TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

# ---------------------------------------------------------------------------
# Pipeline / watcher
# ---------------------------------------------------------------------------
# Concurrent CVs in flight. Extraction is milliseconds; the bottleneck is the
# LLM round-trip (network bound), so threads parallelize it well. 8 workers
# chews through a 50-CV bulk upload in ~7 LLM round-trips of wall time.
MAX_WORKERS = int(os.environ.get("CV_MAX_WORKERS", "8"))

# Quiet period after the last filesystem event before a batch is dispatched,
# so a bulk drop of 50+ PDFs is picked up as one batch instead of 50 batches.
BATCH_DEBOUNCE_SECONDS = 2.0

# A file must keep a stable size for this long before we touch it
# (protects against PDFs still being copied into the buffer).
FILE_STABLE_SECONDS = 1.0

MAX_ATTEMPTS_PER_CV = 2         # after this many failures the CV is skipped and an .error.json is written

# Per-job job description file, dropped by HR next to the CVs:
#   Recruitment/<comp>/CV_Buffer/<job_id>/job_description.txt
JOB_DESCRIPTION_FILENAME = "job_description.txt"

DEFAULT_JOB_DESCRIPTION = (
    "We are looking for a Backend Engineer with Python and Docker experience."
)
