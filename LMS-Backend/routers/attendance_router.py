"""Attendance router — uses prefix="/auth" to keep Flutter URLs intact.

IMPORTANT: /attendance/face and /attendance/summary must be defined
BEFORE /attendance/{card_no} to avoid the path parameter catching them.
"""

from fastapi import APIRouter, HTTPException, Query

from models.attendance_models import (
    AttendanceRequest,
    AttendanceResponse,
    FaceAttendanceRequest,
)
from services.attendance_service import (
    smart_mark_attendance,
    fetch_attendance_report,
    fetch_attendance_report_range,
    fetch_attendance_summary,
)

router = APIRouter(prefix="/auth", tags=["Attendance"])


# POST /auth/attendance/face  — MUST be before /{card_no}
@router.post("/attendance/face")
def mark_face_attendance(request: FaceAttendanceRequest):
    result = smart_mark_attendance(
        card_no=request.card_no,
        attendance_type=request.attendance_type,
        latitude=request.latitude,
        longitude=request.longitude,
        accuracy=request.accuracy,
        address=request.address,
        formatted_address=request.formatted_address,
        timestamp=request.timestamp,
        device_id=request.device_id,
        device_model=request.device_model,
        app_version=request.app_version,
    )
    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return {
        "body": {
            "attendance_id": "",
            "marked_at": result.get("marked_at"),
            "location_verified": result.get("location_verified", False),
            "message": result.get("message", "Attendance marked successfully"),
        }
    }


# GET /auth/attendance/summary — MUST be before /{card_no}
@router.get("/attendance/summary")
def attendance_summary(
    emp_pk: str = Query(...),
    from_date: str = Query(...),
    to_date: str = Query(...),
):
    try:
        data = fetch_attendance_summary(emp_pk, from_date, to_date)
        return {"body": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# GET /auth/attendance/report/{card_no}?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
# MUST be before /{card_no}/{date_str} to avoid path parameter catch
@router.get("/attendance/report-range/{card_no}")
def attendance_report_range(
    card_no: str,
    from_date: str = Query(...),
    to_date: str = Query(...),
):
    try:
        items = fetch_attendance_report_range(card_no, from_date, to_date)
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# GET /auth/attendance/report/{card_no}/{date_str}
@router.get("/attendance/report/{card_no}/{date_str}")
def attendance_report(card_no: str, date_str: str):
    try:
        items = fetch_attendance_report(card_no, date_str)
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# POST /auth/attendance/{card_no} — catch-all LAST
@router.post("/attendance/{card_no}", response_model=AttendanceResponse)
def mark_attendance(card_no: str, request: AttendanceRequest):
    result = smart_mark_attendance(
        card_no=card_no,
        attendance_type="check_in",
        latitude=request.latitude,
        longitude=request.longitude,
    )
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return AttendanceResponse(status=result["status"], message=result["message"])
