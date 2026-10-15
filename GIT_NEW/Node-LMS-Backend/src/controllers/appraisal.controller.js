/**
 * Performance Appraisal controllers (DCL process).
 *
 * HR handlers run behind requireHrAdmin and resolve the company through
 * resolveCompany, so an admin only ever sees companies within their rights.
 * Employee / reviewer handlers run behind requireEmployee: the card is always
 * the bearer token's own, resolved to its EMPCODE here.
 */

import { resolveCompany, resolveBranch } from "../utils/payrollShared.js";
import { resolveEmpcode } from "../services/appraisalShared.service.js";
import * as master from "../services/appraisalMaster.service.js";
import * as cycles from "../services/appraisalCycle.service.js";
import * as flow from "../services/appraisalWorkflow.service.js";
import * as promo from "../services/appraisalPromotion.service.js";
import * as apply from "../services/appraisalApply.service.js";
import * as reports from "../services/appraisalReports.service.js";
import { listDepartments, listEmployees as listTrainingEmployees, listCourses } from "../services/trainingMaster.service.js";

const v = (res) => res.locals.validated;

/** Wrap an HR handler: fn({ compc, actor, branch, q, params, body }) → JSON. */
const hr = (fn) => async (req, res, next) => {
  try {
    const { query, params = {}, body = {} } = v(res);
    const compc = await resolveCompany(query.admin_card_no, query.compc);
    const branch = query.brnch ? await resolveBranch(query.admin_card_no, query.compc, query.brnch) : null;
    res.setHeader("Cache-Control", "private, no-store");
    const out = await fn({ compc, actor: query.admin_card_no, branch, q: query, params, body }, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (err) {
    next(err);
  }
};

/** Wrap an employee / reviewer handler: fn({ empcode, params, body }) → JSON. */
const me = (fn) => async (req, res, next) => {
  try {
    const { params = {}, body = {} } = v(res);
    const empcode = await resolveEmpcode(res.locals.employee?.card_no ?? params.card_no);
    res.setHeader("Cache-Control", "private, no-store");
    const out = await fn({ empcode, params, body }, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (err) {
    next(err);
  }
};

const sendFile = (res, { abs, name }) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.download(abs, name);
};

const items = (p) => p.then((x) => ({ items: x }));

// ── HR: setup ──────────────────────────────────────────────────────────────
export const listCompetencies = hr(({ compc }) => master.listCompetencies(compc));
export const createCompetency = hr(({ compc, actor, body }) => master.saveCompetency(compc, actor, null, body));
export const updateCompetency = hr(({ compc, actor, params, body }) => master.saveCompetency(compc, actor, params.item_id, body));
export const deleteCompetency = hr(({ compc, params }) => master.deleteCompetency(compc, params.item_id));
export const loadDclCompetencies = hr(({ compc, actor }) => master.loadDclCompetencies(compc, actor));

export const getScale = hr(({ compc }) => items(master.getScale(compc)));
export const saveScale = hr(({ compc, actor, body }) => master.saveScale(compc, actor, body.bands));
export const resetScale = hr(({ compc, actor }) => master.resetScale(compc, actor));

export const getPromoSetup = hr(({ compc }) => master.getPromotionSetup(compc));
export const savePromoSetup = hr(({ compc, actor, body }) => master.savePromotionSetup(compc, actor, body));
export const resetPromoSetup = hr(({ compc, actor }) => master.resetPromotionBands(compc, actor));

export const listMgmt = hr(({ compc }) => items(master.listMgmtApprovers(compc)));
export const addMgmt = hr(({ compc, actor, body }) => master.addMgmtApprover(compc, actor, body.empcode));
export const setMgmt = hr(({ compc, actor, params, body }) => master.setMgmtApprover(compc, actor, params.approver_id, body.is_active));
export const deleteMgmt = hr(({ compc, actor, params }) => master.deleteMgmtApprover(compc, actor, params.approver_id));

export const lookups = hr(async ({ compc }) => ({
  departments: await listDepartments(compc),
  designations: await master.listDesignations(compc),
  ...(await master.listFilterValues(compc)),
  periods: await master.listPeriods(compc),
  courses: await listCourses(compc, { activeOnly: true }),
}));
export const listEmployees = hr(({ compc, branch, q }) => items(listTrainingEmployees(compc, { branch, dept: q.dept })));

// ── HR: cycles ─────────────────────────────────────────────────────────────
export const listCycles = hr(({ compc }) => items(cycles.listCycles(compc)));
export const getCycle = hr(({ compc, params }) => cycles.getCycle(compc, params.cycle_id));
export const createCycle = hr(({ compc, actor, body }) => cycles.saveCycle(compc, actor, null, body));
export const updateCycle = hr(({ compc, actor, params, body }) => cycles.saveCycle(compc, actor, params.cycle_id, body));
export const deleteCycle = hr(({ compc, actor, params }) => cycles.deleteCycle(compc, actor, params.cycle_id));
export const setCycleStatus = hr(({ compc, actor, params, body }) => cycles.setCycleStatus(compc, actor, params.cycle_id, body.status));
export const setCyclePhase = hr(({ compc, actor, params, body }) => cycles.setCyclePhase(compc, actor, params.cycle_id, body.phase));
export const createCycleGoal = hr(({ compc, actor, params, body }) => cycles.saveCycleGoal(compc, actor, params.cycle_id, null, body));
export const updateCycleGoal = hr(({ compc, actor, params, body }) => cycles.saveCycleGoal(compc, actor, params.cycle_id, params.goal_id, body));
export const deleteCycleGoal = hr(({ compc, params }) => cycles.deleteCycleGoal(compc, params.cycle_id, params.goal_id));
export const previewLaunch = hr(({ compc, params, body }) => cycles.previewLaunch(compc, params.cycle_id, body));
export const launchCycle = hr(({ compc, actor, params, body }) => cycles.launchCycle(compc, actor, params.cycle_id, body));
export const bellCurve = hr(({ compc, params, q }) => flow.bellCurve(compc, params.cycle_id, { dept: q.dept }));
export const bulkApprove = hr(({ compc, actor, params, body }) => flow.hrBulkApprove(compc, actor, params.cycle_id, body.ids));

// ── HR: appraisals ─────────────────────────────────────────────────────────
export const hrList = hr(({ compc, q }) => items(flow.hrList(compc, q)));
export const hrGet = hr(({ compc, params }) => flow.hrGet(compc, params.appraisal_id));
export const hrEvidence = hr(async ({ compc, params }, res) => {
  sendFile(res, await flow.hrEvidenceFile(compc, params.appraisal_id, params.att_id));
});
export const hrCreateRow = hr(({ compc, actor, params, body }) => flow.hrSaveRow(compc, actor, params.appraisal_id, null, body));
export const hrUpdateRow = hr(({ compc, actor, params, body }) => flow.hrSaveRow(compc, actor, params.appraisal_id, params.goal_id, body));
export const hrDeleteRow = hr(({ compc, actor, params }) => flow.hrDeleteRow(compc, actor, params.appraisal_id, params.goal_id));
export const hrAdjust = hr(({ compc, actor, params, body }) => flow.hrAdjust(compc, actor, params.appraisal_id, body));
export const hrRecommendations = hr(({ compc, actor, params, body }) => flow.hrSaveRecommendations(compc, actor, params.appraisal_id, body));
export const hrDecide = hr(({ compc, actor, params, body }) => flow.hrDecide(compc, actor, params.appraisal_id, body));
export const hrReassign = hr(({ compc, actor, params, body }) => flow.hrReassign(compc, actor, params.appraisal_id, body));
export const hrCancel = hr(({ compc, actor, params, body }) => flow.hrCancel(compc, actor, params.appraisal_id, body.remarks));

// ── HR: promotion evaluation ───────────────────────────────────────────────
export const hrCases = hr(({ compc, q }) => items(promo.hrListCases(compc, q)));
export const hrCase = hr(({ compc, params }) => promo.hrGetCase(compc, params.case_id));
export const hrEligibility = hr(({ compc, actor, params, body }) => promo.hrSaveEligibility(compc, actor, params.case_id, body));
export const hrSubmitEligibility = hr(({ compc, actor, params }) => promo.hrSubmitEligibility(compc, actor, params.case_id));
export const hrHistory = hr(({ compc, actor, params, body }) => promo.hrSaveHistory(compc, actor, params.case_id, body.rows));
export const hrScorecard = hr(({ compc, actor, params, body }) => promo.hrSaveScorecard(compc, actor, params.case_id, body));
export const hrSubmitReview = hr(({ compc, actor, params }) => promo.hrSubmitReview(compc, actor, params.case_id));
export const hrCaseSignoff = hr(({ compc, actor, params, body }) => promo.hrSignoff(compc, actor, params.case_id, body));
export const hrCeoDecision = hr(({ compc, actor, params, body }) => promo.hrRecordCeoDecision(compc, actor, params.case_id, body));
export const hrCancelCase = hr(({ compc, actor, params, body }) => promo.hrCancelCase(compc, actor, params.case_id, body.remarks));

// ── HR: recommendations ────────────────────────────────────────────────────
export const listRecommendations = hr(({ compc, q }) => items(apply.listRecommendations(compc, q)));
export const applyIncrement = hr(({ compc, actor, params, body }) => apply.applyIncrement(compc, actor, params.rec_id, body));
export const applyPromotion = hr(({ compc, actor, params, body }) => apply.applyPromotion(compc, actor, params.rec_id, body));
export const rejectRecommendation = hr(({ compc, actor, params, body }) =>
  apply.rejectRecommendation(compc, actor, params.kind, params.rec_id, body.remarks));

// ── HR: dashboard / reports / summary sheet ────────────────────────────────
export const dashboard = hr(({ compc, q }) => reports.dashboard(compc, q.cycle_id));
export const reportTypes = hr(() => ({ items: Object.entries(reports.REPORTS).map(([type, title]) => ({ type, title })) }));
export const runReport = hr(({ compc, params, q }) => reports.runReport(compc, params.type, q));
export const summarySheet = hr(({ compc, q }) => reports.summarySheet(compc, q.cycle_id, q.dept));
export const saveProfile = hr(({ compc, actor, params, body }) => reports.saveProfile(compc, actor, params.empcode, body));

// ── Employee ───────────────────────────────────────────────────────────────
export const myList = me(({ empcode }) => items(flow.myAppraisals(empcode)));
export const myHistory = me(({ empcode }) => flow.myHistory(empcode));
export const myGet = me(({ empcode, params }) => flow.myAppraisal(empcode, params.appraisal_id));
export const myCreateRow = me(({ empcode, params, body }) => flow.saveMyRow(empcode, params.appraisal_id, null, body));
export const myUpdateRow = me(({ empcode, params, body }) => flow.saveMyRow(empcode, params.appraisal_id, params.goal_id, body));
export const myDeleteRow = me(({ empcode, params }) => flow.deleteMyRow(empcode, params.appraisal_id, params.goal_id));
export const mySubmitObjectives = me(({ empcode, params, body }) => flow.submitMyObjectives(empcode, params.appraisal_id, body?.remarks));
export const mySaveMidYear = me(({ empcode, params, body }) => flow.saveMyMidYear(empcode, params.appraisal_id, body));
export const mySubmitMidYear = me(({ empcode, params, body }) => flow.submitMyMidYear(empcode, params.appraisal_id, body?.remarks));
export const myAcknowledge = me(({ empcode, params, body }) => flow.acknowledge(empcode, params.appraisal_id, body?.comment));
export const myUploadEvidence = me(({ empcode, params, body }, res) =>
  flow.addMyEvidence(empcode, params.appraisal_id, res.req.file, body?.emp_goal_id ?? null));
export const myDeleteEvidence = me(({ empcode, params }) => flow.deleteMyEvidence(empcode, params.appraisal_id, params.att_id));
export const myEvidence = me(async ({ empcode, params }, res) => {
  sendFile(res, await flow.myEvidenceFile(empcode, params.appraisal_id, params.att_id));
});
export const myCases = me(({ empcode }) => items(promo.myCases(empcode)));
export const myCase = me(({ empcode, params }) => promo.myCase(empcode, params.case_id));
export const mySaveSelfAssessment = me(({ empcode, params, body }) => promo.saveMySelfAssessment(empcode, params.case_id, body));
export const mySubmitSelfAssessment = me(({ empcode, params }) => promo.submitMySelfAssessment(empcode, params.case_id));

// ── Reviewer ───────────────────────────────────────────────────────────────
export const reviewInbox = me(async ({ empcode }) => {
  const inbox = await flow.reviewInbox(empcode);
  const cases = await promo.reviewCases(empcode);
  return {
    ...inbox,
    is_reviewer: inbox.is_reviewer || cases.items.length > 0,
    pending: inbox.pending + cases.pending,
    appraisal_pending: inbox.pending,
    cases: cases.items,
    case_pending: cases.pending,
  };
});
export const reviewGet = me(({ empcode, params }) => flow.reviewGet(empcode, params.appraisal_id));
export const reviewCreateRow = me(({ empcode, params, body }) => flow.reviewSaveRow(empcode, params.appraisal_id, null, body));
export const reviewUpdateRow = me(({ empcode, params, body }) => flow.reviewSaveRow(empcode, params.appraisal_id, params.goal_id, body));
export const reviewDeleteRow = me(({ empcode, params }) => flow.reviewDeleteRow(empcode, params.appraisal_id, params.goal_id));
export const reviewRatings = me(({ empcode, params, body }) => flow.reviewSaveRatings(empcode, params.appraisal_id, body));
export const reviewRecommendations = me(({ empcode, params, body }) => flow.reviewSaveRecommendations(empcode, params.appraisal_id, body));
export const reviewDecide = me(({ empcode, params, body }) => flow.reviewDecide(empcode, params.appraisal_id, body));
export const reviewEvidence = me(async ({ empcode, params }, res) => {
  sendFile(res, await flow.reviewEvidenceFile(empcode, params.appraisal_id, params.att_id));
});
// Courses / designations a reviewer can pick for recommendations (their appraisee's company).
export const reviewLookups = me(async ({ empcode, params }) => {
  const a = await flow.reviewGet(empcode, params.appraisal_id);
  return {
    designations: await master.listDesignations(a.compc),
    courses: await listCourses(a.compc, { activeOnly: true }),
  };
});
export const reviewCase = me(({ empcode, params }) => promo.reviewGetCase(empcode, params.case_id));
export const reviewCaseLookups = me(async ({ empcode, params }) => {
  const cs = await promo.reviewGetCase(empcode, params.case_id);
  return { designations: await master.listDesignations(cs.compc) };
});
export const reviewRateCase = me(({ empcode, params, body }) => promo.reviewRateCompetencies(empcode, params.case_id, body, !!body.submit));
export const reviewCaseSignoff = me(({ empcode, params, body }) => promo.reviewSignoff(empcode, params.case_id, body));
export const reviewHodFinal = me(({ empcode, params, body }) => promo.reviewHodFinal(empcode, params.case_id, body));
export const reviewCeoFinal = me(({ empcode, params, body }) => promo.reviewCeoFinal(empcode, params.case_id, body));
