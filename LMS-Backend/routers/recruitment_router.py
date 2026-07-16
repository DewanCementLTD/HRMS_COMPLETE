"""Recruitment router — /recruitment/* endpoints.

All endpoints require HR_ADMIN access via admin_card_no query param.

Talent Pool: candidates are permanent, deduplicated profiles (one person = one
row). CVs are stored on disk under EMP_DOCS/RECRUITMENT_CVS and only the path
is kept in RECRUITMENT_CANDIDATES. Applications link candidate → job.
"""

import os
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse

from core.dependencies import require_hr_admin
from routers.hrms_router import _resolve_filter_lists, _get_admin_rights
from repositories.document_repository import DOCS_BASE
from models.recruitment_models import (
    JobCreateRequest, JobUpdateRequest,
    ApplicationCreateRequest, ApplicationStatusUpdate,
    InterviewCreateRequest, InterviewUpdateRequest,
    OfferCreateRequest, OfferUpdateRequest,
    CandidateCreateRequest, CandidateUpdateRequest, CandidateApplyRequest,
    PanelPoolAddRequest, PanelPoolDeactivateRequest,
    InterviewAssignmentCreateRequest,
    NotificationSelectionsCreateRequest,
)
from services.recruitment_service import (
    svc_create_job, svc_list_jobs, svc_get_job, svc_update_job,
    svc_create_application, svc_list_applications, svc_get_application, svc_update_application_status,
    svc_create_interview, svc_list_interviews, svc_update_interview,
    svc_create_offer, svc_list_offers, svc_update_offer,
    svc_get_analytics,
    svc_create_candidate, svc_list_candidates, svc_get_candidate, svc_update_candidate,
    svc_set_candidate_cv, svc_get_candidate_cv_path, svc_apply_candidate,
    svc_candidate_in_scope, svc_candidate_cv_target,
    svc_get_application_evaluation, svc_match_candidates_for_job, svc_get_job_scope,
    svc_rank_job_applicants, svc_job_cv_dirs, svc_pool_cv_dirs, svc_cv_status_in_dirs,
    svc_evaluate_application,
    svc_list_panel_pool, svc_add_panel_members, svc_deactivate_panel_row,
    svc_deactivate_panel_member, svc_panel_options_for_app,
    svc_create_interview_assignments, svc_list_interview_assignments,
    svc_list_notification_templates, svc_create_notification_selections,
    svc_list_notification_selections,
)


def _default_top_k() -> int:
    """The AI shortlist size, read from AI/.env (TOP_K) via the shared pipeline
    config so it isn't hardcoded. Falls back to 10 if unavailable."""
    try:
        from services.recruitment_service import _ai_dir_on_path
        _ai_dir_on_path()
        import config as ai_config
        return int(getattr(ai_config, "TOP_K", 10) or 10)
    except Exception:
        return 10

router = APIRouter(prefix="/recruitment", tags=["Recruitment"])

# CV files live next to the employee documents, under each company/branch:
#   EMP_DOCS/<Company>/<Branch>/RECRUITMENT_CVS/cand_{id}.{ext}
CV_ALLOWED_EXT = {"pdf", "doc", "docx", "txt", "rtf"}

# The AI screening pipeline watches the shared employee-documents tree: a PDF
# dropped in EMP_DOCS/<Company>/<Branch?>/RECRUITMENT_CVS/<job_id>/ is picked up
# by the watcher, evaluated and persisted (candidate -> application -> evaluation).
# The upload endpoints below write into that drop folder (via svc_job_cv_dirs) so
# the ONE watcher path handles every CV -- single API uploads and 50+ bulk drops
# alike -- without adding blocking LLM work to the request.
MAX_BULK_CVS = 20


def _safe_cv_filename(name: str) -> str:
    """A collision-resistant, traversal-safe PDF filename for the buffer."""
    import re
    import time
    base = os.path.basename(name or "cv.pdf")
    stem = os.path.splitext(base)[0] or "cv"
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("_") or "cv"
    return f"{stem}_{int(time.time()*1000)}.pdf"


def _require_candidate_access(admin_card_no: str, candidate_id: int,
                              compc: Optional[str], brnch: Optional[str]):
    """404 when the candidate exists but belongs to a company/branch outside the
    admin's (selected) scope — company 1's talent pool is invisible to company 2."""
    final_c, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
    if not svc_candidate_in_scope(candidate_id, compc=final_c, brnch=final_b):
        raise HTTPException(status_code=404, detail="Candidate not found")


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


@router.post("/jobs/{job_id}/match")
def match_candidates(
    job_id: int,
    admin_card_no: str = Query(...),
    top: int = Query(20, ge=1, le=200, description="How many top candidates to return"),
    deep: bool = Query(False, description="Also run the shortlist through the LLM evaluator"),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    """Talent-pool matching (Flow 2): rank ALL candidates in scope against a job.

    Stage 1 (always) is a cheap, no-LLM keyword score (skills + preferred title +
    experience). With deep=true the top-N shortlist is additionally run through the
    same LLM evaluator the watcher uses -- reusing each candidate's stored profile
    as the CV text -- which materialises applications + evaluations and re-ranks by
    the AI overall score."""
    require_hr_admin(admin_card_no)
    final_c, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
    result = svc_match_candidates_for_job(job_id, top=top, deep=deep,
                                          compc=final_c, brnch=final_b)
    if result.get("status") == "error":
        raise HTTPException(status_code=404, detail=result.get("message"))
    return result


@router.get("/jobs/{job_id}/top-candidates")
def top_candidates(
    job_id: int,
    admin_card_no: str = Query(...),
    top_k: Optional[int] = Query(None, ge=1, le=200,
                                 description="How many top applicants to return (default: TOP_K from AI/.env)"),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    """AI shortlist for a job: rank the people who APPLIED to this job by their
    stored AI evaluation score (highest first) and return the top K. Applicants
    not yet evaluated are included as 'Pending' (sorted last). Scoped to the
    job's company/branch."""
    require_hr_admin(admin_card_no)
    k = top_k if top_k is not None else _default_top_k()
    final_c, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
    result = svc_rank_job_applicants(job_id, top_k=k, compc=final_c, brnch=final_b)
    if result.get("status") == "error":
        raise HTTPException(status_code=404, detail=result.get("message"))
    return result


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
    # Talent-Pool flow needs a candidate_id; legacy quick-add needs a name.
    if not request.candidate_id and not (request.candidate_name or "").strip():
        raise HTTPException(status_code=400, detail="Select a candidate (or provide a candidate name)")
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


@router.get("/applications/{app_id}/evaluation")
def get_application_evaluation(app_id: int, admin_card_no: str = Query(...)):
    """The latest AI evaluation for an application: scores, recommendation,
    summary, model/token metadata, plus its strengths and weaknesses."""
    require_hr_admin(admin_card_no)
    app = svc_get_application(app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    ev = svc_get_application_evaluation(app_id)
    if not ev:
        raise HTTPException(status_code=404, detail="This application has not been AI-evaluated yet")
    return ev


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
# INTERVIEW PANEL POOL + INTERVIEWER ASSIGNMENTS
# ===================================
# The pool is per (company, branch): only pool members can be assigned to an
# interview. "All Branches" (no brnch param) fans add/remove out to every
# branch of the company at action time — nothing is stored as branch 'ALL'.

def _panel_scope(admin_card_no: str, compc: Optional[str], brnch: Optional[str]):
    """A specific company (validated against the admin's rights) + the selected
    branch, or None for the 'All Branches' view. 400 when no company resolves —
    pool rows are always stamped with a concrete company."""
    comp, brn = _resolve_admin_scope(admin_card_no, compc, brnch)
    if comp is None:
        raise HTTPException(status_code=400, detail="Select a company first")
    return comp, brn


@router.get("/panel-pool")
def get_panel_pool(
    admin_card_no: str = Query(...),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
    include_inactive: bool = Query(False),
):
    require_hr_admin(admin_card_no)
    comp, brn = _panel_scope(admin_card_no, compc, brnch)
    return svc_list_panel_pool(comp, brn, include_inactive)


@router.post("/panel-pool")
def add_panel_pool_members(
    request: PanelPoolAddRequest,
    admin_card_no: str = Query(...),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    require_hr_admin(admin_card_no)
    comp, brn = _panel_scope(admin_card_no, compc, brnch)
    result = svc_add_panel_members(comp, brn, request.empcodes, added_by=admin_card_no)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return result


@router.delete("/panel-pool/{panel_pool_id}")
def deactivate_panel_pool_row(panel_pool_id: int, admin_card_no: str = Query(...)):
    """Soft-remove a single pool row (IS_ACTIVE='N'); history is preserved."""
    require_hr_admin(admin_card_no)
    result = svc_deactivate_panel_row(panel_pool_id)
    if result["status"] == "error":
        raise HTTPException(status_code=404, detail=result.get("message"))
    return result


@router.post("/panel-pool/deactivate")
def deactivate_panel_pool_member(
    request: PanelPoolDeactivateRequest,
    admin_card_no: str = Query(...),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    """Scope-aware soft removal: with a branch selected only that branch's row;
    in the 'All Branches' view every branch of the company."""
    require_hr_admin(admin_card_no)
    comp, brn = _panel_scope(admin_card_no, compc, brnch)
    result = svc_deactivate_panel_member(comp, brn, request.empcode)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return result


@router.get("/applications/{app_id}/interview-panel-options")
def interview_panel_options(app_id: int, admin_card_no: str = Query(...)):
    """Pool members eligible for this application (its job's company/branch;
    a company-wide job draws from every branch's pool)."""
    require_hr_admin(admin_card_no)
    result = svc_panel_options_for_app(app_id)
    if result.get("status") == "error":
        raise HTTPException(status_code=404, detail=result.get("message"))
    return result


@router.post("/applications/{app_id}/interview-assignments")
def create_interview_assignments(
    app_id: int,
    request: InterviewAssignmentCreateRequest,
    admin_card_no: str = Query(...),
):
    """Save the selected interviewer(s) + interview_type + date/time. One row
    per interviewer; server-side validation rejects non-pool employees (400)
    and date+time clashes with an interviewer's other pending interviews (409)."""
    require_hr_admin(admin_card_no)
    result = svc_create_interview_assignments(
        app_id, request.model_dump(), assigned_by=admin_card_no)
    if result["status"] == "error":
        raise HTTPException(status_code=int(result.get("code") or 400),
                            detail=result.get("message"))
    return result


@router.get("/applications/{app_id}/interview-assignments")
def get_interview_assignments(app_id: int, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    return {"items": svc_list_interview_assignments(app_id)}


# ===================================
# NOTIFICATION TEMPLATES + SELECTIONS
# ===================================
# Templates are stored RAW ({{placeholders}} intact) — resolution/delivery is
# a future phase. The dialog persists which notifications were chosen per
# application; contact info is filled by DB triggers (Python fallback).

@router.get("/notification-templates")
def list_notification_templates(
    admin_card_no: str = Query(...),
    event_type: Optional[str] = Query(None, description="e.g. Interview Scheduled / Shortlisted / Rejected"),
    notification_type: Optional[str] = Query(None, description="EMAIL / WHATSAPP"),
    recipient_type: Optional[str] = Query(None, description="INTERVIEWER / CANDIDATE"),
):
    require_hr_admin(admin_card_no)
    return {"items": svc_list_notification_templates(event_type, notification_type, recipient_type)}


@router.post("/applications/{app_id}/notification-selections")
def create_notification_selections(
    app_id: int,
    request: NotificationSelectionsCreateRequest,
    admin_card_no: str = Query(...),
):
    require_hr_admin(admin_card_no)
    result = svc_create_notification_selections(
        app_id, [s.model_dump() for s in request.selections], selected_by=admin_card_no)
    if result["status"] == "error":
        raise HTTPException(status_code=int(result.get("code") or 400),
                            detail=result.get("message"))
    return result


@router.get("/applications/{app_id}/notification-selections")
def get_notification_selections(app_id: int, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    return {"items": svc_list_notification_selections(app_id)}


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
# CANDIDATES — Talent Pool
# ===================================

def _resolve_admin_scope(admin_card_no: str, compc: Optional[str], brnch: Optional[str]):
    """Company/branch to stamp a pool (job-less) CV with, from the admin's selected
    scope (validated against their rights) — same rule as manual candidate create:
    company strict; branch only when a specific branch is selected (else NULL)."""
    rights = _get_admin_rights(admin_card_no)
    allowed_c = rights.get("allowed_companies") or []
    allowed_b = rights.get("allowed_branches") or []
    comp = compc if (compc and (not allowed_c or compc in allowed_c)) else (allowed_c[0] if allowed_c else None)
    brn = brnch if (brnch and (not allowed_b or brnch in allowed_b)) else None
    return comp, brn


def _resolve_drop_dirs(admin_card_no: str, job_id: Optional[int],
                       compc: Optional[str], brnch: Optional[str]) -> dict:
    """Resolve the RECRUITMENT_CVS drop folders for an upload/status request and
    enforce scope. With a job_id -> that job's folder (validated against the admin's
    company). Without -> the company/branch talent-pool folder (RECRUITMENT_CVS/pool).
    Writes a _scope.json sidecar so the watcher can stamp pool CVs. Returns the dirs
    dict; raises 404 on a job outside scope."""
    if job_id is not None:
        scope = svc_get_job_scope(job_id)
        if scope is None:
            raise HTTPException(status_code=404, detail="Job not found")
        rights = _get_admin_rights(admin_card_no)
        allowed_c = rights.get("allowed_companies") or []
        job_compc = scope.get("compc")
        if allowed_c and job_compc is not None and str(job_compc) not in [str(c) for c in allowed_c]:
            raise HTTPException(status_code=404, detail="Job not found")
        dirs = svc_job_cv_dirs(job_id)
        if dirs is None:
            raise HTTPException(status_code=404, detail="Job not found")
    else:
        comp, brn = _resolve_admin_scope(admin_card_no, compc, brnch)
        dirs = svc_pool_cv_dirs(comp, brn)

    os.makedirs(dirs["buffer_dir"], exist_ok=True)
    # Sidecar so the watcher can stamp a pool candidate's company/branch (there is
    # no job to look them up from). Harmless for job folders.
    try:
        with open(os.path.join(dirs["buffer_dir"], "_scope.json"), "w", encoding="utf-8") as f:
            import json as _json
            _json.dump({"compc": dirs.get("compc"), "brnch": dirs.get("brnch"),
                        "job_id": job_id}, f)
    except Exception:
        pass
    return dirs


async def _write_cv_to_buffer(buffer_dir: str, file: UploadFile) -> dict:
    """Save one CV into the drop folder. Only PDFs are screened by the pipeline;
    other types are reported per-file (not raised) so a bulk upload isn't aborted
    by one bad file. Returns {filename, saved_as, queued, error?}."""
    ext = (os.path.splitext(file.filename or "")[1] or "").lstrip(".").lower()
    if ext != "pdf":
        return {"filename": file.filename, "saved_as": None, "queued": False,
                "error": "Only PDF CVs can be AI-screened"}
    saved = _safe_cv_filename(file.filename)
    try:
        with open(os.path.join(buffer_dir, saved), "wb") as f:
            f.write(await file.read())
    except Exception as e:
        return {"filename": file.filename, "saved_as": None, "queued": False,
                "error": f"Failed to queue: {e}"}
    return {"filename": file.filename, "saved_as": saved, "queued": True}


@router.post("/candidates/upload-cvs")
async def upload_cvs(
    admin_card_no: str = Query(...),
    job_id: Optional[int] = Query(None, description="Optional: job to screen against. Omit to add to the talent pool only."),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
    files: List[UploadFile] = File(...),
):
    """'Add candidates to a job' — queue up to 20 CV PDFs for AI processing.
    With a job_id the watcher extracts the profile AND scores each CV against the
    job (creating an application + AI ranking). Without a job_id it only extracts
    the profile into the talent pool (no application, no ranking). Poll
    /candidates/cv-status with the returned saved_as names to track each file."""
    require_hr_admin(admin_card_no)
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")
    if len(files) > MAX_BULK_CVS:
        raise HTTPException(status_code=400, detail=f"Upload at most {MAX_BULK_CVS} CVs at once")
    dirs = _resolve_drop_dirs(admin_card_no, job_id, compc, brnch)
    results = [await _write_cv_to_buffer(dirs["buffer_dir"], f) for f in files]
    queued = sum(1 for r in results if r["queued"])
    return {"status": "success", "job_id": job_id, "queued": queued,
            "total": len(results), "results": results}


@router.get("/candidates/cv-status")
def cv_status(
    admin_card_no: str = Query(...),
    job_id: Optional[int] = Query(None),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
    files: str = Query("", description="Comma-separated saved_as filenames to check"),
):
    """Per-file status for uploaded CVs: processing / scored (+score) / profiled
    (pool, no ranking) / unreadable / failed / unknown. For the upload UI to poll."""
    require_hr_admin(admin_card_no)
    dirs = _resolve_drop_dirs(admin_card_no, job_id, compc, brnch)
    names = [n.strip() for n in (files or "").split(",") if n.strip()]
    result = svc_cv_status_in_dirs(dirs["buffer_dir"], dirs["archive_dir"], names)
    return {"job_id": job_id, **result}


@router.get("/candidates")
def list_candidates(
    admin_card_no: str = Query(...),
    search: str = Query(None, description="Match name / email / mobile / location / preferred job / skill"),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    require_hr_admin(admin_card_no)
    # Scope the pool to the selected company/branch (validated against rights).
    final_c, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
    return {"items": svc_list_candidates(search, compc=final_c, brnch=final_b)}


@router.post("/candidates")
def create_candidate(
    request: CandidateCreateRequest,
    admin_card_no: str = Query(...),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    require_hr_admin(admin_card_no)
    if not request.candidate_name or not request.candidate_name.strip():
        raise HTTPException(status_code=400, detail="Candidate name is required")

    # Stamp the admin's selected company/branch — same rules as job creation:
    # company strict (validated, else first allowed); branch only when a specific
    # branch is selected (NULL = company-wide pool entry).
    rights = _get_admin_rights(admin_card_no)
    allowed_c = rights.get("allowed_companies") or []
    allowed_b = rights.get("allowed_branches") or []
    comp = compc if (compc and (not allowed_c or compc in allowed_c)) else (allowed_c[0] if allowed_c else None)
    brn = brnch if (brnch and (not allowed_b or brnch in allowed_b)) else None

    result = svc_create_candidate(request.model_dump(), compc=comp, brnch=brn)
    if result["status"] == "duplicate":
        # 409 with the existing id so the UI can jump to that profile.
        raise HTTPException(status_code=409, detail=result.get("message"))
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return {"status": "success", "candidate_id": result.get("candidate_id"),
            "message": "Candidate added to talent pool"}


@router.get("/candidates/{candidate_id}")
def get_candidate(
    candidate_id: int,
    admin_card_no: str = Query(...),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    require_hr_admin(admin_card_no)
    _require_candidate_access(admin_card_no, candidate_id, compc, brnch)
    cand = svc_get_candidate(candidate_id)
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return cand


@router.put("/candidates/{candidate_id}")
def update_candidate(
    candidate_id: int,
    request: CandidateUpdateRequest,
    admin_card_no: str = Query(...),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    require_hr_admin(admin_card_no)
    _require_candidate_access(admin_card_no, candidate_id, compc, brnch)
    result = svc_update_candidate(candidate_id, request.model_dump(exclude_unset=True))
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return {"status": "success", "message": "Candidate updated"}


@router.post("/candidates/{candidate_id}/cv")
async def upload_candidate_cv(
    candidate_id: int,
    admin_card_no: str = Query(...),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
    file: UploadFile = File(...),
):
    """Upload / replace a candidate's CV (one current resume per person). The
    file is stored under the candidate's own company/branch folder:
    EMP_DOCS/<Company>/<Branch>/RECRUITMENT_CVS/cand_{id}.{ext}"""
    require_hr_admin(admin_card_no)
    _require_candidate_access(admin_card_no, candidate_id, compc, brnch)
    ext = (os.path.splitext(file.filename or "")[1] or "").lstrip(".").lower()
    if ext not in CV_ALLOWED_EXT:
        raise HTTPException(status_code=400,
                            detail=f"CV must be one of: {', '.join(sorted(CV_ALLOWED_EXT))}")

    target = svc_candidate_cv_target(candidate_id, ext)
    if target is None:
        raise HTTPException(status_code=404, detail="Candidate not found")
    try:
        os.makedirs(target["abs_dir"], exist_ok=True)
        # Replace the previous CV wherever it was stored (old path may differ in
        # extension or predate the company/branch folder structure).
        old = target.get("old_abs_path")
        if old and old != target["abs_path"] and os.path.isfile(old):
            try:
                os.remove(old)
            except OSError:
                pass
        with open(target["abs_path"], "wb") as f:
            f.write(await file.read())
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save CV: {e}")

    fname = os.path.basename(target["abs_path"])
    result = svc_set_candidate_cv(candidate_id, file.filename or fname, target["rel_path"])
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return {"status": "success", "cv_file_name": file.filename or fname}


@router.get("/candidates/{candidate_id}/cv")
def download_candidate_cv(
    candidate_id: int,
    admin_card_no: str = Query(...),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
    inline: bool = Query(False),
):
    require_hr_admin(admin_card_no)
    _require_candidate_access(admin_card_no, candidate_id, compc, brnch)
    row = svc_get_candidate_cv_path(candidate_id)
    if not row or not row[1]:
        raise HTTPException(status_code=404, detail="No CV uploaded for this candidate")
    abs_path = row[1] if os.path.isabs(row[1]) else os.path.join(DOCS_BASE, row[1])
    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail="CV file not found on disk")
    fname = row[0] or os.path.basename(abs_path)
    disposition = "inline" if inline else "attachment"
    return FileResponse(
        abs_path, filename=fname,
        headers={"Content-Disposition": f'{disposition}; filename="{fname}"'},
    )


@router.post("/candidates/{candidate_id}/apply")
def apply_candidate(
    candidate_id: int,
    request: CandidateApplyRequest,
    background_tasks: BackgroundTasks,
    admin_card_no: str = Query(...),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    """Apply an existing Talent Pool candidate to a job: create the application and
    kick off the AI evaluation in the background. The evaluation scores the
    candidate's STORED profile (not the original CV) against the job's full details,
    producing the per-application AI ranking. Returns immediately; the ranking
    appears once scoring finishes."""
    require_hr_admin(admin_card_no)
    _require_candidate_access(admin_card_no, candidate_id, compc, brnch)
    result = svc_apply_candidate_to_job(candidate_id, request.job_id, source=request.source)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    app_id = result["application_id"]
    background_tasks.add_task(svc_evaluate_application, app_id, candidate_id, request.job_id)
    return {"status": "success", "application_id": app_id, "created": result.get("created"),
            "evaluating": True,
            "message": "Application created — AI is scoring the candidate for this job."}


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
