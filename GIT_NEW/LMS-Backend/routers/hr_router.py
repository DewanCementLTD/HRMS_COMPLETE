"""HR admin router — /hr/* endpoints (RBAC-gated)."""

from fastapi import APIRouter, HTTPException, Query

from core.dependencies import require_hr_admin
from models.hr_models import HRFaceEnrollRequest
from services.hr_service import search_employees, hr_enroll_face

router = APIRouter(prefix="/hr", tags=["HR Admin"])


@router.get("/employees/search")
def hr_search_employees(
    q: str = Query(..., min_length=1, description="Search term"),
    admin_card_no: str = Query(..., description="Card no of requesting HR admin"),
):
    require_hr_admin(admin_card_no)
    results = search_employees(q)
    items = [
        {
            "card_no": str(r.get("card_no", "")),
            "emp_name": r.get("emp_name", ""),
            "department": r.get("department"),
            "designation": r.get("designation"),
            "face_registered": (r.get("face_registered", "N") == "Y"),
            "mobile_no": r.get("mobile_no"),
            "empcode": r.get("empcode"),
        }
        for r in results
    ]
    return {"items": items}


@router.post("/face/enroll")
def hr_enroll_employee_face(
    request: HRFaceEnrollRequest,
    admin_card_no: str = Query(..., description="Card no of requesting HR admin"),
):
    require_hr_admin(admin_card_no)

    if len(request.frames) < 10:
        raise HTTPException(status_code=400, detail="Minimum 10 frames required")

    result = hr_enroll_face(request.card_no, request.frames, request.created_at)
    return {"body": result}
