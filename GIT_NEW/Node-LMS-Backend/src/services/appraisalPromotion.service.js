/**
 * Promotion evaluation — DCL form "Appraisal & Promotion Evaluation", sheets 1–5.
 * A case opens when an appraisal that recommends a promotion is finalised.
 *
 *   ELIGIBILITY  sheet 1, HR answers 7 gates Yes/No → NOT_ELIGIBLE (closed) or COMPETENCY
 *   COMPETENCY   sheet 2, employee self-rates the 10 competencies (+ evidence, development
 *                needs, comments, training requests, declaration)
 *   MGR_RATING   sheet 2, the reporting manager (else the HOD) rates them — this rating counts
 *   HR_REVIEW    sheet 3 (last 3 years, prefilled) + sheet 4 (auto scorecard, HR recommendation)
 *   SIGNOFF      sheet 5, independent recommendations: reporting manager, HOD, HR head
 *   HOD_FINAL    HOD / HOU decision
 *   CEO_FINAL    CEO decision (management approver; HR records it when none is set up)
 *   APPROVED     the promotion recommendation becomes APPROVED → HR applies it
 *   REJECTED / NOT_ELIGIBLE / CANCELLED
 */

import {
  OUT_ARRAY, s, num, numOrNull, r2, ymd, ymdhm, mobileKey, mobileKeySql, AppraisalError, nextId, nameOf, writeLog, read, withTx,
  EMP_DEPT_SQL, EMP_DESG_SQL, loadPerson, isMgmtApprover, loadSettings, loadPromoBands,
} from "./appraisalShared.service.js";
import {
  ELIGIBILITY_CRITERIA, eligibilityResult, competencyScore, performanceScore, overallScore, decisionBand, yearsBetween, GRADE_POINTS,
} from "./appraisalRules.js";

export const CASE_STATUS_LABEL = {
  ELIGIBILITY: "Sheet 1 — eligibility (HR)", COMPETENCY: "Sheet 2 — employee self-assessment", MGR_RATING: "Sheet 2 — manager rating",
  HR_REVIEW: "Sheets 3–4 — HR history & scorecard", SIGNOFF: "Sheet 5 — recommendations", HOD_FINAL: "HOD decision",
  CEO_FINAL: "CEO decision", APPROVED: "Approved", REJECTED: "Not approved", NOT_ELIGIBLE: "Not eligible", CANCELLED: "Cancelled",
};
const CLOSED = ["APPROVED", "REJECTED", "NOT_ELIGIBLE", "CANCELLED"];

// ---------------------------------------------------------------------------
// Creation (called when an appraisal is finalised)
// ---------------------------------------------------------------------------

/** Open a case for a finalised appraisal that recommends a promotion. Returns the case id or null. */
export const createPromotionCase = async (c, head, actor) => {
  const rec = await c.execute(
    `SELECT PROP_DESG_CD, PROP_GRADE_CD FROM HR_PROMOTION_RECOMMENDATION WHERE APPRAISAL_ID = :id AND STATUS = 'PROPOSED'`,
    { id: head.appraisal_id }, { outFormat: OUT_ARRAY },
  );
  if (!rec.rows?.length) return null;
  const existing = await c.execute(`SELECT CASE_ID FROM HR_PROMOTION_CASE WHERE APPRAISAL_ID = :id`, { id: head.appraisal_id }, { outFormat: OUT_ARRAY });
  if (existing.rows?.length) return num(existing.rows[0][0]);
  const emp = await loadPerson(c, head.empcode);
  const id = await nextId(c, "HR_PROMOTION_CASE_SEQ");
  await c.execute(
    `INSERT INTO HR_PROMOTION_CASE (CASE_ID, COMPC, APPRAISAL_ID, EMPCODE, CUR_DESG_CD, CUR_GRADE_CD, PROP_DESG_CD, PROP_GRADE_CD,
            RM_EMPCODE, HOD_MNO, CREATED_BY)
     VALUES (:id, :compc, :aid, :e, :cd, :cg, :pd, :pg, :rm, :hod, :actor)`,
    {
      id, compc: head.compc, aid: head.appraisal_id, e: head.empcode, cd: emp?.desg_cd || null, cg: emp?.grade_cd || null,
      pd: s(rec.rows[0][0]) || null, pg: s(rec.rows[0][1]) || null, rm: head.rpt_empcode || null,
      hod: head.hod1_mno || head.hod2_mno || null, actor: s(actor).slice(0, 30),
    },
  );
  for (const k of ELIGIBILITY_CRITERIA) {
    await c.execute(`INSERT INTO HR_PROMO_ELIGIBILITY (CASE_ID, CRITERION) VALUES (:id, :k)`, { id, k: k.code });
  }
  const comps = await c.execute(
    `SELECT COMPETENCY_ID, NAME, DESCRIPTION, WEIGHT_PCT, SEQ FROM HR_COMPETENCY_MASTER
      WHERE COMPC = :compc AND IS_ACTIVE = 'Y' ORDER BY SEQ, UPPER(NAME)`,
    { compc: head.compc }, { outFormat: OUT_ARRAY },
  );
  let seq = 0;
  for (const x of comps.rows ?? []) {
    await c.execute(
      `INSERT INTO HR_PROMO_COMPETENCY (CASE_ID, COMPETENCY_ID, NAME, DEFINITION, WEIGHT_PCT, SEQ) VALUES (:id, :cid, :n, :d, :w, :seq)`,
      { id, cid: num(x[0]), n: s(x[1]), d: s(x[2]) || null, w: num(x[3]), seq: seq++ },
    );
  }
  // Sheet 3 starts from the employee's last three completed appraisals (score out of 5 → %).
  const hist = await c.execute(
    `SELECT y.NAME, y.FY_YEAR, h.FINAL_SCORE, h.FINAL_RATING
       FROM HR_PERFORMANCE_HISTORY h JOIN HR_APPRAISAL_CYCLE y ON y.CYCLE_ID = h.CYCLE_ID
      WHERE h.EMPCODE = :e ORDER BY h.PERIOD_TO DESC FETCH FIRST 3 ROWS ONLY`,
    { e: head.empcode }, { outFormat: OUT_ARRAY },
  );
  let hs = 1;
  for (const x of hist.rows ?? []) {
    const pct = numOrNull(x[2]) === null ? null : r2((num(x[2]) / 5) * 100);
    await c.execute(
      `INSERT INTO HR_PROMO_HISTORY (CASE_ID, SEQ, APPRAISAL_YEAR, RATING_PCT, KPI_PCT, ACHIEVEMENTS) VALUES (:id, :seq, :y, :rp, :kp, :ach)`,
      { id, seq: hs++, y: `${num(x[1])}-${String((num(x[1]) + 1) % 100).padStart(2, "0")}`, rp: pct, kp: pct, ach: `${s(x[0])}: grade ${s(x[3])}`.slice(0, 1000) },
    );
  }
  await recomputeCase(c, id);
  await writeLog(c, { compc: head.compc, entity: "PROMO_CASE", entityId: id, action: "OPEN", details: { appraisal_id: head.appraisal_id }, actor });
  return id;
};

export const caseSummaryFor = async (c, appraisalId) => {
  const r = await c.execute(
    `SELECT CASE_ID, STATUS, DECISION_BAND, OVERALL_SCORE, ELIGIBILITY_RESULT FROM HR_PROMOTION_CASE WHERE APPRAISAL_ID = :id`,
    { id: appraisalId }, { outFormat: OUT_ARRAY },
  );
  const x = r.rows?.[0];
  return x ? {
    case_id: num(x[0]), status: s(x[1]), status_label: CASE_STATUS_LABEL[s(x[1])] ?? s(x[1]), decision_band: s(x[2]) || null,
    overall_score: numOrNull(x[3]), eligibility_result: s(x[4]),
  } : null;
};

// ---------------------------------------------------------------------------
// Loading and scoring
// ---------------------------------------------------------------------------

const CASE_SELECT = `
  SELECT p.CASE_ID, p.COMPC, p.APPRAISAL_ID, p.EMPCODE, m.NAME, ${EMP_DEPT_SQL}, ${EMP_DESG_SQL}, m.GRADE_CD,
         m.DTOFAPPT, m.LAST_PROM_DT, p.CUR_DESG_CD, p.CUR_GRADE_CD, p.PROP_DESG_CD, p.PROP_GRADE_CD,
         (SELECT MAX(g.DESG_DESC) FROM HR_DESG g WHERE TO_CHAR(g.DESG_CD) = p.PROP_DESG_CD AND g.COMPC = p.COMPC),
         p.RM_EMPCODE, (SELECT MAX(r.NAME) FROM HR_EMP_MASTER r WHERE r.EMPCODE = p.RM_EMPCODE), p.HOD_MNO,
         p.STATUS, p.ELIGIBILITY_RESULT, p.ASSESS_DATE, p.ASSESSED_BY, (SELECT MAX(h.NAME) FROM HR_EMP_MASTER h WHERE h.EMPCODE = p.ASSESSED_BY),
         p.EMP_COMMENTS, p.TECH_TRAININGS, p.SOFT_TRAININGS, p.EMP_DECLARED_AT, p.MGR_RATED_BY, p.MGR_RATED_AT,
         p.COMP_SCORE, p.PERF_SCORE, p.COMP_WEIGHT_PCT, p.PERF_WEIGHT_PCT, p.OVERALL_SCORE, p.DECISION_BAND, p.DECISION_OUTCOME,
         p.HR_RECOMMENDATION, p.RATIONALE, p.GAP_AREAS, p.ACTIONS_TIMELINE, p.NEXT_REVIEW_DATE,
         p.FINAL_DESG_CD, (SELECT MAX(g.DESG_DESC) FROM HR_DESG g WHERE TO_CHAR(g.DESG_CD) = p.FINAL_DESG_CD AND g.COMPC = p.COMPC),
         p.FINAL_GRADE_CD, p.NEW_PACKAGE, p.EFFECTIVE_DATE, p.DECIDED_AT, p.CREATED_AT,
         a.FINAL_RATING, a.FINAL_SCORE, y.NAME, m.EMPNO
    FROM HR_PROMOTION_CASE p
    JOIN HR_APPRAISAL_MASTER a ON a.APPRAISAL_ID = p.APPRAISAL_ID
    JOIN HR_APPRAISAL_CYCLE y ON y.CYCLE_ID = a.CYCLE_ID
    LEFT JOIN HR_EMP_MASTER m ON m.EMPCODE = p.EMPCODE`;

const rowToCase = (x) => {
  const roleSince = x[9] || x[8];
  return {
    case_id: num(x[0]), compc: num(x[1]), appraisal_id: num(x[2]), empcode: s(x[3]), emp_name: s(x[4]), dept_name: s(x[5]),
    cur_desg_desc: s(x[6]), cur_grade: s(x[7]) || s(x[11]), join_date: ymd(x[8]), role_since: ymd(roleSince),
    time_in_role_yrs: yearsBetween(roleSince), tenure_yrs: yearsBetween(x[8]),
    cur_desg_cd: s(x[10]), prop_desg_cd: s(x[12]) || null, prop_grade_cd: s(x[13]) || null, prop_desg_desc: s(x[14]),
    rm_empcode: s(x[15]) || null, rm_name: s(x[16]) || null, hod_mno: s(x[17]) || null,
    status: s(x[18]), status_label: CASE_STATUS_LABEL[s(x[18])] ?? s(x[18]), eligibility_result: s(x[19]),
    assess_date: ymd(x[20]), assessed_by: s(x[21]) || null, assessed_by_name: s(x[22]) || null,
    emp_comments: s(x[23]), tech_trainings: s(x[24]), soft_trainings: s(x[25]), emp_declared_at: ymdhm(x[26]),
    mgr_rated_by: s(x[27]) || null, mgr_rated_at: ymdhm(x[28]),
    comp_score: numOrNull(x[29]), perf_score: numOrNull(x[30]), comp_weight_pct: numOrNull(x[31]), perf_weight_pct: numOrNull(x[32]),
    overall_score: numOrNull(x[33]), decision_band: s(x[34]) || "INCOMPLETE", decision_outcome: s(x[35]) || "INCOMPLETE",
    hr_recommendation: s(x[36]), rationale: s(x[37]), gap_areas: s(x[38]), actions_timeline: s(x[39]), next_review_date: ymd(x[40]),
    final_desg_cd: s(x[41]) || null, final_desg_desc: s(x[42]) || null, final_grade_cd: s(x[43]) || null, new_package: s(x[44]),
    effective_date: ymd(x[45]), decided_at: ymdhm(x[46]), created_at: ymdhm(x[47]),
    appraisal_grade: s(x[48]) || null, appraisal_score: numOrNull(x[49]), cycle_name: s(x[50]), empno: s(x[51]),
  };
};

const loadCaseHead = async (c, caseId, { lock = false } = {}) => {
  if (lock) await c.execute(`SELECT 1 FROM HR_PROMOTION_CASE WHERE CASE_ID = :id FOR UPDATE`, { id: caseId }, { outFormat: OUT_ARRAY });
  const r = await c.execute(`${CASE_SELECT} WHERE p.CASE_ID = :id`, { id: caseId }, { outFormat: OUT_ARRAY });
  if (!r.rows?.length) throw new AppraisalError("Promotion case not found", 404);
  return rowToCase(r.rows[0]);
};

const loadEligibility = async (c, caseId) => {
  const r = await c.execute(`SELECT CRITERION, STATUS, REMARKS FROM HR_PROMO_ELIGIBILITY WHERE CASE_ID = :id`, { id: caseId }, { outFormat: OUT_ARRAY });
  const got = new Map((r.rows ?? []).map((x) => [s(x[0]), { status: s(x[1]) || null, remarks: s(x[2]) }]));
  return ELIGIBILITY_CRITERIA.map((k) => ({ ...k, criterion_code: k.code, status: got.get(k.code)?.status ?? null, remarks: got.get(k.code)?.remarks ?? "" }));
};

const loadCompetencies = async (c, caseId) => {
  const r = await c.execute(
    `SELECT COMPETENCY_ID, NAME, DEFINITION, WEIGHT_PCT, SEQ, SELF_RATING, MGR_RATING, EVIDENCE, DEV_NEEDS, MGR_COMMENT
       FROM HR_PROMO_COMPETENCY WHERE CASE_ID = :id ORDER BY SEQ, COMPETENCY_ID`,
    { id: caseId }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => ({
    competency_id: num(x[0]), name: s(x[1]), definition: s(x[2]), weight_pct: num(x[3]), seq: num(x[4]),
    self_rating: numOrNull(x[5]), mgr_rating: numOrNull(x[6]), evidence: s(x[7]), dev_needs: s(x[8]), mgr_comment: s(x[9]),
    self_weighted: numOrNull(x[5]) === null ? null : r2((num(x[3]) / 100) * num(x[5])),
    mgr_weighted: numOrNull(x[6]) === null ? null : r2((num(x[3]) / 100) * num(x[6])),
  }));
};

const loadHistory = async (c, caseId) => {
  const r = await c.execute(
    `SELECT SEQ, APPRAISAL_YEAR, RATING_PCT, KPI_PCT, ACHIEVEMENTS FROM HR_PROMO_HISTORY WHERE CASE_ID = :id ORDER BY SEQ`,
    { id: caseId }, { outFormat: OUT_ARRAY },
  );
  const got = new Map((r.rows ?? []).map((x) => [num(x[0]), x]));
  return [1, 2, 3].map((seq) => {
    const x = got.get(seq);
    return { seq, appraisal_year: x ? s(x[1]) : "", rating_pct: x ? numOrNull(x[2]) : null, kpi_pct: x ? numOrNull(x[3]) : null, achievements: x ? s(x[4]) : "" };
  });
};

const loadSignoffs = async (c, caseId) => {
  const r = await c.execute(
    `SELECT ROLE, ACTOR, ACTOR_NAME, DECISION, REMARKS, ACTED_AT FROM HR_PROMO_SIGNOFF WHERE CASE_ID = :id ORDER BY ACTED_AT`,
    { id: caseId }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => ({ role: s(x[0]), actor: s(x[1]), actor_name: s(x[2]), decision: s(x[3]), remarks: s(x[4]), acted_at: ymdhm(x[5]) }));
};

/** Recompute eligibility result, competency / performance / overall score and the decision band. */
const recomputeCase = async (c, caseId) => {
  const head = await c.execute(`SELECT COMPC FROM HR_PROMOTION_CASE WHERE CASE_ID = :id`, { id: caseId }, { outFormat: OUT_ARRAY });
  const compc = num(head.rows[0][0]);
  const settings = await loadSettings(c, compc);
  const bands = await loadPromoBands(c, compc);
  const elig = eligibilityResult((await loadEligibility(c, caseId)).map((e) => ({ criterion: e.code, status: e.status })));
  const comp = competencyScore(await loadCompetencies(c, caseId), "mgr_rating");
  const perf = performanceScore(await loadHistory(c, caseId)).score;
  const overall = overallScore(comp, perf, settings.comp_weight_pct, settings.perf_weight_pct);
  const band = decisionBand(bands, overall, elig);
  await c.execute(
    `UPDATE HR_PROMOTION_CASE SET ELIGIBILITY_RESULT = :el, COMP_SCORE = :cs, PERF_SCORE = :ps, COMP_WEIGHT_PCT = :cw, PERF_WEIGHT_PCT = :pw,
            OVERALL_SCORE = :os, DECISION_BAND = :db, DECISION_OUTCOME = :dout WHERE CASE_ID = :id`,
    {
      el: elig, cs: comp, ps: perf, cw: settings.comp_weight_pct, pw: settings.perf_weight_pct, os: overall,
      db: band.label, dout: band.outcome, id: caseId,
    },
  );
  return { eligibility_result: elig, comp_score: comp, perf_score: perf, overall_score: overall, decision_band: band.label, decision_outcome: band.outcome };
};

/** Hints HR sees next to sheet 1 (the system's own data; HR still answers Yes/No). */
const eligibilityHints = (cs, settings) => ({
  TENURE: cs.time_in_role_yrs === null ? "No join / promotion date on file"
    : `${cs.time_in_role_yrs} year(s) in current role (minimum ${settings.min_tenure_yrs})`,
  RATING: cs.appraisal_grade ? `This cycle's grade: ${cs.appraisal_grade}${(GRADE_POINTS[cs.appraisal_grade] ?? 0) >= 3 ? " (meets B or above)" : " (below B)"}` : "",
});

const loadCase = async (c, caseId) => {
  const head = await loadCaseHead(c, caseId);
  const settings = await loadSettings(c, head.compc);
  const competencies = await loadCompetencies(c, caseId);
  const history = await loadHistory(c, caseId);
  const perf = performanceScore(history);
  const hodName = head.hod_mno ? await nameByMobile(c, head.hod_mno) : null;
  return {
    ...head, hod_name: hodName, settings,
    eligibility: await loadEligibility(c, caseId), eligibility_hints: eligibilityHints(head, settings),
    competencies,
    self_comp_score: competencyScore(competencies, "self_rating"),
    competency_progress: { self: competencies.filter((x) => x.self_rating !== null).length, mgr: competencies.filter((x) => x.mgr_rating !== null).length, total: competencies.length },
    history, history_avg: { rating: perf.rating_avg, kpi: perf.kpi_avg },
    signoffs: await loadSignoffs(c, caseId),
    bands: await loadPromoBands(c, head.compc),
  };
};

const nameByMobile = async (c, mno) => {
  const k = mobileKey(mno);
  if (!k) return null;
  const r = await c.execute(`SELECT MAX(NAME) FROM HR_EMP_MASTER WHERE ${mobileKeySql('"MOBILE#"')} = :k AND NVL(STATUS,'A') = 'A'`, { k }, { outFormat: OUT_ARRAY });
  return s(r.rows?.[0]?.[0]) || null;
};

// Phone numbers are routing data; never send them to the browser.
const publicCase = ({ hod_mno, ...rest }) => ({ ...rest, has_hod: !!mobileKey(hod_mno) });

/** What the employee sees: their own sheet 2 and the outcome, not the scorecard or recommendations. */
const employeeCase = (full) => ({
  case_id: full.case_id, appraisal_id: full.appraisal_id, cycle_name: full.cycle_name, status: full.status, status_label: full.status_label,
  emp_name: full.emp_name, empcode: full.empcode, cur_desg_desc: full.cur_desg_desc, prop_desg_desc: full.prop_desg_desc,
  competencies: full.competencies.map(({ mgr_rating, mgr_weighted, mgr_comment, ...rest }) => rest),
  self_comp_score: full.self_comp_score, competency_progress: { ...full.competency_progress, mgr: undefined },
  emp_comments: full.emp_comments, tech_trainings: full.tech_trainings, soft_trainings: full.soft_trainings, emp_declared_at: full.emp_declared_at,
  outcome: CLOSED.includes(full.status) ? full.status : null,
  effective_date: full.status === "APPROVED" ? full.effective_date : null,
  final_desg_desc: full.status === "APPROVED" ? full.final_desg_desc : null,
  can_self_assess: full.status === "COMPETENCY",
});

const setStatus = async (c, cs, status, actor, extraSet = "", binds = {}) => {
  await c.execute(
    `UPDATE HR_PROMOTION_CASE SET STATUS = :st, UPDATED_BY = :actor, UPDATED_AT = SYSDATE${extraSet} WHERE CASE_ID = :id`,
    { st: status, actor: s(actor).slice(0, 30), id: cs.case_id, ...binds },
  );
  await writeLog(c, { compc: cs.compc, entity: "PROMO_CASE", entityId: cs.case_id, action: `STATUS_${status}`, details: { from: cs.status }, actor });
};

const assertStatus = (cs, statuses, msg) => {
  if (!statuses.includes(cs.status)) throw new AppraisalError(msg ?? `This case is at "${cs.status_label}"`);
};

/** Close the linked promotion recommendation when the case ends without a promotion. */
const rejectRecommendation = async (c, cs) => {
  await c.execute(
    `UPDATE HR_PROMOTION_RECOMMENDATION SET STATUS = 'REJECTED', UPDATED_AT = SYSDATE WHERE APPRAISAL_ID = :id AND STATUS IN ('PROPOSED','APPROVED')`,
    { id: cs.appraisal_id },
  );
};

const signoff = async (c, cs, role, who, decision, remarks) => {
  await c.execute(`DELETE FROM HR_PROMO_SIGNOFF WHERE CASE_ID = :id AND ROLE = :rl`, { id: cs.case_id, rl: role });
  await c.execute(
    `INSERT INTO HR_PROMO_SIGNOFF (SIGNOFF_ID, CASE_ID, ROLE, ACTOR, ACTOR_NAME, DECISION, REMARKS)
     VALUES (HR_PROMO_SIGNOFF_SEQ.NEXTVAL, :id, :rl, :actor, :aname, :dec, :rem)`,
    { id: cs.case_id, rl: role, actor: s(who.actor).slice(0, 30), aname: s(who.name).slice(0, 100) || null, dec: decision, rem: s(remarks).slice(0, 1000) || null },
  );
  await writeLog(c, { compc: cs.compc, entity: "PROMO_CASE", entityId: cs.case_id, action: `SIGN_${role}`, details: { decision, remarks }, actor: who.actor });
};

/** After each sheet-5 recommendation: move on once everyone who exists on the case has recommended. */
const advanceSignoff = async (c, cs, actor) => {
  const done = new Set((await loadSignoffs(c, cs.case_id)).map((x) => x.role));
  const need = [...(cs.rm_empcode ? ["RM"] : []), ...(mobileKey(cs.hod_mno) ? ["HOD"] : []), "HR_HEAD"];
  if (need.every((r) => done.has(r))) {
    const next = mobileKey(cs.hod_mno) ? "HOD_FINAL" : "CEO_FINAL";
    await setStatus(c, cs, next, actor);
    return next;
  }
  return cs.status;
};

// ---------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------

const hrCase = async (c, compc, caseId, opts) => {
  const cs = await loadCaseHead(c, caseId, opts);
  if (cs.compc !== num(compc)) throw new AppraisalError("Promotion case not found", 404);
  return cs;
};

export const hrListCases = (compc, f = {}) => read(async (c) => {
  const binds = { compc };
  let where = " WHERE p.COMPC = :compc";
  if (f.cycle_id) { where += " AND a.CYCLE_ID = :cid"; binds.cid = num(f.cycle_id); }
  if (f.status) { where += " AND p.STATUS = :st"; binds.st = s(f.status); }
  const r = await c.execute(`${CASE_SELECT}${where} ORDER BY p.CREATED_AT DESC`, binds, { outFormat: OUT_ARRAY });
  return (r.rows ?? []).map(rowToCase).map(publicCase);
});

export const hrGetCase = (compc, caseId) => read(async (c) => {
  await hrCase(c, compc, caseId);
  const full = await loadCase(c, caseId);
  const hasCeo = await c.execute(`SELECT 1 FROM HR_APPR_MGMT_APPROVER WHERE COMPC = :compc AND IS_ACTIVE = 'Y' FETCH FIRST 1 ROWS ONLY`, { compc }, { outFormat: OUT_ARRAY });
  return { ...publicCase(full), has_ceo: !!hasCeo.rows?.length };
});

/** Sheet 1 answers (and the assessment date). Allowed until the case moves past eligibility. */
export const hrSaveEligibility = (compc, actor, caseId, body) => withTx(async (c) => {
  const cs = await hrCase(c, compc, caseId, { lock: true });
  assertStatus(cs, ["ELIGIBILITY"], "Eligibility can only be changed before it is submitted");
  for (const a of body.answers ?? []) {
    if (!ELIGIBILITY_CRITERIA.some((k) => k.code === a.criterion)) throw new AppraisalError(`Unknown criterion ${a.criterion}`);
    await c.execute(
      `UPDATE HR_PROMO_ELIGIBILITY SET STATUS = :st, REMARKS = :rem WHERE CASE_ID = :id AND CRITERION = :k`,
      { st: a.status === "Y" || a.status === "N" ? a.status : null, rem: s(a.remarks).slice(0, 500) || null, id: caseId, k: a.criterion },
    );
  }
  await c.execute(
    `UPDATE HR_PROMOTION_CASE SET ASSESS_DATE = NVL(TO_DATE(:ad,'YYYY-MM-DD'), NVL(ASSESS_DATE, TRUNC(SYSDATE))), ASSESSED_BY = :actor,
            PROP_GRADE_CD = NVL(:pg, PROP_GRADE_CD), UPDATED_BY = :actor, UPDATED_AT = SYSDATE
      WHERE CASE_ID = :id`,
    { ad: body.assess_date || null, actor: s(actor).slice(0, 30), pg: s(body.prop_grade_cd) || null, id: caseId },
  );
  return recomputeCase(c, caseId);
});

/** Submit sheet 1: not eligible closes the case; eligible opens the employee's self-assessment. */
export const hrSubmitEligibility = (compc, actor, caseId) => withTx(async (c) => {
  const cs = await hrCase(c, compc, caseId, { lock: true });
  assertStatus(cs, ["ELIGIBILITY"]);
  const res = await recomputeCase(c, caseId);
  if (res.eligibility_result === "INCOMPLETE") throw new AppraisalError("Answer every eligibility criterion first");
  if (res.eligibility_result === "NOT_ELIGIBLE") {
    await setStatus(c, cs, "NOT_ELIGIBLE", actor, ", DECIDED_AT = SYSDATE");
    await rejectRecommendation(c, cs);
    return { case_id: caseId, status: "NOT_ELIGIBLE" };
  }
  await setStatus(c, cs, "COMPETENCY", actor);
  return { case_id: caseId, status: "COMPETENCY" };
});

/** Sheet 3 (performance history) — HR edits during HR review (or earlier). */
export const hrSaveHistory = (compc, actor, caseId, rows) => withTx(async (c) => {
  const cs = await hrCase(c, compc, caseId, { lock: true });
  if (CLOSED.includes(cs.status)) throw new AppraisalError("This case is closed");
  for (const r of rows ?? []) {
    const seq = num(r.seq);
    if (seq < 1 || seq > 3) throw new AppraisalError("History has three rows");
    await c.execute(
      `MERGE INTO HR_PROMO_HISTORY h USING (SELECT :id CASE_ID, :seq SEQ FROM DUAL) x ON (h.CASE_ID = x.CASE_ID AND h.SEQ = x.SEQ)
        WHEN MATCHED THEN UPDATE SET APPRAISAL_YEAR = :y, RATING_PCT = :rp, KPI_PCT = :kp, ACHIEVEMENTS = :ach
        WHEN NOT MATCHED THEN INSERT (CASE_ID, SEQ, APPRAISAL_YEAR, RATING_PCT, KPI_PCT, ACHIEVEMENTS) VALUES (:id, :seq, :y, :rp, :kp, :ach)`,
      {
        id: caseId, seq, y: s(r.appraisal_year).slice(0, 20) || null, rp: numOrNull(r.rating_pct), kp: numOrNull(r.kpi_pct),
        ach: s(r.achievements).slice(0, 1000) || null,
      },
    );
  }
  await writeLog(c, { compc: cs.compc, entity: "PROMO_CASE", entityId: caseId, action: "HISTORY", details: rows, actor });
  return recomputeCase(c, caseId);
});

/** Sheet 4 — HR recommendation fields (scores are automatic). */
export const hrSaveScorecard = (compc, actor, caseId, body) => withTx(async (c) => {
  const cs = await hrCase(c, compc, caseId, { lock: true });
  assertStatus(cs, ["MGR_RATING", "HR_REVIEW", "SIGNOFF"], "The scorecard is filled after the manager's competency rating");
  await c.execute(
    `UPDATE HR_PROMOTION_CASE SET HR_RECOMMENDATION = :rec, RATIONALE = :rat, GAP_AREAS = :gap, ACTIONS_TIMELINE = :act,
            NEXT_REVIEW_DATE = TO_DATE(:nrd,'YYYY-MM-DD'), UPDATED_BY = :actor, UPDATED_AT = SYSDATE
      WHERE CASE_ID = :id`,
    {
      rec: s(body.hr_recommendation).slice(0, 200) || null, rat: s(body.rationale) || null, gap: s(body.gap_areas) || null,
      act: s(body.actions_timeline) || null, nrd: body.next_review_date || null, actor: s(actor).slice(0, 30), id: caseId,
    },
  );
  return recomputeCase(c, caseId);
});

/** HR finishes sheets 3–4 and opens sheet 5. */
export const hrSubmitReview = (compc, actor, caseId) => withTx(async (c) => {
  const cs = await hrCase(c, compc, caseId, { lock: true });
  assertStatus(cs, ["HR_REVIEW"]);
  const res = await recomputeCase(c, caseId);
  if (res.perf_score === null) throw new AppraisalError("Fill the performance history (sheet 3) first");
  if (!s(cs.hr_recommendation)) throw new AppraisalError("Give the HR recommendation (sheet 4) first");
  await setStatus(c, cs, "SIGNOFF", actor);
  return { case_id: caseId, status: "SIGNOFF" };
});

/** HR head's independent recommendation (sheet 5). */
export const hrSignoff = (compc, actor, caseId, { decision, remarks }) => withTx(async (c) => {
  const cs = await hrCase(c, compc, caseId, { lock: true });
  assertStatus(cs, ["SIGNOFF"]);
  await signoff(c, cs, "HR_HEAD", { actor, name: await nameOf(c, actor) }, decision, remarks);
  return { case_id: caseId, status: await advanceSignoff(c, cs, actor) };
});

/** CEO decision recorded by HR — only when the company has no management approver set up. */
export const hrRecordCeoDecision = (compc, actor, caseId, body) => withTx(async (c) => {
  const cs = await hrCase(c, compc, caseId, { lock: true });
  assertStatus(cs, ["CEO_FINAL"]);
  const hasCeo = await c.execute(`SELECT 1 FROM HR_APPR_MGMT_APPROVER WHERE COMPC = :compc AND IS_ACTIVE = 'Y' FETCH FIRST 1 ROWS ONLY`, { compc }, { outFormat: OUT_ARRAY });
  if (hasCeo.rows?.length) throw new AppraisalError("The CEO decides this case from their own account");
  return ceoDecide(c, cs, { actor, name: `${await nameOf(c, actor)} (for CEO)` }, body);
});

export const hrCancelCase = (compc, actor, caseId, remarks) => withTx(async (c) => {
  const cs = await hrCase(c, compc, caseId, { lock: true });
  if (CLOSED.includes(cs.status)) throw new AppraisalError("This case is already closed");
  if (!s(remarks)) throw new AppraisalError("Please give a reason");
  await setStatus(c, cs, "CANCELLED", actor, ", DECIDED_AT = SYSDATE, RATIONALE = NVL(RATIONALE, :rm)", { rm: s(remarks) });
  await rejectRecommendation(c, cs);
  return { case_id: caseId, status: "CANCELLED" };
});

// ---------------------------------------------------------------------------
// Employee (sheet 2 self-assessment)
// ---------------------------------------------------------------------------

const ownCase = async (c, empcode, caseId, opts) => {
  const cs = await loadCaseHead(c, caseId, opts);
  if (cs.empcode !== s(empcode)) throw new AppraisalError("Promotion case not found", 404);
  return cs;
};

export const myCases = (empcode) => read(async (c) => {
  const r = await c.execute(`${CASE_SELECT} WHERE p.EMPCODE = :e AND p.STATUS <> 'CANCELLED' ORDER BY p.CREATED_AT DESC`, { e: s(empcode) }, { outFormat: OUT_ARRAY });
  return (r.rows ?? []).map(rowToCase).map((x) => ({
    case_id: x.case_id, cycle_name: x.cycle_name, status: x.status, status_label: x.status_label, prop_desg_desc: x.prop_desg_desc,
    my_turn: x.status === "COMPETENCY",
  }));
});

export const myCase = (empcode, caseId) => read(async (c) => {
  await ownCase(c, empcode, caseId);
  return employeeCase(await loadCase(c, caseId));
});

const RATING5 = (v) => {
  const n = numOrNull(v);
  if (n === null) return null;
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new AppraisalError("Competency ratings are 1 to 5");
  return n;
};

export const saveMySelfAssessment = (empcode, caseId, body) => withTx(async (c) => {
  const cs = await ownCase(c, empcode, caseId, { lock: true });
  assertStatus(cs, ["COMPETENCY"], "The self-assessment is not open");
  for (const x of body.competencies ?? []) {
    await c.execute(
      `UPDATE HR_PROMO_COMPETENCY SET SELF_RATING = :r, EVIDENCE = :ev, DEV_NEEDS = :dn WHERE CASE_ID = :id AND COMPETENCY_ID = :cid`,
      { r: RATING5(x.self_rating), ev: s(x.evidence).slice(0, 1000) || null, dn: s(x.dev_needs).slice(0, 1000) || null, id: caseId, cid: num(x.competency_id) },
    );
  }
  await c.execute(
    `UPDATE HR_PROMOTION_CASE SET EMP_COMMENTS = :cm, TECH_TRAININGS = :tt, SOFT_TRAININGS = :st WHERE CASE_ID = :id`,
    { cm: s(body.emp_comments) || null, tt: s(body.tech_trainings) || null, st: s(body.soft_trainings) || null, id: caseId },
  );
  return { saved: true };
});

/** Employee declaration: "the ratings and examples above are my honest self-assessment". */
export const submitMySelfAssessment = (empcode, caseId) => withTx(async (c) => {
  const cs = await ownCase(c, empcode, caseId, { lock: true });
  assertStatus(cs, ["COMPETENCY"], "The self-assessment is not open");
  const comps = await loadCompetencies(c, caseId);
  const missing = comps.filter((x) => x.self_rating === null).length;
  if (missing) throw new AppraisalError(`Rate every competency first (${missing} missing)`);
  await setStatus(c, cs, "MGR_RATING", empcode, ", EMP_DECLARED_AT = SYSDATE");
  return { case_id: caseId, status: "MGR_RATING" };
});

// ---------------------------------------------------------------------------
// Reviewers: reporting manager, HOD, CEO
// ---------------------------------------------------------------------------

/** Roles of the signed-in person on a case: RM, HOD, CEO. The manager rater is RM, else HOD. */
const caseRoles = async (c, cs, me) => {
  const roles = [];
  if (cs.rm_empcode && cs.rm_empcode === me.empcode) roles.push("RM");
  const key = mobileKey(me.mobile);
  if (key && mobileKey(cs.hod_mno) === key) roles.push("HOD");
  if (me.empcode !== cs.empcode && (await isMgmtApprover(c, cs.compc, me.empcode))) roles.push("CEO");
  return roles;
};

const raterRole = (cs) => (cs.rm_empcode ? "RM" : "HOD");

/** What the reviewer can do on a case right now. */
const caseActions = (cs, roles, signed) => ({
  can_rate: cs.status === "MGR_RATING" && roles.includes(raterRole(cs)),
  can_signoff: cs.status === "SIGNOFF" ? roles.filter((r) => ["RM", "HOD"].includes(r) && !signed.has(r)) : [],
  can_hod_final: cs.status === "HOD_FINAL" && roles.includes("HOD"),
  can_ceo_final: cs.status === "CEO_FINAL" && roles.includes("CEO"),
});

const reviewCase = async (c, empcode, caseId, opts) => {
  const cs = await loadCaseHead(c, caseId, opts);
  const me = await loadPerson(c, empcode);
  if (!me) throw new AppraisalError("Employee not found", 404);
  const roles = await caseRoles(c, cs, me);
  // The CEO sees a case from the final decision on; RM / HOD see their own people's cases.
  const visible = roles.some((r) => r !== "CEO") || (roles.includes("CEO") && ["CEO_FINAL", "APPROVED", "REJECTED"].includes(cs.status));
  if (!visible) throw new AppraisalError("Promotion case not found", 404);
  const signed = new Set((await loadSignoffs(c, caseId)).map((x) => x.role));
  return { cs, me, roles, actions: caseActions(cs, roles, signed) };
};

export const reviewCases = (empcode) => read(async (c) => {
  const me = await loadPerson(c, empcode);
  if (!me) throw new AppraisalError("Employee not found", 404);
  const key = mobileKey(me.mobile) || "~none~";
  const r = await c.execute(
    `${CASE_SELECT}
      WHERE p.STATUS <> 'CANCELLED' AND (p.RM_EMPCODE = :e OR ${mobileKeySql("p.HOD_MNO")} = :k
         OR (p.STATUS IN ('CEO_FINAL','APPROVED','REJECTED') AND p.EMPCODE <> :e AND EXISTS (
               SELECT 1 FROM HR_APPR_MGMT_APPROVER g WHERE g.COMPC = p.COMPC AND g.EMPCODE = :e AND g.IS_ACTIVE = 'Y')))
      ORDER BY p.CREATED_AT DESC`,
    { e: me.empcode, k: key }, { outFormat: OUT_ARRAY },
  );
  const items = [];
  for (const x of r.rows ?? []) {
    const cs = rowToCase(x);
    const roles = await caseRoles(c, cs, me);
    const signed = new Set((await loadSignoffs(c, cs.case_id)).map((z) => z.role));
    const a = caseActions(cs, roles, signed);
    items.push({
      ...publicCase(cs), my_roles: roles,
      my_turn: a.can_rate || a.can_signoff.length > 0 || a.can_hod_final || a.can_ceo_final,
    });
  }
  return { items, pending: items.filter((i) => i.my_turn).length };
});

export const reviewGetCase = (empcode, caseId) => read(async (c) => {
  const { roles, actions } = await reviewCase(c, empcode, caseId);
  return { ...publicCase(await loadCase(c, caseId)), my_roles: roles, ...actions };
});

/** Manager rating of the competencies (sheet 2); submit moves the case to HR review. */
export const reviewRateCompetencies = (empcode, caseId, body, submit) => withTx(async (c) => {
  const { cs, me, actions } = await reviewCase(c, empcode, caseId, { lock: true });
  if (!actions.can_rate) throw new AppraisalError("This case is not waiting for your rating", 403);
  for (const x of body.competencies ?? []) {
    await c.execute(
      `UPDATE HR_PROMO_COMPETENCY SET MGR_RATING = :r, MGR_COMMENT = :cm WHERE CASE_ID = :id AND COMPETENCY_ID = :cid`,
      { r: RATING5(x.mgr_rating), cm: s(x.mgr_comment).slice(0, 1000) || null, id: caseId, cid: num(x.competency_id) },
    );
  }
  const res = await recomputeCase(c, caseId);
  if (submit) {
    const missing = (await loadCompetencies(c, caseId)).filter((x) => x.mgr_rating === null).length;
    if (missing) throw new AppraisalError(`Rate every competency first (${missing} missing)`);
    await setStatus(c, cs, "HR_REVIEW", me.empcode, ", MGR_RATED_BY = :rb, MGR_RATED_AT = SYSDATE", { rb: me.empcode });
    return { case_id: caseId, status: "HR_REVIEW" };
  }
  return res;
});

/** RM / HOD independent recommendation (sheet 5). */
export const reviewSignoff = (empcode, caseId, { role, decision, remarks }) => withTx(async (c) => {
  const { cs, me, actions } = await reviewCase(c, empcode, caseId, { lock: true });
  if (!actions.can_signoff.includes(role)) throw new AppraisalError("Your recommendation is not due on this case", 403);
  await signoff(c, cs, role, { actor: me.empcode, name: me.name }, decision, remarks);
  return { case_id: caseId, status: await advanceSignoff(c, cs, me.empcode) };
});

/** HOD / HOU decision; approve sends it to the CEO. */
export const reviewHodFinal = (empcode, caseId, { decision, remarks }) => withTx(async (c) => {
  const { cs, me, actions } = await reviewCase(c, empcode, caseId, { lock: true });
  if (!actions.can_hod_final) throw new AppraisalError("This case is not waiting for your decision", 403);
  if (decision !== "APPROVE" && !s(remarks)) throw new AppraisalError("Please give a reason");
  await signoff(c, cs, "HOD_FINAL", { actor: me.empcode, name: me.name }, decision, remarks);
  if (decision === "APPROVE") {
    await setStatus(c, cs, "CEO_FINAL", me.empcode);
    return { case_id: caseId, status: "CEO_FINAL" };
  }
  await setStatus(c, cs, "REJECTED", me.empcode, ", DECIDED_AT = SYSDATE");
  await rejectRecommendation(c, cs);
  return { case_id: caseId, status: "REJECTED" };
});

/** CEO decision: approve with the final designation / grade / package / effective date, or reject. */
const ceoDecide = async (c, cs, who, body) => {
  const decision = body.decision;
  if (decision !== "APPROVE" && !s(body.remarks)) throw new AppraisalError("Please give a reason");
  await signoff(c, cs, "CEO", who, decision, body.remarks);
  if (decision !== "APPROVE") {
    await setStatus(c, cs, "REJECTED", who.actor, ", DECIDED_AT = SYSDATE");
    await rejectRecommendation(c, cs);
    return { case_id: cs.case_id, status: "REJECTED" };
  }
  const desg = s(body.final_desg_cd) || cs.prop_desg_cd;
  if (!desg) throw new AppraisalError("Choose the new designation");
  const d = await c.execute(`SELECT 1 FROM HR_DESG WHERE TO_CHAR(DESG_CD) = :d AND COMPC = :compc`, { d: desg, compc: cs.compc }, { outFormat: OUT_ARRAY });
  if (!d.rows?.length) throw new AppraisalError("The new designation does not exist for this company");
  if (!body.effective_date) throw new AppraisalError("Give the effective date");
  const grade = s(body.final_grade_cd) || cs.prop_grade_cd || null;
  await setStatus(c, cs, "APPROVED", who.actor,
    `, DECIDED_AT = SYSDATE, FINAL_DESG_CD = :fd, FINAL_GRADE_CD = :fg, NEW_PACKAGE = :pk, EFFECTIVE_DATE = TO_DATE(:ed,'YYYY-MM-DD')`,
    { fd: desg, fg: grade, pk: s(body.new_package).slice(0, 200) || null, ed: body.effective_date });
  // Ready for HR to apply in "Increments & Promotions".
  await c.execute(
    `UPDATE HR_PROMOTION_RECOMMENDATION SET STATUS = 'APPROVED', PROP_DESG_CD = :fd, PROP_GRADE_CD = :fg,
            EFFECTIVE_DATE = TO_DATE(:ed,'YYYY-MM-DD'), UPDATED_AT = SYSDATE
      WHERE APPRAISAL_ID = :id AND STATUS = 'PROPOSED'`,
    { fd: desg, fg: grade, ed: body.effective_date, id: cs.appraisal_id },
  );
  return { case_id: cs.case_id, status: "APPROVED" };
};

export const reviewCeoFinal = (empcode, caseId, body) => withTx(async (c) => {
  const { cs, me, actions } = await reviewCase(c, empcode, caseId, { lock: true });
  if (!actions.can_ceo_final) throw new AppraisalError("This case is not waiting for your decision", 403);
  return ceoDecide(c, cs, { actor: me.empcode, name: me.name }, body);
});
