/**
 * Appraisal workflow — the DCL "Employee Task Setting & Performance Appraisal"
 * process (flow chart "Appraisal & Promotion Evaluation"):
 *
 *   OBJ_SETTING  employee drafts up to 8 accountabilities (weightage 5–40%, total 100%);
 *                the line manager may also edit and approve directly
 *   OBJ_REVIEW   line manager approves → objectives PERMANENTLY LOCKED, or returns them
 *   MIDYEAR      (cycle phase ≥ MIDYEAR) employee: mid-year progress + self rating A+…D per row
 *   MID_REVIEW   line manager comments and signs → HALF-YEAR REVIEW LOCKED, or returns
 *   RPT|HOD1     (cycle phase YEAREND) agreed rating per row, promotion recommendation,
 *                optional increment / trainings
 *   HOD2         (if set) may change the ratings; approve, or return to the first rater
 *   HR           bell curve, optional grade override (with reason); finalise → RATING LOCKED
 *   COMPLETED    performance history, development plan, training requests, and a
 *                promotion evaluation case when promotion was recommended;
 *                the employee then acknowledges (final sign-off)
 *
 * Line manager = reporting officer (RPT_OFFICER), else HOD1, else HOD2, else HR.
 * Every entry point re-checks the caller against the approver snapshot taken at
 * launch, the stage, the cycle status and the cycle phase.
 */

import fs from "node:fs";
import path from "node:path";
import { DOCS_ROOT } from "./documents.service.js";
import { logger } from "../utils/logger.js";
import {
  OUT_ARRAY, s, num, numOrNull, r2, ymd, ymdhm, mobileKey, mobileKeySql, AppraisalError, nextId, nameOf, writeLog, read, withTx,
  EMP_DEPT_SQL, EMP_DESG_SQL, loadPerson, chainOf, lineManagerRole, rolesOn, loadScale,
  STAGE_LABEL, phaseAtLeast, GRADE_POINTS,
} from "./appraisalShared.service.js";
import { recomputeScores } from "./appraisalScore.service.js";
import { nextStageOf, prevStageOf, weightProblems, rowScore, gradeOfPoints, SHEET_RULES } from "./appraisalRules.js";
import { writeLog as writeTrainingLog } from "./trainingShared.service.js";
import { createPromotionCase, caseSummaryFor } from "./appraisalPromotion.service.js";

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const HEAD_SELECT = `
  SELECT a.APPRAISAL_ID, a.COMPC, a.CYCLE_ID, a.EMPCODE, m.NAME, ${EMP_DEPT_SQL}, ${EMP_DESG_SQL}, a.BRNCH,
         m.DTOFAPPT, m.EMPNO,
         a.RPT_EMPCODE, (SELECT MAX(r.NAME) FROM HR_EMP_MASTER r WHERE r.EMPCODE = a.RPT_EMPCODE),
         a.HOD1_MNO, a.HOD2_MNO, a.STAGE, a.GOAL_REVIEWER,
         a.OBJ_LOCKED_AT, a.MID_LOCKED_AT, a.MID_COMMENTS, a.SELF_SUBMITTED_AT,
         a.SELF_SCORE, a.CALC_SCORE, a.HR_ADJ_GRADE, a.HR_ADJ_REASON, a.FINAL_SCORE, a.FINAL_RATING, a.HOD_GRADE,
         a.PROMO_RECOMMENDED, a.COMPLETED_AT, a.EMP_ACK_AT, a.EMP_ACK_COMMENT,
         y.NAME, y.CYCLE_TYPE, y.FY_YEAR, y.PERIOD_FROM, y.PERIOD_TO, y.GOAL_DEADLINE, y.SELF_DEADLINE, y.REVIEW_DEADLINE,
         y.STATUS, y.PHASE,
         a.DEPT_NO, a.DESG_CD, a.GRADE_CD, a.UPDATED_AT
    FROM HR_APPRAISAL_MASTER a
    JOIN HR_APPRAISAL_CYCLE y ON y.CYCLE_ID = a.CYCLE_ID
    LEFT JOIN HR_EMP_MASTER m ON m.EMPCODE = a.EMPCODE`;

const rowToHead = (x) => ({
  appraisal_id: num(x[0]), compc: num(x[1]), cycle_id: num(x[2]), empcode: s(x[3]), emp_name: s(x[4]),
  dept_name: s(x[5]), desg_desc: s(x[6]), brnch: numOrNull(x[7]), join_date: ymd(x[8]), empno: s(x[9]),
  rpt_empcode: s(x[10]) || null, rpt_name: s(x[11]) || null, hod1_mno: s(x[12]) || null, hod2_mno: s(x[13]) || null,
  stage: s(x[14]), goal_reviewer: s(x[15]) || null,
  obj_locked_at: ymdhm(x[16]), mid_locked_at: ymdhm(x[17]), mid_comments: s(x[18]), self_submitted_at: ymdhm(x[19]),
  self_score: numOrNull(x[20]), calc_score: numOrNull(x[21]), hr_adj_grade: s(x[22]) || null, hr_adj_reason: s(x[23]) || null,
  final_score: numOrNull(x[24]), final_rating: s(x[25]) || null, hod_grade: s(x[26]) || null,
  promo_recommended: s(x[27]) === "Y", completed_at: ymdhm(x[28]), emp_ack_at: ymdhm(x[29]), emp_ack_comment: s(x[30]),
  cycle: {
    cycle_id: num(x[2]), name: s(x[31]), cycle_type: s(x[32]), fy_year: num(x[33]), period_from: ymd(x[34]), period_to: ymd(x[35]),
    goal_deadline: ymd(x[36]), self_deadline: ymd(x[37]), review_deadline: ymd(x[38]), status: s(x[39]), phase: s(x[40]),
  },
  dept_no: s(x[41]), desg_cd: s(x[42]), grade_cd: s(x[43]), updated_at: ymdhm(x[44]),
});

const loadHead = async (c, id, { lock = false } = {}) => {
  if (lock) await c.execute(`SELECT 1 FROM HR_APPRAISAL_MASTER WHERE APPRAISAL_ID = :id FOR UPDATE`, { id }, { outFormat: OUT_ARRAY });
  const r = await c.execute(`${HEAD_SELECT} WHERE a.APPRAISAL_ID = :id`, { id }, { outFormat: OUT_ARRAY });
  if (!r.rows?.length) throw new AppraisalError("Appraisal not found", 404);
  return rowToHead(r.rows[0]);
};

const nameByMobile = async (c, mno) => {
  const k = mobileKey(mno);
  if (!k) return null;
  const r = await c.execute(
    `SELECT MAX(NAME) FROM HR_EMP_MASTER WHERE ${mobileKeySql('"MOBILE#"')} = :k AND NVL(STATUS,'A') = 'A'`,
    { k }, { outFormat: OUT_ARRAY },
  );
  return s(r.rows?.[0]?.[0]) || null;
};

/** The accountability rows of the task sheet, with their scores. */
const loadRows = async (c, id) => {
  const r = await c.execute(
    `SELECT EMP_GOAL_ID, SOURCE, GOAL_ID, ACCOUNTABILITY, OBJECTIVE, KPI_TEXT, TARGET, INTERDEPENDENCIES, WEIGHTAGE, DUE_DATE,
            MIDYEAR_PROGRESS, ACHIEVEMENT, SELF_RATING, HOD_RATING, REMARKS, SEQ
       FROM HR_EMPLOYEE_GOAL WHERE APPRAISAL_ID = :id
      ORDER BY CASE SOURCE WHEN 'CORPORATE' THEN 0 WHEN 'DEPARTMENT' THEN 1 ELSE 2 END, SEQ, EMP_GOAL_ID`,
    { id }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => {
    const self = numOrNull(x[12]);
    const agreed = numOrNull(x[13]);
    return {
      emp_goal_id: num(x[0]), source: s(x[1]), goal_id: numOrNull(x[2]), accountability: s(x[3]), task: s(x[4]), kpi: s(x[5]),
      success_criteria: s(x[6]), interdependencies: s(x[7]), weightage: num(x[8]), due_date: ymd(x[9]),
      midyear_progress: s(x[10]), yearend_comment: s(x[11]),
      self_rating: gradeOfPoints(self), agreed_rating: gradeOfPoints(agreed),
      self_score: self === null ? null : r2(rowScore(x[8], self)), score: agreed === null ? null : r2(rowScore(x[8], agreed)),
      reviewer_remarks: s(x[14]), seq: num(x[15]),
    };
  });
};

const loadRecommendations = async (c, id) => {
  const p = await c.execute(
    `SELECT p.REC_ID, p.CUR_DESG_CD, p.CUR_GRADE_CD, p.PROP_DESG_CD, p.PROP_GRADE_CD, p.JUSTIFICATION, p.RECOMMENDED_BY,
            (SELECT MAX(m.NAME) FROM HR_EMP_MASTER m WHERE m.EMPCODE = p.RECOMMENDED_BY), p.STATUS, p.EFFECTIVE_DATE, p.APPLIED_AT,
            (SELECT MAX(g.DESG_DESC) FROM HR_DESG g WHERE TO_CHAR(g.DESG_CD) = p.CUR_DESG_CD AND g.COMPC = p.COMPC),
            (SELECT MAX(g.DESG_DESC) FROM HR_DESG g WHERE TO_CHAR(g.DESG_CD) = p.PROP_DESG_CD AND g.COMPC = p.COMPC)
       FROM HR_PROMOTION_RECOMMENDATION p WHERE p.APPRAISAL_ID = :id`,
    { id }, { outFormat: OUT_ARRAY },
  );
  const i = await c.execute(
    `SELECT n.REC_ID, n.PREV_GROSS, n.INC_PCT, n.INC_AMOUNT, n.NEW_GROSS, n.JUSTIFICATION, n.RECOMMENDED_BY,
            (SELECT MAX(m.NAME) FROM HR_EMP_MASTER m WHERE m.EMPCODE = n.RECOMMENDED_BY), n.STATUS, n.EFFECTIVE_PERIOD,
            n.WITH_ARREAR, n.HIST_DOC_NO, n.APPLIED_AT
       FROM HR_INCREMENT_RECOMMENDATION n WHERE n.APPRAISAL_ID = :id`,
    { id }, { outFormat: OUT_ARRAY },
  );
  const px = p.rows?.[0];
  const ix = i.rows?.[0];
  return {
    promotion: px ? {
      rec_id: num(px[0]), cur_desg_cd: s(px[1]), cur_grade_cd: s(px[2]), prop_desg_cd: s(px[3]), prop_grade_cd: s(px[4]) || null,
      justification: s(px[5]), recommended_by: s(px[6]), recommended_by_name: s(px[7]), status: s(px[8]),
      effective_date: ymd(px[9]), applied_at: ymdhm(px[10]), cur_desg_desc: s(px[11]), prop_desg_desc: s(px[12]),
    } : null,
    increment: ix ? {
      rec_id: num(ix[0]), prev_gross: numOrNull(ix[1]), inc_pct: numOrNull(ix[2]), inc_amount: num(ix[3]), new_gross: numOrNull(ix[4]),
      justification: s(ix[5]), recommended_by: s(ix[6]), recommended_by_name: s(ix[7]), status: s(ix[8]),
      effective_period: numOrNull(ix[9]), with_arrear: s(ix[10]) === "Y", hist_doc_no: numOrNull(ix[11]), applied_at: ymdhm(ix[12]),
    } : null,
  };
};

const loadDevPlan = async (c, id) => {
  const r = await c.execute(
    `SELECT d.PLAN_ID, d.SOURCE, d.AREA, d.ACTION_PLAN, d.COURSE_ID, k.TITLE, d.TARGET_DATE, d.STATUS, d.TRAINING_REQUEST_ID,
            (SELECT q.STATUS FROM HR_TRAINING_REQUEST q WHERE q.REQUEST_ID = d.TRAINING_REQUEST_ID)
       FROM HR_DEVELOPMENT_PLAN d LEFT JOIN HR_TRAINING_COURSE k ON k.COURSE_ID = d.COURSE_ID
      WHERE d.APPRAISAL_ID = :id ORDER BY d.PLAN_ID`,
    { id }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => ({
    plan_id: num(x[0]), source: s(x[1]), area: s(x[2]), action_plan: s(x[3]), course_id: numOrNull(x[4]), course_title: s(x[5]) || null,
    target_date: ymd(x[6]), status: s(x[7]), training_request_id: numOrNull(x[8]), training_request_status: s(x[9]) || null,
  }));
};

const loadTrail = async (c, id) => {
  const a = await c.execute(
    `SELECT STAGE, ROLE, ACTOR, ACTOR_NAME, ACTION, NEXT_STAGE, SCORE_AT_STEP, REMARKS, ACTED_AT
       FROM HR_APPRAISAL_APPROVAL WHERE APPRAISAL_ID = :id ORDER BY ACTED_AT, APPROVAL_ID`,
    { id }, { outFormat: OUT_ARRAY },
  );
  const at = await c.execute(
    `SELECT ATT_ID, EMP_GOAL_ID, FILE_NAME, UPLOADED_BY, UPLOADED_AT FROM HR_APPRAISAL_ATTACHMENT WHERE APPRAISAL_ID = :id ORDER BY ATT_ID`,
    { id }, { outFormat: OUT_ARRAY },
  );
  return {
    approvals: (a.rows ?? []).map((x) => ({
      stage: s(x[0]), role: s(x[1]), actor: s(x[2]), actor_name: s(x[3]), action: s(x[4]), next_stage: s(x[5]) || null,
      score: numOrNull(x[6]), remarks: s(x[7]), acted_at: ymdhm(x[8]),
    })),
    attachments: (at.rows ?? []).map((x) => ({
      att_id: num(x[0]), emp_goal_id: numOrNull(x[1]), file_name: s(x[2]), uploaded_by: s(x[3]), uploaded_at: ymdhm(x[4]),
    })),
  };
};

/** Everything about one appraisal (internal: includes HOD mobiles). */
const loadFull = async (c, id) => {
  const head = await loadHead(c, id);
  // One connection runs one statement at a time, so load sequentially.
  const rows = await loadRows(c, id);
  const recs = await loadRecommendations(c, id);
  const dev_plan = await loadDevPlan(c, id);
  const trail = await loadTrail(c, id);
  const hod1_name = await nameByMobile(c, head.hod1_mno);
  const hod2_name = await nameByMobile(c, head.hod2_mno);
  const promotion_case = await caseSummaryFor(c, id);
  const lm = lineManagerRole(head);
  return {
    ...head, hod1_name, hod2_name, chain: chainOf(head),
    line_manager_role: lm,
    line_manager_name: lm === "RPT" ? head.rpt_name : lm === "HOD1" ? hod1_name : lm === "HOD2" ? hod2_name : "HR",
    stage_label: STAGE_LABEL[head.stage] ?? head.stage,
    rows, weight_total: r2(rows.reduce((t, g) => t + g.weightage, 0)), weight_problems: weightProblems(rows),
    rules: SHEET_RULES, ...recs, dev_plan, ...trail, promotion_case,
  };
};

// Mobile numbers are routing data; never send them to the browser.
const publicView = ({ hod1_mno, hod2_mno, ...rest }) => ({ ...rest, has_hod1: !!mobileKey(hod1_mno), has_hod2: !!mobileKey(hod2_mno) });

/**
 * What the appraisee may see: agreed ratings, scores and grade only once the
 * appraisal is completed; HR's normalisation and pay recommendations never.
 */
const employeeView = (full) => {
  const done = full.stage === "COMPLETED";
  const { promotion, increment, hr_adj_grade, hr_adj_reason, calc_score, hod_grade, ...rest } = publicView(full);
  return {
    ...rest,
    final_score: done ? full.final_score : null,
    final_rating: done ? full.final_rating : null,
    rows: full.rows.map((g) => (done ? g : { ...g, agreed_rating: null, score: null, reviewer_remarks: "" })),
    dev_plan: done ? full.dev_plan : [],
    approvals: full.approvals.map((a) => ({ ...a, score: null, remarks: a.action === "RETURN" || a.stage === "MID_REVIEW" || done ? a.remarks : "" })),
  };
};

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

const assertActive = (head) => {
  if (head.cycle.status !== "ACTIVE") {
    throw new AppraisalError(head.cycle.status === "CLOSED" ? "This appraisal cycle is closed" : "This appraisal cycle has not started yet");
  }
  if (head.stage === "CANCELLED") throw new AppraisalError("This appraisal was cancelled");
};

const assertPhase = (head, phase) => {
  if (!phaseAtLeast(head.cycle.phase, phase)) {
    throw new AppraisalError(phase === "MIDYEAR"
      ? "The mid-year review has not been opened by HR yet"
      : "The year-end review has not been opened by HR yet");
  }
};

const record = async (c, head, { role, actor, actorName, action, next, remarks }) => {
  await c.execute(
    `INSERT INTO HR_APPRAISAL_APPROVAL (APPROVAL_ID, APPRAISAL_ID, STAGE, ROLE, ACTOR, ACTOR_NAME, ACTION, NEXT_STAGE, SCORE_AT_STEP, REMARKS)
     VALUES (HR_APPRAISAL_APPROVAL_SEQ.NEXTVAL, :id, :stg, :rl, :actor, :aname, :act, :nxt,
             (SELECT FINAL_SCORE FROM HR_APPRAISAL_MASTER WHERE APPRAISAL_ID = :id), :rem)`,
    {
      id: head.appraisal_id, stg: head.stage, rl: role, actor: s(actor).slice(0, 30), aname: s(actorName).slice(0, 100) || null,
      act: action, nxt: next ?? null, rem: s(remarks).slice(0, 1000) || null,
    },
  );
  if (s(remarks)) {
    await c.execute(
      `INSERT INTO HR_APPRAISAL_COMMENT (COMMENT_ID, APPRAISAL_ID, STAGE, ACTOR, ACTOR_ROLE, COMMENT_TEXT)
       VALUES (HR_APPRAISAL_COMMENT_SEQ.NEXTVAL, :id, :stg, :actor, :rl, :txt)`,
      { id: head.appraisal_id, stg: head.stage, actor: s(actor).slice(0, 30), rl: role, txt: s(remarks).slice(0, 2000) },
    );
  }
};

const moveTo = async (c, head, stage, actor, extraSet = "") => {
  await c.execute(
    `UPDATE HR_APPRAISAL_MASTER SET STAGE = :st, UPDATED_BY = :actor, UPDATED_AT = SYSDATE${extraSet} WHERE APPRAISAL_ID = :id`,
    { st: stage, actor: s(actor).slice(0, 30), id: head.appraisal_id },
  );
  await writeLog(c, { compc: head.compc, entity: "APPRAISAL", entityId: head.appraisal_id, action: `STAGE_${stage}`, details: { from: head.stage }, actor });
};

const assertSheetValid = async (c, head) => {
  const problems = weightProblems(await loadRows(c, head.appraisal_id));
  if (problems.length) throw new AppraisalError(problems.join("; "));
};

const assertAllRated = async (c, head, col) => {
  const r = await c.execute(
    `SELECT COUNT(*) FROM HR_EMPLOYEE_GOAL WHERE APPRAISAL_ID = :id AND ${col} IS NULL`,
    { id: head.appraisal_id }, { outFormat: OUT_ARRAY },
  );
  const missing = num(r.rows[0][0]);
  if (missing) throw new AppraisalError(`Rate every accountability first (${missing} not rated)`);
};

/** "A+" … "D" (or null) → points; anything else is refused. */
const POINTS = (grade) => {
  if (grade === null || grade === undefined || grade === "") return null;
  const p = GRADE_POINTS[String(grade).toUpperCase()];
  if (!p) throw new AppraisalError("Ratings are A+, A, B, C or D");
  return p;
};

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

const insertTrainingRequest = async (c, head, plan, actor, reason) => {
  const open = await c.execute(
    `SELECT REQUEST_ID FROM HR_TRAINING_REQUEST
      WHERE EMPCODE = :e AND COURSE_ID = :cid AND STATUS IN ('PENDING_HOD1','PENDING_HOD2','PENDING_HR','APPROVED','BOOKED')
      FETCH FIRST 1 ROWS ONLY`,
    { e: head.empcode, cid: plan.course_id }, { outFormat: OUT_ARRAY },
  );
  if (open.rows?.length) return num(open.rows[0][0]);   // already requested — link to it
  const emp = await loadPerson(c, head.empcode);
  const id = await nextId(c, "HR_TRAINING_REQUEST_SEQ");
  await c.execute(
    `INSERT INTO HR_TRAINING_REQUEST (REQUEST_ID, COMPC, BRNCH, EMPCODE, SOURCE, REQUESTED_BY, COURSE_ID, REASON, PRIORITY,
            HOD1_MNO, HOD2_MNO, STATUS, APPRAISAL_ID, CREATED_BY)
     VALUES (:id, :compc, :brnch, :e, 'APPRAISAL', :reqby, :cid, :reason, :prio, :h1, :h2, 'PENDING_HR', :aid, :reqby)`,
    {
      id, compc: head.compc, brnch: emp?.brnch ?? head.brnch, e: head.empcode, reqby: s(actor).slice(0, 30), cid: plan.course_id,
      reason: s(reason).slice(0, 1000), prio: plan.source === "AUTO" ? "HIGH" : "MEDIUM",
      h1: emp?.hod1_mno || null, h2: emp?.hod2_mno || null, aid: head.appraisal_id,
    },
  );
  await writeTrainingLog(c, {
    compc: head.compc, entity: "REQUEST", entityId: id, action: "CREATE_APPRAISAL",
    details: { appraisal_id: head.appraisal_id, course_id: plan.course_id }, actor,
  });
  return id;
};

const complete = async (c, head, actor) => {
  const scores = await recomputeScores(c, head.appraisal_id);
  await c.execute(
    `UPDATE HR_APPRAISAL_MASTER SET STAGE = 'COMPLETED', COMPLETED_AT = SYSDATE, UPDATED_BY = :actor, UPDATED_AT = SYSDATE
      WHERE APPRAISAL_ID = :id`,
    { actor: s(actor).slice(0, 30), id: head.appraisal_id },
  );
  await c.execute(
    `MERGE INTO HR_PERFORMANCE_HISTORY h
     USING (SELECT a.APPRAISAL_ID, a.COMPC, a.EMPCODE, a.CYCLE_ID, y.FY_YEAR, y.CYCLE_TYPE, y.PERIOD_TO,
                   a.DEPT_NO, a.DESG_CD, a.GRADE_CD, a.FINAL_SCORE, a.FINAL_RATING
              FROM HR_APPRAISAL_MASTER a JOIN HR_APPRAISAL_CYCLE y ON y.CYCLE_ID = a.CYCLE_ID
             WHERE a.APPRAISAL_ID = :id) s
        ON (h.APPRAISAL_ID = s.APPRAISAL_ID)
      WHEN MATCHED THEN UPDATE SET h.FINAL_SCORE = s.FINAL_SCORE, h.FINAL_RATING = s.FINAL_RATING
      WHEN NOT MATCHED THEN INSERT (APPRAISAL_ID, COMPC, EMPCODE, CYCLE_ID, FY_YEAR, CYCLE_TYPE, PERIOD_TO, DEPT_NO, DESG_CD, GRADE_CD,
                                    FINAL_SCORE, FINAL_RATING)
           VALUES (s.APPRAISAL_ID, s.COMPC, s.EMPCODE, s.CYCLE_ID, s.FY_YEAR, s.CYCLE_TYPE, s.PERIOD_TO, s.DEPT_NO, s.DESG_CD, s.GRADE_CD,
                   s.FINAL_SCORE, s.FINAL_RATING)`,
    { id: head.appraisal_id },
  );
  // Increments are approved with the appraisal; a promotion goes through the promotion evaluation (sheets 1–5).
  await c.execute(
    `UPDATE HR_INCREMENT_RECOMMENDATION SET STATUS = 'APPROVED', UPDATED_AT = SYSDATE WHERE APPRAISAL_ID = :id AND STATUS = 'PROPOSED'`,
    { id: head.appraisal_id },
  );
  const promoCase = await createPromotionCase(c, head, actor);

  // Development plan for the low grades: every accountability rated C or D becomes an area to work on.
  if (scores?.is_development) {
    const existing = await c.execute(`SELECT COUNT(*) FROM HR_DEVELOPMENT_PLAN WHERE APPRAISAL_ID = :id AND SOURCE = 'AUTO'`, { id: head.appraisal_id }, { outFormat: OUT_ARRAY });
    if (!num(existing.rows[0][0])) {
      const low = (await loadRows(c, head.appraisal_id))
        .filter((g) => ["C", "D"].includes(g.agreed_rating ?? ""))
        .map((g) => (g.accountability ? `${g.accountability}: ${g.task}` : g.task).slice(0, 200));
      if (!low.length) low.push("Overall performance");
      for (const area of low) {
        await c.execute(
          `INSERT INTO HR_DEVELOPMENT_PLAN (PLAN_ID, COMPC, APPRAISAL_ID, EMPCODE, SOURCE, AREA, ACTION_PLAN, TARGET_DATE, CREATED_BY)
           VALUES (HR_DEVELOPMENT_PLAN_SEQ.NEXTVAL, :compc, :id, :e, 'AUTO', :area, :ap, ADD_MONTHS(TRUNC(SYSDATE), 6), :actor)`,
          {
            compc: head.compc, id: head.appraisal_id, e: head.empcode, area,
            ap: `Graded ${scores.final_rating ?? "below target"} — agree an improvement plan with the line manager`, actor: s(actor).slice(0, 30),
          },
        );
      }
    }
  }

  // Recommended courses → training requests waiting for HR (training module).
  const plans = (await loadDevPlan(c, head.appraisal_id)).filter((p) => p.course_id && !p.training_request_id);
  for (const p of plans) {
    const reqId = await insertTrainingRequest(c, head, p, actor, `Recommended in appraisal "${head.cycle.name}" — ${p.area}`);
    await c.execute(`UPDATE HR_DEVELOPMENT_PLAN SET TRAINING_REQUEST_ID = :r, STATUS = 'IN_PROGRESS' WHERE PLAN_ID = :p`, { r: reqId, p: p.plan_id });
  }
  await writeLog(c, { compc: head.compc, entity: "APPRAISAL", entityId: head.appraisal_id, action: "COMPLETED", details: { ...scores, promotion_case: promoCase }, actor });
};

/** Approve on the year-end chain; completes the appraisal after HR. */
const forward = async (c, head, who, remarks) => {
  const chain = chainOf(head);
  const next = nextStageOf(chain, head.stage);
  const scores = await recomputeScores(c, head.appraisal_id);
  await record(c, head, { ...who, action: head.stage === "HR" ? "FINALISE" : "APPROVE", next, remarks });
  if (next === "COMPLETED") {
    await complete(c, head, who.actor);
  } else {
    // The grade the HODs agreed on, before any HR normalisation ("actual HOD recommendation").
    if (["RPT", "HOD1", "HOD2"].includes(head.stage)) {
      await c.execute(`UPDATE HR_APPRAISAL_MASTER SET HOD_GRADE = :g WHERE APPRAISAL_ID = :id`, { g: scores?.calc_grade ?? null, id: head.appraisal_id });
    }
    await moveTo(c, head, next, who.actor);
  }
  return { appraisal_id: head.appraisal_id, stage: next };
};

const sendBack = async (c, head, who, remarks) => {
  if (!s(remarks)) throw new AppraisalError("Please say why you are returning it");
  const prev = prevStageOf(chainOf(head), head.stage);
  if (!prev) throw new AppraisalError("The half-year review is locked — there is no earlier step to return to");
  await record(c, head, { ...who, action: "RETURN", next: prev, remarks });
  await moveTo(c, head, prev, who.actor);
  return { appraisal_id: head.appraisal_id, stage: prev };
};

// ---------------------------------------------------------------------------
// Task sheet rows (before the objectives are locked)
// ---------------------------------------------------------------------------

const saveRow = async (c, head, goalId, body) => {
  const b = {
    acc: s(body.accountability).slice(0, 300) || null, task: s(body.task), kpi: s(body.kpi) || null, crit: s(body.success_criteria) || null,
    dep: s(body.interdependencies) || null, w: num(body.weightage), due: body.due_date || null,
  };
  if (!b.task) throw new AppraisalError("Task for the year is required");
  if (b.w < SHEET_RULES.minWeight || b.w > SHEET_RULES.maxWeight) {
    throw new AppraisalError(`Weightage must be between ${SHEET_RULES.minWeight}% and ${SHEET_RULES.maxWeight}%`);
  }
  if (goalId) {
    const cur = await c.execute(`SELECT SOURCE FROM HR_EMPLOYEE_GOAL WHERE EMP_GOAL_ID = :g AND APPRAISAL_ID = :id`, { g: goalId, id: head.appraisal_id }, { outFormat: OUT_ARRAY });
    if (!cur.rows?.length) throw new AppraisalError("Accountability not found", 404);
    await c.execute(
      `UPDATE HR_EMPLOYEE_GOAL SET ACCOUNTABILITY = :acc, OBJECTIVE = :task, KPI_TEXT = :kpi, TARGET = :crit, INTERDEPENDENCIES = :dep,
              WEIGHTAGE = :w, DUE_DATE = TO_DATE(:due,'YYYY-MM-DD'), UPDATED_AT = SYSDATE
        WHERE EMP_GOAL_ID = :g`,
      { ...b, g: goalId },
    );
    return { emp_goal_id: goalId };
  }
  const cnt = await c.execute(`SELECT COUNT(*) FROM HR_EMPLOYEE_GOAL WHERE APPRAISAL_ID = :id`, { id: head.appraisal_id }, { outFormat: OUT_ARRAY });
  if (num(cnt.rows[0][0]) >= SHEET_RULES.maxRows) throw new AppraisalError(`At most ${SHEET_RULES.maxRows} accountabilities`);
  const id = await nextId(c, "HR_EMPLOYEE_GOAL_SEQ");
  await c.execute(
    `INSERT INTO HR_EMPLOYEE_GOAL (EMP_GOAL_ID, APPRAISAL_ID, SOURCE, ACCOUNTABILITY, OBJECTIVE, KPI_TEXT, TARGET, INTERDEPENDENCIES,
            WEIGHTAGE, DUE_DATE, SEQ)
     VALUES (:g, :id, 'INDIVIDUAL', :acc, :task, :kpi, :crit, :dep, :w, TO_DATE(:due,'YYYY-MM-DD'),
             (SELECT NVL(MAX(SEQ),0) + 1 FROM HR_EMPLOYEE_GOAL WHERE APPRAISAL_ID = :id))`,
    { ...b, g: id, id: head.appraisal_id },
  );
  return { emp_goal_id: id };
};

const deleteRow = async (c, head, goalId) => {
  const cur = await c.execute(`SELECT SOURCE FROM HR_EMPLOYEE_GOAL WHERE EMP_GOAL_ID = :g AND APPRAISAL_ID = :id`, { g: goalId, id: head.appraisal_id }, { outFormat: OUT_ARRAY });
  if (!cur.rows?.length) throw new AppraisalError("Accountability not found", 404);
  await c.execute(`UPDATE HR_APPRAISAL_ATTACHMENT SET EMP_GOAL_ID = NULL WHERE EMP_GOAL_ID = :g`, { g: goalId });
  await c.execute(`DELETE FROM HR_EMPLOYEE_GOAL WHERE EMP_GOAL_ID = :g`, { g: goalId });
  return { deleted: true };
};

/** Line manager / HR approves the objectives: validate, lock for good, open the mid-year step. */
const approveObjectives = async (c, head, who, remarks) => {
  await assertSheetValid(c, head);
  await record(c, head, { ...who, action: "APPROVE", next: "MIDYEAR", remarks });
  await moveTo(c, head, "MIDYEAR", who.actor, ", OBJ_LOCKED_AT = SYSDATE");
  return { appraisal_id: head.appraisal_id, stage: "MIDYEAR" };
};

const returnObjectives = async (c, head, who, remarks) => {
  if (head.stage !== "OBJ_REVIEW") throw new AppraisalError("The objectives have not been submitted");
  if (!s(remarks)) throw new AppraisalError("Please say what should change in the objectives");
  await record(c, head, { ...who, action: "RETURN", next: "OBJ_SETTING", remarks });
  await moveTo(c, head, "OBJ_SETTING", who.actor);
  return { appraisal_id: head.appraisal_id, stage: "OBJ_SETTING" };
};

/** Line manager signs the mid-year review → half-year locked; the year-end chain is next. */
const signMidYear = async (c, head, who, remarks) => {
  const next = chainOf(head)[0];
  await c.execute(`UPDATE HR_APPRAISAL_MASTER SET MID_COMMENTS = :mc WHERE APPRAISAL_ID = :id`, { mc: s(remarks) || null, id: head.appraisal_id });
  await record(c, head, { ...who, action: "SIGN", next, remarks });
  await moveTo(c, head, next, who.actor, ", MID_LOCKED_AT = SYSDATE");
  return { appraisal_id: head.appraisal_id, stage: next };
};

const returnMidYear = async (c, head, who, remarks) => {
  if (!s(remarks)) throw new AppraisalError("Please say what should change in the mid-year review");
  await record(c, head, { ...who, action: "RETURN", next: "MIDYEAR", remarks });
  await moveTo(c, head, "MIDYEAR", who.actor);
  return { appraisal_id: head.appraisal_id, stage: "MIDYEAR" };
};

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------

const ownHead = async (c, empcode, id, opts) => {
  const head = await loadHead(c, id, opts);
  if (head.empcode !== s(empcode)) throw new AppraisalError("Appraisal not found", 404);
  return head;
};

export const myAppraisals = (empcode) => read(async (c) => {
  const r = await c.execute(
    `${HEAD_SELECT} WHERE a.EMPCODE = :e AND a.STAGE <> 'CANCELLED' AND y.STATUS <> 'DRAFT' ORDER BY y.PERIOD_TO DESC, a.APPRAISAL_ID DESC`,
    { e: s(empcode) }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map(rowToHead).map((h) => ({
    appraisal_id: h.appraisal_id, cycle: h.cycle, stage: h.stage, stage_label: STAGE_LABEL[h.stage] ?? h.stage,
    my_turn: h.cycle.status === "ACTIVE" && (h.stage === "OBJ_SETTING"
      || (h.stage === "MIDYEAR" && phaseAtLeast(h.cycle.phase, "MIDYEAR"))
      || (h.stage === "COMPLETED" && !h.emp_ack_at)),
    final_score: h.stage === "COMPLETED" ? h.final_score : null,
    final_rating: h.stage === "COMPLETED" ? h.final_rating : null,
  }));
});

export const myAppraisal = (empcode, id) => read(async (c) => {
  await ownHead(c, empcode, id);
  const full = await loadFull(c, id);
  const active = full.cycle.status === "ACTIVE";
  return {
    ...employeeView(full),
    can_edit_rows: active && full.stage === "OBJ_SETTING",
    can_midyear: active && full.stage === "MIDYEAR" && phaseAtLeast(full.cycle.phase, "MIDYEAR"),
    midyear_waiting_phase: full.stage === "MIDYEAR" && !phaseAtLeast(full.cycle.phase, "MIDYEAR"),
    can_acknowledge: full.stage === "COMPLETED" && !full.emp_ack_at,
  };
});

const assertEmpStage = (head, stage) => {
  assertActive(head);
  if (head.stage !== stage) {
    throw new AppraisalError(stage === "OBJ_SETTING" ? "The objectives can no longer be changed" : "The mid-year review is not open for you");
  }
};

export const saveMyRow = (empcode, id, goalId, body) => withTx(async (c) => {
  const head = await ownHead(c, empcode, id, { lock: true });
  assertEmpStage(head, "OBJ_SETTING");
  return saveRow(c, head, goalId, body);
});

export const deleteMyRow = (empcode, id, goalId) => withTx(async (c) => {
  const head = await ownHead(c, empcode, id, { lock: true });
  assertEmpStage(head, "OBJ_SETTING");
  return deleteRow(c, head, goalId);
});

export const submitMyObjectives = (empcode, id, remarks) => withTx(async (c) => {
  const head = await ownHead(c, empcode, id, { lock: true });
  assertEmpStage(head, "OBJ_SETTING");
  await assertSheetValid(c, head);
  await record(c, head, { role: "EMP", actor: empcode, actorName: head.emp_name, action: "SUBMIT", next: "OBJ_REVIEW", remarks });
  await moveTo(c, head, "OBJ_REVIEW", empcode);
  return { appraisal_id: id, stage: "OBJ_REVIEW" };
});

export const saveMyMidYear = (empcode, id, body) => withTx(async (c) => {
  const head = await ownHead(c, empcode, id, { lock: true });
  assertEmpStage(head, "MIDYEAR");
  assertPhase(head, "MIDYEAR");
  for (const g of body.rows ?? []) {
    await c.execute(
      `UPDATE HR_EMPLOYEE_GOAL SET MIDYEAR_PROGRESS = :mp, SELF_RATING = :r, UPDATED_AT = SYSDATE WHERE EMP_GOAL_ID = :g AND APPRAISAL_ID = :id`,
      { mp: s(g.midyear_progress) || null, r: POINTS(g.self_rating), g: num(g.emp_goal_id), id },
    );
  }
  await recomputeScores(c, id);
  return { saved: true };
});

export const submitMyMidYear = (empcode, id, remarks) => withTx(async (c) => {
  const head = await ownHead(c, empcode, id, { lock: true });
  assertEmpStage(head, "MIDYEAR");
  assertPhase(head, "MIDYEAR");
  await assertAllRated(c, head, "SELF_RATING");
  await recomputeScores(c, id);
  await c.execute(`UPDATE HR_APPRAISAL_MASTER SET SELF_SUBMITTED_AT = SYSDATE WHERE APPRAISAL_ID = :id`, { id });
  await record(c, head, { role: "EMP", actor: empcode, actorName: head.emp_name, action: "SUBMIT", next: "MID_REVIEW", remarks });
  await moveTo(c, head, "MID_REVIEW", empcode);
  return { appraisal_id: id, stage: "MID_REVIEW" };
});

/** Final year-end sign-off by the employee (acknowledges the locked rating). */
export const acknowledge = (empcode, id, comment) => withTx(async (c) => {
  const head = await ownHead(c, empcode, id, { lock: true });
  if (head.stage !== "COMPLETED") throw new AppraisalError("The appraisal is not finalised yet");
  if (head.emp_ack_at) return { acknowledged: true };
  await c.execute(
    `UPDATE HR_APPRAISAL_MASTER SET EMP_ACK_AT = SYSDATE, EMP_ACK_COMMENT = :cm WHERE APPRAISAL_ID = :id`,
    { cm: s(comment).slice(0, 1000) || null, id },
  );
  await record(c, head, { role: "EMP", actor: empcode, actorName: head.emp_name, action: "ACK", next: null, remarks: comment });
  return { acknowledged: true };
});

export const myHistory = (empcode) => read(async (c) => {
  const h = await c.execute(
    `SELECT h.APPRAISAL_ID, y.NAME, h.CYCLE_TYPE, h.FY_YEAR, h.PERIOD_TO, h.FINAL_SCORE, h.FINAL_RATING
       FROM HR_PERFORMANCE_HISTORY h JOIN HR_APPRAISAL_CYCLE y ON y.CYCLE_ID = h.CYCLE_ID
      WHERE h.EMPCODE = :e ORDER BY h.PERIOD_TO`,
    { e: s(empcode) }, { outFormat: OUT_ARRAY },
  );
  const d = await c.execute(
    `SELECT d.PLAN_ID, d.APPRAISAL_ID, d.SOURCE, d.AREA, d.ACTION_PLAN, k.TITLE, d.TARGET_DATE, d.STATUS,
            (SELECT q.STATUS FROM HR_TRAINING_REQUEST q WHERE q.REQUEST_ID = d.TRAINING_REQUEST_ID)
       FROM HR_DEVELOPMENT_PLAN d
       JOIN HR_APPRAISAL_MASTER a ON a.APPRAISAL_ID = d.APPRAISAL_ID AND a.STAGE = 'COMPLETED'
       LEFT JOIN HR_TRAINING_COURSE k ON k.COURSE_ID = d.COURSE_ID
      WHERE d.EMPCODE = :e ORDER BY d.PLAN_ID DESC`,
    { e: s(empcode) }, { outFormat: OUT_ARRAY },
  );
  return {
    history: (h.rows ?? []).map((x) => ({
      appraisal_id: num(x[0]), cycle_name: s(x[1]), cycle_type: s(x[2]), fy_year: num(x[3]), period_to: ymd(x[4]),
      final_score: numOrNull(x[5]), final_rating: s(x[6]),
    })),
    dev_plan: (d.rows ?? []).map((x) => ({
      plan_id: num(x[0]), appraisal_id: num(x[1]), source: s(x[2]), area: s(x[3]), action_plan: s(x[4]), course_title: s(x[5]) || null,
      target_date: ymd(x[6]), status: s(x[7]), training_request_status: s(x[8]) || null,
    })),
  };
});

// ---------------------------------------------------------------------------
// Evidence files (employee before the mid-year submission; everyone with access may download)
// ---------------------------------------------------------------------------

export const EVIDENCE_DIR = path.join(DOCS_ROOT, "APPRAISAL_EVIDENCE");
const EVIDENCE_EXTS = new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".txt", ".png", ".jpg", ".jpeg"]);
const EVIDENCE_STAGES = ["OBJ_SETTING", "OBJ_REVIEW", "MIDYEAR"];

export const addMyEvidence = (empcode, id, file, goalId) => withTx(async (c) => {
  const head = await ownHead(c, empcode, id, { lock: true });
  assertActive(head);
  if (!EVIDENCE_STAGES.includes(head.stage)) throw new AppraisalError("Evidence can only be added before you submit your mid-year review");
  if (!file?.buffer?.length) throw new AppraisalError("Choose a file to upload");
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (!EVIDENCE_EXTS.has(ext)) throw new AppraisalError("Allowed files: PDF, Word, PowerPoint, Excel, text or image");
  if (goalId) {
    const g = await c.execute(`SELECT 1 FROM HR_EMPLOYEE_GOAL WHERE EMP_GOAL_ID = :g AND APPRAISAL_ID = :id`, { g: goalId, id }, { outFormat: OUT_ARRAY });
    if (!g.rows?.length) throw new AppraisalError("Accountability not found", 404);
  }
  const count = await c.execute(`SELECT COUNT(*) FROM HR_APPRAISAL_ATTACHMENT WHERE APPRAISAL_ID = :id`, { id }, { outFormat: OUT_ARRAY });
  if (num(count.rows[0][0]) >= 20) throw new AppraisalError("At most 20 evidence files per appraisal");

  await fs.promises.mkdir(EVIDENCE_DIR, { recursive: true });
  const stored = `appraisal_${id}_${Date.now()}${ext}`;
  await fs.promises.writeFile(path.join(EVIDENCE_DIR, stored), file.buffer);
  const attId = await nextId(c, "HR_APPRAISAL_ATTACHMENT_SEQ");
  try {
    await c.execute(
      `INSERT INTO HR_APPRAISAL_ATTACHMENT (ATT_ID, APPRAISAL_ID, EMP_GOAL_ID, FILE_NAME, FILE_PATH, UPLOADED_BY)
       VALUES (:att, :id, :g, :n, :p, :e)`,
      { att: attId, id, g: goalId || null, n: path.basename(file.originalname).slice(0, 255), p: stored, e: s(empcode) },
    );
  } catch (e) {
    fs.promises.unlink(path.join(EVIDENCE_DIR, stored)).catch(() => {});
    throw e;
  }
  return { att_id: attId, file_name: file.originalname };
});

export const deleteMyEvidence = (empcode, id, attId) => withTx(async (c) => {
  const head = await ownHead(c, empcode, id, { lock: true });
  assertActive(head);
  if (!EVIDENCE_STAGES.includes(head.stage)) throw new AppraisalError("Evidence can no longer be removed");
  const r = await c.execute(`SELECT FILE_PATH FROM HR_APPRAISAL_ATTACHMENT WHERE ATT_ID = :a AND APPRAISAL_ID = :id`, { a: attId, id }, { outFormat: OUT_ARRAY });
  if (!r.rows?.length) throw new AppraisalError("File not found", 404);
  await c.execute(`DELETE FROM HR_APPRAISAL_ATTACHMENT WHERE ATT_ID = :a`, { a: attId });
  fs.promises.unlink(path.join(EVIDENCE_DIR, path.basename(s(r.rows[0][0])))).catch((e) => {
    if (e.code !== "ENOENT") logger.warn(`[APPRAISAL] could not delete evidence ${r.rows[0][0]}: ${e.message}`);
  });
  return { deleted: true };
});

const evidenceFile = async (c, id, attId) => {
  const r = await c.execute(`SELECT FILE_NAME, FILE_PATH FROM HR_APPRAISAL_ATTACHMENT WHERE ATT_ID = :a AND APPRAISAL_ID = :id`, { a: attId, id }, { outFormat: OUT_ARRAY });
  if (!r.rows?.length) throw new AppraisalError("File not found", 404);
  const abs = path.join(EVIDENCE_DIR, path.basename(s(r.rows[0][1])));
  if (!fs.existsSync(abs)) throw new AppraisalError("The file is missing on the server", 404);
  return { abs, name: s(r.rows[0][0]) || path.basename(abs) };
};

export const myEvidenceFile = (empcode, id, attId) => read(async (c) => {
  await ownHead(c, empcode, id);
  return evidenceFile(c, id, attId);
});

// ---------------------------------------------------------------------------
// Reviewers: line manager (objectives, mid-year) and the year-end raters
// ---------------------------------------------------------------------------

const reviewerOf = async (c, empcode) => {
  const me = await loadPerson(c, empcode);
  if (!me) throw new AppraisalError("Employee not found", 404);
  return me;
};

/** The caller's roles on an appraisal, and the role they can act in right now (phase permitting). */
const accessOf = (head, me) => {
  const roles = rolesOn(head, me, false);
  const lm = lineManagerRole(head);
  let actRole = null;
  if (["OBJ_SETTING", "OBJ_REVIEW", "MID_REVIEW"].includes(head.stage) && roles.includes(lm)) actRole = lm;
  if (["RPT", "HOD1", "HOD2"].includes(head.stage) && roles.includes(head.stage)) actRole = head.stage;
  const phaseOk = ["RPT", "HOD1", "HOD2"].includes(head.stage) ? phaseAtLeast(head.cycle.phase, "YEAREND")
    : head.stage === "MID_REVIEW" ? phaseAtLeast(head.cycle.phase, "MIDYEAR") : true;
  // The line manager may set objectives during OBJ_SETTING, but it is mainly the employee's turn then.
  const myTurn = !!actRole && phaseOk && head.cycle.status === "ACTIVE" && head.stage !== "OBJ_SETTING";
  return { roles, act_role: actRole, phase_ok: phaseOk, my_turn: myTurn };
};

const reviewHead = async (c, empcode, id, opts) => {
  const head = await loadHead(c, id, opts);
  const me = await reviewerOf(c, empcode);
  const access = accessOf(head, me);
  if (!access.roles.length) throw new AppraisalError("Appraisal not found", 404);
  return { head, me, ...access };
};

const ROLE_SQL = (alias = "a") => `
  (${alias}.RPT_EMPCODE = :e
   OR ${mobileKeySql(`${alias}.HOD1_MNO`)} = :k
   OR ${mobileKeySql(`${alias}.HOD2_MNO`)} = :k)`;

export const reviewInbox = (empcode) => read(async (c) => {
  const me = await reviewerOf(c, empcode);
  const key = mobileKey(me.mobile) || "~none~";
  const r = await c.execute(
    `${HEAD_SELECT}
      WHERE a.STAGE <> 'CANCELLED' AND y.STATUS <> 'DRAFT' AND ${ROLE_SQL("a")}
      ORDER BY y.PERIOD_TO DESC, UPPER(m.NAME)`,
    { e: me.empcode, k: key }, { outFormat: OUT_ARRAY },
  );
  const items = (r.rows ?? []).map(rowToHead).map((head) => {
    const access = accessOf(head, me);
    return {
      appraisal_id: head.appraisal_id, cycle: head.cycle, empcode: head.empcode, emp_name: head.emp_name,
      dept_name: head.dept_name, desg_desc: head.desg_desc, stage: head.stage, stage_label: STAGE_LABEL[head.stage] ?? head.stage,
      my_roles: access.roles, my_turn: access.my_turn, waiting_phase: !!access.act_role && !access.phase_ok,
      self_score: head.self_score, final_score: head.final_score, final_rating: head.final_rating,
    };
  });
  const mgmtAny = await c.execute(`SELECT 1 FROM HR_APPR_MGMT_APPROVER WHERE EMPCODE = :e AND IS_ACTIVE = 'Y' FETCH FIRST 1 ROWS ONLY`, { e: me.empcode }, { outFormat: OUT_ARRAY });
  return {
    is_reviewer: items.length > 0 || !!mgmtAny.rows?.length,
    is_ceo: !!mgmtAny.rows?.length,
    pending: items.filter((i) => i.my_turn).length,
    items,
  };
});

export const reviewGet = (empcode, id) => read(async (c) => {
  const { head, roles, act_role: actRole, phase_ok: phaseOk } = await reviewHead(c, empcode, id);
  const full = await loadFull(c, id);
  const active = head.cycle.status === "ACTIVE";
  const can = (stages) => active && !!actRole && phaseOk && stages.includes(head.stage);
  return {
    ...publicView(full),
    my_roles: roles,
    act_role: active && phaseOk ? actRole : null,
    waiting_phase: !!actRole && !phaseOk,
    can_edit_rows: can(["OBJ_SETTING", "OBJ_REVIEW"]),
    can_approve_objectives: can(["OBJ_SETTING", "OBJ_REVIEW"]),
    can_sign_midyear: can(["MID_REVIEW"]),
    can_rate: can(["RPT", "HOD1", "HOD2"]),
    can_return: can(["OBJ_REVIEW", "MID_REVIEW"]) || (can(["HOD2"])),
  };
});

export const reviewEvidenceFile = (empcode, id, attId) => read(async (c) => {
  await reviewHead(c, empcode, id);
  return evidenceFile(c, id, attId);
});

const actingHead = async (c, empcode, id, stages) => {
  const ctx = await reviewHead(c, empcode, id, { lock: true });
  assertActive(ctx.head);
  if (!ctx.act_role || !stages.includes(ctx.head.stage)) throw new AppraisalError("This appraisal is not waiting for you", 403);
  if (!ctx.phase_ok) assertPhase(ctx.head, ["RPT", "HOD1", "HOD2"].includes(ctx.head.stage) ? "YEAREND" : "MIDYEAR");
  return ctx;
};

export const reviewSaveRow = (empcode, id, goalId, body) => withTx(async (c) => {
  const { head } = await actingHead(c, empcode, id, ["OBJ_SETTING", "OBJ_REVIEW"]);
  return saveRow(c, head, goalId, body);
});

export const reviewDeleteRow = (empcode, id, goalId) => withTx(async (c) => {
  const { head } = await actingHead(c, empcode, id, ["OBJ_SETTING", "OBJ_REVIEW"]);
  return deleteRow(c, head, goalId);
});

/** Agreed ratings (A+ … D) and remarks of the current year-end rater. */
const saveAgreed = async (c, head, body) => {
  for (const g of body.rows ?? []) {
    await c.execute(
      `UPDATE HR_EMPLOYEE_GOAL SET HOD_RATING = :r, REMARKS = :rem, ACHIEVEMENT = NVL(:ye, ACHIEVEMENT), UPDATED_AT = SYSDATE
        WHERE EMP_GOAL_ID = :g AND APPRAISAL_ID = :id`,
      { r: POINTS(g.agreed_rating), rem: s(g.reviewer_remarks) || null, ye: s(g.yearend_comment) || null, g: num(g.emp_goal_id), id: head.appraisal_id },
    );
  }
  return recomputeScores(c, head.appraisal_id);
};

export const reviewSaveRatings = (empcode, id, body) => withTx(async (c) => {
  const { head } = await actingHead(c, empcode, id, ["RPT", "HOD1", "HOD2"]);
  return saveAgreed(c, head, body);
});

/**
 * Promotion / increment / training recommendations. Each call replaces the
 * earlier recommendation; `null` removes it. A promotion recommendation marks
 * the appraisal "promotion recommended" and opens the promotion evaluation
 * (sheets 1–5) when the appraisal is finalised.
 */
const saveRecs = async (c, head, actor, body) => {
  const id = head.appraisal_id;
  const emp = await loadPerson(c, head.empcode);

  if (body.promotion !== undefined) {
    await c.execute(`DELETE FROM HR_PROMOTION_RECOMMENDATION WHERE APPRAISAL_ID = :id AND STATUS = 'PROPOSED'`, { id });
    const p = body.promotion;
    if (p) {
      const d = await c.execute(
        `SELECT GRADE_CD FROM HR_DESG WHERE TO_CHAR(DESG_CD) = :d AND COMPC = :compc`,
        { d: s(p.prop_desg_cd), compc: head.compc }, { outFormat: OUT_ARRAY },
      );
      if (!d.rows?.length) throw new AppraisalError("Choose a designation of this company");
      if (s(p.prop_desg_cd) === s(emp?.desg_cd) && !s(p.prop_grade_cd)) throw new AppraisalError("The proposed designation is the current one");
      await c.execute(
        `INSERT INTO HR_PROMOTION_RECOMMENDATION (REC_ID, COMPC, APPRAISAL_ID, EMPCODE, CUR_DESG_CD, CUR_GRADE_CD, PROP_DESG_CD,
                PROP_GRADE_CD, JUSTIFICATION, RECOMMENDED_BY)
         VALUES (HR_PROMOTION_REC_SEQ.NEXTVAL, :compc, :id, :e, :cd, :cg, :pd, :pg, :j, :by1)`,
        {
          compc: head.compc, id, e: head.empcode, cd: emp?.desg_cd || null, cg: emp?.grade_cd || null, pd: s(p.prop_desg_cd),
          pg: s(p.prop_grade_cd) || null, j: s(p.justification) || null, by1: s(actor).slice(0, 30),
        },
      );
    }
    await c.execute(`UPDATE HR_APPRAISAL_MASTER SET PROMO_RECOMMENDED = :p WHERE APPRAISAL_ID = :id`, { p: p ? "Y" : "N", id });
  }

  if (body.increment !== undefined) {
    await c.execute(`DELETE FROM HR_INCREMENT_RECOMMENDATION WHERE APPRAISAL_ID = :id AND STATUS = 'PROPOSED'`, { id });
    const inc = body.increment;
    if (inc) {
      const prev = numOrNull(emp?.gross);
      const pct = numOrNull(inc.inc_pct);
      let amount = numOrNull(inc.inc_amount);
      if (amount === null && pct !== null) {
        if (!prev) throw new AppraisalError("The employee's current gross salary is not set — enter the increment as an amount");
        amount = Math.round((prev * pct) / 100);
      }
      if (amount === null || amount <= 0) throw new AppraisalError("Enter the increment as a percentage or an amount");
      await c.execute(
        `INSERT INTO HR_INCREMENT_RECOMMENDATION (REC_ID, COMPC, APPRAISAL_ID, EMPCODE, PREV_GROSS, INC_PCT, INC_AMOUNT, NEW_GROSS,
                JUSTIFICATION, RECOMMENDED_BY)
         VALUES (HR_INCREMENT_REC_SEQ.NEXTVAL, :compc, :id, :e, :pg, :pct, :amt, :ng, :j, :by1)`,
        {
          compc: head.compc, id, e: head.empcode, pg: prev, pct: pct ?? (prev ? r2((amount / prev) * 100) : null), amt: amount,
          ng: prev !== null ? prev + amount : null, j: s(inc.justification) || null, by1: s(actor).slice(0, 30),
        },
      );
    }
  }

  if (body.trainings !== undefined) {
    // Reviewer lines not yet turned into a training request are replaced.
    await c.execute(
      `DELETE FROM HR_DEVELOPMENT_PLAN WHERE APPRAISAL_ID = :id AND SOURCE IN ('REVIEWER','HR') AND TRAINING_REQUEST_ID IS NULL`,
      { id },
    );
    for (const t of body.trainings ?? []) {
      if (t.course_id) {
        const k = await c.execute(
          `SELECT 1 FROM HR_TRAINING_COURSE WHERE COURSE_ID = :k AND COMPC = :compc AND IS_ACTIVE = 'Y'`,
          { k: num(t.course_id), compc: head.compc }, { outFormat: OUT_ARRAY },
        );
        if (!k.rows?.length) throw new AppraisalError("A recommended course is not offered by this company");
      }
      await c.execute(
        `INSERT INTO HR_DEVELOPMENT_PLAN (PLAN_ID, COMPC, APPRAISAL_ID, EMPCODE, SOURCE, AREA, ACTION_PLAN, COURSE_ID, TARGET_DATE, CREATED_BY)
         VALUES (HR_DEVELOPMENT_PLAN_SEQ.NEXTVAL, :compc, :id, :e, :src, :area, :ap, :k, TO_DATE(:td,'YYYY-MM-DD'), :by1)`,
        {
          compc: head.compc, id, e: head.empcode, src: head.stage === "HR" ? "HR" : "REVIEWER", area: s(t.area).slice(0, 200) || "Training",
          ap: s(t.action_plan) || null, k: t.course_id ? num(t.course_id) : null, td: t.target_date || null, by1: s(actor).slice(0, 30),
        },
      );
    }
  }
  await writeLog(c, { compc: head.compc, entity: "APPRAISAL", entityId: id, action: "RECOMMEND", details: body, actor });
  return loadRecommendations(c, id);
};

export const reviewSaveRecommendations = (empcode, id, body) => withTx(async (c) => {
  const { head } = await actingHead(c, empcode, id, ["RPT", "HOD1", "HOD2"]);
  return saveRecs(c, head, empcode, body);
});

export const reviewDecide = (empcode, id, { decision, remarks }) => withTx(async (c) => {
  const { head, me, act_role: role } = await actingHead(c, empcode, id, ["OBJ_SETTING", "OBJ_REVIEW", "MID_REVIEW", "RPT", "HOD1", "HOD2"]);
  const who = { role, actor: me.empcode, actorName: me.name };
  if (["OBJ_SETTING", "OBJ_REVIEW"].includes(head.stage)) {
    return decision === "return" ? returnObjectives(c, head, who, remarks) : approveObjectives(c, head, who, remarks);
  }
  if (head.stage === "MID_REVIEW") {
    return decision === "return" ? returnMidYear(c, head, who, remarks) : signMidYear(c, head, who, remarks);
  }
  if (decision === "return") return sendBack(c, head, who, remarks);
  await assertAllRated(c, head, "HOD_RATING");
  return forward(c, head, who, remarks);
});

// ---------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------

const hrHead = async (c, compc, id, opts) => {
  const head = await loadHead(c, id, opts);
  if (head.compc !== num(compc)) throw new AppraisalError("Appraisal not found", 404);
  return head;
};

export const hrList = (compc, f = {}) => read(async (c) => {
  const binds = { compc };
  let where = "";
  if (f.cycle_id) { where += " AND a.CYCLE_ID = :cid"; binds.cid = num(f.cycle_id); }
  if (f.stage) { where += " AND a.STAGE = :stg"; binds.stg = s(f.stage); }
  if (f.dept) { where += " AND LTRIM(a.DEPT_NO,'0') = LTRIM(:dept,'0')"; binds.dept = s(f.dept); }
  if (f.q) { where += " AND (UPPER(m.NAME) LIKE :q OR a.EMPCODE LIKE :q)"; binds.q = `%${s(f.q).toUpperCase()}%`; }
  const r = await c.execute(
    `${HEAD_SELECT} WHERE a.COMPC = :compc${where} ORDER BY y.PERIOD_TO DESC, UPPER(m.NAME) FETCH FIRST 2000 ROWS ONLY`,
    binds, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map(rowToHead).map((h) => {
    const lm = lineManagerRole(h);
    return {
      appraisal_id: h.appraisal_id, cycle: h.cycle, empcode: h.empcode, emp_name: h.emp_name, dept_name: h.dept_name,
      desg_desc: h.desg_desc, stage: h.stage, stage_label: STAGE_LABEL[h.stage] ?? h.stage,
      rpt_name: h.rpt_name, has_hod1: !!mobileKey(h.hod1_mno), has_hod2: !!mobileKey(h.hod2_mno), line_manager_role: lm,
      self_score: h.self_score, calc_score: h.calc_score, hod_grade: h.hod_grade, hr_adj_grade: h.hr_adj_grade,
      final_score: h.final_score, final_rating: h.final_rating, promo_recommended: h.promo_recommended,
      emp_ack_at: h.emp_ack_at, updated_at: h.updated_at,
    };
  });
});

export const hrGet = (compc, id) => read(async (c) => {
  const head = await hrHead(c, compc, id);
  const full = await loadFull(c, id);
  const active = head.cycle.status === "ACTIVE";
  const hrIsLm = lineManagerRole(head) === "HR";
  return {
    ...publicView(full),
    can_edit_rows: active && ["OBJ_SETTING", "OBJ_REVIEW"].includes(head.stage),
    can_hr_objectives: active && hrIsLm && ["OBJ_SETTING", "OBJ_REVIEW"].includes(head.stage),
    can_hr_midyear: active && hrIsLm && head.stage === "MID_REVIEW",
    can_hr_act: active && head.stage === "HR",
  };
});

export const hrEvidenceFile = (compc, id, attId) => read(async (c) => {
  await hrHead(c, compc, id);
  return evidenceFile(c, id, attId);
});

export const hrSaveRow = (compc, actor, id, goalId, body) => withTx(async (c) => {
  const head = await hrHead(c, compc, id, { lock: true });
  assertActive(head);
  if (!["OBJ_SETTING", "OBJ_REVIEW"].includes(head.stage)) throw new AppraisalError("The objectives are locked");
  const out = await saveRow(c, head, goalId, body);
  await writeLog(c, { compc: head.compc, entity: "APPRAISAL", entityId: id, action: "HR_ROW_EDIT", details: body, actor });
  return out;
});

export const hrDeleteRow = (compc, actor, id, goalId) => withTx(async (c) => {
  const head = await hrHead(c, compc, id, { lock: true });
  assertActive(head);
  if (!["OBJ_SETTING", "OBJ_REVIEW"].includes(head.stage)) throw new AppraisalError("The objectives are locked");
  const out = await deleteRow(c, head, goalId);
  await writeLog(c, { compc: head.compc, entity: "APPRAISAL", entityId: id, action: "HR_ROW_DELETE", details: { goal_id: goalId }, actor });
  return out;
});

/** HR normalisation (bell curve): set or clear a grade override. A reason is mandatory. */
export const hrAdjust = (compc, actor, id, { grade, reason }) => withTx(async (c) => {
  const head = await hrHead(c, compc, id, { lock: true });
  assertActive(head);
  if (head.stage !== "HR") throw new AppraisalError("The grade can be adjusted at the HR review stage");
  const g = s(grade).toUpperCase() || null;
  if (g) {
    const scale = await loadScale(c, head.compc, { seed: true });
    if (!scale.some((b) => b.label === g)) throw new AppraisalError("Choose a grade from the rating scale");
    if (!s(reason)) throw new AppraisalError("Give a reason for changing the grade");
  }
  await c.execute(
    `UPDATE HR_APPRAISAL_MASTER SET HR_ADJ_GRADE = :g, HR_ADJ_REASON = :r, UPDATED_BY = :actor, UPDATED_AT = SYSDATE WHERE APPRAISAL_ID = :id`,
    { g, r: g ? s(reason) : null, actor: s(actor).slice(0, 30), id },
  );
  const scores = await recomputeScores(c, id);
  await writeLog(c, {
    compc: head.compc, entity: "APPRAISAL", entityId: id, action: g ? "HR_ADJUST" : "HR_ADJUST_CLEAR",
    details: { previous: head.hr_adj_grade, calc_grade: scores?.calc_grade, new: g, reason }, actor,
  });
  return scores;
});

export const hrSaveRecommendations = (compc, actor, id, body) => withTx(async (c) => {
  const head = await hrHead(c, compc, id, { lock: true });
  assertActive(head);
  if (head.stage !== "HR") throw new AppraisalError("HR can change recommendations at the HR review stage");
  return saveRecs(c, head, actor, body);
});

/**
 * HR decisions: at HR stage finalise (lock) or return to the last rater; and
 * when HR is the line manager (no reporting officer / HOD), the objective
 * approval and mid-year sign-off.
 */
export const hrDecide = (compc, actor, id, { decision, remarks }) => withTx(async (c) => {
  const head = await hrHead(c, compc, id, { lock: true });
  assertActive(head);
  const who = { role: "HR", actor, actorName: await nameOf(c, actor) };
  const hrIsLm = lineManagerRole(head) === "HR";
  if (["OBJ_SETTING", "OBJ_REVIEW"].includes(head.stage)) {
    if (!hrIsLm) throw new AppraisalError("The line manager approves the objectives");
    return decision === "return" ? returnObjectives(c, head, who, remarks) : approveObjectives(c, head, who, remarks);
  }
  if (head.stage === "MID_REVIEW") {
    if (!hrIsLm) throw new AppraisalError("The line manager signs the mid-year review");
    assertPhase(head, "MIDYEAR");
    return decision === "return" ? returnMidYear(c, head, who, remarks) : signMidYear(c, head, who, remarks);
  }
  if (head.stage !== "HR") throw new AppraisalError("This appraisal is not at the HR review stage");
  return decision === "return" ? sendBack(c, head, who, remarks) : forward(c, head, who, remarks);
});

/** Finalise every appraisal of a cycle that sits at the HR stage (no grade changes). */
export const hrBulkApprove = (compc, actor, cycleId, ids) => withTx(async (c) => {
  const actorName = await nameOf(c, actor);
  const r = await c.execute(
    `SELECT a.APPRAISAL_ID FROM HR_APPRAISAL_MASTER a WHERE a.COMPC = :compc AND a.CYCLE_ID = :cid AND a.STAGE = 'HR'`,
    { compc, cid: cycleId }, { outFormat: OUT_ARRAY },
  );
  const want = ids?.length ? new Set(ids.map(Number)) : null;
  let done = 0;
  for (const [aid] of r.rows ?? []) {
    if (want && !want.has(num(aid))) continue;
    const head = await hrHead(c, compc, num(aid), { lock: true });
    assertActive(head);
    await forward(c, head, { role: "HR", actor, actorName }, "Finalised by HR (bulk)");
    done++;
  }
  return { approved: done };
});

/** Change the approver snapshot (e.g. the reporting officer left). */
export const hrReassign = (compc, actor, id, body) => withTx(async (c) => {
  const head = await hrHead(c, compc, id, { lock: true });
  if (["COMPLETED", "CANCELLED"].includes(head.stage)) throw new AppraisalError("This appraisal is closed");
  const pick = async (empcode) => {
    if (!s(empcode)) return null;
    const p = await loadPerson(c, empcode);
    if (!p) throw new AppraisalError(`Employee ${empcode} not found`, 404);
    if (p.empcode === head.empcode) throw new AppraisalError("An employee cannot review their own appraisal");
    return p;
  };
  // A field left out keeps the current level; null / "" removes it; an EMPCODE sets it.
  const keep = (v) => v === undefined;
  const rpt = keep(body.rpt_empcode) ? null : await pick(body.rpt_empcode);
  const hod1 = keep(body.hod1_empcode) ? null : await pick(body.hod1_empcode);
  const hod2 = keep(body.hod2_empcode) ? null : await pick(body.hod2_empcode);
  if (hod1 && !mobileKey(hod1.mobile)) throw new AppraisalError(`${hod1.name} has no mobile number on file, so they cannot sign in as HOD`);
  if (hod2 && !mobileKey(hod2.mobile)) throw new AppraisalError(`${hod2.name} has no mobile number on file, so they cannot sign in as HOD`);

  const next = {
    rpt_empcode: keep(body.rpt_empcode) ? head.rpt_empcode : rpt?.empcode ?? null,
    hod1_mno: keep(body.hod1_empcode) ? head.hod1_mno : hod1?.mobile ?? null,
    hod2_mno: keep(body.hod2_empcode) ? head.hod2_mno : hod2?.mobile ?? null,
  };
  const rptPerson = next.rpt_empcode ? await loadPerson(c, next.rpt_empcode) : null;
  const keys = [rptPerson ? mobileKey(rptPerson.mobile) || `rpt:${rptPerson.empcode}` : null, mobileKey(next.hod1_mno), mobileKey(next.hod2_mno)].filter(Boolean);
  if (new Set(keys).size !== keys.length) throw new AppraisalError("Each review level must be a different person");
  // A year-end stage whose level was removed moves on to the next existing level.
  let stage = head.stage;
  if (["RPT", "HOD1", "HOD2"].includes(stage)) {
    const chain = chainOf(next);
    if (!chain.includes(stage)) {
      const order = ["RPT", "HOD1", "HOD2", "HR"];
      stage = chain.find((x) => order.indexOf(x) > order.indexOf(stage)) ?? chain[0] ?? "HR";
    }
  }
  const goalReviewer = lineManagerRole(next);
  await c.execute(
    `UPDATE HR_APPRAISAL_MASTER SET RPT_EMPCODE = :rpt, HOD1_MNO = :h1, HOD2_MNO = :h2, STAGE = :st, GOAL_REVIEWER = :gr,
            UPDATED_BY = :actor, UPDATED_AT = SYSDATE
      WHERE APPRAISAL_ID = :id`,
    { rpt: next.rpt_empcode, h1: next.hod1_mno, h2: next.hod2_mno, st: stage, gr: goalReviewer, actor: s(actor).slice(0, 30), id },
  );
  await writeLog(c, {
    compc: head.compc, entity: "APPRAISAL", entityId: id, action: "REASSIGN",
    details: {
      previous: { rpt: head.rpt_empcode, hod1: !!head.hod1_mno, hod2: !!head.hod2_mno, stage: head.stage },
      rpt: next.rpt_empcode, hod1: hod1?.empcode ?? (keep(body.hod1_empcode) ? "kept" : null), hod2: hod2?.empcode ?? (keep(body.hod2_empcode) ? "kept" : null), stage,
    },
    actor,
  });
  return { appraisal_id: id, stage };
});

export const hrCancel = (compc, actor, id, remarks) => withTx(async (c) => {
  const actorName = await nameOf(c, actor);
  const head = await hrHead(c, compc, id, { lock: true });
  if (["COMPLETED", "CANCELLED"].includes(head.stage)) throw new AppraisalError("This appraisal is already closed");
  if (!s(remarks)) throw new AppraisalError("Please give a reason for cancelling");
  await record(c, head, { role: "HR", actor, actorName, action: "CANCEL", next: "CANCELLED", remarks });
  await moveTo(c, head, "CANCELLED", actor);
  return { appraisal_id: id, stage: "CANCELLED" };
});

/**
 * Bell curve of a cycle (flow chart): standard vs actual share per grade, plus
 * the grades the HODs gave before HR normalisation. Counts appraisals that have
 * reached HR or are completed.
 */
export const bellCurve = (compc, cycleId, { dept } = {}) => read(async (c) => {
  const scale = await loadScale(c, compc);
  const binds = { compc, cid: cycleId };
  let where = "";
  if (dept) { where = " AND LTRIM(DEPT_NO,'0') = LTRIM(:dept,'0')"; binds.dept = s(dept); }
  const r = await c.execute(
    `SELECT FINAL_RATING, HOD_GRADE, FINAL_SCORE FROM HR_APPRAISAL_MASTER
      WHERE COMPC = :compc AND CYCLE_ID = :cid AND STAGE IN ('HR','COMPLETED') AND FINAL_RATING IS NOT NULL${where}`,
    binds, { outFormat: OUT_ARRAY },
  );
  const rows = r.rows ?? [];
  const total = rows.length;
  const TOLERANCE = 5;   // percentage points above target before HR is warned
  const bands = scale.map((b) => {
    const count = rows.filter((x) => s(x[0]) === b.label).length;
    const hodCount = rows.filter((x) => (s(x[1]) || s(x[0])) === b.label).length;
    const actual = total ? r2((count / total) * 100) : 0;
    const standardCount = b.target_pct === null ? null : Math.round((total * b.target_pct) / 100);
    const over = b.target_pct !== null && total > 0 && actual > b.target_pct + TOLERANCE;
    return {
      label: b.label, description: b.description, min_score: b.min_score, max_score: b.max_score, target_pct: b.target_pct,
      standard_count: standardCount, count, hod_count: hodCount, actual_pct: actual, over_target: over,
      remark: standardCount === null || count === standardCount ? "MATCHED" : count > standardCount ? "ABOVE" : "BELOW",
    };
  });
  const warnings = bands.filter((b) => b.over_target)
    .map((b) => `${b.label}: ${b.actual_pct}% of employees against a standard of ${b.target_pct}%`);
  const scores = rows.map((x) => numOrNull(x[2])).filter((v) => v !== null);
  return { total, average: scores.length ? r2(scores.reduce((t, v) => t + v, 0) / scores.length) : null, bands, warnings };
});

export { loadHead as loadAppraisalHead };
