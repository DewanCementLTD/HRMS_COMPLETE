"""Server-side face guard for attendance marking.

The main backend's /auth/attendance/face used to mark whatever card_no it was
handed and never looked at the face. In the kiosk ("mark attendance outside the
app") flow the app may pre-fill a previously-logged-in card, so a different
person scanning their face got the wrong person marked.

Rule (user, 2026-07-21): the FACE is the source of truth — mark whoever was just
scanned, not whatever card the client sent. So this helper asks the 8002 face
service to IDENTIFY the person from the submitted frames (1:N), and the caller
marks that identified card, ignoring the client-supplied card_no.

Fail-closed: if the face service is unreachable/errors, or the face can't be
identified with confidence, no one is marked (the mark is rejected and can be
retried) rather than falling back to the untrusted client card.

All rejection reasons are logged to LMS-Backend/logs/attendance_errors.log
(2026-08-06: previously these only went to console print(), so a rejected
face-mark — "I marked it but nothing shows" — left no durable trace to
diagnose afterward).
"""

import logging
import os

import httpx

from core.config import settings

# Minimum frames /face/identify needs to attempt a match (mirrors api.py's check).
_MIN_FRAMES = 5
_TIMEOUT_S = 20.0

# Shared with repositories/attendance_repository.py's logger (same file, same
# format) so every attendance failure — DB or face-guard — lands in one place.
_log_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs")
os.makedirs(_log_dir, exist_ok=True)
_logger = logging.getLogger("attendance")
if not _logger.handlers:
    _fh = logging.FileHandler(os.path.join(_log_dir, "attendance_errors.log"), encoding="utf-8")
    _fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    _logger.addHandler(_fh)
    _logger.setLevel(logging.ERROR)


def identify_scanned_card(frames, submitted_card=None):
    """Identify the person in the submitted frames via 8002 /face/identify.

    Returns (card_no, emp_name, reason):
      - (card_no, emp_name, "") when a person is confidently identified.
      - (None, None, reason)    when there aren't enough frames, the service is
                                unreachable, or the face isn't recognized.

    Every rejection is logged to attendance_errors.log (with the confidence
    score when the face service supplied one) so a "marked but not showing"
    report can be traced back to why the mark was actually rejected.
    """
    if not frames or len(frames) < _MIN_FRAMES:
        reason = f"too few frames for identification (need >= {_MIN_FRAMES}, got {len(frames or [])})"
        _logger.error(f"[FACE_GUARD] submitted_card={submitted_card}: {reason}")
        return (None, None, reason)

    try:
        resp = httpx.post(
            f"{settings.FACE_SERVICE_URL}/face/identify",
            json={"frames": frames},
            timeout=_TIMEOUT_S,
        )
        resp.raise_for_status()
        body = resp.json().get("body", {})
    except Exception as e:
        _logger.error(f"[FACE_GUARD] submitted_card={submitted_card}: identify call failed: {e}")
        return (None, None, "face service unavailable")

    if not body.get("identified"):
        reason = body.get("message") or "face not recognized"
        confidence = body.get("confidence")
        _logger.error(f"[FACE_GUARD] submitted_card={submitted_card}: rejected "
                       f"({reason}, confidence={confidence})")
        return (None, None, reason)

    return (body.get("card_no"), body.get("emp_name"), "")
