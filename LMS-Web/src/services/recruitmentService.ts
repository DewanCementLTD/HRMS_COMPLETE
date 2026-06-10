import { apiRequest } from "./api";
import { Job, Application, Interview, Offer, RecruitmentAnalytics } from "@/models/recruitment";

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
