"""Pydantic models for the Recruitment module."""

from typing import List, Optional
from pydantic import BaseModel


class JobCreateRequest(BaseModel):
    job_title: str
    dept_no: Optional[int] = None
    open_positions: int = 1
    job_desc: Optional[str] = None
    skills_req: Optional[str] = None            # must-have skills (fed to AI matching)
    # ── AI CV-scoring fields ──
    employment_type: Optional[str] = None       # Full-time / Part-time / Contract
    work_mode: Optional[str] = None             # On-site / Hybrid / Remote
    nice_to_have_skills: Optional[str] = None
    min_experience_years: Optional[int] = None
    education_req: Optional[str] = None
    salary_min: Optional[float] = None
    salary_max: Optional[float] = None


class JobUpdateRequest(BaseModel):
    job_title: Optional[str] = None
    dept_no: Optional[int] = None
    open_positions: Optional[int] = None
    job_desc: Optional[str] = None
    skills_req: Optional[str] = None
    employment_type: Optional[str] = None
    work_mode: Optional[str] = None
    nice_to_have_skills: Optional[str] = None
    min_experience_years: Optional[int] = None
    education_req: Optional[str] = None
    salary_min: Optional[float] = None
    salary_max: Optional[float] = None
    status: Optional[str] = None  # OPEN / CLOSED / ON_HOLD


class ApplicationCreateRequest(BaseModel):
    job_id: int
    # Talent-Pool flow: link an existing candidate profile...
    candidate_id: Optional[int] = None
    # ...or legacy quick-add by name (no profile).
    candidate_name: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    source: Optional[str] = None  # Walk-in / Online / Referral / Agency
    notes: Optional[str] = None


class ApplicationStatusUpdate(BaseModel):
    status: str  # PENDING / SHORTLISTED / REJECTED
    notes: Optional[str] = None


class InterviewCreateRequest(BaseModel):
    app_id: int
    interview_date: Optional[str] = None  # YYYY-MM-DD
    interview_type: Optional[str] = None  # HR / Technical / Final
    interviewer: Optional[str] = None
    feedback_owner: Optional[str] = None


class InterviewUpdateRequest(BaseModel):
    status: Optional[str] = None   # SCHEDULED / COMPLETED / CANCELLED
    feedback: Optional[str] = None
    interview_date: Optional[str] = None
    interview_type: Optional[str] = None
    interviewer: Optional[str] = None
    # ── Structured feedback (interview feedback form) ──
    feedback_owner: Optional[str] = None
    technical_rating: Optional[str] = None       # Excellent / Good / Average / Poor
    communication_rating: Optional[str] = None
    culture_fit_rating: Optional[str] = None
    recommendation: Optional[str] = None         # Next round / Send offer / Reject


class OfferCreateRequest(BaseModel):
    app_id: int
    salary_offered: Optional[float] = None
    notes: Optional[str] = None


class OfferUpdateRequest(BaseModel):
    status: Optional[str] = None  # SENT / ACCEPTED / REJECTED
    salary_offered: Optional[float] = None
    notes: Optional[str] = None


# ── Talent Pool (candidates) ──

class CandidateEducation(BaseModel):
    institution: Optional[str] = None
    degree: Optional[str] = None
    graduation_year: Optional[str] = None


class CandidateExperience(BaseModel):
    company: Optional[str] = None
    role: Optional[str] = None
    duration: Optional[str] = None
    description: Optional[str] = None


class CandidateCreateRequest(BaseModel):
    candidate_name: str
    email: Optional[str] = None
    mobile: Optional[str] = None
    location: Optional[str] = None
    preferred_job_title: Optional[str] = None
    profile_summary: Optional[str] = None
    education: Optional[List[CandidateEducation]] = None
    experience: Optional[List[CandidateExperience]] = None
    skills: Optional[List[str]] = None


class CandidateUpdateRequest(BaseModel):
    candidate_name: Optional[str] = None
    email: Optional[str] = None
    mobile: Optional[str] = None
    location: Optional[str] = None
    preferred_job_title: Optional[str] = None
    profile_summary: Optional[str] = None
    # When provided, these lists REPLACE the stored child rows.
    education: Optional[List[CandidateEducation]] = None
    experience: Optional[List[CandidateExperience]] = None
    skills: Optional[List[str]] = None


class CandidateApplyRequest(BaseModel):
    job_id: int
    source: Optional[str] = None
    notes: Optional[str] = None


# ── Interview panel pool + interviewer assignments ──

class PanelPoolAddRequest(BaseModel):
    empcodes: List[str]                 # HR_EMP_MASTER.EMPCODEs to add


class PanelPoolDeactivateRequest(BaseModel):
    empcode: str                        # soft-remove across the current scope


class InterviewRescheduleRequest(BaseModel):
    interview_date: Optional[str] = None   # YYYY-MM-DD; omit to keep current date
    start_time: Optional[str] = None       # HH:MM (24h); omit to keep current start
    end_time: Optional[str] = None         # HH:MM; omit to keep current duration/end
    location_or_link: Optional[str] = None
    interview_mode: Optional[str] = None


class InterviewAssignmentCreateRequest(BaseModel):
    empcodes: List[str]                 # one assignment row per interviewer
    interview_type: str                 # required (400 if blank)
    interview_date: str                 # YYYY-MM-DD
    start_time: str                     # HH:MM (24h)
    end_time: Optional[str] = None      # defaults to start + 1 hour
    remarks: Optional[str] = None
    location_or_link: Optional[str] = None   # venue or meeting URL
    interview_mode: Optional[str] = None     # On-site / Online / Phone


# ── Notification templates + per-application selections ──

class NotificationSelectionItem(BaseModel):
    template_id: int
    notification_type: str              # EMAIL / WHATSAPP
    recipient_type: str                 # INTERVIEWER / CANDIDATE
    empcodes: Optional[List[str]] = None  # required when recipient_type=INTERVIEWER


class NotificationSelectionsCreateRequest(BaseModel):
    selections: List[NotificationSelectionItem]
