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
"""

import httpx

from core.config import settings

# Minimum frames /face/identify needs to attempt a match (mirrors api.py's check).
_MIN_FRAMES = 5
_TIMEOUT_S = 20.0


def identify_scanned_card(frames):
    """Identify the person in the submitted frames via 8002 /face/identify.

    Returns (card_no, emp_name, reason):
      - (card_no, emp_name, "") when a person is confidently identified.
      - (None, None, reason)    when there aren't enough frames, the service is
                                unreachable, or the face isn't recognized.
    """
    if not frames or len(frames) < _MIN_FRAMES:
        return (None, None, f"too few frames for identification (need >= {_MIN_FRAMES})")

    try:
        resp = httpx.post(
            f"{settings.FACE_SERVICE_URL}/face/identify",
            json={"frames": frames},
            timeout=_TIMEOUT_S,
        )
        resp.raise_for_status()
        body = resp.json().get("body", {})
    except Exception as e:
        print(f"[FACE_GUARD] identify call failed: {e}")
        return (None, None, "face service unavailable")

    if not body.get("identified"):
        return (None, None, body.get("message") or "face not recognized")

    return (body.get("card_no"), body.get("emp_name"), "")
