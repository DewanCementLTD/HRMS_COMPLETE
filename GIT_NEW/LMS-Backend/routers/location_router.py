"""Location tracking router — /auth/location/* endpoints."""

import logging
import os

from fastapi import APIRouter, Header, HTTPException, Query
from typing import Optional

from core.config import settings
from core.tokens import decode_token, extract_bearer_token
from models.location_models import LocationBatchRequest
from routers.hrms_router import require_hr_admin, _get_admin_rights, _resolve_filter_lists
from services.location_service import (
    fetch_all_locations_summary,
    fetch_location_history,
    save_location_batch,
    fetch_location_trail_report,
    fetch_location_summary_report,
)

# Same logs/ dir and format as attendance's logger (routers/attendance_router.py,
# services/face_verification_service.py) so auth failures land alongside the
# other attendance/location audit trail instead of only console print().
_log_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs")
os.makedirs(_log_dir, exist_ok=True)
_logger = logging.getLogger("location_auth")
if not _logger.handlers:
    _fh = logging.FileHandler(os.path.join(_log_dir, "attendance_errors.log"), encoding="utf-8")
    _fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    _logger.addHandler(_fh)
    _logger.setLevel(logging.WARNING)


def _csv_list(v):
    """Split a comma-separated query param into a clean list, or None."""
    if not v:
        return None
    items = [x.strip() for x in str(v).split(",") if x.strip()]
    return items or None

router = APIRouter(prefix="/auth", tags=["Location Tracking"])


@router.post("/location/batch")
def post_location_batch(
    request: LocationBatchRequest,
    authorization: Optional[str] = Header(None),
):
    """Receive a batch of offline-buffered location points from the mobile app.

    2026-09-22: previously accepted with no Authorization header at all, so
    anyone could write location history for any card_no. Now requires a valid
    session token (core/tokens.py, issued by /auth/login) to prove the caller
    is *some* logged-in session — NOT that the token's card_no matches
    request.card_no. On a shared phone the app legitimately uploads a
    previous employee's buffered points under that employee's card while a
    different person is currently logged in, so that mismatch is expected and
    must keep working.

    Rollout (settings.LOCATION_BATCH_ENFORCE_TOKEN, .env, no redeploy needed):
      - False (current default): missing/invalid tokens are only logged, so
        older app builds that don't send one yet keep uploading normally.
      - True: missing/invalid tokens are rejected with 401. The app keeps the
        points locally and retries later, so nothing is lost — flip this on
        only after the token-sending app build has had a few days to roll out.
    """
    token = extract_bearer_token(authorization)
    payload = decode_token(token) if token else None
    if not payload:
        reason = "missing Authorization header" if not authorization else (
            "malformed Authorization header" if not token else "invalid/expired token"
        )
        _logger.warning(
            f"[LOCATION_AUTH] card_no={request.card_no}: {reason} "
            f"(enforce={settings.LOCATION_BATCH_ENFORCE_TOKEN})"
        )
        if settings.LOCATION_BATCH_ENFORCE_TOKEN:
            raise HTTPException(status_code=401, detail="Login required")

    try:
        result = save_location_batch(request.card_no, request.locations)
        return {"body": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/location/summary")
def get_location_summary(
    date: str = Query(..., description="YYYY-MM-DD"),
    admin_card_no: str = Query(...),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    """HR-only: all employees with location data for a given date.
    Always enforces the admin's company/branch rights server-side.
    """
    require_hr_admin(admin_card_no)
    try:
        # Server-side enforcement: resolve admin's actual allowed companies/branches.
        # The UI may send compc/brnch hints, but the backend always intersects with
        # the admin's SEC_USERCMPN / SEC_USERBRCH rights.
        final_c, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
        summary = fetch_all_locations_summary(date, allowed_companies=final_c, allowed_branches=final_b)
        return {"body": {"date": date, "employees": summary}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/location/history/{card_no}")
def get_location_history(
    card_no: str,
    date: str = Query(..., description="YYYY-MM-DD"),
    admin_card_no: str = Query(...),
):
    """HR-only: all location points for one employee on a given date."""
    require_hr_admin(admin_card_no)
    try:
        points = fetch_location_history(card_no, date)
        return {"body": {"card_no": card_no, "date": date, "points": points}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/location/report/trail")
def get_location_trail_report_api(
    from_date: str = Query(..., description="YYYY-MM-DD"),
    to_date: str = Query(..., description="YYYY-MM-DD"),
    admin_card_no: str = Query(...),
    compc: Optional[str] = Query(None, description="Selected company (UNIT_ID)"),
    brnch: Optional[str] = Query(None, description="Selected branch (LOCATION)"),
    dept_no: Optional[str] = Query(None, description="Comma-separated department numbers"),
    desg_cd: Optional[str] = Query(None, description="Comma-separated designation codes"),
    empcodes: Optional[str] = Query(None, description="Comma-separated employee codes"),
    region: Optional[str] = Query(None, description="Comma-separated region codes"),
    category: Optional[str] = Query(None, description="Comma-separated employee categories"),
):
    """Feature 1 — employee-wise GPS trail (one row per point) for a date range.
    Company/branch are always intersected with the admin's rights server-side."""
    require_hr_admin(admin_card_no)
    try:
        final_c, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
        items = fetch_location_trail_report(
            from_date, to_date,
            allowed_companies=final_c, allowed_branches=final_b,
            dept_no=_csv_list(dept_no), desg_cd=_csv_list(desg_cd),
            empcodes=_csv_list(empcodes),
            region=_csv_list(region), category=_csv_list(category),
        )
        return {"items": items, "from_date": from_date, "to_date": to_date}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/location/report/summary")
def get_location_summary_report_api(
    from_date: str = Query(..., description="YYYY-MM-DD"),
    to_date: str = Query(..., description="YYYY-MM-DD"),
    admin_card_no: str = Query(...),
    compc: Optional[str] = Query(None, description="Selected company (UNIT_ID)"),
    brnch: Optional[str] = Query(None, description="Selected branch (LOCATION)"),
    dept_no: Optional[str] = Query(None, description="Comma-separated department numbers"),
    desg_cd: Optional[str] = Query(None, description="Comma-separated designation codes"),
    empcodes: Optional[str] = Query(None, description="Comma-separated employee codes"),
    region: Optional[str] = Query(None, description="Comma-separated region codes"),
    category: Optional[str] = Query(None, description="Comma-separated employee categories"),
):
    """Feature 2 — per-employee-per-day tracking summary for a date range."""
    require_hr_admin(admin_card_no)
    try:
        final_c, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
        items = fetch_location_summary_report(
            from_date, to_date,
            allowed_companies=final_c, allowed_branches=final_b,
            dept_no=_csv_list(dept_no), desg_cd=_csv_list(desg_cd),
            empcodes=_csv_list(empcodes),
            region=_csv_list(region), category=_csv_list(category),
        )
        return {"items": items, "from_date": from_date, "to_date": to_date}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
