"""
Filesystem watcher that auto-starts the CV pipeline.

Watches Recruitment/<company_id>/CV_Buffer/<job_id>/ (all companies, all jobs)
for new PDF files. Events are debounced so a bulk drop of 50+ CVs is picked up
as one batch and processed concurrently; each finished CV gets an Eval JSON
and is moved from CV_Buffer to CV_Archive.

Run:
    python cv_watcher.py
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

import config
import cv_extractor
import cv_pipeline

log = logging.getLogger("cv_watcher")


def _is_buffer_pdf(path: Path) -> bool:
    if path.suffix.lower() != ".pdf":
        return False
    p = path.resolve()
    try:
        p.relative_to(config.RECRUITMENT_ROOT.resolve())
    except ValueError:
        return False
    # A screening drop is EMP_DOCS/<Company>/<Branch?>/RECRUITMENT_CVS/<job_id>/<cv>.pdf
    # i.e. the PDF's grandparent folder is RECRUITMENT_CVS. A PDF directly inside
    # RECRUITMENT_CVS is a permanent per-candidate resume, not a screening drop.
    return p.parent.parent.name == config.BUFFER_DIR_NAME


def _wait_until_stable(path: Path, timeout: float = 60.0) -> bool:
    """Wait until the file size stops changing (file finished copying)."""
    deadline = time.monotonic() + timeout
    last_size = -1
    while time.monotonic() < deadline:
        try:
            size = path.stat().st_size
        except OSError:
            return False  # vanished (moved away / deleted)
        if size == last_size and size > 0:
            return True
        last_size = size
        time.sleep(config.FILE_STABLE_SECONDS)
    return False


class BufferEventHandler(FileSystemEventHandler):
    """Collects PDF arrivals into a debounced pending set."""

    def __init__(self) -> None:
        self.pending: set[Path] = set()
        self.lock = threading.Lock()
        self.last_event = 0.0

    def _enqueue(self, raw_path: str) -> None:
        path = Path(raw_path)
        if _is_buffer_pdf(path):
            with self.lock:
                self.pending.add(path)
                self.last_event = time.monotonic()

    def on_created(self, event: FileSystemEvent) -> None:
        if not event.is_directory:
            self._enqueue(event.src_path)

    def on_moved(self, event: FileSystemEvent) -> None:
        if not event.is_directory:
            self._enqueue(event.dest_path)

    def drain_ready_batch(self) -> list[Path]:
        """Return the pending set once the debounce quiet-period has elapsed."""
        with self.lock:
            if not self.pending:
                return []
            if time.monotonic() - self.last_event < config.BATCH_DEBOUNCE_SECONDS:
                return []
            batch = sorted(self.pending)
            self.pending.clear()
        return batch


def scan_existing_buffer_pdfs() -> list[Path]:
    """CVs already sitting in any job's RECRUITMENT_CVS drop folder at startup
    (catch-up pass). `**` absorbs the company/branch levels (branch is optional
    for company-wide jobs)."""
    return sorted(
        p
        for p in config.RECRUITMENT_ROOT.glob(f"**/{config.BUFFER_DIR_NAME}/*/*.pdf")
        if p.is_file()
    )


def run_watcher() -> None:
    config.RECRUITMENT_ROOT.mkdir(parents=True, exist_ok=True)
    attempts: dict[Path, int] = {}

    def dispatch(batch: list[Path]) -> None:
        ready: list[Path] = []
        for pdf in batch:
            if attempts.get(pdf, 0) >= config.MAX_ATTEMPTS_PER_CV:
                continue  # already failed too often; .error.json was written
            if _wait_until_stable(pdf):
                ready.append(pdf)
        if not ready:
            return
        results = cv_pipeline.process_batch(ready)
        for pdf, outcome in results.items():
            if isinstance(outcome, Exception):
                attempts[pdf] = attempts.get(pdf, 0) + 1
                if attempts[pdf] >= config.MAX_ATTEMPTS_PER_CV:
                    cv_pipeline.write_error_record(pdf, outcome)
                else:
                    handler._enqueue(str(pdf))  # retry in a later batch
            else:
                attempts.pop(pdf, None)

    handler = BufferEventHandler()
    observer = Observer()
    observer.schedule(handler, str(config.RECRUITMENT_ROOT), recursive=True)
    observer.start()

    log.info("Watching %s (model=%s, workers=%d, OCR fallback: %s)",
             config.RECRUITMENT_ROOT, config.MODEL_NAME, config.MAX_WORKERS,
             "available" if cv_extractor.tesseract_available() else "UNAVAILABLE -- install Tesseract")

    # Catch-up: process whatever is already in the buffers.
    existing = scan_existing_buffer_pdfs()
    if existing:
        log.info("Startup scan found %d unprocessed CV(s) in buffers", len(existing))
        dispatch(existing)

    try:
        while True:
            time.sleep(0.5)
            batch = handler.drain_ready_batch()
            if batch:
                dispatch(batch)
    except KeyboardInterrupt:
        log.info("Stopping watcher...")
    finally:
        observer.stop()
        observer.join()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler(config.AI_ROOT / "pipeline.log", encoding="utf-8"),
        ],
    )
    run_watcher()
