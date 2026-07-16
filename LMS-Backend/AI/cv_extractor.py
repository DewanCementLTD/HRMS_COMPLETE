"""
CV text extraction: text-first, OCR-fallback.

Strategy:
  1. Try direct text extraction with PyMuPDF (fitz) -- fast, free, no OCR needed.
  2. If a page has little/no extractable text (i.e. it's a scanned image),
     fall back to Tesseract OCR by rasterizing that page to an image.
  3. Parse the extracted text into structured sections (Education, Experience,
     Skills, Summary, ...) and detect the candidate's preferred job title.

OCR only runs on the minority of pages that are actually scanned images,
saving huge amounts of compute vs. running every CV through OCR.
"""

from __future__ import annotations

import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf  # PyMuPDF

import config

# ---------------------------------------------------------------------------
# Tesseract availability (checked once at import)
# ---------------------------------------------------------------------------
_TESSERACT_AVAILABLE = False
try:
    import pytesseract
    from PIL import Image

    if shutil.which("tesseract"):
        _TESSERACT_AVAILABLE = True
    elif Path(config.TESSERACT_CMD).is_file():
        pytesseract.pytesseract.tesseract_cmd = config.TESSERACT_CMD
        _TESSERACT_AVAILABLE = True
except ImportError:
    pass


def tesseract_available() -> bool:
    return _TESSERACT_AVAILABLE


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------
@dataclass
class ExtractionResult:
    text: str
    method: str                 # "text" | "ocr" | "mixed" | "text (ocr unavailable)"
    page_count: int
    ocr_pages: list[int] = field(default_factory=list)   # 1-based page numbers OCR'd
    sections: dict[str, str] = field(default_factory=dict)
    detected_job_title: str | None = None


def _ocr_page(page: "pymupdf.Page") -> str:
    pix = page.get_pixmap(dpi=config.OCR_DPI)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    return pytesseract.image_to_string(img, lang=config.OCR_LANG)


def extract_text(pdf_path: str | Path) -> ExtractionResult:
    """Extract full text from a CV PDF using the text-first, OCR-fallback strategy."""
    pdf_path = Path(pdf_path)
    page_texts: list[str] = []
    ocr_pages: list[int] = []
    ocr_unavailable_pages = 0

    with pymupdf.open(pdf_path) as doc:
        page_count = len(doc)
        for i, page in enumerate(doc):
            text = page.get_text("text").strip()
            if len(text) < config.MIN_CHARS_PER_PAGE:
                # Looks like a scanned page -> OCR fallback.
                if _TESSERACT_AVAILABLE:
                    text = _ocr_page(page).strip()
                    ocr_pages.append(i + 1)
                else:
                    ocr_unavailable_pages += 1
            page_texts.append(text)

    if not ocr_pages:
        method = "text" if not ocr_unavailable_pages else "text (ocr unavailable)"
    elif len(ocr_pages) == page_count:
        method = "ocr"
    else:
        method = "mixed"

    full_text = "\n\n".join(t for t in page_texts if t)
    result = ExtractionResult(
        text=full_text, method=method, page_count=page_count, ocr_pages=ocr_pages
    )
    result.sections = parse_sections(full_text)
    result.detected_job_title = detect_job_title(full_text, result.sections)
    return result


# ---------------------------------------------------------------------------
# Section parsing
# ---------------------------------------------------------------------------
# Canonical section -> heading keywords (matched against short standalone lines).
_SECTION_KEYWORDS: dict[str, list[str]] = {
    "summary": ["summary", "objective", "profile", "about me", "career objective"],
    "education": ["education", "academic", "qualifications"],
    "experience": ["experience", "employment", "work history", "internship", "internships"],
    "skills": ["skills", "technologies", "technical skills", "competencies", "tools"],
    "projects": ["projects", "personal projects", "academic projects"],
    "certifications": ["certifications", "certificates", "courses", "training"],
    "achievements": ["achievements", "awards", "honors", "accomplishments"],
    "languages": ["languages"],
    "references": ["references", "referees"],
}


def _match_heading(line: str) -> str | None:
    """Return the canonical section name if the line looks like a section heading."""
    stripped = line.strip().strip(":").strip()
    if not stripped or len(stripped) > 40:
        return None
    lowered = stripped.lower()
    for canonical, keywords in _SECTION_KEYWORDS.items():
        for kw in keywords:
            if lowered == kw or (lowered.startswith(kw) and len(lowered) <= len(kw) + 12):
                # Headings are typically standalone / mostly uppercase / short.
                letters = [c for c in stripped if c.isalpha()]
                upper_ratio = sum(c.isupper() for c in letters) / max(len(letters), 1)
                if upper_ratio > 0.5 or len(stripped.split()) <= 4:
                    return canonical
    return None


def parse_sections(text: str) -> dict[str, str]:
    """Split raw CV text into sections keyed by canonical heading names.

    Text before the first recognized heading is stored under "header"
    (usually name + contact details).
    """
    sections: dict[str, list[str]] = {}
    current = "header"
    for line in text.splitlines():
        heading = _match_heading(line)
        if heading:
            current = heading
            sections.setdefault(current, [])
        else:
            sections.setdefault(current, []).append(line)
    return {
        name: "\n".join(lines).strip()
        for name, lines in sections.items()
        if "\n".join(lines).strip()
    }


# ---------------------------------------------------------------------------
# Preferred job title detection
# ---------------------------------------------------------------------------
_TITLE_WORDS = (
    r"(?:engineer|developer|programmer|scientist|analyst|manager|consultant|"
    r"architect|designer|administrator|specialist|technician|accountant|"
    r"officer|executive|lead|intern|teacher|writer|marketer|recruiter)"
)
_TITLE_RE = re.compile(
    rf"\b((?:[A-Z][\w+#./-]*\s+){{0,3}}{_TITLE_WORDS})\b", re.IGNORECASE
)
_SEEKING_RE = re.compile(
    rf"(?:seeking|pursuing|looking for|aspiring|position as|role as|as an?|apply(?:ing)? for)\s+"
    rf"(?:an?\s+)?((?:[\w+#./-]+\s+){{0,3}}{_TITLE_WORDS})\b",
    re.IGNORECASE,
)


def detect_job_title(text: str, sections: dict[str, str]) -> str | None:
    """Best-effort guess of the candidate's preferred/target job title.

    Order of preference:
      1. An explicit statement in the summary/objective ("seeking a ... role").
      2. A title-like line near the top of the CV (usually under the name).
    """
    summary = sections.get("summary", "")
    m = _SEEKING_RE.search(summary) or _SEEKING_RE.search(text[:1500])
    if m:
        return " ".join(m.group(1).split()).title()

    header = sections.get("header", text[:600])
    for line in header.splitlines()[:10]:
        line = line.strip()
        if not line or "@" in line or any(ch.isdigit() for ch in line):
            continue  # skip contact lines
        m = _TITLE_RE.fullmatch(line) or _TITLE_RE.match(line)
        if m and len(line) <= 60:
            return " ".join(m.group(1).split()).title()
    return None
