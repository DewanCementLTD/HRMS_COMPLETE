"""Attendance router — uses prefix="/auth" to keep Flutter URLs intact.

IMPORTANT: /attendance/face and /attendance/summary must be defined
BEFORE /attendance/{card_no} to avoid the path parameter catching them.
"""

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

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
from services.face_verification_service import identify_scanned_card
from repositories.app_version_repository import force_update_block
from repositories.user_repository import lookup_by_phone

router = APIRouter(prefix="/auth", tags=["Attendance"])


# POST /auth/attendance/face  — MUST be before /{card_no}
@router.post("/attendance/face")
def mark_face_attendance(request: FaceAttendanceRequest):
    # Block attendance from app versions below the required minimum. Only fires
    # when the client sends a too-old version — web/version-less callers pass.
    blk = force_update_block(request.app_version, request.app_build, "ANDROID")
    if blk:
        raise HTTPException(
            status_code=426,
            detail={"code": "FORCE_UPDATE", "message": blk[0], "update_url": blk[1]},
        )

    # Face guard: the FACE is the source of truth — mark whoever was actually
    # scanned, not whatever card the client sent (the kiosk flow can pre-fill a
    # previously-logged-in card). When the app sends the scanned frames, ask the
    # 8002 face service to identify the person and mark THAT card, overriding the
    # submitted card_no. If the face can't be confidently identified, mark no one.
    # Frames are optional for now so older app builds still work (unverified);
    # once the frame-sending app ships, this becomes the only accepted path.
    card_to_mark = request.card_no
    scanned_name = None
    if request.frames:
        scanned_card, scanned_name, reason = identify_scanned_card(request.frames)
        if not scanned_card:
            print(f"[FACE_GUARD] no confident identity for face-mark "
                  f"(submitted card={request.card_no}): {reason}")
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "FACE_NOT_RECOGNIZED",
                    "message": "Face not recognized. Attendance not marked.",
                },
            )
        if scanned_card != request.card_no:
            print(f"[FACE_GUARD] overriding submitted card={request.card_no} with "
                  f"scanned identity={scanned_card} ({scanned_name})")
        card_to_mark = scanned_card
    else:
        print(f"[FACE_GUARD] UNVERIFIED face-mark for card={request.card_no} "
              f"(no frames sent by app version={request.app_version})")

    result = smart_mark_attendance(
        card_no=card_to_mark,
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
            # Who was actually marked — the scanned/identified person, which may
            # differ from the card the client sent. Lets the kiosk show the right
            # name instead of the pre-filled one.
            "card_no": card_to_mark,
            "marked_for": scanned_name,
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


# GET /auth/attendance/report-pdf/{card_no}?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
# Same data as report-range above, rendered as a PDF the app can open/share.
@router.get("/attendance/report-pdf/{card_no}")
def attendance_report_pdf(
    card_no: str,
    from_date: str = Query(..., description="YYYY-MM-DD"),
    to_date: str = Query(..., description="YYYY-MM-DD"),
):
    for label, value in (("from_date", from_date), ("to_date", to_date)):
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400,
                                detail=f"{label} must be in YYYY-MM-DD format")
    if from_date > to_date:
        raise HTTPException(status_code=400, detail="from_date must not be after to_date")

    try:
        rows = fetch_attendance_report_range(card_no, from_date, to_date)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Employee name for the header (best-effort — never fail the report over it).
    emp_name, found = "", None
    try:
        found = lookup_by_phone(card_no)
        if found:
            emp_name = found.get("emp_name") or ""
    except Exception as e:
        print(f"[REPORT_PDF] name lookup failed for card={card_no}: {e}")

    # Unknown card = no roster rows AND no employee record. A real employee with
    # simply no attendance in the range still gets a (empty) report, not a 404.
    if not rows and not found:
        raise HTTPException(status_code=404, detail="Card not found")

    # Imported lazily: reportlab is only needed for this one endpoint, and the
    # backend has been started under more than one interpreter — a module-level
    # import would take the WHOLE app down if reportlab were missing from the one
    # in use. This way only the PDF route degrades.
    try:
        from services.attendance_pdf_service import build_attendance_pdf
    except ImportError as e:
        print(f"[REPORT_PDF] PDF library unavailable: {e}")
        raise HTTPException(
            status_code=503,
            detail="PDF generation is unavailable on the server (reportlab not installed)",
        )

    pdf_bytes = build_attendance_pdf(card_no, emp_name, from_date, to_date, rows)
    filename = f"attendance_{card_no}_{from_date}_to_{to_date}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
            "Cache-Control": "no-cache",
        },
    )


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
