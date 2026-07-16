"""
Regression tests for the pool-CV "Unknown candidate" bug.

Root cause: the metrics-only prompt template told non-JSON-mode models to
return {"metrics": {...}} while validation expected the BARE metrics object;
the raw wrapped dict was kept and wrapped AGAIN by _run_llm, so
assessment["metrics"]["contact_info"] was empty and every pool candidate was
stored as "Unknown".

These tests run the real _run_llm with a faked genai client (no network, no
API key, no DB) and assert the assessment shape that the repositories consume:
    assessment["metrics"]["contact_info"]["name"], education/experience/skills.

Run:  python AI/test_cv_evaluator_shapes.py   (from LMS-Backend, venv active)
"""

import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

import cv_evaluator  # noqa: E402

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {label}" + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


BARE_METRICS = {
    "contact_info": {"name": "Ayesha Khan", "email": "ayesha@example.com",
                     "phone": "0300-1234567", "location": "Lahore"},
    "preferred_job_title": "Accounts Officer",
    "profile_summary": "Finance professional with 5 years in manufacturing.",
    "education": [{"institution": "PU", "degree": "B.Com", "graduation_year": "2018"}],
    "experience": [{"company": "DCL", "role": "Accountant",
                    "duration": "2019-2024", "description": "GL and payables."}],
    "skills": ["Oracle", "Excel"],
}

FULL_ASSESSMENT = {
    "metrics": BARE_METRICS,
    "evaluation": {
        "compatibility": 80, "technical_match": 75, "experience_match": 85,
        "overall_score": 80, "strengths": ["ERP exposure"], "weaknesses": ["No IFRS"],
        "recommendation": "Interview", "summary": "Good fit.",
    },
}


def fake_client(reply: dict):
    """A genai.Client stand-in whose generate_content always returns `reply`."""
    response = SimpleNamespace(
        text=json.dumps(reply),
        candidates=[SimpleNamespace(finish_reason="STOP")],
        usage_metadata=None,
    )
    return SimpleNamespace(models=SimpleNamespace(
        generate_content=lambda **kwargs: response))


def with_reply(reply: dict, fn):
    saved = cv_evaluator._client
    cv_evaluator._client = fake_client(reply)
    try:
        return fn()
    finally:
        cv_evaluator._client = saved


def main():
    # --- Prompt templates must agree with the pydantic schemas ----------------
    metrics_tpl = json.loads(cv_evaluator._METRICS_TEMPLATE)
    check("metrics-only template is the BARE metrics object",
          "contact_info" in metrics_tpl and "metrics" not in metrics_tpl,
          f"top-level keys: {sorted(metrics_tpl)}")

    full_tpl = json.loads(cv_evaluator._JSON_TEMPLATE)
    check("full template keeps metrics + evaluation wrapper",
          set(full_tpl) == {"metrics", "evaluation"},
          f"top-level keys: {sorted(full_tpl)}")

    # --- Pool flow, model returns the bare object (JSON-mode models) ----------
    assessment, stats = with_reply(
        BARE_METRICS, lambda: cv_evaluator.extract_metrics("cv text", "Accountant"))
    name = ((assessment.get("metrics") or {}).get("contact_info") or {}).get("name")
    check("pool + bare reply: name reaches assessment['metrics']",
          name == "Ayesha Khan", f"got {name!r}")
    check("pool + bare reply: schema_valid", stats.get("schema_valid") is True)

    # --- Pool flow, model wraps the reply in {'metrics': ...} (the bug) -------
    assessment, stats = with_reply(
        {"metrics": BARE_METRICS},
        lambda: cv_evaluator.extract_metrics("cv text", "Accountant"))
    metrics = assessment.get("metrics") or {}
    check("pool + wrapped reply: no double nesting", "metrics" not in metrics,
          f"metrics keys: {sorted(metrics)}")
    name = (metrics.get("contact_info") or {}).get("name")
    check("pool + wrapped reply: name recovered (was 'Unknown' before fix)",
          name == "Ayesha Khan", f"got {name!r}")
    check("pool + wrapped reply: children survive",
          metrics.get("skills") == ["Oracle", "Excel"]
          and len(metrics.get("education") or []) == 1
          and len(metrics.get("experience") or []) == 1)
    check("pool + wrapped reply: validates against schema",
          stats.get("schema_valid") is True)

    # --- Multiple pool CVs: each reply maps to its own distinct assessment ----
    people = ["Ali Raza", "Sara Malik", "Bilal Ahmed"]
    for person in people:
        reply = {"metrics": {**BARE_METRICS,
                             "contact_info": {**BARE_METRICS["contact_info"],
                                              "name": person}}}
        assessment, _ = with_reply(
            reply, lambda: cv_evaluator.extract_metrics("cv text"))
        got = ((assessment.get("metrics") or {}).get("contact_info") or {}).get("name")
        check(f"pool batch: '{person}' stays distinct and populated",
              got == person, f"got {got!r}")

    # --- Regression guard: specific-job flow unchanged -------------------------
    assessment, stats = with_reply(
        FULL_ASSESSMENT,
        lambda: cv_evaluator.evaluate_cv("cv text", "JD text", "Accountant"))
    check("job flow: metrics + evaluation intact",
          ((assessment.get("metrics") or {}).get("contact_info") or {}).get("name")
          == "Ayesha Khan"
          and (assessment.get("evaluation") or {}).get("overall_score") == 80)
    check("job flow: schema_valid", stats.get("schema_valid") is True)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURE(S): {FAILURES}")
        sys.exit(1)
    print("All shape regression tests passed.")


if __name__ == "__main__":
    main()
