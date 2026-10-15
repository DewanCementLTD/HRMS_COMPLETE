/**
 * Pure appraisal rules of the DCL process — no database access, so they can be
 * unit tested (test/appraisalRules.test.js).
 *
 * Task sheet ("Employee Task Setting & Performance Appraisal"):
 *   up to 8 accountabilities, weightage 5–40% each, total exactly 100%
 *   rating A+ / A / B / C / D = 5 / 4 / 3 / 2 / 1 points
 *   row score = weightage% × points; Total "A" = Σ row scores (1.00–5.00)
 *   grade from the total: ≥4.5 A+, ≥3.5 A, ≥2.5 B, ≥1.5 C, else D (company scale)
 *
 * Promotion evaluation (sheets 1–5): eligibility gate, competency score,
 * 3-year performance score, weighted overall score and decision band.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v) => (v === null || v === undefined || v === "" ? null : num(v));
const r2 = (v) => Math.round(num(v) * 100) / 100;

// ---------------------------------------------------------------------------
// Grades and the task sheet
// ---------------------------------------------------------------------------

export const GRADES = ["A+", "A", "B", "C", "D"];
export const GRADE_POINTS = { "A+": 5, A: 4, B: 3, C: 2, D: 1 };
export const GRADE_MEANING = { "A+": "Outstanding", A: "Excellent Performance", B: "Good Performance", C: "Inconsistent", D: "Non-performer" };
export const gradeOfPoints = (p) => GRADES.find((g) => GRADE_POINTS[g] === num(p)) ?? null;

export const SHEET_RULES = { maxRows: 8, minWeight: 5, maxWeight: 40, total: 100 };

/** Score of one accountability: weightage% × rating points (20% × A = 0.80). */
export const rowScore = (weightage, points) => (numOrNull(points) === null ? null : (num(weightage) / 100) * num(points));

/** Total "A": sum of the row scores that are rated; null when nothing is rated. */
export const sheetTotal = (rows, pick) => {
  let total = 0;
  let any = false;
  for (const r of rows) {
    const s = rowScore(r.weightage, pick(r));
    if (s === null) continue;
    total += s;
    any = true;
  }
  return any ? r2(total) : null;
};

/** Problems with the weightage of a task sheet (empty list = valid). */
export const weightProblems = (rows, rules = SHEET_RULES) => {
  const out = [];
  if (!rows.length) out.push("Add at least one accountability");
  if (rows.length > rules.maxRows) out.push(`At most ${rules.maxRows} accountabilities`);
  rows.forEach((r, i) => {
    const w = num(r.weightage);
    if (w < rules.minWeight || w > rules.maxWeight) out.push(`Row ${i + 1}: weightage must be ${rules.minWeight}%–${rules.maxWeight}% (now ${w}%)`);
  });
  const total = r2(rows.reduce((t, r) => t + num(r.weightage), 0));
  if (Math.abs(total - rules.total) > 0.01) out.push(`Total weightage must equal ${rules.total}% (now ${total}%)`);
  return out;
};

// The DCL grade bands on the 1–5 total, with the company's bell curve (flow chart).
export const DEFAULT_SCALE = [
  { min_score: 4.5, max_score: 5, label: "A+", description: "Outstanding", target_pct: 5, is_development: false },
  { min_score: 3.5, max_score: 4.49, label: "A", description: "Excellent Performance", target_pct: 19, is_development: false },
  { min_score: 2.5, max_score: 3.49, label: "B", description: "Good Performance", target_pct: 63, is_development: false },
  { min_score: 1.5, max_score: 2.49, label: "C", description: "Inconsistent", target_pct: 8, is_development: true },
  { min_score: 0, max_score: 1.49, label: "D", description: "Non-performer", target_pct: 5, is_development: true },
];

/** Grade band for a score from a company's scale rows. */
export const bandFor = (scale, score) => {
  if (score === null || score === undefined) return null;
  const sc = num(score);
  const sorted = [...scale].sort((a, b) => b.min_score - a.min_score);
  return sorted.find((b) => sc >= b.min_score) ?? sorted[sorted.length - 1] ?? null;
};

// ---------------------------------------------------------------------------
// Review chain (year end): first rater (HOD1, or the reporting officer when
// there is no HOD1) → HOD2 (if set) → HR
// ---------------------------------------------------------------------------

/** Year-end stages of an appraisal given which approvers it has. */
export const yearEndChain = ({ hasRpt, hasHod1, hasHod2 }) => [
  ...(hasHod1 ? ["HOD1"] : hasRpt ? ["RPT"] : []),
  ...(hasHod2 ? ["HOD2"] : []),
  "HR",
];

/** Stage after `stage` on the year-end chain (MID_REVIEW → first rater, last → COMPLETED). */
export const nextStageOf = (chain, stage) => {
  if (stage === "MID_REVIEW") return chain[0];
  const i = chain.indexOf(stage);
  return i >= 0 && i < chain.length - 1 ? chain[i + 1] : "COMPLETED";
};
/** Stage a year-end reviewer returns to; null when there is nobody before them (mid-year is locked). */
export const prevStageOf = (chain, stage) => {
  const i = chain.indexOf(stage);
  return i > 0 ? chain[i - 1] : null;
};

// ---------------------------------------------------------------------------
// Promotion evaluation
// ---------------------------------------------------------------------------

// Sheet 1 — eligibility gate (all must be "Yes").
export const ELIGIBILITY_CRITERIA = [
  { code: "TENURE", criterion: "Minimum tenure in current role met", requirement: "Typically 2 years, unless waived by HOD/HR Head" },
  { code: "RATING", criterion: "Last appraisal rating meets threshold", requirement: "\"Meets Expectations\" (B) or above in the most recent cycle" },
  { code: "DISCIPLINE", criterion: "No active disciplinary action", requirement: "No unresolved warning/show-cause in the last 12 months" },
  { code: "GRIEVANCE", criterion: "No pending grievance or investigation", requirement: "None open at the time of assessment" },
  { code: "QUALIFICATION", criterion: "Required qualification/certification held", requirement: "As specified in the target role's job description" },
  { code: "ATTENDANCE", criterion: "Attendance & conduct record satisfactory", requirement: "Within approved leave/attendance policy limits" },
  { code: "VACANCY", criterion: "Budgeted vacancy / headcount approved", requirement: "Confirmed by Finance/HR for the target position" },
];

/** INCOMPLETE until every criterion is answered; NOT_ELIGIBLE if any is "No". */
export const eligibilityResult = (answers) => {
  const byCode = new Map(answers.map((a) => [a.criterion, a.status]));
  const vals = ELIGIBILITY_CRITERIA.map((c) => byCode.get(c.code) ?? null);
  if (vals.some((v) => v === "N")) return "NOT_ELIGIBLE";
  if (vals.some((v) => v !== "Y")) return "INCOMPLETE";
  return "ELIGIBLE";
};

// Sheet 2 — the ten competencies of the DCL promotion form (10% each).
export const DCL_COMPETENCIES = [
  ["Analytical Thinking", "Logically breaking problems into essential elements; diagnosing issues and developing solutions."],
  ["Flexibility", "Altering behaviours and opinions in light of new information or changing situations."],
  ["Positive Self Image", "Positive belief in personal capability; confidence in difficult situations and with people."],
  ["Tenacity", "Repeated and enduring efforts to overcome obstacles and complete tasks."],
  ["Initiative", "Engaging in proactive behaviour; seizing opportunities without being asked."],
  ["Efficiency Orientation", "Seeking the best use of resources; improving methods, systems, processes and structures."],
  ["Development Orientation", "Identifying and providing opportunities to improve the capabilities of others."],
  ["Concern for Standards", "Pursuing the highest standards in procedures, systems and outcomes."],
  ["Results Orientation", "Focusing attention on key objectives; wanting effective, measurable outcomes."],
  ["Communication", "Presenting ideas verbally and in writing, clearly and effectively, to different audiences."],
];

/** Competency score %: Σ(weight% × rating/5); null until every competency is rated. */
export const competencyScore = (items, field) => {
  if (!items.length || items.some((i) => numOrNull(i[field]) === null)) return null;
  const w = items.reduce((t, i) => t + num(i.weight_pct), 0);
  if (!(w > 0)) return null;
  return r2(items.reduce((t, i) => t + num(i.weight_pct) * (num(i[field]) / 5), 0) * (100 / w));
};

/** Sheet 3 — performance score % = average of (3-yr avg rating %, 3-yr avg KPI %). */
export const performanceScore = (rows) => {
  const avg = (vals) => (vals.length ? vals.reduce((t, v) => t + v, 0) / vals.length : null);
  const rating = avg(rows.map((r) => numOrNull(r.rating_pct)).filter((v) => v !== null));
  const kpi = avg(rows.map((r) => numOrNull(r.kpi_pct)).filter((v) => v !== null));
  const parts = [rating, kpi].filter((v) => v !== null);
  return {
    rating_avg: rating === null ? null : r2(rating),
    kpi_avg: kpi === null ? null : r2(kpi),
    score: parts.length ? r2(parts.reduce((t, v) => t + v, 0) / parts.length) : null,
  };
};

export const overallScore = (comp, perf, compW, perfW) =>
  (comp === null || perf === null ? null : r2((num(comp) * num(compW) + num(perf) * num(perfW)) / 100));

// Sheet 4 — decision bands (the form refers to an "Instructions" sheet that was
// not supplied; these are the defaults HR can change in Setup).
export const DEFAULT_PROMO_BANDS = [
  { min_score: 80, label: "Promote", outcome: "PROMOTE" },
  { min_score: 70, label: "Promote with Development Plan", outcome: "PROMOTE_DEV" },
  { min_score: 60, label: "Defer — review next cycle", outcome: "DEFER" },
  { min_score: 0, label: "Not recommended", outcome: "NOT_RECOMMEND" },
];

/** Decision band: INCOMPLETE / NOT ELIGIBLE override the score band. */
export const decisionBand = (bands, overall, eligibility) => {
  if (eligibility === "NOT_ELIGIBLE") return { label: "NOT ELIGIBLE", outcome: "NOT_ELIGIBLE" };
  if (eligibility !== "ELIGIBLE" || overall === null || overall === undefined) return { label: "INCOMPLETE", outcome: "INCOMPLETE" };
  const sorted = [...bands].sort((a, b) => b.min_score - a.min_score);
  const b = sorted.find((x) => num(overall) >= x.min_score) ?? sorted[sorted.length - 1];
  return b ? { label: b.label, outcome: b.outcome } : { label: "INCOMPLETE", outcome: "INCOMPLETE" };
};

/** Whole years (1 decimal) between two dates. */
export const yearsBetween = (from, to = new Date()) => {
  if (!from) return null;
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.max(0, Math.round(((b - a) / (365.25 * 24 * 3600 * 1000)) * 10) / 10);
};

// ---------------------------------------------------------------------------
// Summary sheet categories
// ---------------------------------------------------------------------------

export const CATEGORY_LABEL = {
  FULL: "A: Eligible employees (full year)",
  PRORATA: "B: Eligible employees (pro-rata basis)",
  PROBATION: "C: Non-eligible employees (on probation)",
  TE_MTO: "D: TE / MTO",
};

/**
 * Category of an employee for the summary sheet: HR override, else TE/MTO by
 * designation, probation by employment status '1', pro-rata when joined less
 * than a year before the end of the review period, else full year.
 */
export const categoryOf = ({ override, desgDesc, empStatus, joinDate, periodTo }) => {
  if (override) return override;
  if (/\b(MTO|TE|TRAINEE|MANAGEMENT TRAINEE|TRAINEE ENGINEER)\b/i.test(String(desgDesc ?? ""))) return "TE_MTO";
  if (String(empStatus ?? "") === "1") return "PROBATION";
  const yrs = yearsBetween(joinDate, periodTo);
  if (yrs !== null && yrs < 1) return "PRORATA";
  return "FULL";
};
