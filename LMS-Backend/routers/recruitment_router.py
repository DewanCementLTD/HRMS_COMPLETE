"""Recruitment router — /recruitment/* endpoints.

All endpoints require HR_ADMIN access via admin_card_no query param.
"""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from core.dependencies import require_hr_admin
from routers.hrms_router import _resolve_filter_lists, _get_admin_rights
from models.recruitment_models import (
    JobCreateRequest, JobUpdateRequest,
    ApplicationCreateRequest, ApplicationStatusUpdate,
    InterviewCreateRequest, InterviewUpdateRequest,
    OfferCreateRequest, OfferUpdateRequest,
)
from services.recruitment_service import (
    svc_create_job, svc_list_jobs, svc_get_job, svc_update_job,
    svc_create_application, svc_list_applications, svc_get_application, svc_update_application_status,
    svc_create_interview, svc_list_interviews, svc_update_interview,
    svc_create_offer, svc_list_offers, svc_update_offer,
    svc_get_analytics,
)

router = APIRouter(prefix="/recruitment", tags=["Recruitment"])


# ===================================
# JOBS
# ===================================

@router.get("/jobs")
def list_jobs(
    admin_card_no: str = Query(...),
    status: str = Query(None, description="OPEN / CLOSED / ON_HOLD"),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    require_hr_admin(admin_card_no)
    # Scope to the admin's company/branch (no-op until RECRUITMENT_JOBS has the columns).
    final_c, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
    return {"items": svc_list_jobs(status, compc=final_c, brnch=final_b)}


@router.post("/jobs")
def create_job(
    request: JobCreateRequest,
    admin_card_no: str = Query(...),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    require_hr_admin(admin_card_no)
    if not request.job_title or not request.job_title.strip():
        raise HTTPException(status_code=400, detail="Job title is required")

    rights = _get_admin_rights(admin_card_no)
    allowed_c = rights.get("allowed_companies") or []
    allowed_b = rights.get("allowed_branches") or []

    # Company: stamp the admin's selected company (validated), else their first.
    comp = compc if (compc and (not allowed_c or compc in allowed_c)) else (allowed_c[0] if allowed_c else None)
    # Branch: stamp only when a specific branch is selected; under "All Branches"
    # leave NULL so the job is company-wide (visible in every branch).
    brn = brnch if (brnch and (not allowed_b or brnch in allowed_b)) else None

    result = svc_create_job(request.model_dump(), created_by=admin_card_no, compc=comp, brnch=brn)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return {"status": "success", "message": "Job created successfully"}


@router.get("/jobs/{job_id}")
def get_job(job_id: int, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    job = svc_get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.put("/jobs/{job_id}")
def update_job(
    job_id: int,
    request: JobUpdateRequest,
    admin_card_no: str = Query(...),
):
    require_hr_admin(admin_card_no)
    result = svc_update_job(job_id, request.model_dump(exclude_none=True))
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return {"status": "success", "message": "Job updated successfully"}


# ===================================
# APPLICATIONS
# ===================================

@router.get("/applications")
def list_applications(
    admin_card_no: str = Query(...),
    job_id: int = Query(None),
    status: str = Query(None),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    require_hr_admin(admin_card_no)
    final_c, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
    return {"items": svc_list_applications(job_id, status, compc=final_c, brnch=final_b)}


@router.post("/applications")
def create_application(
    request: ApplicationCreateRequest,
    admin_card_no: str = Query(...),
):
    require_hr_admin(admin_card_no)
    if not request.candidate_name or not request.candidate_name.strip():
        raise HTTPException(status_code=400, detail="Candidate name is required")
    result = svc_create_application(request.model_dump())
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return {"status": "success", "message": "Application added successfully"}


@router.get("/applications/{app_id}")
def get_application(app_id: int, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    app = svc_get_application(app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    return app


@router.patch("/applications/{app_id}/status")
def update_application_status(
    app_id: int,
    request: ApplicationStatusUpdate,
    admin_card_no: str = Query(...),
):
    require_hr_admin(admin_card_no)
    valid = {"PENDING", "SHORTLISTED", "REJECTED"}
    if request.status.upper() not in valid:
        raise HTTPException(status_code=400, detail=f"Status must be one of {valid}")
    result = svc_update_application_status(app_id, request.status.upper(), request.notes)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return {"status": "success", "message": "Status updated"}


# ===================================
# INTERVIEWS
# ===================================

@router.get("/interviews")
def list_interviews(
    admin_card_no: str = Query(...),
    app_id: int = Query(None),
    status: str = Query(None),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    require_hr_admin(admin_card_no)
    final_c, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
    return {"items": svc_list_interviews(app_id, status, compc=final_c, brnch=final_b)}


@router.post("/interviews")
def create_interview(
    request: InterviewCreateRequest,
    admin_card_no: str = Query(...),
):
    require_hr_admin(admin_card_no)
    result = svc_create_interview(request.model_dump())
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return {"status": "success", "message": "Interview scheduled"}


@router.patch("/interviews/{interview_id}")
def update_interview(
    interview_id: int,
    request: InterviewUpdateRequest,
    admin_card_no: str = Query(...),
):
    require_hr_admin(admin_card_no)
    result = svc_update_interview(interview_id, request.model_dump(exclude_none=True))
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return {"status": "success", "message": "Interview updated"}


# ===================================
# OFFERS
# ===================================

@router.get("/offers")
def list_offers(
    admin_card_no: str = Query(...),
    status: str = Query(None),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    require_hr_admin(admin_card_no)
    final_c, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
    return {"items": svc_list_offers(status, compc=final_c, brnch=final_b)}


@router.post("/offers")
def create_offer(
    request: OfferCreateRequest,
    admin_card_no: str = Query(...),
):
    require_hr_admin(admin_card_no)
    result = svc_create_offer(request.model_dump())
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return {"status": "success", "message": "Offer created"}


@router.patch("/offers/{offer_id}")
def update_offer(
    offer_id: int,
    request: OfferUpdateRequest,
    admin_card_no: str = Query(...),
):
    require_hr_admin(admin_card_no)
    result = svc_update_offer(offer_id, request.model_dump(exclude_none=True))
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return {"status": "success", "message": "Offer updated"}


# ===================================
# ANALYTICS
# ===================================

@router.get("/analytics")
def analytics(
    admin_card_no: str = Query(...),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    require_hr_admin(admin_card_no)
    final_c, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
    return svc_get_analytics(compc=final_c, brnch=final_b)
