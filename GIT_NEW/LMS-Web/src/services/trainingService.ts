import { apiRequest } from "./api";

// Training Management (L&D). Backend: Node-LMS-Backend/src/routes/training.routes.js
//   HR:       /training/admin/*        admin_card_no + selected company
//   Employee: /training/me/:card/*     Bearer <session_token>
//   HOD:      /training/hod/:card/*    Bearer <session_token>

// ── Types ──
export type TrainingType = "TECHNICAL" | "SOFT_SKILL" | "COMPLIANCE" | "SAFETY" | "OTHER";
export type TrainingMode = "PHYSICAL" | "ONLINE";
export type SessionStatus = "PLANNED" | "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type RequestStatus =
  | "PENDING_HOD1" | "PENDING_HOD2" | "PENDING_HR" | "APPROVED" | "BOOKED" | "COMPLETED" | "REJECTED" | "CANCELLED";
export type ParticipantStatus = "BOOKED" | "COMPLETED" | "FAILED" | "NO_SHOW" | "WITHDRAWN";
export type Priority = "LOW" | "MEDIUM" | "HIGH";

export interface Category { category_id: number; name: string; is_active: boolean; course_count: number }

export interface Trainer {
  trainer_id: number; trainer_type: "I" | "E"; empcode: string | null; name: string; organization: string;
  phone: string; email: string; expertise: string; default_rate: number | null; is_active: boolean;
  session_count: number; avg_rating: number | null;
  bio: string; qualifications: string; rate_unit: RateUnit; is_free: boolean; upcoming_slots: number; compc: number;
}
export type RateUnit = "SESSION" | "HOUR" | "DAY";
export const RATE_UNIT_LABEL: Record<RateUnit, string> = { SESSION: "per session", HOUR: "per hour", DAY: "per day" };
export const rateText = (t: Pick<Trainer, "is_free" | "default_rate" | "rate_unit">) =>
  t.is_free ? "Free of charge" : t.default_rate != null ? `${money(t.default_rate)} ${RATE_UNIT_LABEL[t.rate_unit] ?? ""}` : "—";

export interface Slot { slot_id: number; slot_date: string; time_from: string; time_to: string; remarks: string }

export interface Outline { outline_text: string; outline_file_name: string | null; outline_updated_at: string | null }

export interface Course {
  course_id: number; course_code: string; title: string; category_id: number | null; category_name: string;
  training_type: TrainingType; default_mode: TrainingMode; duration_hrs: number | null; description: string;
  cert_required: boolean; pass_pct: number; min_attend_pct: number; is_active: boolean;
  session_count: number; has_pre_test: boolean; has_post_test: boolean;
}

export interface BudgetLine {
  budget_id: number; dept_no: number | null; dept_name: string; amount: number; used: number;
  remaining: number; used_pct: number | null; remarks: string;
}
export interface Budget { fy_year: number; fy_label: string; lines: BudgetLine[]; total_used: number }

export interface Department { dept_no: number; dept_name: string }
export interface EmployeeLite { empcode: string; name: string; dept_no: string; dept_name: string; desg_desc: string; brnch: number | null }

export interface Session {
  session_id: number; session_code: string; course_id: number; course_code: string; course_title: string;
  trainer_id: number | null; trainer_name: string; trainer_type: string; mode: TrainingMode; venue: string;
  online_link: string; start_date: string; end_date: string; time_from: string; time_to: string;
  total_hours: number | null; capacity: number; dept_no: number | null; dept_name: string; fy_year: number;
  trainer_cost: number; venue_cost: number; material_cost: number; other_cost: number; total_cost: number;
  status: SessionStatus; remarks: string; completed_at: string | null; participants: number; seats_left: number;
  cost_per_head: number | null; training_type: TrainingType; cert_required: boolean; pass_pct: number;
  min_attend_pct: number; avg_rating: number | null; has_pre_test?: boolean; has_post_test?: boolean;
  outline_text: string; outline_file_name: string | null; outline_updated_at: string | null;
  trainer_cert_no: string | null; trainer_cert_at: string | null; trainer_empcode: string | null;
}

export interface Participant {
  participant_id: number; empcode: string; name: string; dept_name: string; desg_desc: string;
  request_id: number | null; status: ParticipantStatus; attend_pct: number | null;
  pre_score_pct: number | null; post_score_pct: number | null; improvement: number | null;
  passed: boolean | null; retest_allowed: number; cert_no: string | null; cert_issued_at: string | null;
  post_attempts: number; feedback_rating: number | null;
}

export interface AttendanceMark { participant_id: number; date: string; status: "P" | "A" | "L"; hours: number | null }

export interface Feedback {
  feedback_id: number; given_by_type: string; given_by: string; given_by_name: string;
  rating_content: number | null; rating_trainer: number | null; rating_overall: number; comments: string; created_at: string;
}

export interface SessionDetail { session: Session; participants: Participant[]; attendance: AttendanceMark[]; feedback: Feedback[] }

export interface Approval { flag: "Y" | "N" | null; date: string | null; name: string; remarks: string }

export interface TrainingRequest {
  request_id: number; compc: number; brnch: number | null; empcode: string; emp_name: string; dept_name: string;
  desg_desc: string; source: "EMPLOYEE" | "HOD" | "HR" | "APPRAISAL"; requested_by: string; requested_by_name: string;
  course_id: number | null; course_code: string; course_title: string; requested_topic: string; title: string;
  reason: string; priority: Priority; preferred_from: string | null; preferred_to: string | null;
  hod1: Approval | null; hod2: Approval | null; hr: Approval; status: RequestStatus;
  session_id: number | null; session_code: string; session_start: string | null; session_end: string | null; created_at: string;
}
export interface HodRequest extends TrainingRequest { my_step: 1 | 2; my_turn: boolean }

export interface CatalogCourse {
  course_id: number; course_code: string; title: string; category_name: string; training_type: TrainingType;
  default_mode: TrainingMode; duration_hrs: number | null; description: string; cert_required: boolean; next_session: string | null;
}
export interface Catalog {
  employee: { empcode: string; name: string; dept_name: string; compc: number; has_hod: boolean };
  courses: CatalogCourse[];
}

export interface MyTraining {
  participant_id: number; status: ParticipantStatus; attend_pct: number | null; pre_score_pct: number | null;
  post_score_pct: number | null; passed: boolean | null; cert_no: string | null; cert_issued_at: string | null;
  session_id: number; session_code: string; session_status: SessionStatus; mode: TrainingMode; venue: string;
  online_link: string; start_date: string; end_date: string; time_from: string; time_to: string;
  total_hours: number | null; course_id: number; course_code: string; course_title: string; training_type: TrainingType;
  trainer_name: string; can_take_pre: boolean; can_take_post: boolean; has_pre_test: boolean; has_post_test: boolean;
  post_attempts_left: number; can_give_feedback: boolean; feedback_given: boolean; hours_attended: number;
  pass_pct: number; min_attend_pct: number; cert_required: boolean;
  outline_text: string; outline_file_name: string | null; outline_updated_at: string | null;
}

export interface TeamMember {
  empcode: string; name: string; dept_name: string; desg_desc: string;
  completed: number; upcoming: number; open_requests: number; my_step: number;
}

export interface Question {
  question_id: number; seq: number; question_text: string; opt_a: string; opt_b: string;
  opt_c: string | null; opt_d: string | null; correct_opt: "A" | "B" | "C" | "D"; marks: number; is_active: boolean;
}
export interface TestDef {
  test_id: number; test_kind: "PRE" | "POST"; title: string; time_limit_min: number; pass_pct: number | null;
  effective_pass_pct: number; shuffle: boolean; is_active: boolean; attempts: number; questions: Question[]; total_marks: number;
}
export interface CourseTests { course_id: number; course_title: string; course_pass_pct: number; pre: TestDef | null; post: TestDef | null }

export interface AttemptQuestion { question_id: number; question_text: string; options: { key: string; text: string }[]; marks: number }
export interface Attempt {
  attempt_id: number; test_kind: "PRE" | "POST"; title: string; course_title: string; time_limit_min: number;
  pass_pct: number; seconds_left: number; deadline_at: string; questions: AttemptQuestion[];
}
export interface AttemptResult { score: number; total: number; pct: number; passed: boolean; pass_pct: number; late: boolean }
export interface AttemptRow {
  attempt_id: number; test_kind: string; started_at: string; submitted_at: string | null;
  score: number | null; total: number | null; pct: number | null; passed: boolean | null;
}

export interface Dashboard {
  fy_year: number; fy_label: string;
  requests: { pending_hr: number; to_book: number; pending_hod: number };
  sessions: Record<string, number> & { total: number };
  employees_trained: number; training_hours: number; certificates: number;
  completion_rate: number | null; avg_improvement: number | null; cost: number; budget: number | null;
  budget_used_pct: number | null; avg_rating: number | null;
  upcoming: { session_id: number; session_code: string; course_title: string; start_date: string; end_date: string;
    mode: string; venue: string; capacity: number; status: SessionStatus; participants: number }[];
  by_type: { training_type: TrainingType; sessions: number; completed: number }[];
}

export type ReportType = "conducted" | "employees" | "cost" | "assessment" | "certificates" | "trainers" | "history";
export interface Report { title: string; columns: string[]; numeric: number[]; rows: (string | number | null)[][] }

// ── Labels ──
export const TYPE_LABEL: Record<TrainingType, string> = {
  TECHNICAL: "Technical", SOFT_SKILL: "Soft skill", COMPLIANCE: "Compliance", SAFETY: "Safety", OTHER: "Other",
};
export const MODE_LABEL: Record<TrainingMode, string> = { PHYSICAL: "Physical", ONLINE: "Online" };
export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  PLANNED: "Planned", OPEN: "Open", IN_PROGRESS: "In progress", COMPLETED: "Completed", CANCELLED: "Cancelled",
};
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  PENDING_HOD1: "Waiting HOD 1", PENDING_HOD2: "Waiting HOD 2", PENDING_HR: "Waiting HR", APPROVED: "Approved — to book",
  BOOKED: "Booked", COMPLETED: "Completed", REJECTED: "Rejected", CANCELLED: "Cancelled",
};
export const PARTICIPANT_STATUS_LABEL: Record<ParticipantStatus, string> = {
  BOOKED: "Booked", COMPLETED: "Completed", FAILED: "Failed", NO_SHOW: "No-show", WITHDRAWN: "Withdrawn",
};

/** Current July–June fiscal year's starting year. */
export const currentFy = () => {
  const d = new Date();
  return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
};
export const fyLabel = (fy: number) => `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
export const money = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));

// ── HR helpers ──
const q = (adminCardNo: string, compc?: string, extra: Record<string, string | number | undefined | null> = {}) => {
  const p = new URLSearchParams({ admin_card_no: adminCardNo });
  if (compc) p.set("compc", compc);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  return p.toString();
};
const A = "/training/admin";

export interface Hr { card: string; compc?: string }
const get = <T,>(h: Hr, path: string, extra?: Record<string, string | number | undefined | null>) =>
  apiRequest<T>(`${A}${path}?${q(h.card, h.compc, extra)}`);
const send = <T,>(h: Hr, method: string, path: string, body?: unknown) =>
  apiRequest<T>(`${A}${path}?${q(h.card, h.compc)}`, { method, body: body ?? {} });

export const hrApi = {
  categories: (h: Hr) => get<{ items: Category[] }>(h, "/categories"),
  saveCategory: (h: Hr, body: { name: string; is_active?: boolean }, id?: number) =>
    send(h, id ? "PUT" : "POST", id ? `/categories/${id}` : "/categories", body),
  deleteCategory: (h: Hr, id: number) => send(h, "DELETE", `/categories/${id}`),

  trainers: (h: Hr) => get<{ items: Trainer[] }>(h, "/trainers"),
  saveTrainer: (h: Hr, body: Partial<Trainer>, id?: number) =>
    send(h, id ? "PUT" : "POST", id ? `/trainers/${id}` : "/trainers", body),
  deleteTrainer: (h: Hr, id: number) => send(h, "DELETE", `/trainers/${id}`),
  trainerSlots: (h: Hr, id: number) => get<{ items: Slot[] }>(h, `/trainers/${id}/slots`),

  courses: (h: Hr, activeOnly = false) => get<{ items: Course[] }>(h, "/courses", { active: activeOnly ? "1" : undefined }),
  saveCourse: (h: Hr, body: Partial<Course>, id?: number) =>
    send<{ course_id: number; course_code?: string }>(h, id ? "PUT" : "POST", id ? `/courses/${id}` : "/courses", body),
  deleteCourse: (h: Hr, id: number) => send(h, "DELETE", `/courses/${id}`),

  budget: (h: Hr, fy: number) => get<Budget>(h, "/budget", { fy }),
  saveBudget: (h: Hr, body: { fy_year: number; dept_no: number | null; amount: number; remarks?: string }) => send(h, "PUT", "/budget", body),
  deleteBudget: (h: Hr, id: number) => send(h, "DELETE", `/budget/${id}`),

  departments: (h: Hr) => get<{ items: Department[] }>(h, "/departments"),
  employees: (h: Hr, dept?: string) => get<{ items: EmployeeLite[] }>(h, "/employees", { dept }),

  sessions: (h: Hr, f: { status?: string; from?: string; to?: string; course_id?: number; fy?: number } = {}) =>
    get<{ items: Session[] }>(h, "/sessions", f),
  bookable: (h: Hr, courseId?: number | null) => get<{ items: Session[] }>(h, "/sessions/bookable", { course_id: courseId ?? undefined }),
  session: (h: Hr, id: number) => get<SessionDetail>(h, `/sessions/${id}`),
  saveSession: (h: Hr, body: Record<string, unknown>, id?: number) =>
    send<{ session_id: number; warnings: string[] }>(h, id ? "PUT" : "POST", id ? `/sessions/${id}` : "/sessions", body),
  setSessionStatus: (h: Hr, id: number, status: SessionStatus, remarks?: string) =>
    send(h, "POST", `/sessions/${id}/status`, { status, remarks }),
  completeSession: (h: Hr, id: number) =>
    send<{ completed: number; failed: number; no_show: number; certificates: number; trainer_certificate?: string }>(h, "POST", `/sessions/${id}/complete`),
  addParticipants: (h: Hr, id: number, empcodes: string[]) =>
    send<{ added: string[]; skipped: { empcode: string; reason: string }[] }>(h, "POST", `/sessions/${id}/participants`, { empcodes }),
  withdraw: (h: Hr, sid: number, pid: number, remarks?: string) =>
    send(h, "POST", `/sessions/${sid}/participants/${pid}/withdraw`, { remarks }),
  retest: (h: Hr, sid: number, pid: number) => send(h, "POST", `/sessions/${sid}/participants/${pid}/retest`),
  saveAttendance: (h: Hr, sid: number, date: string, rows: { participant_id: number; status: string; hours?: number | null }[]) =>
    send<{ saved: number }>(h, "PUT", `/sessions/${sid}/attendance`, { date, rows }),
  sessionFeedback: (h: Hr, sid: number, body: Record<string, unknown>) => send(h, "POST", `/sessions/${sid}/feedback`, body),
  attempts: (h: Hr, pid: number) => get<{ items: AttemptRow[] }>(h, `/participants/${pid}/attempts`),
  certificateUrl: (h: Hr, pid: number) => `/api${A}/participants/${pid}/certificate?${q(h.card, h.compc)}`,
  trainerCertificateUrl: (h: Hr, sid: number) => `/api${A}/sessions/${sid}/trainer-certificate?${q(h.card, h.compc)}`,
  saveOutline: (h: Hr, sid: number, text: string) => send(h, "PUT", `/sessions/${sid}/outline`, { text }),
  uploadOutline: (h: Hr, sid: number, file: File) => uploadFile(`/api${A}/sessions/${sid}/outline/file?${q(h.card, h.compc)}`, file),
  deleteOutlineFile: (h: Hr, sid: number) => send(h, "DELETE", `/sessions/${sid}/outline/file`),
  outlineFileUrl: (h: Hr, sid: number) => `/api${A}/sessions/${sid}/outline/file?${q(h.card, h.compc)}`,

  requests: (h: Hr, status?: string) => get<{ items: TrainingRequest[] }>(h, "/requests", { status }),
  decide: (h: Hr, id: number, body: { decision: "approve" | "reject"; remarks?: string; session_id?: number | null; course_id?: number | null }) =>
    send<{ status: RequestStatus }>(h, "POST", `/requests/${id}/decision`, body),
  history: (h: Hr, id: number) =>
    get<{ items: { action: string; details: string; actor: string; actor_name: string; at: string }[] }>(h, `/requests/${id}/history`),

  courseTests: (h: Hr, courseId: number) => get<CourseTests>(h, `/courses/${courseId}/tests`),
  saveTest: (h: Hr, courseId: number, kind: "PRE" | "POST", body: Record<string, unknown>) =>
    send<{ test_id: number }>(h, "PUT", `/courses/${courseId}/tests/${kind}`, body),
  saveQuestion: (h: Hr, testId: number, body: Record<string, unknown>, id?: number) =>
    send(h, id ? "PUT" : "POST", id ? `/tests/${testId}/questions/${id}` : `/tests/${testId}/questions`, body),
  deleteQuestion: (h: Hr, testId: number, id: number) =>
    send<{ deleted: boolean; deactivated?: boolean }>(h, "DELETE", `/tests/${testId}/questions/${id}`),

  dashboard: (h: Hr, fy: number) => get<Dashboard>(h, "/dashboard", { fy }),
  report: (h: Hr, type: ReportType, f: { from?: string; to?: string; dept?: string; empcode?: string }) =>
    get<Report>(h, `/reports/${type}`, f),
};

// ── Employee / HOD (bearer token) ──
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const enc = encodeURIComponent;

export const meApi = {
  catalog: (card: string, token: string) => apiRequest<Catalog>(`/training/me/${enc(card)}/catalog`, { headers: auth(token) }),
  requests: (card: string, token: string) =>
    apiRequest<{ items: TrainingRequest[] }>(`/training/me/${enc(card)}/requests`, { headers: auth(token) }),
  createRequest: (card: string, token: string, body: Record<string, unknown>) =>
    apiRequest<{ request_id: number; status: RequestStatus }>(`/training/me/${enc(card)}/requests`, { method: "POST", body, headers: auth(token) }),
  cancelRequest: (card: string, token: string, id: number) =>
    apiRequest(`/training/me/${enc(card)}/requests/${id}/cancel`, { method: "POST", body: {}, headers: auth(token) }),
  trainings: (card: string, token: string) =>
    apiRequest<{ items: MyTraining[] }>(`/training/me/${enc(card)}/trainings`, { headers: auth(token) }),
  startTest: (card: string, token: string, pid: number, kind: "PRE" | "POST") =>
    apiRequest<Attempt>(`/training/me/${enc(card)}/trainings/${pid}/tests/${kind}/start`, { method: "POST", body: {}, headers: auth(token) }),
  submitTest: (card: string, token: string, attemptId: number, answers: Record<number, string>) =>
    apiRequest<AttemptResult>(`/training/me/${enc(card)}/attempts/${attemptId}/submit`, { method: "POST", body: { answers }, headers: auth(token) }),
  feedback: (card: string, token: string, pid: number, body: Record<string, unknown>) =>
    apiRequest(`/training/me/${enc(card)}/trainings/${pid}/feedback`, { method: "POST", body, headers: auth(token) }),
  certificatePath: (card: string, pid: number) => `/api/training/me/${enc(card)}/trainings/${pid}/certificate`,
  outlinePath: (card: string, sessionId: number) => `/api/training/me/${enc(card)}/sessions/${sessionId}/outline/file`,
};

// ── Trainer portal (internal trainers, bearer token) ──
export interface TrainerProfile {
  is_trainer: boolean; trainer?: Trainer;
  stats?: { upcoming: number; completed: number; hours: number; people_trained: number };
}
export interface TrainerSessionDetail {
  session: Session;
  participants: Omit<Participant, "request_id" | "retest_allowed" | "feedback_rating">[];
  my_feedback: { feedback_id: number; rating_content: number | null; rating_trainer: number | null; rating_overall: number; comments: string; created_at: string }[];
  participant_ratings: { count: number; trainer: number | null; content: number | null; overall: number | null };
}
export interface TrainerCourse { course_id: number; course_code: string; title: string; next_session: string | null; has_pre_test: boolean; has_post_test: boolean }

const T = (card: string) => `/training/trainer/${enc(card)}`;
export const trainerApi = {
  profile: (card: string, token: string) => apiRequest<TrainerProfile>(`${T(card)}/profile`, { headers: auth(token) }),
  saveProfile: (card: string, token: string, body: Record<string, unknown>) =>
    apiRequest(`${T(card)}/profile`, { method: "PUT", body, headers: auth(token) }),
  slots: (card: string, token: string) => apiRequest<{ items: Slot[] }>(`${T(card)}/slots`, { headers: auth(token) }),
  addSlot: (card: string, token: string, body: { slot_date: string; time_from: string; time_to: string; remarks?: string }) =>
    apiRequest(`${T(card)}/slots`, { method: "POST", body, headers: auth(token) }),
  deleteSlot: (card: string, token: string, id: number) =>
    apiRequest(`${T(card)}/slots/${id}`, { method: "DELETE", body: {}, headers: auth(token) }),
  sessions: (card: string, token: string) => apiRequest<{ items: Session[] }>(`${T(card)}/sessions`, { headers: auth(token) }),
  session: (card: string, token: string, id: number) => apiRequest<TrainerSessionDetail>(`${T(card)}/sessions/${id}`, { headers: auth(token) }),
  saveOutline: (card: string, token: string, id: number, text: string) =>
    apiRequest(`${T(card)}/sessions/${id}/outline`, { method: "PUT", body: { text }, headers: auth(token) }),
  uploadOutline: (card: string, token: string, id: number, file: File) => uploadFile(`/api${T(card)}/sessions/${id}/outline/file`, file, token),
  deleteOutlineFile: (card: string, token: string, id: number) =>
    apiRequest(`${T(card)}/sessions/${id}/outline/file`, { method: "DELETE", body: {}, headers: auth(token) }),
  outlinePath: (card: string, id: number) => `/api${T(card)}/sessions/${id}/outline/file`,
  feedback: (card: string, token: string, id: number, body: Record<string, unknown>) =>
    apiRequest(`${T(card)}/sessions/${id}/feedback`, { method: "POST", body, headers: auth(token) }),
  certificatePath: (card: string, id: number) => `/api${T(card)}/sessions/${id}/certificate`,
  testCourses: (card: string, token: string) => apiRequest<{ items: TrainerCourse[] }>(`${T(card)}/test-courses`, { headers: auth(token) }),
};

/** The four test-editing calls, so the same editor serves HR and trainers. */
export interface TestApi {
  courseTests: (courseId: number) => Promise<CourseTests>;
  saveTest: (courseId: number, kind: "PRE" | "POST", body: Record<string, unknown>) => Promise<unknown>;
  saveQuestion: (testId: number, body: Record<string, unknown>, id?: number) => Promise<unknown>;
  deleteQuestion: (testId: number, id: number) => Promise<{ deleted: boolean; deactivated?: boolean }>;
}
export const hrTestApi = (h: Hr): TestApi => ({
  courseTests: (cid) => hrApi.courseTests(h, cid),
  saveTest: (cid, kind, body) => hrApi.saveTest(h, cid, kind, body),
  saveQuestion: (tid, body, id) => hrApi.saveQuestion(h, tid, body, id),
  deleteQuestion: (tid, id) => hrApi.deleteQuestion(h, tid, id),
});
export const trainerTestApi = (card: string, token: string): TestApi => ({
  courseTests: (cid) => apiRequest<CourseTests>(`${T(card)}/courses/${cid}/tests`, { headers: auth(token) }),
  saveTest: (cid, kind, body) => apiRequest(`${T(card)}/courses/${cid}/tests/${kind}`, { method: "PUT", body, headers: auth(token) }),
  saveQuestion: (tid, body, id) => apiRequest(id ? `${T(card)}/tests/${tid}/questions/${id}` : `${T(card)}/tests/${tid}/questions`, {
    method: id ? "PUT" : "POST", body, headers: auth(token),
  }),
  deleteQuestion: (tid, id) => apiRequest<{ deleted: boolean; deactivated?: boolean }>(`${T(card)}/tests/${tid}/questions/${id}`, {
    method: "DELETE", body: {}, headers: auth(token),
  }),
});

/** Multipart upload of one file under "file". */
async function uploadFile(url: string, file: File, token?: string) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(url, { method: "POST", body: form, headers: token ? auth(token) : {} });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    const d = err?.detail;
    throw new Error(typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x?.msg).join(", ") : d?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export const hodApi = {
  requests: (card: string, token: string) =>
    apiRequest<{ is_hod: boolean; pending: number; items: HodRequest[] }>(`/training/hod/${enc(card)}/requests`, { headers: auth(token) }),
  decide: (card: string, token: string, id: number, decision: "approve" | "reject", remarks?: string) =>
    apiRequest<{ status: RequestStatus }>(`/training/hod/${enc(card)}/requests/${id}/decision`, {
      method: "POST", body: { decision, remarks }, headers: auth(token),
    }),
  team: (card: string, token: string) => apiRequest<{ items: TeamMember[] }>(`/training/hod/${enc(card)}/team`, { headers: auth(token) }),
  member: (card: string, token: string, empcode: string) =>
    apiRequest<{ employee: { empcode: string; name: string; dept_name: string }; items: {
      session_code: string; course_title: string; start_date: string; end_date: string; status: ParticipantStatus;
      attend_pct: number | null; pre_score_pct: number | null; post_score_pct: number | null; cert_no: string | null }[] }>(
      `/training/hod/${enc(card)}/team/${enc(empcode)}`, { headers: auth(token) }),
  catalog: (card: string, token: string) => apiRequest<Catalog>(`/training/hod/${enc(card)}/catalog`, { headers: auth(token) }),
  nominate: (card: string, token: string, body: Record<string, unknown>) =>
    apiRequest<{ request_id: number; status: RequestStatus }>(`/training/hod/${enc(card)}/nominate`, { method: "POST", body, headers: auth(token) }),
};

/** Download a file from an API path (optionally with a bearer token) and save it. */
export async function downloadPdf(url: string, filename: string, token?: string) {
  const res = await fetch(url, { headers: token ? auth(token) : {} });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    const d = err?.detail;
    throw new Error(typeof d === "string" ? d : d?.message || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
