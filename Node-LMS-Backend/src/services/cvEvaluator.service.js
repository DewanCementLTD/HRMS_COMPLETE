import { GoogleGenAI } from '@google/genai';

import { logger } from '../utils/logger.js';
const LLM_MAX_RETRIES = 6;
const LLM_RETRY_BACKOFF_BASE = 2; // seconds
const MAX_OUTPUT_TOKENS = 8192;
const LLM_MAX_TOKEN_ESCALATIONS = 2;
const MAX_TEXT_CHARS = 40000;

// Caps state tracking (simplified port from Python's threading.Lock mechanism)
const modelCaps = new Map();

function seedCaps(model) {
  const m = model.toLowerCase();
  if (m.startsWith('gemma') || m.includes('/gemma')) {
    return { system_instruction: false, json_mode: false, thinking: false };
  }
  return { system_instruction: true, json_mode: true, thinking: true };
}

function getCaps(model) {
  if (!modelCaps.has(model)) {
    modelCaps.set(model, seedCaps(model));
  }
  return { ...modelCaps.get(model) };
}

function degradeCaps(model, errorText) {
  const lowered = errorText.toLowerCase();
  const caps = modelCaps.get(model) || seedCaps(model);
  modelCaps.set(model, caps); // Ensure it's in the map

  if (caps.thinking && lowered.includes('thinking')) {
    caps.thinking = false;
    return 'thinking';
  }
  if (caps.system_instruction && (lowered.includes('developer instruction') || lowered.includes('system instruction'))) {
    caps.system_instruction = false;
    return 'system_instruction';
  }
  if (caps.json_mode && (lowered.includes('json') || lowered.includes('response_schema') || lowered.includes('response schema') || lowered.includes('mime'))) {
    caps.json_mode = false;
    return 'json_mode';
  }
  for (const name of ['thinking', 'system_instruction', 'json_mode']) {
    if (caps[name]) {
      caps[name] = false;
      return name;
    }
  }
  return null;
}

let client = null;
function getClient() {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

const SYSTEM_INSTRUCTION = "You are a fast, precise CV screening engine. Do not narrate reasoning. Respond with only the final JSON object matching the required schema -- no preamble, no explanation, no markdown code fences.";

const METRICS_OBJ = `{
    "contact_info": {"name": "...", "email": null, "phone": null, "location": null},
    "preferred_job_title": null,
    "profile_summary": "...",
    "education": [{"institution": "...", "degree": null, "graduation_year": null}],
    "experience": [{"company": "...", "role": "...", "duration": null, "description": null}],
    "skills": ["..."]
  }`;

const JSON_TEMPLATE = `{
  "metrics": ${METRICS_OBJ},
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
}`;

const CandidateAssessmentSchema = {
  type: 'OBJECT',
  properties: {
    metrics: {
      type: 'OBJECT',
      properties: {
        contact_info: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            email: { type: 'STRING', nullable: true },
            phone: { type: 'STRING', nullable: true },
            location: { type: 'STRING', nullable: true },
          },
          required: ['name'],
        },
        preferred_job_title: { type: 'STRING', nullable: true, description: "The job title the candidate is targeting" },
        profile_summary: {
          type: 'STRING',
          nullable: true,
          description: "A concise 2-3 sentence professional summary of the candidate (seniority, domains, standout strengths) — candidate-centric, not tied to any job."
        },
        education: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              institution: { type: 'STRING' },
              degree: { type: 'STRING', nullable: true },
              graduation_year: { type: 'STRING', nullable: true },
            },
            required: ['institution'],
          }
        },
        experience: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              company: { type: 'STRING' },
              role: { type: 'STRING' },
              duration: { type: 'STRING', nullable: true, description: "Start date to end date, or total duration" },
              description: { type: 'STRING', nullable: true },
            },
            required: ['company', 'role'],
          }
        },
        skills: {
          type: 'ARRAY',
          items: { type: 'STRING' }
        },
      },
      required: ['contact_info', 'education', 'experience', 'skills'],
    },
    evaluation: {
      type: 'OBJECT',
      properties: {
        compatibility: { type: 'INTEGER' },
        technical_match: { type: 'INTEGER' },
        experience_match: { type: 'INTEGER' },
        overall_score: { type: 'INTEGER' },
        strengths: { type: 'ARRAY', items: { type: 'STRING' } },
        weaknesses: { type: 'ARRAY', items: { type: 'STRING' } },
        recommendation: { type: 'STRING' },
        summary: { type: 'STRING' },
      },
      required: ['compatibility', 'technical_match', 'experience_match', 'overall_score', 'strengths', 'weaknesses', 'recommendation', 'summary'],
    }
  },
  required: ['metrics', 'evaluation'],
};

// Metrics-only schema (profile extraction with no job scoring) — the bare metrics
// object, matching cv_evaluator.py's CandidateMetricsSchema.
const CandidateMetricsSchema = CandidateAssessmentSchema.properties.metrics;

// Coerce one score to an integer (mirror pydantic LenientInt: float -> round).
function coerceInt(v) {
  if (typeof v === 'number') return Math.round(v);
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Math.round(Number(v));
  return v;
}

// Lightweight stand-in for pydantic model_validate: coerce near-miss numeric
// types in place and report whether the response conforms to the schema
// (sets stats.schema_valid). Never throws.
function normalizeAssessment(assessment, metricsOnly) {
  if (!assessment || typeof assessment !== 'object') return false;
  let valid = true;
  const metrics = metricsOnly ? assessment : assessment.metrics;
  if (!metrics || typeof metrics !== 'object' || !metrics.contact_info) {
    valid = false;
  } else {
    const phone = metrics.contact_info.phone;
    if (phone !== null && phone !== undefined && typeof phone !== 'string') {
      metrics.contact_info.phone = String(phone); // LenientStr
    }
  }
  if (!metricsOnly) {
    const ev = assessment.evaluation;
    if (!ev || typeof ev !== 'object') {
      valid = false;
    } else {
      for (const k of ['compatibility', 'technical_match', 'experience_match', 'overall_score']) {
        ev[k] = coerceInt(ev[k]);
        if (typeof ev[k] !== 'number' || !Number.isInteger(ev[k])) valid = false;
      }
    }
  }
  return valid;
}

function buildPrompt(cvText, detectedJobTitle, jobDescription, caps, metricsOnly = false) {
  const hint = detectedJobTitle ? `\nHeuristic pre-detection suggests the candidate's preferred job title is '${detectedJobTitle}' -- confirm or correct this from the CV text.` : "";
  const template = metricsOnly ? METRICS_OBJ : JSON_TEMPLATE;
  const schemaClause = caps.json_mode
    ? "Return ONLY the JSON object matching the requested schema."
    : `Return ONLY a single valid JSON object (no markdown fences, no text before or after it) with exactly this structure -- every key shown is required; use null where a value is unknown; all scores are integers 0-100:\n${template}`;

  const target = metricsOnly ? "the JSON object" : "the 'metrics' object";
  const extractionTask = `Extract ALL relevant profile metadata into ${target}:
- contact_info (full name, email, phone, location)
- preferred_job_title (the role the candidate is targeting)${hint}
- profile_summary: 2-3 sentence candidate-centric summary (seniority, domains, strengths)
- education: every degree/qualification (institution, degree, graduation_year)
- experience: every position (company, role, duration, a <=40-word description)
- skills: every distinct technical and professional skill mentioned
Be thorough on extraction but concise in wording -- do NOT copy the CV verbatim.`;

  let body = "";
  if (metricsOnly) {
    body = `Analyze the candidate from the CV text below and build their profile.\n\n${extractionTask}\n\n--- CV TEXT START ---\n${cvText.substring(0, MAX_TEXT_CHARS)}\n--- CV TEXT END ---\n\n${schemaClause}`;
  } else {
    body = `Analyze the candidate from the CV text below.\n1. ${extractionTask}\n2. Evaluate the candidate against the Job Description into the 'evaluation' object (scores are integers 0-100): compatibility, technical_match, experience_match, overall_score, strengths, weaknesses, a one-word/phrase recommendation, and a job-specific summary.\n\nJob Description: ${jobDescription}\n\n--- CV TEXT START ---\n${cvText.substring(0, MAX_TEXT_CHARS)}\n--- CV TEXT END ---\n\n${schemaClause}`;
  }

  if (!caps.system_instruction) {
    body = `${SYSTEM_INSTRUCTION}\n\n${body}`;
  }
  return body;
}

function extractJson(rawText) {
  try {
    return JSON.parse(rawText);
  } catch (e) {
    // pass
  }
  const fenced = rawText.match(/```(?:json)?\s*({[\s\S]*?})\s*```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch (e) {
      // pass
    }
  }
  const braceMatch = rawText.match(/{[\s\S]*}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch (e) {
      // pass
    }
  }
  throw new Error("Could not extract valid JSON from model response.");
}

function classifyError(e) {
  const code = e.status;
  const text = e.message || String(e);
  if (code === 429 || text.includes("RESOURCE_EXHAUSTED")) return "rate_limit";
  if (code === 400 || text.includes("INVALID_ARGUMENT")) return "config";
  if ([401, 403, 404].includes(code) || ["NOT_FOUND", "PERMISSION_DENIED", "UNAUTHENTICATED", "API key not valid"].some(s => text.includes(s))) return "fatal";
  return "transient";
}

async function sleepBeforeRetry(e, kind, attempt) {
  let delay = 0;
  if (kind === "rate_limit") {
    const m = String(e).match(/retryDelay['"]?\s*:\s*['"]?(\d+)/);
    delay = m ? parseInt(m[1], 10) : Math.pow(LLM_RETRY_BACKOFF_BASE, attempt) * 2;
    delay = Math.min(delay, 60.0);
  } else {
    delay = Math.pow(LLM_RETRY_BACKOFF_BASE, attempt);
  }
  const jitter = Math.random() * 1.5;
  await new Promise(r => setTimeout(r, (delay + jitter) * 1000));
}

function makeConfig(caps, maxTokens, schema) {
  const config = {
    temperature: 0,
    maxOutputTokens: maxTokens,
  };
  if (caps.system_instruction) {
    config.systemInstruction = SYSTEM_INSTRUCTION;
  }
  if (caps.json_mode) {
    config.responseMimeType = "application/json";
    config.responseSchema = schema;
  }
  if (caps.thinking) {
    // Disabling thinking is the single biggest latency win on 2.5-series models;
    // models without the knob reject it and degradeCaps drops it (mirrors cv_evaluator.py).
    config.thinkingConfig = { thinkingBudget: 0 };
  }
  return config;
}

export async function runLlm(cvText, jobDescription, detectedJobTitle, metricsOnly) {
  const schema = metricsOnly ? CandidateMetricsSchema : CandidateAssessmentSchema;
  const c = getClient();
  const model = process.env.CV_MODEL || "gemini-2.5-flash-lite";
  const start = process.uptime();

  let maxTokens = MAX_OUTPUT_TOKENS;
  let escalationsLeft = LLM_MAX_TOKEN_ESCALATIONS;
  let lastError = null;

  for (let attempt = 1; attempt <= LLM_MAX_RETRIES; attempt++) {
    const caps = getCaps(model);
    const prompt = buildPrompt(cvText, detectedJobTitle, jobDescription, caps, metricsOnly);
    
    let response;
    try {
      response = await c.models.generateContent({
        model: model,
        contents: prompt,
        config: makeConfig(caps, maxTokens, schema),
      });
    } catch (e) {
      const kind = classifyError(e);
      if (kind === "fatal") throw new Error(`LLM call rejected permanently (model=${model}): ${e.message}`);
      if (kind === "config") {
        const dropped = degradeCaps(model, e.message);
        if (dropped) {
          logger.info(`Model ${model} rejected '${dropped}' -- disabled it and retrying`);
          continue;
        }
      }
      lastError = e;
      logger.warn(`LLM attempt ${attempt}/${LLM_MAX_RETRIES} failed (${kind}): ${e.message.substring(0, 200)}`);
      if (attempt < LLM_MAX_RETRIES) {
        await sleepBeforeRetry(e, kind, attempt);
      }
      continue;
    }

    const raw = response.text;
    const finish = response.candidates?.[0]?.finishReason || "NO_CANDIDATES";
    let truncated = finish.includes("MAX_TOKENS");
    let assessment = null;

    if (raw && !truncated) {
      try {
        assessment = extractJson(raw);
      } catch (e) {
        truncated = true;
        lastError = e;
      }
    }

    if (!assessment) {
      if (escalationsLeft > 0) {
        escalationsLeft--;
        maxTokens *= 2;
        logger.warn(`Response truncated/unparseable (finishReason=${finish}); retrying with maxOutputTokens=${maxTokens}`);
        continue;
      }
      lastError = lastError || new Error(`Response truncated/empty (finishReason=${finish})`);
      break;
    }

    if (metricsOnly && assessment && !assessment.contact_info && assessment.metrics) {
      assessment = assessment.metrics;
    }

    // Normalize through the schema (coerce near-misses, flag validity) BEFORE the
    // metrics-only wrap, matching cv_evaluator.py's ordering.
    const schemaValid = normalizeAssessment(assessment, metricsOnly);

    if (metricsOnly) {
      assessment = { metrics: assessment };
    }

    const stats = {
      model,
      llm_seconds: Number((process.uptime() - start).toFixed(3)),
      json_mode: caps.json_mode,
      schema_valid: schemaValid,
    };
    if (response.usageMetadata) {
      stats.prompt_tokens = response.usageMetadata.promptTokenCount;
      stats.output_tokens = response.usageMetadata.candidatesTokenCount;
      stats.total_tokens = response.usageMetadata.totalTokenCount;
    }

    return { assessment, stats };
  }
  throw new Error(`LLM evaluation failed after ${LLM_MAX_RETRIES} attempts. ${lastError ? lastError.message : ''}`);
}

export async function evaluateCv(cvText, jobDescription, detectedJobTitle) {
  return await runLlm(cvText, jobDescription, detectedJobTitle, false);
}

export async function extractMetrics(cvText, detectedJobTitle) {
  return await runLlm(cvText, null, detectedJobTitle, true);
}
