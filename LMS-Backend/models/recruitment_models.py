"""Pydantic models for the Recruitment module."""

from typing import Optional
from pydantic import BaseModel


class JobCreateRequest(BaseModel):
    job_title: str
    dept_no: Optional[int] = None
    open_positions: int = 1
    job_desc: Optional[str] = None
    skills_req: Optional[str] = None


class JobUpdateRequest(BaseModel):
    job_title: Optional[str] = None
    dept_no: Optional[int] = None
    open_positions: Optional[int] = None
    job_desc: Optional[str] = None
    skills_req: Optional[str] = None
    status: Optional[str] = None  # OPEN / CLOSED / ON_HOLD


class ApplicationCreateRequest(BaseModel):
    job_id: int
    candidate_name: str
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


class InterviewUpdateRequest(BaseModel):
    status: Optional[str] = None   # SCHEDULED / COMPLETED / CANCELLED
    feedback: Optional[str] = None
    interview_date: Optional[str] = None
    interview_type: Optional[str] = None
    interviewer: Optional[str] = None


class OfferCreateRequest(BaseModel):
    app_id: int
    salary_offered: Optional[float] = None
    notes: Optional[str] = None


class OfferUpdateRequest(BaseModel):
    status: Optional[str] = None  # SENT / ACCEPTED / REJECTED
    salary_offered: Optional[float] = None
    notes: Optional[str] = None
