"""Location tracking router — /auth/location/* endpoints."""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from models.location_models import LocationBatchRequest
from routers.hrms_router import require_hr_admin, _get_admin_rights, _resolve_filter_lists
from services.location_service import (
    fetch_all_locations_summary,
    fetch_location_history,
    save_location_batch,
    fetch_location_trail_report,
    fetch_location_summary_report,
)


def _csv_list(v):
    """Split a comma-separated query param into a clean list, or None."""
    if not v:
        return None
    items = [x.strip() for x in str(v).split(",") if x.strip()]
    return items or None

router = APIRouter(prefix="/auth", tags=["Location Tracking"])


@router.post("/location/batch")
def post_location_batch(request: LocationBatchRequest):
    """Receive a batch of offline-buffered location points from the mobile app."""
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
