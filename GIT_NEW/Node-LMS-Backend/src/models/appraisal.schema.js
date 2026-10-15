import { z } from "zod";

/**
 * Zod schemas for the Performance Appraisal routes (/appraisal/*) — DCL process.
 *
 * HR routes: admin_card_no MUST be declared in every query schema — validate()
 * strips undeclared keys and requireHrAdmin reads it from there.
 * Employee / reviewer routes: :card_no in the path must be the bearer token's
 * own card (requireEmployee enforces it).
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const optDate = date.optional().nullable().or(z.literal("").transform(() => null));
const id = z.coerce.number().int().positive();
const optText = (max) => z.string().max(max).optional().nullable();
const pct = z.coerce.number().min(0).max(100);
const grade = z.enum(["A+", "A", "B", "C", "D"]);
const optGrade = grade.optional().nullable().or(z.literal("").transform(() => null));
const rating5 = z.coerce.number().int().min(1).max(5).optional().nullable();
const strCode = z.union([z.string(), z.number()]).transform(String);

const hrQuery = {
  admin_card_no: z.string().min(1, "admin_card_no is required"),
  compc: z.string().optional(),
  brnch: z.string().optional(),
};
const hr = (extra = {}) => z.object({ query: z.object({ ...hrQuery, ...extra }) });
const hrParams = (params, extra = {}) => z.object({ params: z.object(params), query: z.object({ ...hrQuery, ...extra }) });
const hrBody = (body, params) => z.object({
  ...(params ? { params: z.object(params) } : {}),
  query: z.object(hrQuery),
  body,
});

const card = { card_no: z.string().min(1, "card_no is required") };
const emp = (params = {}, body) => z.object({
  params: z.object({ ...card, ...params }),
  ...(body ? { body } : {}),
});
const remarksBody = z.object({ remarks: optText(1000) }).optional().default({});

// ── HR: setup ──────────────────────────────────────────────────────────────
export const hrListSchema = hr();
export const hrEmployeesSchema = hr({ dept: z.string().optional() });

const competencyBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: optText(1000),
  weight_pct: z.coerce.number().positive().max(100).optional(),
  seq: z.coerce.number().int().min(0).max(999).optional(),
  is_active: z.boolean().optional(),
});
export const competencyCreateSchema = hrBody(competencyBody);
export const competencyUpdateSchema = hrBody(competencyBody, { item_id: id });
export const competencyDeleteSchema = hrParams({ item_id: id });

export const scaleSaveSchema = hrBody(z.object({
  bands: z.array(z.object({
    label: z.string().trim().min(1, "Grade is required").max(10),
    description: optText(60),
    min_score: z.coerce.number().min(0).max(5),
    max_score: z.coerce.number().min(0).max(5),
    target_pct: pct.optional().nullable(),
    is_development: z.boolean().optional(),
  })).min(1).max(10),
}));

export const promoSetupSchema = hrBody(z.object({
  settings: z.object({ comp_weight_pct: pct, perf_weight_pct: pct, min_tenure_yrs: z.coerce.number().min(0).max(20) }),
  bands: z.array(z.object({
    min_score: pct, label: z.string().trim().min(1).max(60), outcome: z.enum(["PROMOTE", "PROMOTE_DEV", "DEFER", "NOT_RECOMMEND"]),
  })).min(1).max(10),
}));

export const mgmtAddSchema = hrBody(z.object({ empcode: z.string().trim().min(1).max(30) }));
export const mgmtSetSchema = hrBody(z.object({ is_active: z.boolean() }), { approver_id: id });
export const mgmtDeleteSchema = hrParams({ approver_id: id });

// ── HR: cycles ─────────────────────────────────────────────────────────────
const cycleBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  cycle_type: z.enum(["ANNUAL", "HALF_YEARLY", "QUARTERLY", "PROBATION", "CONFIRMATION"]),
  fy_year: z.coerce.number().int().min(2000).max(2100).optional().nullable(),
  period_from: date,
  period_to: date,
  goal_deadline: optDate,
  self_deadline: optDate,
  review_deadline: optDate,
  remarks: optText(1000),
});
export const cycleGetSchema = hrParams({ cycle_id: id });
export const cycleCreateSchema = hrBody(cycleBody);
export const cycleUpdateSchema = hrBody(cycleBody, { cycle_id: id });
export const cycleStatusSchema = hrBody(z.object({ status: z.enum(["ACTIVE", "CLOSED"]) }), { cycle_id: id });
export const cyclePhaseSchema = hrBody(z.object({ phase: z.enum(["OBJECTIVES", "MIDYEAR", "YEAREND"]) }), { cycle_id: id });

const goalMasterBody = z.object({
  level_type: z.enum(["CORPORATE", "DEPARTMENT"]),
  dept_no: z.union([z.string(), z.number()]).optional().nullable().transform((v) => (v === null || v === undefined ? null : String(v))),
  objective: z.string().trim().min(1, "Task is required").max(500),
  kpi_text: optText(300),
  target: optText(200),
  weightage: z.coerce.number().min(5, "Weightage is at least 5%").max(40, "Weightage is at most 40%"),
});
export const cycleGoalCreateSchema = hrBody(goalMasterBody, { cycle_id: id });
export const cycleGoalUpdateSchema = hrBody(goalMasterBody, { cycle_id: id, goal_id: id });
export const cycleGoalDeleteSchema = hrParams({ cycle_id: id, goal_id: id });

const launchBody = z.object({
  empcodes: z.array(z.string().min(1).max(30)).max(2000).optional(),
  dept_nos: z.array(strCode).max(200).optional(),
  brnch: z.union([z.string(), z.number()]).optional().nullable().transform((v) => (v === null || v === undefined || v === "" ? null : String(v))),
  emp_statuses: z.array(z.string().max(2)).max(10).optional(),
});
export const launchSchema = hrBody(launchBody, { cycle_id: id });

// ── Task sheet rows ────────────────────────────────────────────────────────
const rowBody = z.object({
  accountability: optText(300),
  task: z.string().trim().min(1, "Task for the year is required").max(500),
  kpi: optText(300),
  success_criteria: optText(500),
  interdependencies: optText(500),
  weightage: z.coerce.number().min(5, "Weightage is at least 5%").max(40, "Weightage is at most 40%"),
  due_date: optDate,
});

// ── HR: appraisals ─────────────────────────────────────────────────────────
export const hrAppraisalsSchema = hr({
  cycle_id: z.string().optional(), stage: z.string().optional(), dept: z.string().optional(), q: z.string().max(60).optional(),
});
export const hrAppraisalSchema = hrParams({ appraisal_id: id });
export const hrEvidenceSchema = hrParams({ appraisal_id: id, att_id: id });
export const hrRowCreateSchema = hrBody(rowBody, { appraisal_id: id });
export const hrRowUpdateSchema = hrBody(rowBody, { appraisal_id: id, goal_id: id });
export const hrRowDeleteSchema = hrParams({ appraisal_id: id, goal_id: id });

const decisionBody = z.object({ decision: z.enum(["approve", "return"]), remarks: optText(1000) });
export const hrDecisionSchema = hrBody(decisionBody, { appraisal_id: id });
export const hrAdjustSchema = hrBody(z.object({ grade: optGrade, reason: optText(1000) }), { appraisal_id: id });
export const hrBulkApproveSchema = hrBody(z.object({ ids: z.array(id).max(2000).optional() }), { cycle_id: id });
export const hrReassignSchema = hrBody(z.object({
  rpt_empcode: optText(30), hod1_empcode: optText(30), hod2_empcode: optText(30),
}), { appraisal_id: id });
export const hrCancelSchema = hrBody(z.object({ remarks: z.string().trim().min(1, "Give a reason").max(1000) }), { appraisal_id: id });

const recsBody = z.object({
  promotion: z.object({
    prop_desg_cd: strCode,
    prop_grade_cd: optText(10),
    justification: optText(1000),
  }).nullable().optional(),
  increment: z.object({
    inc_pct: z.coerce.number().min(0).max(200).optional().nullable(),
    inc_amount: z.coerce.number().min(0).optional().nullable(),
    justification: optText(1000),
  }).nullable().optional(),
  trainings: z.array(z.object({
    area: z.string().trim().min(1, "Area is required").max(200),
    action_plan: optText(1000),
    course_id: id.optional().nullable(),
    target_date: optDate,
  })).max(20).optional(),
});
export const hrRecsSchema = hrBody(recsBody, { appraisal_id: id });
export const bellCurveSchema = hrParams({ cycle_id: id }, { dept: z.string().optional() });

// ── HR: recommendations / apply ────────────────────────────────────────────
export const recListSchema = hr({
  cycle_id: z.string().optional(), kind: z.enum(["INCREMENT", "PROMOTION"]).optional(),
  status: z.enum(["PROPOSED", "APPROVED", "APPLIED", "REJECTED"]).optional(),
});
export const applyIncrementSchema = hrBody(z.object({
  inc_amount: z.coerce.number().positive().optional().nullable(),
  effective_period: z.coerce.number().int().positive().optional().nullable(),
  effective_date: optDate,
  with_arrear: z.boolean().optional(),
}), { rec_id: id });
export const applyPromotionSchema = hrBody(z.object({
  prop_desg_cd: strCode.optional().nullable(),
  prop_grade_cd: optText(10),
  effective_date: optDate,
}), { rec_id: id });
export const recRejectSchema = hrBody(z.object({ remarks: z.string().trim().min(1, "Give a reason").max(1000) }), {
  kind: z.enum(["INCREMENT", "PROMOTION"]), rec_id: id,
});

// ── HR: promotion evaluation (sheets 1–5) ──────────────────────────────────
export const hrCasesSchema = hr({ cycle_id: z.string().optional(), status: z.string().optional() });
export const hrCaseSchema = hrParams({ case_id: id });
export const hrEligibilitySchema = hrBody(z.object({
  answers: z.array(z.object({
    criterion: z.string().min(1).max(20),
    status: z.enum(["Y", "N"]).optional().nullable().or(z.literal("").transform(() => null)),
    remarks: optText(500),
  })).max(20),
  assess_date: optDate,
  prop_grade_cd: optText(10),
}), { case_id: id });
export const hrHistorySchema = hrBody(z.object({
  rows: z.array(z.object({
    seq: z.coerce.number().int().min(1).max(3),
    appraisal_year: optText(20),
    rating_pct: pct.optional().nullable(),
    kpi_pct: pct.optional().nullable(),
    achievements: optText(1000),
  })).max(3),
}), { case_id: id });
export const hrScorecardSchema = hrBody(z.object({
  hr_recommendation: optText(200), rationale: optText(2000), gap_areas: optText(1000), actions_timeline: optText(1000),
  next_review_date: optDate,
}), { case_id: id });
export const hrSignoffSchema = hrBody(z.object({ decision: z.enum(["RECOMMEND", "NOT_RECOMMEND"]), remarks: optText(1000) }), { case_id: id });
const ceoBody = z.object({
  decision: z.enum(["APPROVE", "REJECT"]), remarks: optText(1000),
  final_desg_cd: strCode.optional().nullable(), final_grade_cd: optText(10), new_package: optText(200), effective_date: optDate,
});
export const hrCeoSchema = hrBody(ceoBody, { case_id: id });
export const hrCaseCancelSchema = hrBody(z.object({ remarks: z.string().trim().min(1, "Give a reason").max(1000) }), { case_id: id });

// ── HR: dashboard / reports / summary sheet ────────────────────────────────
export const dashboardSchema = hr({ cycle_id: z.string().optional() });
export const reportSchema = z.object({
  params: z.object({ type: z.string().min(1) }),
  query: z.object({
    ...hrQuery, cycle_id: z.string().optional(), dept: z.string().optional(), empcode: z.string().optional(), limit: z.string().optional(),
  }),
});
export const summarySchema = hr({ cycle_id: z.string().optional(), dept: z.string().optional() });
export const profileSchema = hrBody(z.object({
  prior_exp_years: z.coerce.number().min(0).max(60).optional().nullable(),
  category_override: z.enum(["FULL", "PRORATA", "PROBATION", "TE_MTO"]).optional().nullable().or(z.literal("").transform(() => null)),
  resource_type: optText(40),
  remarks: optText(500),
}), { empcode: z.string().min(1).max(30) });

// ── Employee ───────────────────────────────────────────────────────────────
export const myListSchema = emp();
export const myAppraisalSchema = emp({ appraisal_id: id });
export const myRowCreateSchema = emp({ appraisal_id: id }, rowBody);
export const myRowUpdateSchema = emp({ appraisal_id: id, goal_id: id }, rowBody);
export const myRowDeleteSchema = emp({ appraisal_id: id, goal_id: id });
export const mySubmitSchema = emp({ appraisal_id: id }, remarksBody);
export const myMidYearSchema = emp({ appraisal_id: id }, z.object({
  rows: z.array(z.object({ emp_goal_id: id, midyear_progress: optText(2000), self_rating: optGrade })).max(20),
}));
export const myAckSchema = emp({ appraisal_id: id }, z.object({ comment: optText(1000) }).optional().default({}));
export const myEvidenceUploadSchema = z.object({
  params: z.object({ ...card, appraisal_id: id }),
  body: z.object({ emp_goal_id: id.optional().nullable().or(z.literal("").transform(() => null)) }).optional().default({}),
});
export const myEvidenceSchema = emp({ appraisal_id: id, att_id: id });
export const myCaseSchema = emp({ case_id: id });
export const mySelfAssessSchema = emp({ case_id: id }, z.object({
  competencies: z.array(z.object({ competency_id: id, self_rating: rating5, evidence: optText(1000), dev_needs: optText(1000) })).max(30),
  emp_comments: optText(2000), tech_trainings: optText(1000), soft_trainings: optText(1000),
}));

// ── Reviewer (line manager / HODs / CEO) ───────────────────────────────────
export const reviewInboxSchema = emp();
export const reviewGetSchema = emp({ appraisal_id: id });
export const reviewRowCreateSchema = emp({ appraisal_id: id }, rowBody);
export const reviewRowUpdateSchema = emp({ appraisal_id: id, goal_id: id }, rowBody);
export const reviewRowDeleteSchema = emp({ appraisal_id: id, goal_id: id });
export const reviewRatingsSchema = emp({ appraisal_id: id }, z.object({
  rows: z.array(z.object({
    emp_goal_id: id, agreed_rating: optGrade, reviewer_remarks: optText(1000), yearend_comment: optText(1000),
  })).max(20),
}));
export const reviewRecsSchema = emp({ appraisal_id: id }, recsBody);
export const reviewDecisionSchema = emp({ appraisal_id: id }, decisionBody);
export const reviewEvidenceSchema = emp({ appraisal_id: id, att_id: id });
export const reviewCaseSchema = emp({ case_id: id });
export const reviewRateCaseSchema = emp({ case_id: id }, z.object({
  competencies: z.array(z.object({ competency_id: id, mgr_rating: rating5, mgr_comment: optText(1000) })).max(30),
  submit: z.boolean().optional(),
}));
export const reviewCaseSignoffSchema = emp({ case_id: id }, z.object({
  role: z.enum(["RM", "HOD"]), decision: z.enum(["RECOMMEND", "NOT_RECOMMEND"]), remarks: optText(1000),
}));
export const reviewHodFinalSchema = emp({ case_id: id }, z.object({ decision: z.enum(["APPROVE", "REJECT"]), remarks: optText(1000) }));
export const reviewCeoSchema = emp({ case_id: id }, ceoBody);
