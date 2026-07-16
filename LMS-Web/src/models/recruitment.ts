export interface Job {
  job_id: number;
  job_title: string;
  dept_no: number | null;
  dept_name: string | null;
  open_positions: number;
  filled_positions: number;
  remaining_positions: number;
  job_desc: string | null;
  skills_req: string | null;              // must-have skills (used for AI CV matching)
  // ── AI CV-scoring fields ──
  employment_type: string | null;         // Full-time / Part-time / Contract
  work_mode: string | null;               // On-site / Hybrid / Remote
  nice_to_have_skills: string | null;
  min_experience_years: number | null;
  education_req: string | null;
  salary_min: number | null;
  salary_max: number | null;
  status: "OPEN" | "CLOSED" | "ON_HOLD";
  created_by: string | null;
  created_at: string | null;
}

export interface Application {
  app_id: number;
  job_id: number;
  job_title: string;
  candidate_id: number | null;   // link to the Talent Pool profile (null = legacy quick-add)
  candidate_name: string;
  mobile: string | null;
  email: string | null;
  source: string | null;
  app_date: string | null;
  status: "PENDING" | "SHORTLISTED" | "REJECTED";
  notes: string | null;
  created_at: string | null;
}

// ── Talent Pool ──
// One person = one permanent candidate profile (never duplicated).
// Education / experience / skills hang off the candidate; applications link
// candidate → job.

export interface CandidateEducation {
  education_id?: number;
  institution: string | null;
  degree: string | null;
  graduation_year: string | null;
}

export interface CandidateExperience {
  experience_id?: number;
  company: string | null;
  role: string | null;
  duration: string | null;
  description: string | null;
}

export interface CandidateListItem {
  candidate_id: number;
  candidate_name: string;
  email: string | null;
  mobile: string | null;
  location: string | null;
  preferred_job_title: string | null;
  cv_file_name: string | null;
  created_at: string | null;
  applications: number;          // how many jobs they've applied to
  skills: string | null;         // comma-joined for the list view
}

export interface CandidateApplication {
  app_id: number;
  job_id: number;
  job_title: string;
  status: string;
  app_date: string | null;
  ai_overall_score: number | null;   // latest AI score for this application (null = not scored yet)
}

export interface CandidateDetail {
  candidate_id: number;
  candidate_name: string;
  email: string | null;
  mobile: string | null;
  location: string | null;
  preferred_job_title: string | null;
  cv_file_name: string | null;
  cv_file_path: string | null;
  profile_summary: string | null;
  created_at: string | null;
  updated_at: string | null;
  education: CandidateEducation[];
  experience: CandidateExperience[];
  skills: string[];
  applications: CandidateApplication[];
}

// ── AI shortlist (top-K applicants ranked for a job) ──

export interface RankedApplicant {
  app_id: number;
  candidate_id: number | null;
  candidate_name: string | null;
  email: string | null;
  mobile: string | null;
  location: string | null;
  preferred_job_title: string | null;
  cv_file_name: string | null;
  status: string;                          // PENDING / SHORTLISTED / REJECTED
  source: string | null;
  app_date: string | null;
  evaluation_id: number | null;
  overall_score: number | null;            // 0-100, null = not evaluated yet
  compatibility: number | null;
  technical_match: number | null;
  experience_match: number | null;
  recommendation: string | null;
  ai_note: string | null;                  // the evaluation summary
  model_name: string | null;
  processed_at: string | null;
  score_band: "strong" | "review" | "weak" | null;  // green / amber / red
  ai_flagged: boolean;                     // borderline score → needs review
}

export interface TopCandidatesResponse {
  status: string;
  job_id: number;
  job_title: string;
  top_k: number;
  counts: {
    total: number; evaluated: number; pending: number;
    flagged: number; shortlisted: number; rejected: number;
  };
  candidates: RankedApplicant[];
}

// ── Bulk CV upload + per-file scoring status ──

export interface CvUploadResult {
  filename: string;
  saved_as: string | null;
  queued: boolean;
  error?: string;
}

export interface CvBulkUploadResponse {
  status: string;
  job_id: number;
  queued: number;
  total: number;
  results: CvUploadResult[];
}

export type CvFileState = "processing" | "scored" | "profiled" | "unreadable" | "failed" | "unknown";

export interface CvStatusResponse {
  job_id: number;
  files: Record<string, { state: CvFileState; score: number | null }>;
}

export interface Interview {
  interview_id: number;
  app_id: number;
  candidate_name: string;
  job_title: string;
  interview_date: string | null;
  interview_type: string | null;
  interviewer: string | null;
  feedback_owner: string | null;
  technical_rating: string | null;
  communication_rating: string | null;
  culture_fit_rating: string | null;
  recommendation: string | null;      // Next round / Send offer / Reject
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  feedback: string | null;
  created_at: string | null;
}

export interface Offer {
  offer_id: number;
  app_id: number;
  candidate_name: string;
  job_title: string;
  offer_date: string | null;
  salary_offered: number | null;
  status: "SENT" | "ACCEPTED" | "REJECTED";
  notes: string | null;
  created_at: string | null;
}

export interface RecruitmentAnalytics {
  open_jobs: number;
  total_applications: number;
  pending: number;
  shortlisted: number;
  rejected: number;
  total_interviews: number;
  hires_this_month: number;
  avg_time_to_hire_days: number;
  avg_cost_per_hire: number;
  monthly_hires: { month: string; hires: number }[];
}

// ── Interview panel pool + interviewer assignments ──

export interface PanelPoolMember {
  panel_pool_id: number;
  compc: number;
  brnch: number;
  empcode: string;
  is_active: "Y" | "N";
  added_by: string;
  added_on: string | null;
  name: string | null;          // joined from HR_EMP_MASTER
  emp_status: string | null;
  brnch_name: string | null;
}

export interface PanelPoolResponse {
  items: PanelPoolMember[];
  // All branches of the company — lets the UI show "All Branches" when a
  // member is active in every one (derived, not stored).
  company_branches: { lcode: number; descr: string }[];
}

export interface PanelOption {
  empcode: string;
  name: string | null;
  branches: string;             // comma-separated branch codes the emp pools in
}

// ── Notification templates + per-application selections ──

export interface NotificationTemplate {
  template_id: number;
  template_name: string;
  notification_type: "EMAIL" | "WHATSAPP";
  recipient_type: "INTERVIEWER" | "CANDIDATE";
  event_type: string;                 // Interview Scheduled / Shortlisted / Rejected / …
  subject: string | null;             // EMAIL templates only
  message_body: string;               // raw body, {{placeholders}} intact
  placeholders: string[];
  is_active: "Y" | "N";
  created_by: string;
  created_on: string | null;
}

// The outbox: ONE row per actual message, fully rendered and send-ready —
// the recipient's own email/phone (panel member's for INTERVIEWER rows, the
// candidate's for CANDIDATE rows) plus the resolved subject and body.
export interface NotificationSelection {
  message_id: number;
  app_id: number;
  template_id: number | null;
  template_name: string | null;
  event_type: string | null;          // Interview Scheduled / Shortlisted / Rejected
  notification_type: string;          // EMAIL / WHATSAPP
  recipient_type: string;             // CANDIDATE / INTERVIEWER
  empcode: string | null;             // interviewer rows only
  person_name: string | null;         // candidate or interviewer name
  email: string | null;
  phone: string | null;
  subject: string | null;             // rendered (email only)
  message_body: string | null;        // fully rendered message
  job_title: string | null;
  interview_mode: string | null;
  status: string;                     // PENDING → (future) SENT
  created_by: string;
  created_on: string | null;
}

export interface InterviewAssignment {
  assignment_id: number;
  app_id: number;
  interview_id: number | null;
  empcode: string;
  name: string | null;
  interview_type: string;
  interview_date: string;
  start_time: string;
  end_time: string;
  assigned_by: string;
  assigned_on: string | null;
  status: "PENDING" | "CONDUCTED";
  remarks: string | null;
}
