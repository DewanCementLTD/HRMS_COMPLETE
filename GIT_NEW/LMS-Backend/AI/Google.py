import os
import time
import json
import re
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

# Initialize the Gemini client (the same client/File API is used to host Gemma 4 models).
# Key comes from the environment / AI/.env — NEVER hardcode it (GitHub push
# protection blocks commits containing API keys).
API_KEY = os.environ.get("GEMINI_API_KEY", "")
JOB_DES = "We are looking for a Backend Engineer with Python and Docker experience."
RESUME_FILE_PATH = "./Resume/resume1.pdf"

client = genai.Client(api_key=API_KEY)

# =====================================================================
# 0. MODEL CONFIG
# =====================================================================
# Official Gemini API model id for the hosted Gemma 4 26B-A4B (MoE) instruct model.
MODEL_NAME = "gemma-4-31b-it"

# =====================================================================
# 1. DEFINE NESTED SCHEMAS
# =====================================================================

class ContactInfo(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None
    location: str | None = None

class Education(BaseModel):
    institution: str
    degree: str | None = None
    graduation_year: str | None = None

class Experience(BaseModel):
    company: str
    role: str
    duration: str | None = Field(default=None, description="Start date to end date, or total duration")
    description: str | None = None

class CandidateMetricsSchema(BaseModel):
    contact_info: ContactInfo
    education: list[Education]
    experience: list[Experience]
    skills: list[str]

class EvaluationSchema(BaseModel):
    compatibility: int
    technical_match: int
    experience_match: int
    overall_score: int
    strengths: list[str]
    weaknesses: list[str]
    recommendation: str
    summary: str

# Master Schema combining both JSON objects
class CandidateAssessmentSchema(BaseModel):
    metrics: CandidateMetricsSchema
    evaluation: EvaluationSchema

# =====================================================================
# 2. HELPERS
# =====================================================================

def upload_resume_with_fallback(resume_path: str):
    """
    Uploads the resume via the File API. Gemma 4's model card only documents
    text/image/video multimodal input -- application/pdf is not explicitly
    confirmed the way it is for Gemini models. We try the direct PDF upload
    first; if that fails (or the model clearly can't read it), fall back to
    rasterizing pages to PNG with PyMuPDF and uploading those instead.
    """
    try:
        uploaded = client.files.upload(file=resume_path)
        return [uploaded]
    except Exception as e:
        print(f"Direct PDF upload failed or unsupported ({e}); falling back to page-image rasterization...")

    try:
        import fitz  # type: ignore # PyMuPDF
    except ImportError:
        raise RuntimeError(
            "PDF upload failed and PyMuPDF isn't installed for the image fallback. "
            "Install it with: pip install pymupdf --break-system-packages"
        )

    doc = fitz.open(resume_path)
    uploaded_parts = []
    for page_index in range(len(doc)):
        page = doc.load_page(page_index)
        pix = page.get_pixmap(dpi=200)
        img_path = f"/tmp/resume_page_{page_index}.png"
        pix.save(img_path)
        uploaded_parts.append(client.files.upload(file=img_path))
    doc.close()
    return uploaded_parts


def extract_json(raw_text: str) -> dict:
    """
    Defensive JSON extraction. Gemma 4 can emit reasoning/thinking text or
    markdown fences before the actual JSON payload even when
    response_mime_type='application/json' is set. This strips anything
    outside the outermost {...} block before parsing.
    """
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        pass

    # Strip common markdown code fences
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw_text, re.DOTALL)
    if fenced:
        return json.loads(fenced.group(1))

    # Fall back to grabbing the first {...} block greedily
    brace_match = re.search(r"\{.*\}", raw_text, re.DOTALL)
    if brace_match:
        return json.loads(brace_match.group(0))

    raise ValueError("Could not extract valid JSON from model response.")


# =====================================================================
# 3. RUN WORKFLOW
# =====================================================================

print(f"Uploading resume file: {RESUME_FILE_PATH}...")
uploaded_parts = upload_resume_with_fallback(RESUME_FILE_PATH)

# Define your evaluation goal
job_description = JOB_DES

prompt = f"""
Analyze the candidate from the attached resume document.
1. Extract all relevant profile metadata into the 'metrics' object.
2. Evaluate the candidate against the provided Job Description into the 'evaluation' object.

Job Description: {job_description}
Ensure you return a valid JSON object matching the requested schema.
Ensure the Parsing of All fields is accurate and complete.
Return ONLY the JSON object -- no explanation, no reasoning, no markdown fences.
"""

system_instruction = (
    "Think minimally and efficiently. Do not narrate your reasoning process. "
    "Respond with only the final JSON object that matches the required schema -- "
    "no preamble, no explanation, no markdown code fences."
)

print(f"\nProcessing evaluation with {MODEL_NAME}...")
start_time = time.perf_counter()

max_retries = 3
response = None
last_error = None
for attempt in range(1, max_retries + 1):
    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=[*uploaded_parts, prompt],
            config=types.GenerateContentConfig(
                temperature=0,
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_schema=CandidateAssessmentSchema,  # SDK still auto-converts Pydantic -> schema for Gemma
            ),
        )
        break
    except Exception as e:
        last_error = e
        print(f"Attempt {attempt}/{max_retries} failed: {e}")
        if attempt < max_retries:
            backoff = 2 ** attempt
            print(f"Retrying in {backoff}s...")
            time.sleep(backoff)

if response is None:
    raise last_error

end_time = time.perf_counter()
elapsed_time = end_time - start_time

print(f"Time Taken: {elapsed_time:.4f} seconds")

if response.usage_metadata:
    prompt_tokens = response.usage_metadata.prompt_token_count
    output_tokens = response.usage_metadata.candidates_token_count
    total_tokens = response.usage_metadata.total_token_count

    print(f"Prompt Tokens: {prompt_tokens}")
    print(f"Output Tokens: {output_tokens}")
    print(f"Total Tokens Processed: {total_tokens}")

    if output_tokens and elapsed_time > 0:
        tokens_per_second = output_tokens / elapsed_time
        print(f"Generation Speed: {tokens_per_second:.2f} tokens/second")

print("\n--- Raw Response Output ---")
print(response.text)

print("\n--- Parsed JSON ---")
try:
    parsed = extract_json(response.text)
    print(json.dumps(parsed, indent=2))
except ValueError as e:
    print(f"Failed to parse structured output: {e}")