import { apiRequest } from "./api";
import {
  Job, Application, Interview, Offer, RecruitmentAnalytics,
  CandidateListItem, CandidateDetail, TopCandidatesResponse,
  CvBulkUploadResponse, CvStatusResponse,
  PanelPoolResponse, PanelOption, InterviewAssignment,
  NotificationTemplate, NotificationSelection,
} from "@/models/recruitment";

// scope = the currently selected company/branch, so recruitment data is
// filtered to match the rest of the HRMS UI (not the admin's full rights).
export interface RecruitmentScope { compc?: string; brnch?: string }

const scopeQS = (scope?: RecruitmentScope) => {
  let s = "";
  if (scope?.compc) s += `&compc=${encodeURIComponent(scope.compc)}`;
  if (scope?.brnch) s += `&brnch=${encodeURIComponent(scope.brnch)}`;
  return s;
};

const q = (adminCardNo: string, extra = "") =>
  `admin_card_no=${encodeURIComponent(adminCardNo)}${extra}`;

// --- Jobs ---
export const listJobs = (adminCardNo: string, status?: string, scope?: RecruitmentScope) =>
  apiRequest<{ items: Job[] }>(
    `/recruitment/jobs?${q(adminCardNo, (status ? `&status=${status}` : "") + scopeQS(scope))}`
  );

export const createJob = (adminCardNo: string, data: Record<string, unknown>, scope?: RecruitmentScope) =>
  apiRequest(`/recruitment/jobs?${q(adminCardNo, scopeQS(scope))}`, { method: "POST", body: data });

export const updateJob = (adminCardNo: string, jobId: number, data: Record<string, unknown>) =>
  apiRequest(`/recruitment/jobs/${jobId}?${q(adminCardNo)}`, { method: "PUT", body: data });

// AI shortlist: the top-K applicants for a job, ranked by their stored AI score.
export const getTopCandidates = (adminCardNo: string, jobId: number, topK?: number, scope?: RecruitmentScope) =>
  apiRequest<TopCandidatesResponse>(
    `/recruitment/jobs/${jobId}/top-candidates?${q(adminCardNo, (topK ? `&top_k=${topK}` : "") + scopeQS(scope))}`
  );

// "Add candidates to a job" — queue multiple CV PDFs for AI processing.
// jobId optional: with a job → application + AI ranking; without → talent pool only.
export async function uploadCvsBulk(
  adminCardNo: string, jobId: number | null, files: File[], scope?: RecruitmentScope,
): Promise<CvBulkUploadResponse> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const jobQS = jobId != null ? `&job_id=${jobId}` : "";
  const res = await fetch(
    `/api/recruitment/candidates/upload-cvs?${q(adminCardNo, jobQS + scopeQS(scope))}`,
    { method: "POST", body: form },  // browser sets the multipart boundary
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(typeof err.detail === "string" ? err.detail : "Upload failed");
  }
  return res.json() as Promise<CvBulkUploadResponse>;
}

// Poll the per-file processing status of uploaded CVs (by their saved_as names).
export const getCvStatus = (adminCardNo: string, jobId: number | null, savedNames: string[], scope?: RecruitmentScope) =>
  apiRequest<CvStatusResponse>(
    `/recruitment/candidates/cv-status?${q(adminCardNo,
      (jobId != null ? `&job_id=${jobId}` : "") +
      `&files=${encodeURIComponent(savedNames.join(","))}` + scopeQS(scope))}`
  );

// --- Applications ---
export const listApplications = (adminCardNo: string, jobId?: number, status?: string, scope?: RecruitmentScope) => {
  const params = new URLSearchParams({ admin_card_no: adminCardNo });
  if (jobId != null) params.set("job_id", String(jobId));
  if (status) params.set("status", status);
  if (scope?.compc) params.set("compc", scope.compc);
  if (scope?.brnch) params.set("brnch", scope.brnch);
  return apiRequest<{ items: Application[] }>(`/recruitment/applications?${params}`);
};

export const createApplication = (adminCardNo: string, data: Record<string, unknown>) =>
  apiRequest(`/recruitment/applications?${q(adminCardNo)}`, { method: "POST", body: data });

export const updateApplicationStatus = (
  adminCardNo: string,
  appId: number,
  status: string,
  notes?: string
) =>
  apiRequest(`/recruitment/applications/${appId}/status?${q(adminCardNo)}`, {
    method: "PATCH",
    body: { status, notes },
  });

// --- Interviews ---
export const listInterviews = (adminCardNo: string, appId?: number, status?: string, scope?: RecruitmentScope) => {
  const params = new URLSearchParams({ admin_card_no: adminCardNo });
  if (appId != null) params.set("app_id", String(appId));
  if (status) params.set("status", status);
  if (scope?.compc) params.set("compc", scope.compc);
  if (scope?.brnch) params.set("brnch", scope.brnch);
  return apiRequest<{ items: Interview[] }>(`/recruitment/interviews?${params}`);
};

export const createInterview = (adminCardNo: string, data: Partial<Interview> & { app_id: number }) =>
  apiRequest(`/recruitment/interviews?${q(adminCardNo)}`, { method: "POST", body: data });

export const updateInterview = (adminCardNo: string, interviewId: number, data: object) =>
  apiRequest(`/recruitment/interviews/${interviewId}?${q(adminCardNo)}`, {
    method: "PATCH",
    body: data,
  });

// Change date/start/end time (and optionally location/mode) of an already-
// scheduled interview. Re-checks interviewer clashes server-side; a 409 means
// the new slot overlaps another PENDING interview for one of the interviewers.
export const rescheduleInterview = (
  adminCardNo: string, interviewId: number,
  data: { interview_date?: string; start_time?: string; end_time?: string;
          location_or_link?: string; interview_mode?: string },
) =>
  apiRequest<{ status: string; interview_date: string; start_time: string; end_time: string }>(
    `/recruitment/interviews/${interviewId}/reschedule?${q(adminCardNo)}`,
    { method: "PATCH", body: data });

// --- Interview panel pool ---
// The pool of employees allowed to conduct interviews, per company+branch.
// With no branch selected ("All Branches") adds/removals fan out to every
// branch of the company on the server.

export const getPanelPool = (adminCardNo: string, scope?: RecruitmentScope, includeInactive = false) =>
  apiRequest<PanelPoolResponse>(
    `/recruitment/panel-pool?${q(adminCardNo, scopeQS(scope) + (includeInactive ? "&include_inactive=true" : ""))}`
  );

export const addPanelPoolMembers = (adminCardNo: string, empcodes: string[], scope?: RecruitmentScope) =>
  apiRequest<{ status: string; inserted: number; reactivated: number; rejected: string[] }>(
    `/recruitment/panel-pool?${q(adminCardNo, scopeQS(scope))}`,
    { method: "POST", body: { empcodes } });

// Soft-remove one specific pool row (single company+branch membership).
export const deactivatePanelPoolRow = (adminCardNo: string, panelPoolId: number) =>
  apiRequest(`/recruitment/panel-pool/${panelPoolId}?${q(adminCardNo)}`, { method: "DELETE" });

// Scope-aware soft removal: in "All Branches" view deactivates the employee
// across every branch of the company.
export const deactivatePanelPoolMember = (adminCardNo: string, empcode: string, scope?: RecruitmentScope) =>
  apiRequest<{ status: string; deactivated: number }>(
    `/recruitment/panel-pool/deactivate?${q(adminCardNo, scopeQS(scope))}`,
    { method: "POST", body: { empcode } });

// --- Interviewer assignments ---

export const getInterviewPanelOptions = (adminCardNo: string, appId: number) =>
  apiRequest<{ items: PanelOption[] }>(
    `/recruitment/applications/${appId}/interview-panel-options?${q(adminCardNo)}`);

export const createInterviewAssignments = (
  adminCardNo: string, appId: number,
  data: { empcodes: string[]; interview_type: string; interview_date: string;
          start_time: string; end_time?: string; remarks?: string;
          location_or_link?: string; interview_mode?: string },
) =>
  apiRequest<{ status: string; interview_id: number; assignment_ids: number[] }>(
    `/recruitment/applications/${appId}/interview-assignments?${q(adminCardNo)}`,
    { method: "POST", body: data });

export const listInterviewAssignments = (adminCardNo: string, appId: number) =>
  apiRequest<{ items: InterviewAssignment[] }>(
    `/recruitment/applications/${appId}/interview-assignments?${q(adminCardNo)}`);

// --- Notification templates + per-application selections ---
// Templates are stored raw ({{placeholders}} intact); delivery is future-phase.

export const listNotificationTemplates = (
  adminCardNo: string,
  filters?: { event_type?: string; notification_type?: string; recipient_type?: string },
) => {
  const params = new URLSearchParams({ admin_card_no: adminCardNo });
  if (filters?.event_type) params.set("event_type", filters.event_type);
  if (filters?.notification_type) params.set("notification_type", filters.notification_type);
  if (filters?.recipient_type) params.set("recipient_type", filters.recipient_type);
  return apiRequest<{ items: NotificationTemplate[] }>(`/recruitment/notification-templates?${params}`);
};

export const createNotificationSelections = (
  adminCardNo: string, appId: number,
  selections: { template_id: number; notification_type: string; recipient_type: string; empcodes?: string[] }[],
) =>
  apiRequest<{ status: string; created: unknown[] }>(
    `/recruitment/applications/${appId}/notification-selections?${q(adminCardNo)}`,
    { method: "POST", body: { selections } });

export const listNotificationSelections = (adminCardNo: string, appId: number) =>
  apiRequest<{ items: NotificationSelection[] }>(
    `/recruitment/applications/${appId}/notification-selections?${q(adminCardNo)}`);

// --- Offers ---
export const listOffers = (adminCardNo: string, status?: string, scope?: RecruitmentScope) =>
  apiRequest<{ items: Offer[] }>(
    `/recruitment/offers?${q(adminCardNo, (status ? `&status=${status}` : "") + scopeQS(scope))}`
  );

export const createOffer = (adminCardNo: string, data: { app_id: number; salary_offered?: number; notes?: string }) =>
  apiRequest(`/recruitment/offers?${q(adminCardNo)}`, { method: "POST", body: data });

export const updateOffer = (adminCardNo: string, offerId: number, data: object) =>
  apiRequest(`/recruitment/offers/${offerId}?${q(adminCardNo)}`, {
    method: "PATCH",
    body: data,
  });

// --- Analytics ---
export const fetchRecruitmentAnalytics = (adminCardNo: string, scope?: RecruitmentScope) =>
  apiRequest<RecruitmentAnalytics>(`/recruitment/analytics?${q(adminCardNo, scopeQS(scope))}`);

// --- Talent Pool (candidates) ---
// Candidates are permanent, deduplicated profiles, scoped per company/branch
// like the rest of recruitment: company 1's pool is invisible to company 2.

export const listCandidates = (adminCardNo: string, search?: string, scope?: RecruitmentScope) =>
  apiRequest<{ items: CandidateListItem[] }>(
    `/recruitment/candidates?${q(adminCardNo,
      (search ? `&search=${encodeURIComponent(search)}` : "") + scopeQS(scope))}`
  );

export const getCandidate = (adminCardNo: string, candidateId: number, scope?: RecruitmentScope) =>
  apiRequest<CandidateDetail>(`/recruitment/candidates/${candidateId}?${q(adminCardNo, scopeQS(scope))}`);

export const createCandidate = (adminCardNo: string, data: Record<string, unknown>, scope?: RecruitmentScope) =>
  apiRequest<{ status: string; candidate_id: number }>(
    `/recruitment/candidates?${q(adminCardNo, scopeQS(scope))}`, { method: "POST", body: data });

export const updateCandidate = (
  adminCardNo: string, candidateId: number, data: Record<string, unknown>, scope?: RecruitmentScope,
) =>
  apiRequest(`/recruitment/candidates/${candidateId}?${q(adminCardNo, scopeQS(scope))}`, { method: "PUT", body: data });

export const applyCandidateToJob = (
  adminCardNo: string, candidateId: number,
  data: { job_id: number; source?: string; notes?: string },
  scope?: RecruitmentScope,
) =>
  apiRequest(`/recruitment/candidates/${candidateId}/apply?${q(adminCardNo, scopeQS(scope))}`, {
    method: "POST", body: data,
  });

export async function uploadCandidateCv(
  adminCardNo: string, candidateId: number, file: File, scope?: RecruitmentScope,
) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(
    `/api/recruitment/candidates/${candidateId}/cv?${q(adminCardNo, scopeQS(scope))}`,
    { method: "POST", body: form },  // browser sets the multipart boundary
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "CV upload failed" }));
    throw new Error(typeof err.detail === "string" ? err.detail : "CV upload failed");
  }
  return res.json() as Promise<{ status: string; cv_file_name: string }>;
}

// URL the browser can open to view (inline) or download the stored CV.
export const candidateCvUrl = (
  adminCardNo: string, candidateId: number, inline = false, scope?: RecruitmentScope,
) =>
  `/api/recruitment/candidates/${candidateId}/cv?${q(adminCardNo, scopeQS(scope))}${inline ? "&inline=true" : ""}`;
