"""Recruitment service — thin layer between router and repository."""

from repositories.recruitment_repository import (
    create_job, list_jobs, get_job, update_job,
    create_application, list_applications, get_application, update_application_status,
    create_interview, list_interviews, update_interview,
    create_offer, list_offers, update_offer,
    get_analytics,
)


def svc_create_job(data: dict, created_by: str, compc=None, brnch=None) -> dict:
    return create_job(data, created_by, compc=compc, brnch=brnch)

def svc_list_jobs(status: str = None, compc=None, brnch=None) -> list:
    return list_jobs(status, compc=compc, brnch=brnch)

def svc_get_job(job_id: int) -> dict | None:
    return get_job(job_id)

def svc_update_job(job_id: int, data: dict) -> dict:
    return update_job(job_id, data)

def svc_create_application(data: dict) -> dict:
    return create_application(data)

def svc_list_applications(job_id: int = None, status: str = None, compc=None, brnch=None) -> list:
    return list_applications(job_id, status, compc=compc, brnch=brnch)

def svc_get_application(app_id: int) -> dict | None:
    return get_application(app_id)

def svc_update_application_status(app_id: int, status: str, notes: str = None) -> dict:
    return update_application_status(app_id, status, notes)

def svc_create_interview(data: dict) -> dict:
    return create_interview(data)

def svc_list_interviews(app_id: int = None, status: str = None, compc=None, brnch=None) -> list:
    return list_interviews(app_id, status, compc=compc, brnch=brnch)

def svc_update_interview(interview_id: int, data: dict) -> dict:
    return update_interview(interview_id, data)

def svc_create_offer(data: dict) -> dict:
    return create_offer(data)

def svc_list_offers(status: str = None, compc=None, brnch=None) -> list:
    return list_offers(status, compc=compc, brnch=brnch)

def svc_update_offer(offer_id: int, data: dict) -> dict:
    return update_offer(offer_id, data)

def svc_get_analytics(compc=None, brnch=None) -> dict:
    return get_analytics(compc=compc, brnch=brnch)
