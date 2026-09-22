"""Minimal HS256 JWT-style session token — issuance and verification.

Stdlib only (hmac/hashlib/base64/json), so rolling this out needs no new pip
dependency and no venv change on the server.

Added 2026-09-22 to gate POST /auth/location/batch, which previously accepted
uploads with no Authorization header at all (anyone could write location
history for any card_no). /auth/login now issues one of these tokens; the
location-batch endpoint requires a syntactically valid, correctly-signed,
unexpired one (see routers/location_router.py for the phased rollout).

Deliberately NOT tied to a specific card_no match anywhere it's checked: on a
shared phone the app can upload a previous employee's buffered points under
that employee's card while a different person is now logged in. The token
only proves "this came from a logged-in session", not "session owner ==
card_no in the payload".
"""

import base64
import hashlib
import hmac
import json
import time
from typing import Optional

from core.config import settings

_ALG = "HS256"
_TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60  # 180 days — the app has no logout/refresh flow today


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _secret() -> bytes:
    key = settings.JWT_SECRET_KEY
    if not key:
        # Falls back to a fixed, obviously-labeled placeholder rather than
        # refusing to start — tokens signed with it verify fine against each
        # other, but anyone reading this source could forge one. Set
        # JWT_SECRET_KEY in .env before turning on LOCATION_BATCH_ENFORCE_TOKEN.
        key = "INSECURE-DEV-ONLY-SET-JWT_SECRET_KEY-IN-ENV"
    return key.encode("utf-8")


def issue_token(card_no: str) -> str:
    """Issue a signed session token for card_no, valid for _TOKEN_TTL_SECONDS."""
    now = int(time.time())
    header = {"alg": _ALG, "typ": "JWT"}
    payload = {"card_no": card_no, "iat": now, "exp": now + _TOKEN_TTL_SECONDS}
    h = _b64url_encode(json.dumps(header, separators=(",", ":")).encode())
    p = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    signing_input = f"{h}.{p}".encode()
    sig = hmac.new(_secret(), signing_input, hashlib.sha256).digest()
    return f"{h}.{p}.{_b64url_encode(sig)}"


def decode_token(token: str) -> Optional[dict]:
    """Verify signature + expiry. Returns the payload dict, or None if the
    token is missing, malformed, tampered with, or expired."""
    if not token:
        return None
    try:
        h, p, s = token.split(".")
    except ValueError:
        return None
    signing_input = f"{h}.{p}".encode()
    expected_sig = hmac.new(_secret(), signing_input, hashlib.sha256).digest()
    try:
        actual_sig = _b64url_decode(s)
    except Exception:
        return None
    if not hmac.compare_digest(expected_sig, actual_sig):
        return None
    try:
        payload = json.loads(_b64url_decode(p))
    except Exception:
        return None
    if payload.get("exp", 0) < int(time.time()):
        return None
    return payload


def extract_bearer_token(auth_header: Optional[str]) -> Optional[str]:
    """Pull the token out of an 'Authorization: Bearer <token>' header value."""
    if not auth_header:
        return None
    parts = auth_header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None
