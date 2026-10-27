import { apiRequest, withSession } from "./api";
import { downloadPdf, type Hr, type Department, type EmployeeLite, type Course } from "./trainingService";

// Performance Appraisal — DCL process. Backend: Node-LMS-Backend/src/routes/appraisal.routes.js
//   HR:       /appraisal/admin/*          admin_card_no + selected company
//   Employee: /appraisal/me/:card/*       Bearer <session_token>
//   Reviewer: /appraisal/review/:card/*   Bearer <session_token>

export type { Hr };
export { downloadPdf as downloadFile };

// ── Types ──
export type Stage = "OBJ_SETTING" | "OBJ_REVIEW" | "MIDYEAR" | "MID_REVIEW" | "RPT" | "HOD1" | "HOD2" | "HR" | "COMPLETED" | "CANCELLED";
export type ReviewRole = "RPT" | "HOD1" | "HOD2" | "HR";
export type Grade = "A+" | "A" | "B" | "C" | "D";
export type CycleType = "ANNUAL" | "HALF_YEARLY" | "QUARTERLY" | "PROBATION" | "CONFIRMATION";
export type CycleStatus = "DRAFT" | "ACTIVE" | "CLOSED";
export type Phase = "OBJECTIVES" | "MIDYEAR" | "YEAREND";
export type RecStatus = "PROPOSED" | "APPROVED" | "APPLIED" | "REJECTED";
export type CaseStatus = "ELIGIBILITY" | "COMPETENCY" | "MGR_RATING" | "HR_REVIEW" | "SIGNOFF" | "HOD_FINAL" | "CEO_FINAL"
  | "APPROVED" | "REJECTED" | "NOT_ELIGIBLE" | "CANCELLED";
export type Category = "FULL" | "PRORATA" | "PROBATION" | "TE_MTO";

export const GRADES: Grade[] = ["A+", "A", "B", "C", "D"];
export const GRADE_POINTS: Record<Grade, number> = { "A+": 5, A: 4, B: 3, C: 2, D: 1 };
export const GRADE_MEANING: Record<Grade, string> = {
  "A+": "Outstanding", A: "Excellent Performance", B: "Good Performance", C: "Inconsistent", D: "Non-performer",
};
export const STAGE_LABEL: Record<Stage, string> = {
  OBJ_SETTING: "Objective setting", OBJ_REVIEW: "Objectives — line manager approval", MIDYEAR: "Mid-year self review",
  MID_REVIEW: "Mid-year — line manager review", RPT: "Year-end rating (reporting officer)", HOD1: "Year-end rating (HOD)",
  HOD2: "Year-end review (HOD 2)", HR: "HR review", COMPLETED: "Completed", CANCELLED: "Cancelled",
};
export const PHASE_LABEL: Record<Phase, string> = { OBJECTIVES: "Objective setting", MIDYEAR: "Mid-year review", YEAREND: "Year-end review" };
export const ROLE_LABEL: Record<string, string> = {
  EMP: "Employee", RPT: "Reporting officer", HOD1: "HOD", HOD2: "HOD 2", HR: "HR", MGMT: "CEO",
  RM: "Reporting manager", HOD: "HOD", HR_HEAD: "HR Head", HOD_FINAL: "HOD / HOU decision", CEO: "CEO decision",
};
export const CYCLE_TYPE_LABEL: Record<CycleType, string> = {
  ANNUAL: "Annual", HALF_YEARLY: "Half-yearly", QUARTERLY: "Quarterly", PROBATION: "Probation", CONFIRMATION: "Confirmation",
};
export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  ELIGIBILITY: "Sheet 1 — eligibility (HR)", COMPETENCY: "Sheet 2 — employee self-assessment", MGR_RATING: "Sheet 2 — manager rating",
  HR_REVIEW: "Sheets 3–4 — HR history & scorecard", SIGNOFF: "Sheet 5 — recommendations", HOD_FINAL: "HOD decision",
  CEO_FINAL: "CEO decision", APPROVED: "Approved", REJECTED: "Not approved", NOT_ELIGIBLE: "Not eligible", CANCELLED: "Cancelled",
};
export const CATEGORY_LABEL: Record<Category, string> = {
  FULL: "A: Eligible employees (full year)", PRORATA: "B: Eligible employees (pro-rata basis)",
  PROBATION: "C: Non-eligible employees (on probation)", TE_MTO: "D: TE / MTO",
};
export const OUTCOME_LABEL: Record<string, string> = {
  PROMOTE: "Promote", PROMOTE_DEV: "Promote with development plan", DEFER: "Defer", NOT_RECOMMEND: "Not recommended",
};
export const SHEET_RULES = { maxRows: 8, minWeight: 5, maxWeight: 40, total: 100 };

export interface Cycle {
  cycle_id: number; name: string; cycle_type: CycleType; fy_year: number; period_from: string; period_to: string;
  goal_deadline: string | null; self_deadline: string | null; review_deadline: string | null; status: CycleStatus; phase: Phase; remarks?: string;
  appraisal_count?: number; completed_count?: number; goal_count?: number; objectives_open?: number; midyear_open?: number;
}
export interface CycleGoal {
  goal_id: number; level_type: "CORPORATE" | "DEPARTMENT"; dept_no: string | null; dept_name: string;
  objective: string; kpi_text: string; target: string; weightage: number;
}
export interface Competency { id: number; name: string; description: string; weight_pct: number; seq: number; is_active: boolean; used_count: number }
export interface ScaleBand { scale_id?: number | null; label: string; description: string; min_score: number; max_score: number; target_pct: number | null; is_development: boolean }
export interface PromoBand { band_id?: number | null; min_score: number; label: string; outcome: "PROMOTE" | "PROMOTE_DEV" | "DEFER" | "NOT_RECOMMEND" }
export interface PromoSettings { comp_weight_pct: number; perf_weight_pct: number; min_tenure_yrs: number }
export interface MgmtApprover { approver_id: number; empcode: string; name: string; is_active: boolean; desg_desc: string }
export interface Designation { desg_cd: string; desg_desc: string; grade_cd: string | null; desg_grp: string | null }
export interface Period { period_no: number; period_from: string; period_to: string; status: string }
export interface Lookups {
  departments: Department[]; designations: Designation[]; grades: { value: string; employees: number }[];
  desg_groups: { value: string; employees: number }[]; periods: Period[]; courses: Course[];
}

/** One accountability row of the task sheet. */
export interface SheetRow {
  emp_goal_id: number; source: "CORPORATE" | "DEPARTMENT" | "INDIVIDUAL"; goal_id: number | null;
  accountability: string; task: string; kpi: string; success_criteria: string; interdependencies: string;
  weightage: number; due_date: string | null; midyear_progress: string; yearend_comment: string;
  self_rating: Grade | null; agreed_rating: Grade | null; self_score: number | null; score: number | null;
  reviewer_remarks: string; seq: number;
}
export interface RowBody {
  accountability?: string; task: string; kpi?: string; success_criteria?: string; interdependencies?: string; weightage: number; due_date?: string | null;
}
export interface Promotion {
  rec_id: number; cur_desg_cd: string; cur_grade_cd: string; prop_desg_cd: string; prop_grade_cd: string | null; justification: string;
  recommended_by: string; recommended_by_name: string; status: RecStatus; effective_date: string | null; applied_at: string | null;
  cur_desg_desc: string; prop_desg_desc: string;
}
export interface Increment {
  rec_id: number; prev_gross: number | null; inc_pct: number | null; inc_amount: number; new_gross: number | null; justification: string;
  recommended_by: string; recommended_by_name: string; status: RecStatus; effective_period: number | null; with_arrear: boolean;
  hist_doc_no: number | null; applied_at: string | null;
}
export interface DevPlan {
  plan_id: number; source: "REVIEWER" | "AUTO" | "HR"; area: string; action_plan: string; course_id: number | null; course_title: string | null;
  target_date: string | null; status: string; training_request_id: number | null; training_request_status: string | null;
}
export interface ApprovalStep {
  stage: Stage; role: string; actor: string; actor_name: string; action: "SUBMIT" | "APPROVE" | "RETURN" | "CANCEL" | "REOPEN" | "SIGN" | "FINALISE" | "ACK";
  next_stage: Stage | null; score: number | null; remarks: string; acted_at: string;
}
export interface Attachment { att_id: number; emp_goal_id: number | null; file_name: string; uploaded_by: string; uploaded_at: string }
export interface CaseSummary { case_id: number; status: CaseStatus; status_label: string; decision_band: string | null; overall_score: number | null; eligibility_result: string }

export interface Appraisal {
  appraisal_id: number; compc: number; cycle_id: number; empcode: string; empno: string; emp_name: string; dept_name: string; desg_desc: string;
  join_date: string | null;
  rpt_empcode: string | null; rpt_name: string | null; hod1_name: string | null; hod2_name: string | null; has_hod1: boolean; has_hod2: boolean;
  chain: ReviewRole[]; line_manager_role: ReviewRole; line_manager_name: string | null;
  stage: Stage; stage_label: string;
  obj_locked_at: string | null; mid_locked_at: string | null; mid_comments: string; self_submitted_at: string | null;
  self_score: number | null; calc_score?: number | null; hod_grade?: string | null; hr_adj_grade?: string | null; hr_adj_reason?: string | null;
  final_score: number | null; final_rating: string | null; completed_at: string | null; promo_recommended: boolean;
  emp_ack_at: string | null; emp_ack_comment: string;
  cycle: Cycle;
  rows: SheetRow[]; weight_total: number; weight_problems: string[];
  promotion?: Promotion | null; increment?: Increment | null; dev_plan: DevPlan[];
  approvals: ApprovalStep[]; attachments: Attachment[]; promotion_case: CaseSummary | null;
  // permissions (depend on who is looking)
  can_edit_rows?: boolean; can_midyear?: boolean; midyear_waiting_phase?: boolean; can_acknowledge?: boolean;
  my_roles?: string[]; act_role?: ReviewRole | null; waiting_phase?: boolean;
  can_approve_objectives?: boolean; can_sign_midyear?: boolean; can_rate?: boolean; can_return?: boolean;
  can_hr_objectives?: boolean; can_hr_midyear?: boolean; can_hr_act?: boolean;
}

export interface MyAppraisalRow {
  appraisal_id: number; cycle: Cycle; stage: Stage; stage_label: string; my_turn: boolean;
  final_score: number | null; final_rating: string | null;
}
export interface InboxRow {
  appraisal_id: number; cycle: Cycle; empcode: string; emp_name: string; dept_name: string; desg_desc: string;
  stage: Stage; stage_label: string; my_roles: string[]; my_turn: boolean; waiting_phase: boolean;
  self_score: number | null; final_score: number | null; final_rating: string | null;
}
export interface HrRow {
  appraisal_id: number; cycle: Cycle; empcode: string; emp_name: string; dept_name: string; desg_desc: string;
  stage: Stage; stage_label: string; rpt_name: string | null; has_hod1: boolean; has_hod2: boolean; line_manager_role: ReviewRole;
  self_score: number | null; calc_score: number | null; hod_grade: string | null; hr_adj_grade: string | null;
  final_score: number | null; final_rating: string | null; promo_recommended: boolean; emp_ack_at: string | null; updated_at: string | null;
}
export interface History {
  history: { appraisal_id: number; cycle_name: string; cycle_type: CycleType; fy_year: number; period_to: string; final_score: number | null; final_rating: string }[];
  dev_plan: (DevPlan & { appraisal_id: number })[];
}
export interface BellBand {
  label: string; description: string; min_score: number; max_score: number; target_pct: number | null; standard_count: number | null;
  count: number; hod_count: number; actual_pct: number; over_target?: boolean; remark: string;
}
export interface BellCurve { total: number; average: number | null; bands: BellBand[]; warnings: string[] }
export interface LaunchPreview {
  total: number;
  items: { empcode: string; name: string; dept_name: string; already: boolean; has_rpt: boolean; has_hod1: boolean; has_hod2: boolean }[];
}
export interface LaunchFilters { empcodes?: string[]; dept_nos?: string[]; brnch?: string | null; emp_statuses?: string[] }

export interface RecRow {
  kind: "INCREMENT" | "PROMOTION"; rec_id: number; appraisal_id: number; empcode: string; emp_name: string; cycle_name: string;
  final_score: number | null; final_rating: string; status: RecStatus; justification: string; recommended_by_name: string;
  dept_name: string; cycle_id: number; appraisal_stage: Stage;
  prev_gross?: number | null; inc_pct?: number | null; inc_amount?: number; new_gross?: number | null; current_gross?: number | null;
  effective_period?: number | null; with_arrear?: boolean; hist_doc_no?: number | null; applied_at?: string | null;
  cur_desg_cd?: string; cur_desg_desc?: string; prop_desg_cd?: string; prop_desg_desc?: string; cur_grade_cd?: string | null;
  prop_grade_cd?: string | null; effective_date?: string | null; current_desg_cd?: string;
}

// ── Promotion evaluation (sheets 1–5) ──
export interface CaseCompetency {
  competency_id: number; name: string; definition: string; weight_pct: number; seq: number;
  self_rating: number | null; mgr_rating?: number | null; evidence: string; dev_needs: string; mgr_comment?: string;
  self_weighted: number | null; mgr_weighted?: number | null;
}
export interface CaseSignoff { role: string; actor: string; actor_name: string; decision: string; remarks: string; acted_at: string }
export interface PromotionCase {
  case_id: number; compc: number; appraisal_id: number; empcode: string; empno: string; emp_name: string; dept_name: string;
  cur_desg_desc: string; cur_grade: string; join_date: string | null; role_since: string | null; time_in_role_yrs: number | null; tenure_yrs: number | null;
  cur_desg_cd: string; prop_desg_cd: string | null; prop_grade_cd: string | null; prop_desg_desc: string;
  rm_empcode: string | null; rm_name: string | null; hod_name: string | null; has_hod: boolean;
  status: CaseStatus; status_label: string; eligibility_result: "INCOMPLETE" | "ELIGIBLE" | "NOT_ELIGIBLE";
  assess_date: string | null; assessed_by: string | null; assessed_by_name: string | null;
  emp_comments: string; tech_trainings: string; soft_trainings: string; emp_declared_at: string | null;
  mgr_rated_by: string | null; mgr_rated_at: string | null;
  comp_score: number | null; perf_score: number | null; comp_weight_pct: number | null; perf_weight_pct: number | null;
  overall_score: number | null; decision_band: string; decision_outcome: string;
  hr_recommendation: string; rationale: string; gap_areas: string; actions_timeline: string; next_review_date: string | null;
  final_desg_cd: string | null; final_desg_desc: string | null; final_grade_cd: string | null; new_package: string;
  effective_date: string | null; decided_at: string | null; created_at: string | null;
  appraisal_grade: string | null; appraisal_score: number | null; cycle_name: string;
  settings: PromoSettings;
  eligibility: { code: string; criterion: string; requirement: string; status: "Y" | "N" | null; remarks: string }[];
  eligibility_hints: Record<string, string>;
  competencies: CaseCompetency[]; self_comp_score: number | null;
  competency_progress: { self: number; mgr?: number; total: number };
  history: { seq: number; appraisal_year: string; rating_pct: number | null; kpi_pct: number | null; achievements: string }[];
  history_avg: { rating: number | null; kpi: number | null };
  signoffs: CaseSignoff[]; bands: PromoBand[];
  // permissions
  has_ceo?: boolean; my_roles?: string[];
  can_rate?: boolean; can_signoff?: string[]; can_hod_final?: boolean; can_ceo_final?: boolean;
}
export interface MyCase {
  case_id: number; appraisal_id: number; cycle_name: string; status: CaseStatus; status_label: string; emp_name: string; empcode: string;
  cur_desg_desc: string; prop_desg_desc: string; competencies: CaseCompetency[]; self_comp_score: number | null;
  competency_progress: { self: number; total: number };
  emp_comments: string; tech_trainings: string; soft_trainings: string; emp_declared_at: string | null;
  outcome: CaseStatus | null; effective_date: string | null; final_desg_desc: string | null; can_self_assess: boolean;
}
export type CaseRow = Omit<PromotionCase, "settings" | "eligibility" | "eligibility_hints" | "competencies" | "self_comp_score"
  | "competency_progress" | "history" | "history_avg" | "signoffs" | "bands"> & { my_roles?: string[]; my_turn?: boolean };

export interface Dashboard {
  cycle: { cycle_id: number; name: string; status: CycleStatus; cycle_type: CycleType; period_from: string; period_to: string; phase: Phase } | null;
  active_cycles: { cycle_id: number; name: string; status: CycleStatus; period_to: string; phase: Phase; appraisals: number; completed: number }[];
  total?: number; completed?: number; pending_hr?: number;
  stages?: { stage: Stage; label: string; count: number }[];
  avg_score?: number | null; promotions_recommended?: number; promotion_cases_open?: number; promotions_approved?: number;
  increments?: number; increment_cost?: number; training_requests?: number; awaiting_ack?: number;
  bell_curve?: BellCurve;
  departments?: { rank: number | null; dept_no: string; dept_name: string; employees: number; scored: number; avg_score: number | null; min_score: number | null; max_score: number | null; completed: number }[];
  top?: Performer[]; low?: Performer[];
}
export interface Performer { appraisal_id: number; empcode: string; name: string; dept_name: string; desg_desc: string; final_score: number | null; final_rating: string; stage: Stage }
export interface Report {
  title: string; cycle?: { cycle_id: number; name: string } | null; columns: { key: string; label: string }[];
  rows: Record<string, unknown>[]; warnings?: string[];
}
export interface SummaryEmployee {
  empcode: string; name: string; age: number | null; doa: string | null; desg_desc: string; grade: string; grade_title: string;
  dept_no: string; dept_name: string; qualification: string; location: string; resource_type: string;
  exp_dcl: number | null; prior_exp: number | null; total_exp: number | null; category: Category; category_override: Category | null;
  remarks: string; appraisal_id: number | null; stage: Stage | null; stage_label: string; rating: string | null; hod_grade: string | null;
  score: number | null; promotion: string;
}
export interface SummarySheet {
  cycle: { cycle_id: number; name: string; period_from: string; period_to: string } | null;
  dept: string | null; dept_name: string; departments: { dept_no: string; dept_name: string }[];
  grades: { label: string; description: string }[];
  totals: { strength: number; eligible: number; graded: number };
  bell: { label: string; description: string; target_pct: number | null; standard_count: number | null; count: number; hod_count: number; actual_pct: number; remark: string }[];
  categories: { category: Category; label: string; count: number; eligible: boolean; by_grade: Record<string, number>; not_graded: number }[];
  lists: Record<Category, SummaryEmployee[]>;
}

export interface RecsBody {
  promotion?: { prop_desg_cd: string; prop_grade_cd?: string | null; justification?: string | null } | null;
  increment?: { inc_pct?: number | null; inc_amount?: number | null; justification?: string | null } | null;
  trainings?: { area: string; action_plan?: string | null; course_id?: number | null; target_date?: string | null }[];
}

// ── HR ──
const q = (h: Hr, extra: Record<string, string | number | undefined | null> = {}) => {
  const p = new URLSearchParams({ admin_card_no: h.card });
  if (h.compc) p.set("compc", h.compc);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  return p.toString();
};
const A = "/appraisal/admin";
const get = <T,>(h: Hr, path: string, extra?: Record<string, string | number | undefined | null>) =>
  apiRequest<T>(`${A}${path}?${q(h, extra)}`);
const send = <T,>(h: Hr, method: string, path: string, body?: unknown) =>
  apiRequest<T>(`${A}${path}?${q(h)}`, { method, body: body ?? {} });

export const apprHrApi = {
  lookups: (h: Hr) => get<Lookups>(h, "/lookups"),
  employees: (h: Hr, dept?: string) => get<{ items: EmployeeLite[] }>(h, "/employees", { dept }),

  competencies: (h: Hr) => get<{ items: Competency[]; active_weight: number }>(h, "/competencies"),
  saveCompetency: (h: Hr, body: Partial<Competency>, id?: number) =>
    send(h, id ? "PUT" : "POST", id ? `/competencies/${id}` : "/competencies", body),
  deleteCompetency: (h: Hr, id: number) => send(h, "DELETE", `/competencies/${id}`),
  loadDclCompetencies: (h: Hr) => send<{ added: number; deactivated: number }>(h, "POST", "/competencies/load-dcl"),

  scale: (h: Hr) => get<{ items: ScaleBand[] }>(h, "/scale"),
  saveScale: (h: Hr, bands: ScaleBand[]) => send(h, "PUT", "/scale", { bands }),
  resetScale: (h: Hr) => send(h, "POST", "/scale/reset"),

  promoSetup: (h: Hr) => get<{ settings: PromoSettings; bands: PromoBand[] }>(h, "/promotion-setup"),
  savePromoSetup: (h: Hr, body: { settings: PromoSettings; bands: PromoBand[] }) => send(h, "PUT", "/promotion-setup", body),
  resetPromoSetup: (h: Hr) => send(h, "POST", "/promotion-setup/reset"),

  mgmt: (h: Hr) => get<{ items: MgmtApprover[] }>(h, "/mgmt-approvers"),
  addMgmt: (h: Hr, empcode: string) => send(h, "POST", "/mgmt-approvers", { empcode }),
  setMgmt: (h: Hr, id: number, is_active: boolean) => send(h, "PUT", `/mgmt-approvers/${id}`, { is_active }),
  deleteMgmt: (h: Hr, id: number) => send(h, "DELETE", `/mgmt-approvers/${id}`),

  cycles: (h: Hr) => get<{ items: Cycle[] }>(h, "/cycles"),
  cycle: (h: Hr, id: number) => get<Cycle & { goals: CycleGoal[] }>(h, `/cycles/${id}`),
  saveCycle: (h: Hr, body: Partial<Cycle>, id?: number) =>
    send<{ cycle_id: number }>(h, id ? "PUT" : "POST", id ? `/cycles/${id}` : "/cycles", body),
  deleteCycle: (h: Hr, id: number) => send(h, "DELETE", `/cycles/${id}`),
  setCycleStatus: (h: Hr, id: number, status: "ACTIVE" | "CLOSED") => send(h, "POST", `/cycles/${id}/status`, { status }),
  setCyclePhase: (h: Hr, id: number, phase: Phase) =>
    send<{ phase: Phase; objectives_open: number; midyear_open: number }>(h, "POST", `/cycles/${id}/phase`, { phase }),
  saveCycleGoal: (h: Hr, cycleId: number, body: Partial<CycleGoal>, id?: number) =>
    send(h, id ? "PUT" : "POST", id ? `/cycles/${cycleId}/goals/${id}` : `/cycles/${cycleId}/goals`, body),
  deleteCycleGoal: (h: Hr, cycleId: number, id: number) => send(h, "DELETE", `/cycles/${cycleId}/goals/${id}`),
  previewLaunch: (h: Hr, cycleId: number, f: LaunchFilters) => send<LaunchPreview>(h, "POST", `/cycles/${cycleId}/launch/preview`, f),
  launch: (h: Hr, cycleId: number, f: LaunchFilters) =>
    send<{ created: number; skipped: { empcode: string; name: string; reason: string }[] }>(h, "POST", `/cycles/${cycleId}/launch`, f),
  bellCurve: (h: Hr, cycleId: number, dept?: string) => get<BellCurve>(h, `/cycles/${cycleId}/bell-curve`, { dept }),
  bulkApprove: (h: Hr, cycleId: number, ids?: number[]) => send<{ approved: number }>(h, "POST", `/cycles/${cycleId}/bulk-approve`, { ids }),

  appraisals: (h: Hr, f: { cycle_id?: number | string; stage?: string; dept?: string; q?: string }) =>
    get<{ items: HrRow[] }>(h, "/appraisals", f),
  appraisal: (h: Hr, id: number) => get<Appraisal>(h, `/appraisals/${id}`),
  saveRow: (h: Hr, aid: number, body: RowBody, id?: number) =>
    send(h, id ? "PUT" : "POST", id ? `/appraisals/${aid}/rows/${id}` : `/appraisals/${aid}/rows`, body),
  deleteRow: (h: Hr, aid: number, id: number) => send(h, "DELETE", `/appraisals/${aid}/rows/${id}`),
  adjust: (h: Hr, aid: number, grade: string | null, reason?: string) => send(h, "PUT", `/appraisals/${aid}/adjust`, { grade, reason }),
  recommendations: (h: Hr, aid: number, body: RecsBody) => send(h, "PUT", `/appraisals/${aid}/recommendations`, body),
  decide: (h: Hr, aid: number, decision: "approve" | "return", remarks?: string) =>
    send<{ stage: Stage }>(h, "POST", `/appraisals/${aid}/decision`, { decision, remarks }),
  reassign: (h: Hr, aid: number, body: { rpt_empcode?: string | null; hod1_empcode?: string | null; hod2_empcode?: string | null }) =>
    send<{ stage: Stage }>(h, "PUT", `/appraisals/${aid}/approvers`, body),
  cancel: (h: Hr, aid: number, remarks: string) => send(h, "POST", `/appraisals/${aid}/cancel`, { remarks }),
  evidencePath: (h: Hr, aid: number, attId: number) => withSession(`/api${A}/appraisals/${aid}/evidence/${attId}?${q(h)}`),

  cases: (h: Hr, f: { cycle_id?: number | string; status?: string }) => get<{ items: CaseRow[] }>(h, "/promotion-cases", f),
  case: (h: Hr, id: number) => get<PromotionCase>(h, `/promotion-cases/${id}`),
  saveEligibility: (h: Hr, id: number, body: { answers: { criterion: string; status: "Y" | "N" | null; remarks?: string }[]; assess_date?: string | null; prop_grade_cd?: string | null }) =>
    send(h, "PUT", `/promotion-cases/${id}/eligibility`, body),
  submitEligibility: (h: Hr, id: number) => send<{ status: CaseStatus }>(h, "POST", `/promotion-cases/${id}/eligibility/submit`),
  saveHistory: (h: Hr, id: number, rows: PromotionCase["history"]) => send(h, "PUT", `/promotion-cases/${id}/history`, { rows }),
  saveScorecard: (h: Hr, id: number, body: Partial<Pick<PromotionCase, "hr_recommendation" | "rationale" | "gap_areas" | "actions_timeline" | "next_review_date">>) =>
    send(h, "PUT", `/promotion-cases/${id}/scorecard`, body),
  submitReview: (h: Hr, id: number) => send<{ status: CaseStatus }>(h, "POST", `/promotion-cases/${id}/review/submit`),
  signoff: (h: Hr, id: number, decision: "RECOMMEND" | "NOT_RECOMMEND", remarks?: string) =>
    send<{ status: CaseStatus }>(h, "POST", `/promotion-cases/${id}/signoff`, { decision, remarks }),
  ceoDecision: (h: Hr, id: number, body: CeoBody) => send<{ status: CaseStatus }>(h, "POST", `/promotion-cases/${id}/ceo-decision`, body),
  cancelCase: (h: Hr, id: number, remarks: string) => send(h, "POST", `/promotion-cases/${id}/cancel`, { remarks }),

  recs: (h: Hr, f: { cycle_id?: number | string; kind?: string; status?: string }) => get<{ items: RecRow[] }>(h, "/recommendations", f),
  applyIncrement: (h: Hr, recId: number, body: { inc_amount?: number | null; effective_period?: number | null; effective_date?: string | null; with_arrear?: boolean }) =>
    send<{ doc_no: number; prev_gross: number; new_gross: number; new_basic: number | null; payroll_total: number | null }>(
      h, "POST", `/recommendations/increment/${recId}/apply`, body),
  applyPromotion: (h: Hr, recId: number, body: { prop_desg_cd?: string | null; prop_grade_cd?: string | null; effective_date?: string | null }) =>
    send<{ desg_desc: string }>(h, "POST", `/recommendations/promotion/${recId}/apply`, body),
  rejectRec: (h: Hr, kind: "INCREMENT" | "PROMOTION", recId: number, remarks: string) =>
    send(h, "POST", `/recommendations/${kind}/${recId}/reject`, { remarks }),

  dashboard: (h: Hr, cycleId?: number | string) => get<Dashboard>(h, "/dashboard", { cycle_id: cycleId }),
  report: (h: Hr, type: string, f: { cycle_id?: number | string; dept?: string; empcode?: string }) => get<Report>(h, `/reports/${type}`, f),
  summary: (h: Hr, cycleId?: number | string, dept?: string) => get<SummarySheet>(h, "/summary-sheet", { cycle_id: cycleId, dept }),
  saveProfile: (h: Hr, empcode: string, body: { prior_exp_years?: number | null; category_override?: Category | null; resource_type?: string; remarks?: string }) =>
    send(h, "PUT", `/profiles/${encodeURIComponent(empcode)}`, body),
};

export interface CeoBody {
  decision: "APPROVE" | "REJECT"; remarks?: string; final_desg_cd?: string | null; final_grade_cd?: string | null; new_package?: string; effective_date?: string | null;
}

// ── Employee / reviewer (bearer token) ──
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const enc = encodeURIComponent;
const M = (card: string) => `/appraisal/me/${enc(card)}`;
const R = (card: string) => `/appraisal/review/${enc(card)}`;

export const apprMeApi = {
  list: (card: string, token: string) => apiRequest<{ items: MyAppraisalRow[] }>(`${M(card)}/appraisals`, { headers: auth(token) }),
  history: (card: string, token: string) => apiRequest<History>(`${M(card)}/history`, { headers: auth(token) }),
  get: (card: string, token: string, id: number) => apiRequest<Appraisal>(`${M(card)}/appraisals/${id}`, { headers: auth(token) }),
  saveRow: (card: string, token: string, aid: number, body: RowBody, id?: number) =>
    apiRequest(id ? `${M(card)}/appraisals/${aid}/rows/${id}` : `${M(card)}/appraisals/${aid}/rows`, {
      method: id ? "PUT" : "POST", body, headers: auth(token),
    }),
  deleteRow: (card: string, token: string, aid: number, id: number) =>
    apiRequest(`${M(card)}/appraisals/${aid}/rows/${id}`, { method: "DELETE", body: {}, headers: auth(token) }),
  submitObjectives: (card: string, token: string, aid: number, remarks?: string) =>
    apiRequest<{ stage: Stage }>(`${M(card)}/appraisals/${aid}/objectives/submit`, { method: "POST", body: { remarks }, headers: auth(token) }),
  saveMidYear: (card: string, token: string, aid: number, rows: { emp_goal_id: number; midyear_progress: string; self_rating: Grade | null }[]) =>
    apiRequest(`${M(card)}/appraisals/${aid}/midyear`, { method: "PUT", body: { rows }, headers: auth(token) }),
  submitMidYear: (card: string, token: string, aid: number, remarks?: string) =>
    apiRequest<{ stage: Stage }>(`${M(card)}/appraisals/${aid}/midyear/submit`, { method: "POST", body: { remarks }, headers: auth(token) }),
  acknowledge: (card: string, token: string, aid: number, comment?: string) =>
    apiRequest(`${M(card)}/appraisals/${aid}/acknowledge`, { method: "POST", body: { comment }, headers: auth(token) }),
  uploadEvidence: async (card: string, token: string, aid: number, file: File, goalId?: number | null) => {
    const form = new FormData();
    form.append("file", file);
    if (goalId) form.append("emp_goal_id", String(goalId));
    const res = await fetch(`/api${M(card)}/appraisals/${aid}/evidence`, { method: "POST", body: form, headers: auth(token) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
      const d = err?.detail;
      throw new Error(typeof d === "string" ? d : Array.isArray(d) ? d.map((x: { msg?: string }) => x?.msg).join(", ") : `HTTP ${res.status}`);
    }
    return res.json();
  },
  deleteEvidence: (card: string, token: string, aid: number, attId: number) =>
    apiRequest(`${M(card)}/appraisals/${aid}/evidence/${attId}`, { method: "DELETE", body: {}, headers: auth(token) }),
  evidencePath: (card: string, aid: number, attId: number) => `/api${M(card)}/appraisals/${aid}/evidence/${attId}`,
  cases: (card: string, token: string) =>
    apiRequest<{ items: { case_id: number; cycle_name: string; status: CaseStatus; status_label: string; prop_desg_desc: string; my_turn: boolean }[] }>(
      `${M(card)}/promotion-cases`, { headers: auth(token) }),
  case: (card: string, token: string, id: number) => apiRequest<MyCase>(`${M(card)}/promotion-cases/${id}`, { headers: auth(token) }),
  saveSelfAssessment: (card: string, token: string, id: number, body: {
    competencies: { competency_id: number; self_rating: number | null; evidence: string; dev_needs: string }[];
    emp_comments: string; tech_trainings: string; soft_trainings: string;
  }) => apiRequest(`${M(card)}/promotion-cases/${id}/self-assessment`, { method: "PUT", body, headers: auth(token) }),
  submitSelfAssessment: (card: string, token: string, id: number) =>
    apiRequest<{ status: CaseStatus }>(`${M(card)}/promotion-cases/${id}/self-assessment/submit`, { method: "POST", body: {}, headers: auth(token) }),
};

export const apprReviewApi = {
  inbox: (card: string, token: string) =>
    apiRequest<{ is_reviewer: boolean; is_ceo: boolean; pending: number; appraisal_pending: number; items: InboxRow[]; cases: CaseRow[]; case_pending: number }>(
      `${R(card)}/inbox`, { headers: auth(token) }),
  get: (card: string, token: string, id: number) => apiRequest<Appraisal>(`${R(card)}/appraisals/${id}`, { headers: auth(token) }),
  lookups: (card: string, token: string, id: number) =>
    apiRequest<{ designations: Designation[]; courses: Course[] }>(`${R(card)}/appraisals/${id}/lookups`, { headers: auth(token) }),
  saveRow: (card: string, token: string, aid: number, body: RowBody, id?: number) =>
    apiRequest(id ? `${R(card)}/appraisals/${aid}/rows/${id}` : `${R(card)}/appraisals/${aid}/rows`, {
      method: id ? "PUT" : "POST", body, headers: auth(token),
    }),
  deleteRow: (card: string, token: string, aid: number, id: number) =>
    apiRequest(`${R(card)}/appraisals/${aid}/rows/${id}`, { method: "DELETE", body: {}, headers: auth(token) }),
  ratings: (card: string, token: string, aid: number, rows: { emp_goal_id: number; agreed_rating: Grade | null; reviewer_remarks?: string }[]) =>
    apiRequest<{ calc_score: number | null; final_rating: string | null }>(`${R(card)}/appraisals/${aid}/ratings`, { method: "PUT", body: { rows }, headers: auth(token) }),
  recommendations: (card: string, token: string, aid: number, body: RecsBody) =>
    apiRequest(`${R(card)}/appraisals/${aid}/recommendations`, { method: "PUT", body, headers: auth(token) }),
  decide: (card: string, token: string, aid: number, decision: "approve" | "return", remarks?: string) =>
    apiRequest<{ stage: Stage }>(`${R(card)}/appraisals/${aid}/decision`, { method: "POST", body: { decision, remarks }, headers: auth(token) }),
  evidencePath: (card: string, aid: number, attId: number) => `/api${R(card)}/appraisals/${aid}/evidence/${attId}`,
  case: (card: string, token: string, id: number) => apiRequest<PromotionCase>(`${R(card)}/promotion-cases/${id}`, { headers: auth(token) }),
  caseLookups: (card: string, token: string, id: number) =>
    apiRequest<{ designations: Designation[] }>(`${R(card)}/promotion-cases/${id}/lookups`, { headers: auth(token) }),
  rateCase: (card: string, token: string, id: number, competencies: { competency_id: number; mgr_rating: number | null; mgr_comment?: string }[], submit = false) =>
    apiRequest(`${R(card)}/promotion-cases/${id}/competencies`, { method: "PUT", body: { competencies, submit }, headers: auth(token) }),
  caseSignoff: (card: string, token: string, id: number, role: "RM" | "HOD", decision: "RECOMMEND" | "NOT_RECOMMEND", remarks?: string) =>
    apiRequest(`${R(card)}/promotion-cases/${id}/signoff`, { method: "POST", body: { role, decision, remarks }, headers: auth(token) }),
  hodFinal: (card: string, token: string, id: number, decision: "APPROVE" | "REJECT", remarks?: string) =>
    apiRequest(`${R(card)}/promotion-cases/${id}/hod-decision`, { method: "POST", body: { decision, remarks }, headers: auth(token) }),
  ceoFinal: (card: string, token: string, id: number, body: CeoBody) =>
    apiRequest(`${R(card)}/promotion-cases/${id}/ceo-decision`, { method: "POST", body, headers: auth(token) }),
};

/** Total "A" score (1.00–5.00). */
export const scoreText = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));
export const pctText = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}%`);
