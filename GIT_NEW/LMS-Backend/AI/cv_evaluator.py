"""
LLM evaluation of an extracted CV against a job description.

The raw extracted text (not the PDF) is sent as context, so there is no File
API upload round-trip. The model config is tuned for minimum latency:
  - flash-lite tier model (see config.MODEL_NAME)
  - thinking disabled (thinking_budget=0) where the model supports it
  - temperature 0, JSON-schema constrained output, bounded max_output_tokens

Model families accept different request parameters: Gemma API models reject
system_instruction, JSON mode (response_mime_type/response_schema) and
thinking_config, all of which gemini-2.5-* support. Capabilities are seeded
per model family and further degraded at runtime when the API returns
INVALID_ARGUMENT, so the same pipeline runs unchanged against either family.
When JSON mode is off, the schema is spelled out in the prompt and the reply
is parsed defensively + validated with pydantic.
"""

from __future__ import annotations

import json
import logging
import random
import re
import threading
import time

from typing import Annotated

from google import genai
from google.genai import types
from pydantic import BaseModel, BeforeValidator, Field, ValidationError

import config

log = logging.getLogger("cv_evaluator")

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
# Models without server-side schema enforcement (Gemma) drift on types:
# years/phones arrive as numbers, scores as floats. These aliases coerce the
# benign cases instead of failing validation; the JSON schema sent to models
# WITH enforcement is unchanged (still plain string/integer).
LenientStr = Annotated[
    str | None, BeforeValidator(lambda v: str(v) if isinstance(v, (int, float)) else v)
]
LenientInt = Annotated[
    int, BeforeValidator(lambda v: round(v) if isinstance(v, float) else v)
]


class ContactInfo(BaseModel):
    name: str
    email: str | None = None
    phone: LenientStr = None
    location: str | None = None


class Education(BaseModel):
    institution: str
    degree: str | None = None
    graduation_year: LenientStr = None


class Experience(BaseModel):
    company: str
    role: str
    duration: LenientStr = Field(default=None, description="Start date to end date, or total duration")
    description: str | None = None


class CandidateMetricsSchema(BaseModel):
    contact_info: ContactInfo
    preferred_job_title: str | None = Field(
        default=None, description="The job title the candidate is targeting"
    )
    profile_summary: str | None = Field(
        default=None,
        description="A concise 2-3 sentence professional summary of the candidate "
                    "(seniority, domains, standout strengths) — candidate-centric, "
                    "not tied to any job.",
    )
    education: list[Education]
    experience: list[Experience]
    skills: list[str]


class EvaluationSchema(BaseModel):
    compatibility: LenientInt
    technical_match: LenientInt
    experience_match: LenientInt
    overall_score: LenientInt
    strengths: list[str]
    weaknesses: list[str]
    recommendation: str
    summary: str


class CandidateAssessmentSchema(BaseModel):
    metrics: CandidateMetricsSchema
    evaluation: EvaluationSchema


# Compact schema spelled out in the prompt for models without JSON mode.
_METRICS_OBJ = """{
    "contact_info": {"name": "...", "email": null, "phone": null, "location": null},
    "preferred_job_title": null,
    "profile_summary": "...",
    "education": [{"institution": "...", "degree": null, "graduation_year": null}],
    "experience": [{"company": "...", "role": "...", "duration": null, "description": null}],
    "skills": ["..."]
  }"""

_JSON_TEMPLATE = '{\n  "metrics": ' + _METRICS_OBJ + """,
  "evaluation": {
    "compatibility": 0,
    "technical_match": 0,
    "experience_match": 0,
    "overall_score": 0,
    "strengths": ["..."],
    "weaknesses": ["..."],
    "recommendation": "...",
    "summary": "..."
  }
}"""

# Metrics-only shape (profile extraction with no job scoring). Must stay the
# BARE metrics object -- it is validated against CandidateMetricsSchema and
# wrapped into {"metrics": ...} by _run_llm afterwards; a "metrics"-wrapped
# template here double-nests the result and every profile field reads empty
# downstream (candidates show up as "Unknown").
_METRICS_TEMPLATE = _METRICS_OBJ


# ---------------------------------------------------------------------------
# Per-model capabilities
# ---------------------------------------------------------------------------
# Seeded by family, then degraded at runtime if the API still rejects a knob
# (INVALID_ARGUMENT). Shared across worker threads so one worker's discovery
# saves every later call the failed round-trip.
_CAPS_LOCK = threading.Lock()
_MODEL_CAPS: dict[str, dict[str, bool]] = {}


def _seed_caps(model: str) -> dict[str, bool]:
    m = model.lower()
    if m.startswith("gemma") or "/gemma" in m:
        # Gemma on the Gemini API takes plain user turns only.
        return {"system_instruction": False, "json_mode": False, "thinking": False}
    return {"system_instruction": True, "json_mode": True, "thinking": True}


def _get_caps(model: str) -> dict[str, bool]:
    with _CAPS_LOCK:
        if model not in _MODEL_CAPS:
            _MODEL_CAPS[model] = _seed_caps(model)
        return dict(_MODEL_CAPS[model])


def _degrade_caps(model: str, error_text: str) -> str | None:
    """Disable the capability an INVALID_ARGUMENT most likely refers to.
    Returns the disabled capability name, or None if nothing was left to
    disable (i.e. the 400 is about something else entirely)."""
    lowered = error_text.lower()
    with _CAPS_LOCK:
        caps = _MODEL_CAPS.setdefault(model, _seed_caps(model))
        if caps["thinking"] and "thinking" in lowered:
            caps["thinking"] = False
            return "thinking"
        if caps["system_instruction"] and (
            "developer instruction" in lowered or "system instruction" in lowered
        ):
            caps["system_instruction"] = False
            return "system_instruction"
        if caps["json_mode"] and (
            "json" in lowered or "response_schema" in lowered
            or "response schema" in lowered or "mime" in lowered
        ):
            caps["json_mode"] = False
            return "json_mode"
        # Unrecognized 400 wording: drop remaining knobs cheapest-first.
        for name in ("thinking", "system_instruction", "json_mode"):
            if caps[name]:
                caps[name] = False
                return name
    return None


# ---------------------------------------------------------------------------
# Client (one per process; genai client is thread-safe)
# ---------------------------------------------------------------------------
_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _client


_SYSTEM_INSTRUCTION = (
    "You are a fast, precise CV screening engine. Do not narrate reasoning. "
    "Respond with only the final JSON object matching the required schema -- "
    "no preamble, no explanation, no markdown code fences."
)


def _build_prompt(
    cv_text: str,
    detected_job_title: str | None,
    job_description: str | None,
    caps: dict[str, bool],
    metrics_only: bool = False,
) -> str:
    hint = (
        f"\nHeuristic pre-detection suggests the candidate's preferred job title is "
        f"'{detected_job_title}' -- confirm or correct this from the CV text."
        if detected_job_title
        else ""
    )
    template = _METRICS_TEMPLATE if metrics_only else _JSON_TEMPLATE
    if caps["json_mode"]:
        schema_clause = "Return ONLY the JSON object matching the requested schema."
    else:
        # No server-side schema enforcement: spell the exact shape out.
        schema_clause = (
            "Return ONLY a single valid JSON object (no markdown fences, no text "
            "before or after it) with exactly this structure -- every key shown "
            "is required; use null where a value is unknown; all scores are "
            f"integers 0-100:\n{template}"
        )

    # In metrics-only mode the reply IS the metrics object (no wrapper key), so
    # don't name a 'metrics' object -- that wording makes models nest one.
    target = "the JSON object" if metrics_only else "the 'metrics' object"
    extraction_task = f"""Extract ALL relevant profile metadata into {target}:
- contact_info (full name, email, phone, location)
- preferred_job_title (the role the candidate is targeting){hint}
- profile_summary: 2-3 sentence candidate-centric summary (seniority, domains, strengths)
- education: every degree/qualification (institution, degree, graduation_year)
- experience: every position (company, role, duration, a <=40-word description)
- skills: every distinct technical and professional skill mentioned
Be thorough on extraction but concise in wording -- do NOT copy the CV verbatim."""

    if metrics_only:
        body = f"""Analyze the candidate from the CV text below and build their profile.

{extraction_task}

--- CV TEXT START ---
{cv_text[: config.MAX_TEXT_CHARS]}
--- CV TEXT END ---

{schema_clause}"""
    else:
        body = f"""Analyze the candidate from the CV text below.
1. {extraction_task}
2. Evaluate the candidate against the Job Description into the 'evaluation'
   object (scores are integers 0-100): compatibility, technical_match,
   experience_match, overall_score, strengths, weaknesses, a one-word/phrase
   recommendation, and a job-specific summary.

Job Description: {job_description}

--- CV TEXT START ---
{cv_text[: config.MAX_TEXT_CHARS]}
--- CV TEXT END ---

{schema_clause}"""

    # Models without a system-instruction channel get it inlined instead.
    if not caps["system_instruction"]:
        body = f"{_SYSTEM_INSTRUCTION}\n\n{body}"
    return body


def _extract_json(raw_text: str) -> dict:
    """Defensive JSON extraction: strips reasoning text / markdown fences if the
    model emits them despite being told not to."""
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        pass
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw_text, re.DOTALL)
    if fenced:
        return json.loads(fenced.group(1))
    brace_match = re.search(r"\{.*\}", raw_text, re.DOTALL)
    if brace_match:
        return json.loads(brace_match.group(0))
    raise ValueError("Could not extract valid JSON from model response.")


def _make_config(caps: dict[str, bool], max_tokens: int,
                 schema=CandidateAssessmentSchema) -> types.GenerateContentConfig:
    kwargs = dict(
        temperature=0,
        max_output_tokens=max_tokens,
    )
    if caps["system_instruction"]:
        kwargs["system_instruction"] = _SYSTEM_INSTRUCTION
    if caps["json_mode"]:
        kwargs["response_mime_type"] = "application/json"
        kwargs["response_schema"] = schema
    if caps["thinking"]:
        # Disabling thinking is the single biggest latency win on 2.5-series
        # models; models without the knob reject it and _degrade_caps drops it.
        kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
    return types.GenerateContentConfig(**kwargs)


_RETRY_DELAY_RE = re.compile(r"retryDelay['\"]?\s*:\s*['\"]?(\d+)")


def _classify_error(e: Exception) -> str:
    """Returns 'rate_limit', 'config', 'fatal' or 'transient'."""
    code = getattr(e, "code", None)
    text = str(e)
    if code == 429 or "RESOURCE_EXHAUSTED" in text:
        return "rate_limit"
    if code == 400 or "INVALID_ARGUMENT" in text:
        return "config"
    if code in (401, 403, 404) or any(
        s in text for s in ("NOT_FOUND", "PERMISSION_DENIED", "UNAUTHENTICATED", "API key not valid")
    ):
        return "fatal"  # wrong model name / bad key -- retrying cannot help
    return "transient"


def _sleep_before_retry(e: Exception, kind: str, attempt: int) -> None:
    if kind == "rate_limit":
        # Honor the server-suggested retry delay when present; hammering a
        # rate-limited endpoint just extends the 429 window.
        m = _RETRY_DELAY_RE.search(str(e))
        delay = int(m.group(1)) if m else config.LLM_RETRY_BACKOFF_BASE**attempt * 2
        delay = min(delay, 60.0)
    else:
        delay = float(config.LLM_RETRY_BACKOFF_BASE**attempt)
    time.sleep(delay + random.uniform(0, 1.5))  # jitter de-syncs parallel workers


def evaluate_cv(
    cv_text: str,
    job_description: str,
    detected_job_title: str | None = None,
) -> tuple[dict, dict]:
    """Evaluate extracted CV text against a job description. Returns
    (assessment_dict {metrics, evaluation}, llm_stats)."""
    return _run_llm(cv_text, job_description, detected_job_title, metrics_only=False)


def extract_metrics(
    cv_text: str,
    detected_job_title: str | None = None,
) -> tuple[dict, dict]:
    """Extract ONLY the candidate profile metrics from CV text (no job, no
    scoring). Used when a CV is added to the talent pool without applying to a
    job. Returns (assessment_dict {metrics}, llm_stats)."""
    return _run_llm(cv_text, None, detected_job_title, metrics_only=True)


def _run_llm(
    cv_text: str,
    job_description: str | None,
    detected_job_title: str | None,
    metrics_only: bool,
) -> tuple[dict, dict]:
    """Shared LLM call with retry/backoff, capability degradation and output-token
    escalation. `metrics_only` swaps the schema+prompt between full assessment
    (metrics + evaluation) and profile-only extraction (metrics)."""
    schema = CandidateMetricsSchema if metrics_only else CandidateAssessmentSchema
    client = _get_client()
    model = config.MODEL_NAME
    start = time.perf_counter()

    max_tokens = config.MAX_OUTPUT_TOKENS
    escalations_left = config.LLM_MAX_TOKEN_ESCALATIONS
    last_error: Exception | None = None

    for attempt in range(1, config.LLM_MAX_RETRIES + 1):
        # Re-read caps each attempt: another worker may have degraded them.
        caps = _get_caps(model)
        prompt = _build_prompt(cv_text, detected_job_title, job_description, caps,
                               metrics_only=metrics_only)
        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=_make_config(caps, max_tokens, schema),
            )
        except Exception as e:
            kind = _classify_error(e)
            if kind == "fatal":
                raise RuntimeError(
                    f"LLM call rejected permanently (model={model}): {e}"
                ) from e
            if kind == "config":
                dropped = _degrade_caps(model, str(e))
                if dropped:
                    log.info(
                        "Model %s rejected '%s' -- disabled it and retrying", model, dropped
                    )
                    continue
            last_error = e
            log.warning("LLM attempt %d/%d failed (%s): %s",
                        attempt, config.LLM_MAX_RETRIES, kind, str(e)[:200])
            if attempt < config.LLM_MAX_RETRIES:
                _sleep_before_retry(e, kind, attempt)
            continue

        raw = response.text
        finish = str(response.candidates[0].finish_reason) if response.candidates else "NO_CANDIDATES"
        truncated = "MAX_TOKENS" in finish

        assessment = None
        if raw and not truncated:
            try:
                assessment = _extract_json(raw)
            except (ValueError, json.JSONDecodeError) as e:
                # Malformed JSON from a schema-constrained call is almost
                # always a hidden truncation -- treat it the same way.
                truncated, last_error = True, e

        if assessment is None:
            if escalations_left > 0:
                escalations_left -= 1
                max_tokens *= 2
                log.warning(
                    "Response truncated/unparseable (finish_reason=%s); "
                    "retrying with max_output_tokens=%d", finish, max_tokens,
                )
                continue
            last_error = last_error or RuntimeError(
                f"Response truncated/empty (finish_reason={finish})"
            )
            break

        # Some models wrap the metrics-only reply as {"metrics": {...}} even
        # when asked for the bare object; unwrap so it validates against
        # CandidateMetricsSchema and isn't double-nested by the wrap below.
        if (metrics_only and isinstance(assessment, dict)
                and "contact_info" not in assessment
                and isinstance(assessment.get("metrics"), dict)):
            assessment = assessment["metrics"]

        # Normalize through pydantic. Coerces near-misses (e.g. float scores
        # from non-schema-constrained models); a hard mismatch keeps the raw
        # dict but is flagged so downstream consumers can filter on it.
        schema_valid = True
        try:
            assessment = schema.model_validate(assessment).model_dump()
        except ValidationError as e:
            schema_valid = False
            log.warning("Response JSON deviates from schema; keeping raw. %s", str(e)[:300])

        # metrics-only returns the bare metrics object; wrap it so downstream code
        # always sees assessment["metrics"] (evaluation absent = profile only).
        if metrics_only:
            assessment = {"metrics": assessment}

        stats = {
            "model": model,
            "llm_seconds": round(time.perf_counter() - start, 3),
            "json_mode": caps["json_mode"],
            "schema_valid": schema_valid,
        }
        if response.usage_metadata:
            stats["prompt_tokens"] = response.usage_metadata.prompt_token_count
            stats["output_tokens"] = response.usage_metadata.candidates_token_count
            stats["total_tokens"] = response.usage_metadata.total_token_count
        return assessment, stats

    raise RuntimeError(
        f"LLM evaluation failed after {config.LLM_MAX_RETRIES} attempts"
    ) from last_error
