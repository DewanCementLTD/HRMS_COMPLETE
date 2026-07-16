"""Recruitment service — thin layer between router and repository."""

import logging

from repositories.recruitment_repository import (
    create_job, list_jobs, get_job, update_job,
    create_application, list_applications, get_application, update_application_status,
    create_interview, list_interviews, update_interview,
    create_offer, list_offers, update_offer,
    get_analytics,
    create_candidate, list_candidates, get_candidate, update_candidate,
    set_candidate_cv, get_candidate_cv_path, apply_candidate_to_job,
    candidate_in_scope, candidate_cv_target,
    get_application_evaluation, match_candidates_for_job,
    create_application_for_candidate, get_candidate_cv_text, store_evaluation,
    get_job_scope, rank_job_applicants, job_cv_dirs, pool_cv_dirs, cv_status_in_dirs,
    build_job_jd_text,
    get_job as _get_job_row,
)


def svc_pool_cv_dirs(compc, brnch):
    return pool_cv_dirs(compc, brnch)


def svc_cv_status_in_dirs(buffer_dir: str, archive_dir: str, filenames):
    return cv_status_in_dirs(buffer_dir, archive_dir, filenames)


def svc_get_job_scope(job_id: int):
    return get_job_scope(job_id)


def svc_job_cv_dirs(job_id: int):
    return job_cv_dirs(job_id)


def svc_rank_job_applicants(job_id: int, top_k: int = 10, compc=None, brnch=None) -> dict:
    return rank_job_applicants(job_id, top_k=top_k, compc=compc, brnch=brnch)


def svc_evaluate_application(app_id: int, candidate_id: int, job_id: int) -> dict:
    """Score a candidate against a job using their STORED profile (education /
    experience / skills / summary from the DB — the CV is NOT re-read) and save the
    evaluation on the application. Blocking (~LLM latency) — call from a background
    task so the apply request returns immediately."""
    import time
    _ai_dir_on_path()
    try:
        import cv_evaluator
    except Exception as e:
        log.error("Apply-eval unavailable (AI import failed): %s", e)
        return {"status": "error", "message": f"AI evaluator unavailable: {e}"}

    cv = get_candidate_cv_text(candidate_id)
    if not cv or not (cv.get("text") or "").strip():
        return {"status": "error", "message": "No stored profile text to evaluate"}
    jd = build_job_jd_text(job_id) or ""
    started = time.perf_counter()
    try:
        assessment, stats = cv_evaluator.evaluate_cv(cv["text"], jd, cv.get("detected_job_title"))
    except Exception as e:
        log.error("Apply-eval LLM failed (candidate %s, job %s): %s", candidate_id, job_id, e)
        return {"status": "error", "message": str(e)}
    total = round(time.perf_counter() - started, 3)
    result = store_evaluation(app_id, assessment.get("evaluation") or {}, stats, total_seconds=total)
    if result.get("status") == "success":
        log.info("Apply-eval stored: candidate %s x job %s -> app %s (eval %s)",
                 candidate_id, job_id, app_id, result.get("evaluation_id"))
    return result

log = logging.getLogger("recruitment_service")


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


# ── Interview panel pool + interviewer assignments ──
# (imported lazily so a missing table/DDL failure surfaces per-request, not at boot)

def svc_list_panel_pool(compc, brnch=None, include_inactive: bool = False) -> dict:
    from repositories.interview_panel_repository import list_panel_pool
    return list_panel_pool(compc, brnch, include_inactive)

def svc_add_panel_members(compc, brnch, empcodes: list, added_by: str) -> dict:
    from repositories.interview_panel_repository import add_panel_members
    return add_panel_members(compc, brnch, empcodes, added_by)

def svc_deactivate_panel_row(panel_pool_id: int) -> dict:
    from repositories.interview_panel_repository import deactivate_panel_row
    return deactivate_panel_row(panel_pool_id)

def svc_deactivate_panel_member(compc, brnch, empcode: str) -> dict:
    from repositories.interview_panel_repository import deactivate_panel_member
    return deactivate_panel_member(compc, brnch, empcode)

def svc_panel_options_for_app(app_id: int) -> dict:
    from repositories.interview_panel_repository import panel_options_for_app
    return panel_options_for_app(app_id)

def svc_create_interview_assignments(app_id: int, data: dict, assigned_by: str) -> dict:
    from repositories.interview_panel_repository import create_interview_assignments
    return create_interview_assignments(
        app_id,
        empcodes=data.get("empcodes") or [],
        interview_type=data.get("interview_type"),
        interview_date=data.get("interview_date"),
        start_time=data.get("start_time"),
        end_time=data.get("end_time"),
        remarks=data.get("remarks"),
        assigned_by=assigned_by,
        location_or_link=data.get("location_or_link"),
        interview_mode=data.get("interview_mode"),
    )

def svc_list_interview_assignments(app_id: int) -> list:
    from repositories.interview_panel_repository import list_interview_assignments
    return list_interview_assignments(app_id)


# ── Notification templates + selections ──

def svc_list_notification_templates(event_type=None, notification_type=None,
                                    recipient_type=None) -> list:
    from repositories.notification_repository import list_templates
    return list_templates(event_type, notification_type, recipient_type)

def svc_create_notification_selections(app_id: int, selections: list, selected_by: str) -> dict:
    from repositories.notification_repository import create_notification_selections
    return create_notification_selections(app_id, selections, selected_by)

def svc_list_notification_selections(app_id: int) -> list:
    from repositories.notification_repository import list_notification_selections
    return list_notification_selections(app_id)


def svc_create_offer(data: dict) -> dict:
    return create_offer(data)

def svc_list_offers(status: str = None, compc=None, brnch=None) -> list:
    return list_offers(status, compc=compc, brnch=brnch)

def svc_update_offer(offer_id: int, data: dict) -> dict:
    return update_offer(offer_id, data)

def svc_get_analytics(compc=None, brnch=None) -> dict:
    return get_analytics(compc=compc, brnch=brnch)

# ── Talent Pool (candidates) ──

def svc_create_candidate(data: dict, compc=None, brnch=None) -> dict:
    return create_candidate(data, compc=compc, brnch=brnch)

def svc_list_candidates(search: str = None, compc=None, brnch=None) -> list:
    return list_candidates(search, compc=compc, brnch=brnch)

def svc_candidate_in_scope(candidate_id: int, compc=None, brnch=None) -> bool:
    return candidate_in_scope(candidate_id, compc=compc, brnch=brnch)

def svc_candidate_cv_target(candidate_id: int, ext: str):
    return candidate_cv_target(candidate_id, ext)

def svc_get_candidate(candidate_id: int) -> dict | None:
    return get_candidate(candidate_id)

def svc_update_candidate(candidate_id: int, data: dict) -> dict:
    return update_candidate(candidate_id, data)

def svc_set_candidate_cv(candidate_id: int, file_name: str, rel_path: str) -> dict:
    return set_candidate_cv(candidate_id, file_name, rel_path)

def svc_get_candidate_cv_path(candidate_id: int):
    return get_candidate_cv_path(candidate_id)

def svc_apply_candidate(candidate_id: int, job_id: int, source: str = None, notes: str = None) -> dict:
    return apply_candidate_to_job(candidate_id, job_id, source=source, notes=notes)


def svc_apply_candidate_to_job(candidate_id: int, job_id: int, source: str = None) -> dict:
    """Ensure an application exists for candidate x job (reuses the existing one)
    and return its id, so the caller can kick off the AI evaluation."""
    return create_application_for_candidate(candidate_id, job_id, source=source)


# ── AI evaluations + talent-pool matching ──

def svc_get_application_evaluation(app_id: int):
    return get_application_evaluation(app_id)


def _ai_dir_on_path():
    """Make the AI/ pipeline modules importable (cv_evaluator) without turning
    AI/ into a package. Idempotent."""
    import os
    import sys
    ai_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "AI")
    if ai_dir not in sys.path:
        sys.path.insert(0, ai_dir)


def _deep_evaluate(job_id: int, job_description: str, shortlist: list) -> None:
    """Run each shortlisted candidate's stored profile through the LLM evaluator
    (concurrently, like the watcher batches), materialise an application and store
    the evaluation. Mutates each shortlist entry in place with the AI result.
    Best-effort: a per-candidate failure is logged, not raised."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import time

    _ai_dir_on_path()
    try:
        import config as ai_config
        import cv_evaluator
    except Exception as e:
        log.error("Deep match unavailable (AI pipeline import failed): %s", e)
        for c in shortlist:
            c["deep_error"] = f"AI evaluator unavailable: {e}"
        return

    def _one(entry: dict) -> None:
        cid = entry["candidate_id"]
        cv = get_candidate_cv_text(cid)
        if not cv or not cv["text"].strip():
            entry["deep_error"] = "No stored profile text to evaluate"
            return
        started = time.perf_counter()
        assessment, stats = cv_evaluator.evaluate_cv(
            cv["text"], job_description, cv.get("detected_job_title"))
        total_seconds = round(time.perf_counter() - started, 3)
        evaluation = assessment.get("evaluation") or {}
        app = create_application_for_candidate(cid, job_id, source="Talent Match (deep)")
        if app.get("status") != "success":
            entry["deep_error"] = app.get("message")
            return
        app_id = app["application_id"]
        store_evaluation(app_id, evaluation, stats, total_seconds=total_seconds)
        entry["existing_application_id"] = app_id
        entry["ai_overall_score"] = evaluation.get("overall_score")
        entry["ai_recommendation"] = evaluation.get("recommendation")

    workers = int(getattr(ai_config, "MAX_WORKERS", 8) or 8)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_one, e): e for e in shortlist}
        for fut in as_completed(futures):
            entry = futures[fut]
            try:
                fut.result()
            except Exception as e:
                log.error("Deep eval failed for candidate %s: %s",
                          entry.get("candidate_id"), e)
                entry["deep_error"] = str(e)


def svc_match_candidates_for_job(job_id: int, top: int = 20, deep: bool = False,
                                 compc=None, brnch=None) -> dict:
    result = match_candidates_for_job(job_id, top=top, compc=compc, brnch=brnch)
    if not deep or result.get("status") != "success" or not result.get("candidates"):
        result["deep"] = False
        return result
    job = _get_job_row(int(job_id)) or {}
    jd = " ".join(filter(None, [job.get("job_desc"), job.get("skills_req")])) \
        or job.get("job_title") or ""
    _deep_evaluate(int(job_id), jd, result["candidates"])
    # Re-sort by the fresh AI score where present (falls back to keyword score).
    result["candidates"].sort(
        key=lambda c: (-(c.get("ai_overall_score") or -1), -c["score"], c["candidate_id"]))
    result["deep"] = True
    return result
