"""
Per-CV pipeline: extract text -> LLM evaluation -> write Eval JSON -> move
the PDF from CV_Buffer to CV_Archive. Batches run in a thread pool sized by
config.MAX_WORKERS (the LLM round-trip is network-bound, so threads scale).
"""

from __future__ import annotations

import json
import logging
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import config
import cv_evaluator
import cv_extractor

log = logging.getLogger("cv_pipeline")

# The watcher runs as its own process, but candidate/evaluation persistence must
# be shared with the FastAPI app, so it lives in the backend's repositories/.
# AI/ sits one level below the backend root (AI/../ == LMS-Backend), so add that
# to sys.path to import it. The repository chain uses oracledb only -- it never
# imports FastAPI app state. If the import fails (e.g. oracledb missing) the
# pipeline still extracts, evaluates, archives and writes the Eval JSON; only the
# DB write is skipped, and a .dberror.json marks it for replay.
_BACKEND_ROOT = str(Path(__file__).resolve().parent.parent)
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

try:
    from repositories import recruitment_repository as _recruitment_repo
except Exception as _import_err:  # pragma: no cover - env-dependent
    _recruitment_repo = None
    log.warning("DB persistence disabled (could not import recruitment_repository): %s",
                _import_err)


def _job_id_from_folder(job_folder: str):
    """Map a CV_Buffer job folder name to the numeric RECRUITMENT_JOBS.JOB_ID.
    Folders may be plain numbers ('21') or 'J-021' style; either way the digits
    are the job id. Returns an int, or None when the folder has no digits."""
    digits = re.sub(r"\D", "", job_folder or "")
    return int(digits) if digits else None


@dataclass
class CVJob:
    """A CV sitting in a job's drop folder:
        EMP_DOCS/<Company>/<Branch?>/RECRUITMENT_CVS/<job_id>/<cv>.pdf
    The company/branch come from the job record in the DB (authoritative), so the
    pipeline only needs the <job_id> folder from the path; the archive mirrors the
    same hierarchy with RECRUITMENT_CVS -> CV_Archive."""
    pdf_path: Path
    job_folder: str      # the <job_id> folder name (e.g. "1" or "J-001")
    archive_dir: Path    # .../CV_Archive/<job_folder>

    @classmethod
    def from_buffer_path(cls, pdf_path: Path) -> "CVJob":
        p = pdf_path.resolve()
        # A job CV is exactly one level below RECRUITMENT_CVS
        # (RECRUITMENT_CVS/<job>/<cv>.pdf). A file directly in RECRUITMENT_CVS is a
        # permanent per-candidate resume, not a screening drop -> ignored.
        if p.parent.parent.name != config.BUFFER_DIR_NAME:
            raise ValueError(
                f"PDF is not in a {config.BUFFER_DIR_NAME}/<job_id>/ folder: {pdf_path}"
            )
        archive_dir = _swap_path_segment(p.parent, config.BUFFER_DIR_NAME, config.ARCHIVE_DIR_NAME)
        return cls(pdf_path=pdf_path, job_folder=p.parent.name, archive_dir=archive_dir)

    @property
    def job_id(self):
        return _job_id_from_folder(self.job_folder)

    @property
    def eval_dir(self) -> Path:
        # Eval JSON audit files sit next to the archived PDF (CV_Archive/<job>/).
        return self.archive_dir


def _swap_path_segment(path: Path, old: str, new: str) -> Path:
    """Return `path` with its innermost `old` path component renamed to `new`
    (e.g. .../RECRUITMENT_CVS/<job> -> .../CV_Archive/<job>)."""
    parts = list(path.parts)
    for i in range(len(parts) - 1, -1, -1):
        if parts[i] == old:
            parts[i] = new
            return Path(*parts)
    raise ValueError(f"segment {old!r} not found in {path}")


def load_job_description(job: CVJob) -> str:
    """Build the job description the CV is scored against from the DB job record
    (title + description + must/nice-to-have skills + min experience + education).
    Falls back to an optional job_description.txt in the drop folder, then to the
    generic default."""
    if _recruitment_repo is not None and job.job_id is not None:
        try:
            jd = _recruitment_repo.build_job_jd_text(job.job_id)
            if jd and jd.strip():
                return jd
        except Exception as e:
            log.warning("Could not build JD from DB for job %s: %s", job.job_id, e)
    jd_file = job.pdf_path.parent / config.JOB_DESCRIPTION_FILENAME
    if jd_file.is_file():
        text = jd_file.read_text(encoding="utf-8", errors="replace").strip()
        if text:
            return text
    log.warning("No DB/text job description for job %s -- using default", job.job_folder)
    return config.DEFAULT_JOB_DESCRIPTION


def _unique_path(target: Path) -> Path:
    """Avoid clobbering an archived CV with the same filename."""
    if not target.exists():
        return target
    stem, suffix = target.stem, target.suffix
    for i in range(1, 1000):
        candidate = target.with_name(f"{stem}_{i}{suffix}")
        if not candidate.exists():
            return candidate
    raise FileExistsError(f"Could not find a free archive name for {target}")


def process_cv(pdf_path: Path) -> Path:
    """Run the full pipeline for one CV. Returns the path of the written
    evaluation JSON. Raises on failure (PDF stays in the buffer)."""
    job = CVJob.from_buffer_path(pdf_path)
    started = time.perf_counter()

    extraction = cv_extractor.extract_text(pdf_path)
    if not extraction.text.strip():
        raise ValueError("No text could be extracted from the PDF (empty after OCR fallback)")

    # Two modes:
    #  - job folder present  -> extract metrics AND score against the job (creates
    #    an application + AI ranking downstream).
    #  - pool folder (no job) -> extract the profile metrics only; no scoring.
    has_job = job.job_id is not None
    if has_job:
        job_description = load_job_description(job)
        assessment, llm_stats = cv_evaluator.evaluate_cv(
            extraction.text, job_description, extraction.detected_job_title
        )
    else:
        assessment, llm_stats = cv_evaluator.extract_metrics(
            extraction.text, extraction.detected_job_title
        )

    record = {
        "cv_file": pdf_path.name,
        "job_folder": job.job_folder,
        "job_id": job.job_id,
        "mode": "evaluate" if has_job else "profile",
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "pipeline": {
            "total_seconds": None,  # filled below
            **llm_stats,
        },
        "extraction": {
            "method": extraction.method,
            "page_count": extraction.page_count,
            "ocr_pages": extraction.ocr_pages,
            "detected_job_title": extraction.detected_job_title,
            "sections_found": sorted(extraction.sections.keys()),
            "text_chars": len(extraction.text),
        },
        **assessment,  # metrics + evaluation
    }
    record["pipeline"]["total_seconds"] = round(time.perf_counter() - started, 3)

    job.eval_dir.mkdir(parents=True, exist_ok=True)
    eval_path = job.eval_dir / f"{pdf_path.stem}.json"
    eval_path.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")

    # Only after the eval JSON is safely written: cut/move buffer -> archive.
    job.archive_dir.mkdir(parents=True, exist_ok=True)
    archived_path = _unique_path(job.archive_dir / pdf_path.name)
    pdf_path.replace(archived_path)

    # Persist to the recruitment DB (candidate -> application -> evaluation). This
    # runs AFTER archive + JSON so a DB failure never loses work; on failure we
    # drop a .dberror.json alongside the Eval JSON so it can be replayed.
    _persist_to_db(job, record, assessment, llm_stats, archived_path, eval_path)

    log.info(
        "Done job %s / %s in %.2fs (extract=%s, model=%s)",
        job.job_folder, pdf_path.name,
        record["pipeline"]["total_seconds"], extraction.method, llm_stats.get("model"),
    )
    return eval_path


def _read_scope_sidecar(folder: Path) -> dict:
    """Read {compc, brnch} from a `_scope.json` the upload endpoint drops in the
    drop folder, so a pool (job-less) CV can still stamp the candidate's
    company/branch without a job to look them up from. Returns {} if absent."""
    try:
        f = folder / "_scope.json"
        if f.is_file():
            return json.loads(f.read_text(encoding="utf-8"))
    except Exception as e:
        log.warning("Could not read _scope.json in %s: %s", folder, e)
    return {}


def _persist_to_db(job: "CVJob", record: dict, assessment: dict, llm_stats: dict,
                   archived_path: Path, eval_path: Path) -> None:
    """Best-effort DB persistence for one finished CV. Never raises.
    With a job: candidate + application + evaluation. Without a job (pool): the
    candidate profile only."""
    if _recruitment_repo is None:
        return
    try:
        if job.job_id is not None:
            result = _recruitment_repo.persist_cv_evaluation(
                company_id=None,   # the job's own COMPC/BRNCH (from the DB) are authoritative
                job_id=job.job_id,
                assessment=assessment,
                stats=llm_stats,
                total_seconds=record["pipeline"].get("total_seconds"),
                processed_at=None,  # PROCESSED_AT defaults to SYSDATE; JSON keeps the precise UTC stamp
                cv_file_name=record["cv_file"],
                cv_file_path=str(archived_path.resolve()),
            )
        else:
            scope = _read_scope_sidecar(job.pdf_path.parent)
            result = _recruitment_repo.persist_cv_profile(
                compc=scope.get("compc"),
                brnch=scope.get("brnch"),
                assessment=assessment,
                cv_file_name=record["cv_file"],
                cv_file_path=str(archived_path.resolve()),
            )
    except Exception as e:  # defensive: the repo already catches, but never let this kill a CV
        result = {"status": "error", "message": f"{type(e).__name__}: {e}"}

    if result.get("status") == "success":
        if job.job_id is not None:
            log.info("DB persisted %s -> candidate #%s, application #%s, evaluation #%s%s",
                     record["cv_file"], result.get("candidate_id"),
                     result.get("application_id"), result.get("evaluation_id"),
                     "" if result.get("candidate_created") else " (existing candidate updated)")
        else:
            log.info("DB persisted %s -> candidate #%s (profile only, no job)%s",
                     record["cv_file"], result.get("candidate_id"),
                     "" if result.get("candidate_created") else " (existing candidate updated)")
    else:
        log.error("DB persist FAILED for %s: %s", record["cv_file"], result.get("message"))
        try:
            marker = eval_path.with_suffix(".dberror.json")
            marker.write_text(json.dumps({
                "cv_file": record["cv_file"],
                "job_folder": job.job_folder,
                "job_id": job.job_id,
                "failed_at": datetime.now(timezone.utc).isoformat(),
                "error": result.get("message"),
                "archived_pdf": str(archived_path.resolve()),
                "eval_json": str(eval_path.resolve()),
                "note": "Evaluation JSON + archived PDF are intact. Fix the DB issue "
                        "and replay this record into RECRUITMENT_* tables.",
            }, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception:
            log.exception("Could not write .dberror.json for %s", record["cv_file"])


def write_error_record(pdf_path: Path, error: Exception) -> None:
    """Persist a .error.json next to where the eval would have gone, so failed
    CVs are visible to HR instead of silently stuck in the buffer."""
    try:
        job = CVJob.from_buffer_path(pdf_path)
        job.eval_dir.mkdir(parents=True, exist_ok=True)
        err_path = job.eval_dir / f"{pdf_path.stem}.error.json"
        err_path.write_text(
            json.dumps(
                {
                    "cv_file": pdf_path.name,
                    "failed_at": datetime.now(timezone.utc).isoformat(),
                    "error": f"{type(error).__name__}: {error}",
                    "note": "PDF left in CV_Buffer. Fix the issue and restart the watcher to retry.",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
    except Exception:
        log.exception("Could not write error record for %s", pdf_path)


def process_batch(pdf_paths: list[Path]) -> dict[Path, Exception | Path]:
    """Process many CVs concurrently. Returns {pdf_path: eval_json_path | Exception}."""
    results: dict[Path, Exception | Path] = {}
    if not pdf_paths:
        return results
    log.info("Processing batch of %d CV(s) with %d workers", len(pdf_paths), config.MAX_WORKERS)
    batch_start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=config.MAX_WORKERS) as pool:
        futures = {pool.submit(process_cv, p): p for p in pdf_paths}
        for future in as_completed(futures):
            pdf = futures[future]
            try:
                results[pdf] = future.result()
            except Exception as e:
                log.error("FAILED %s: %s", pdf.name, e)
                results[pdf] = e
    ok = sum(1 for v in results.values() if isinstance(v, Path))
    log.info(
        "Batch finished: %d ok, %d failed in %.1fs",
        ok, len(results) - ok, time.perf_counter() - batch_start,
    )
    return results
