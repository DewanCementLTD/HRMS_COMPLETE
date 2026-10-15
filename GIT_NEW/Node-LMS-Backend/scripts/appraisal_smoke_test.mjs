// End-to-end smoke test of the Performance Appraisal module (DCL process) against
// the real database. Runs one full cycle through the service layer:
//   setup → cycle → launch → objectives (return + approve, locked) → mid-year phase →
//   self review → line manager sign-off (HY locked) → year-end phase → HOD agreed
//   ratings + promotion / increment / training → HR grade normalisation + finalise
//   → employee acknowledgement → promotion sheets 1–5 → HOD + CEO decision →
//   apply increment + promotion → summary sheet / reports
// then restores the employee's pay / designation and the company's competency
// master exactly, and deletes every row it created (even when a step fails).
//   cd Node-LMS-Backend && node scripts/appraisal_smoke_test.mjs
import 'dotenv/config';
import { getDirectConnection } from '../src/config/database.js';
import * as master from '../src/services/appraisalMaster.service.js';
import * as cycles from '../src/services/appraisalCycle.service.js';
import * as flow from '../src/services/appraisalWorkflow.service.js';
import * as promo from '../src/services/appraisalPromotion.service.js';
import * as apply from '../src/services/appraisalApply.service.js';
import * as reports from '../src/services/appraisalReports.service.js';
import * as trainingMaster from '../src/services/trainingMaster.service.js';

const ACTOR = 'SMOKE';
const created = { cycles: [], mgmt: [], courses: [], docs: [] };
let people = null;      // { compc, emp, rpt, hod, mgmt, emp2 }
let snapshot = null;    // employee pay/designation before the test
let compSnapshot = null; // the company's competency master before the test
let scaleWasEmpty = false;
let logStart = 0;
let tlogStart = 0;
let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  — ${extra}` : ''}`);
  if (!cond) failures++;
};
const rejects = async (fn) => { try { await fn(); return false; } catch { return true; } };

const q = async (sql, binds = {}) => {
  const c = await getDirectConnection();
  try { return (await c.execute(sql, binds, { outFormat: 4001 })).rows ?? []; } finally { await c.close(); }
};
const KEY = (col) => `SUBSTR(REGEXP_REPLACE(TO_CHAR(${col}), '[^0-9]', ''), -10)`;

async function findPeople() {
  // Employee with a reporting officer and a different HOD1 (no HOD2), with pay on file,
  // no pending transfer (an HR_EMP_MASTER update would otherwise rewrite their roster).
  const r = await q(`
    SELECT m.EMPCODE, m.RPT_OFFICER, h.EMPCODE, m.UNIT_ID
      FROM HR_EMP_MASTER m
      JOIN EMPLOYEE e ON e.EMPCODE = m.EMPCODE
      JOIN HR_EMP_MASTER r ON r.EMPCODE = m.RPT_OFFICER AND NVL(r.STATUS,'A') = 'A' AND r.EMPCODE <> m.EMPCODE
      JOIN HR_EMP_MASTER h ON ${KEY('h."MOBILE#"')} = ${KEY('e.HOD1')} AND NVL(h.STATUS,'A') = 'A'
                          AND h.EMPCODE NOT IN (m.EMPCODE, r.EMPCODE)
     WHERE NVL(m.STATUS,'A') = 'A' AND e.HOD1 IS NOT NULL AND e.HOD2 IS NULL
       AND ${KEY('r."MOBILE#"')} <> ${KEY('e.HOD1')}
       AND m.GROSS > 0 AND m.OLD_EMPCODE IS NOT NULL AND m.TRANSFER_DATE IS NULL
       AND EXISTS (SELECT 1 FROM HR_DESG g WHERE TO_CHAR(g.DESG_CD) = m.DESG_CD AND g.COMPC = m.UNIT_ID)
       AND EXISTS (SELECT 1 FROM HR_EMP_ALLOW a WHERE a.OLD_EMPCODE = m.OLD_EMPCODE AND a.UNIT_ID = m.UNIT_ID)
     FETCH FIRST 1 ROWS ONLY`);
  if (!r[0]) return null;
  const [emp, rpt, hod, compc] = [String(r[0][0]), String(r[0][1]), String(r[0][2]), Number(r[0][3])];
  const r2 = await q(`
    SELECT m.EMPCODE FROM HR_EMP_MASTER m
     WHERE m.UNIT_ID = :u AND NVL(m.STATUS,'A') = 'A' AND m.EMPCODE NOT IN (:a, :b, :c)
     FETCH FIRST 1 ROWS ONLY`, { u: compc, a: emp, b: rpt, c: hod });
  // CEO (management approver): someone else in the company who is not already one.
  const r3 = await q(`
    SELECT m.EMPCODE FROM HR_EMP_MASTER m
     WHERE m.UNIT_ID = :u AND NVL(m.STATUS,'A') = 'A' AND m.EMPCODE NOT IN (:a, :b, :c, :d)
       AND NOT EXISTS (SELECT 1 FROM HR_APPR_MGMT_APPROVER g WHERE g.EMPCODE = m.EMPCODE)
     FETCH FIRST 1 ROWS ONLY`, { u: compc, a: emp, b: rpt, c: hod, d: r2[0]?.[0] ?? '-' });
  if (!r2[0] || !r3[0]) return null;
  return { compc, emp, rpt, hod, emp2: String(r2[0][0]), mgmt: String(r3[0][0]) };
}

async function takeSnapshot(empcode) {
  const m = (await q(`SELECT OLD_EMPCODE, UNIT_ID, GROSS, BASIC, DESG_CD, GRADE_CD, LAST_INC_DT, LAST_PROM_DT FROM HR_EMP_MASTER WHERE EMPCODE = :e`, { e: empcode }))[0];
  const [oe, u] = [m[0], m[1]];
  return {
    empcode, oe, u, gross: m[2], basic: m[3], desg: m[4], grade: m[5], incDt: m[6], promDt: m[7],
    allow: await q(`SELECT EMPCODE, ALLOWANCE_ID, AMOUNT, PROC_FLAG, USR_ID_UPD, USR_DATE_UPD, OLD_EMPCODE, INC_DATE, ACT_GRS, UNIT_ID
                      FROM HR_EMP_ALLOW WHERE OLD_EMPCODE = :oe AND UNIT_ID = :u ORDER BY ALLOWANCE_ID`, { oe, u }),
    sal: await q(`SELECT UNIT_ID, OLD_EMPCODE, GROSS, BASIC, "PERIOD#" FROM HR_EMP_MASTER_SAL WHERE OLD_EMPCODE = :oe AND UNIT_ID = :u ORDER BY "PERIOD#", GROSS`, { oe, u }),
  };
}

async function restoreSnapshot(c, sn) {
  // GROSS first (its triggers rebuild allowances / salary snapshot), then the rest,
  // then put the original allowance and salary-snapshot rows back exactly.
  await c.execute(`UPDATE HR_EMP_MASTER SET GROSS = :g WHERE EMPCODE = :e`, { g: sn.gross, e: sn.empcode });
  await c.execute(
    `UPDATE HR_EMP_MASTER SET BASIC = :b, DESG_CD = :d, GRADE_CD = :gr, LAST_INC_DT = :li, LAST_PROM_DT = :lp WHERE EMPCODE = :e`,
    { b: sn.basic, d: sn.desg, gr: sn.grade, li: sn.incDt, lp: sn.promDt, e: sn.empcode },
  );
  await c.execute(`DELETE FROM HR_EMP_ALLOW WHERE OLD_EMPCODE = :oe AND UNIT_ID = :u`, { oe: sn.oe, u: sn.u });
  for (const a of sn.allow) {
    await c.execute(
      `INSERT INTO HR_EMP_ALLOW (EMPCODE, ALLOWANCE_ID, AMOUNT, PROC_FLAG, USR_ID_UPD, USR_DATE_UPD, OLD_EMPCODE, INC_DATE, ACT_GRS, UNIT_ID)
       VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10)`, a);
  }
  await c.execute(`DELETE FROM HR_EMP_MASTER_SAL WHERE OLD_EMPCODE = :oe AND UNIT_ID = :u`, { oe: sn.oe, u: sn.u });
  for (const r of sn.sal) {
    await c.execute(`INSERT INTO HR_EMP_MASTER_SAL (UNIT_ID, OLD_EMPCODE, GROSS, BASIC, "PERIOD#") VALUES (:1, :2, :3, :4, :5)`, r);
  }
}

const COMP_SQL = `SELECT COMPETENCY_ID, NAME, DESCRIPTION, WEIGHT_PCT, SEQ, IS_ACTIVE FROM HR_COMPETENCY_MASTER WHERE COMPC = :c ORDER BY COMPETENCY_ID`;

async function main() {
  people = await findPeople();
  if (!people) { check('found test employees (RPT + HOD + pay on file)', false); return; }
  const { compc, emp, rpt, hod, emp2, mgmt } = people;
  console.log(`company ${compc}: employee ${emp}, reporting officer ${rpt}, HOD ${hod}, 2nd employee ${emp2}, CEO ${mgmt}`);
  snapshot = await takeSnapshot(emp);
  compSnapshot = await q(COMP_SQL, { c: compc });
  scaleWasEmpty = !(await q(`SELECT 1 FROM HR_APPR_RATING_SCALE WHERE COMPC = :c`, { c: compc })).length;
  logStart = Number((await q(`SELECT NVL(MAX(LOG_ID),0) FROM HR_APPRAISAL_LOG`))[0][0]);
  tlogStart = Number((await q(`SELECT NVL(MAX(LOG_ID),0) FROM HR_TRAINING_LOG`))[0][0]);

  // ── Setup ──
  const scale = await master.getScale(compc);
  check('grade scale is A+ / A / B / C / D', scale.map((b) => b.label).join(',') === 'A+,A,B,C,D', scale.map((b) => `${b.label} ${b.min_score}`).join(', '));
  check('a scale that does not reach 5 is refused', await rejects(() => master.saveScale(compc, ACTOR, [
    { label: 'A', min_score: 3, max_score: 4 }, { label: 'B', min_score: 0, max_score: 2.99 }])));
  const loaded = await master.loadDclCompetencies(compc, ACTOR);
  const comps = await master.listCompetencies(compc);
  check('DCL competencies loaded, active weights total 100%', comps.active_weight === 100 && comps.items.filter((i) => i.is_active).length === 10,
    `added ${loaded.added}, deactivated ${loaded.deactivated}`);
  const setup = await master.getPromotionSetup(compc);
  check('promotion setup defaults to 50/50 and 4 decision bands', setup.settings.comp_weight_pct === 50 && setup.bands.length === 4);
  created.mgmt.push((await master.addMgmtApprover(compc, ACTOR, mgmt)).approver_id);
  const course = await trainingMaster.saveCourse(compc, ACTOR, null, {
    title: 'SMOKE Appraisal course', training_type: 'SOFT_SKILL', default_mode: 'PHYSICAL', is_active: true,
  });
  created.courses.push(course.course_id);

  // ── Cycle + launch ──
  const cyc = await cycles.saveCycle(compc, ACTOR, null, { name: 'SMOKE Annual', cycle_type: 'ANNUAL', period_from: '2026-07-01', period_to: '2027-06-30' });
  created.cycles.push(cyc.cycle_id);
  check('a corporate goal over 40% is refused', await rejects(() => cycles.saveCycleGoal(compc, ACTOR, cyc.cycle_id, null, {
    level_type: 'CORPORATE', objective: 'too big', weightage: 50 })));
  await cycles.saveCycleGoal(compc, ACTOR, cyc.cycle_id, null, { level_type: 'CORPORATE', objective: 'SMOKE grow sales', kpi_text: 'Sales', weightage: 20 });
  const launch = await cycles.launchCycle(compc, ACTOR, cyc.cycle_id, { empcodes: [emp, emp2] });
  check('launch created 2 appraisals at objective setting', launch.created === 2, JSON.stringify(launch.skipped));
  const aid = (await flow.myAppraisals(emp)).find((x) => x.cycle.cycle_id === cyc.cycle_id)?.appraisal_id;
  const a2 = (await flow.myAppraisals(emp2)).find((x) => x.cycle.cycle_id === cyc.cycle_id)?.appraisal_id;
  let my = await flow.myAppraisal(emp, aid);
  check('employee sees the task sheet with the corporate row', my.stage === 'OBJ_SETTING' && my.rows.length === 1 && my.line_manager_role === 'RPT');

  // ── Objectives ──
  check('a row over 40% is refused', await rejects(() => flow.saveMyRow(emp, aid, null, { task: 'x', weightage: 45 })));
  const r1 = await flow.saveMyRow(emp, aid, null, {
    accountability: 'Production', task: 'Increase clinker output', kpi: 'Tonnes / day', success_criteria: '5,500 TPD by Dec',
    interdependencies: 'Maintenance', weightage: 40,
  });
  check('submitting with 60% total is refused', await rejects(() => flow.submitMyObjectives(emp, aid)));
  await flow.saveMyRow(emp, aid, null, { accountability: 'Cost', task: 'Reduce power cost', kpi: 'kWh / t', weightage: 40 });
  await flow.submitMyObjectives(emp, aid, 'objectives ready');
  check('HOD cannot approve objectives (line manager is the reporting officer)', await rejects(() => flow.reviewDecide(hod, aid, { decision: 'approve' })));
  check('return needs a reason', await rejects(() => flow.reviewDecide(rpt, aid, { decision: 'return' })));
  await flow.reviewDecide(rpt, aid, { decision: 'return', remarks: 'make output measurable' });
  check('returned to the employee', (await flow.myAppraisal(emp, aid)).stage === 'OBJ_SETTING');
  await flow.saveMyRow(emp, aid, r1.emp_goal_id, {
    accountability: 'Production', task: 'Increase clinker output', kpi: 'Tonnes / day', success_criteria: '5,500 TPD by 31 Dec', weightage: 40,
  });
  await flow.submitMyObjectives(emp, aid);
  const ok1 = await flow.reviewDecide(rpt, aid, { decision: 'approve', remarks: 'agreed' });
  check('line manager approved → mid-year', ok1.stage === 'MIDYEAR', ok1.stage);
  check('objectives are permanently locked', await rejects(() => flow.saveMyRow(emp, aid, r1.emp_goal_id, { task: 'changed', weightage: 40 })));
  check('HR cannot edit locked objectives either', await rejects(() => flow.hrSaveRow(compc, ACTOR, aid, r1.emp_goal_id, { task: 'changed', weightage: 40 })));

  // ── Mid-year ──
  my = await flow.myAppraisal(emp, aid);
  const sr = { 0: 'A', 1: 'B', 2: 'A+' };
  const midBody = { rows: my.rows.map((x, i) => ({ emp_goal_id: x.emp_goal_id, midyear_progress: `progress ${i}`, self_rating: sr[i] })) };
  check('mid-year is closed until HR opens the phase', await rejects(() => flow.saveMyMidYear(emp, aid, midBody)));
  await cycles.setCyclePhase(compc, ACTOR, cyc.cycle_id, 'MIDYEAR');
  check('submitting without self ratings is refused', await rejects(() => flow.submitMyMidYear(emp, aid)));
  await flow.saveMyMidYear(emp, aid, midBody);
  await flow.submitMyMidYear(emp, aid);
  my = await flow.myAppraisal(emp, aid);
  // self: 20%×4 + 40%×3 + 40%×5 = 0.8 + 1.2 + 2.0 = 4.0
  check('self Total "A" computed', my.self_score === 4, String(my.self_score));
  const sign = await flow.reviewDecide(rpt, aid, { decision: 'approve', remarks: 'on track' });
  check('line manager signed the mid-year → HOD', sign.stage === 'HOD1', sign.stage);
  check('the half-year review is locked', await rejects(() => flow.saveMyMidYear(emp, aid, midBody)));

  // ── Year end ──
  let rv = await flow.reviewGet(hod, aid);
  const agreed = { rows: rv.rows.map((x, i) => ({ emp_goal_id: x.emp_goal_id, agreed_rating: ['A', 'B', 'A'][i], reviewer_remarks: 'ok' })) };
  check('HOD cannot rate before the year-end phase', await rejects(() => flow.reviewSaveRatings(hod, aid, agreed)));
  await cycles.setCyclePhase(compc, ACTOR, cyc.cycle_id, 'YEAREND');
  check('the HOD cannot return (mid-year is locked)', await rejects(() => flow.reviewDecide(hod, aid, { decision: 'return', remarks: 'x' })));
  check('approving without ratings is refused', await rejects(() => flow.reviewDecide(hod, aid, { decision: 'approve' })));
  const scored = await flow.reviewSaveRatings(hod, aid, agreed);
  // agreed: 20%×4 + 40%×3 + 40%×4 = 0.8 + 1.2 + 1.6 = 3.6 → A
  check('Total "A" = 3.60 → grade A', scored.calc_score === 3.6 && scored.final_rating === 'A', `${scored.calc_score} ${scored.final_rating}`);
  const otherDesg = (await master.listDesignations(compc)).find((d) => d.desg_cd !== snapshot.desg);
  await flow.reviewSaveRecommendations(hod, aid, {
    promotion: { prop_desg_cd: otherDesg.desg_cd, justification: 'SMOKE' },
    increment: { inc_pct: 10 },
    trainings: [{ area: 'Communication', course_id: course.course_id }],
  });
  const h1 = await flow.reviewDecide(hod, aid, { decision: 'approve' });
  check('HOD approved → HR (no HOD2)', h1.stage === 'HR', h1.stage);
  check('employee does not see the agreed rating yet', (await flow.myAppraisal(emp, aid)).rows.every((x) => x.agreed_rating === null));

  // ── HR ──
  check('a grade change needs a reason', await rejects(() => flow.hrAdjust(compc, ACTOR, aid, { grade: 'B' })));
  await flow.hrAdjust(compc, ACTOR, aid, { grade: 'B', reason: 'SMOKE bell curve' });
  let hrv = await flow.hrGet(compc, aid);
  check('HR normalised the grade to B, HOD grade kept as A', hrv.final_rating === 'B' && hrv.hod_grade === 'A', `${hrv.final_rating} / ${hrv.hod_grade}`);
  const bc = await flow.bellCurve(compc, cyc.cycle_id);
  check('bell curve shows actual B and HOD recommendation A', bc.bands.find((b) => b.label === 'B')?.count === 1 && bc.bands.find((b) => b.label === 'A')?.hod_count === 1);
  const fin = await flow.hrDecide(compc, ACTOR, aid, { decision: 'approve', remarks: 'final' });
  check('HR finalised → completed (rating locked)', fin.stage === 'COMPLETED', fin.stage);
  check('a completed appraisal cannot be adjusted', await rejects(() => flow.hrAdjust(compc, ACTOR, aid, { grade: 'A', reason: 'x' })));

  my = await flow.myAppraisal(emp, aid);
  check('employee now sees grade B and the agreed ratings', my.final_rating === 'B' && my.rows.every((x) => x.agreed_rating));
  check('employee never sees pay recommendations or the HOD grade', my.increment === undefined && my.promotion === undefined && my.hod_grade === undefined);
  await flow.acknowledge(emp, aid, 'Agreed');
  check('employee acknowledged (final sign-off)', !!(await flow.myAppraisal(emp, aid)).emp_ack_at);
  const treq = await q(`SELECT STATUS, SOURCE FROM HR_TRAINING_REQUEST WHERE APPRAISAL_ID = :a`, { a: aid });
  check('recommended course became a training request for HR', treq.length === 1 && treq[0][0] === 'PENDING_HR');
  const hist = await flow.myHistory(emp);
  check('performance history written', hist.history.some((h) => h.appraisal_id === aid && h.final_rating === 'B'));

  // ── Promotion evaluation ──
  const cases = await promo.hrListCases(compc, { cycle_id: cyc.cycle_id });
  const caseId = cases[0]?.case_id;
  check('promotion case opened at sheet 1 (eligibility)', cases.length === 1 && cases[0].status === 'ELIGIBILITY');
  let cs = await promo.hrGetCase(compc, caseId);
  check('case has 7 gates, 10 competencies and a prefilled history row', cs.eligibility.length === 7 && cs.competencies.length === 10 && cs.history[0].rating_pct === 72,
    `history ${cs.history[0].rating_pct}`);
  check('submitting an incomplete gate is refused', await rejects(() => promo.hrSubmitEligibility(compc, ACTOR, caseId)));
  await promo.hrSaveEligibility(compc, ACTOR, caseId, { answers: cs.eligibility.map((e) => ({ criterion: e.code, status: 'Y', remarks: 'ok' })) });
  check('eligibility submitted → employee self-assessment', (await promo.hrSubmitEligibility(compc, ACTOR, caseId)).status === 'COMPETENCY');

  const myCase = await promo.myCase(emp, caseId);
  check('employee sees their self-assessment but not the scorecard', myCase.can_self_assess && myCase.overall_score === undefined);
  check('submitting unrated is refused', await rejects(() => promo.submitMySelfAssessment(emp, caseId)));
  await promo.saveMySelfAssessment(emp, caseId, {
    competencies: myCase.competencies.map((x) => ({ competency_id: x.competency_id, self_rating: 5, evidence: 'example' })),
    emp_comments: 'ready', tech_trainings: 'Kiln operation', soft_trainings: 'Leadership',
  });
  check('self-assessment submitted → manager rating', (await promo.submitMySelfAssessment(emp, caseId)).status === 'MGR_RATING');

  const rmView = await promo.reviewGetCase(rpt, caseId);
  check('reporting manager is the competency rater', rmView.can_rate);
  check('the HOD is not the rater here', !(await promo.reviewGetCase(hod, caseId)).can_rate);
  await promo.reviewRateCompetencies(rpt, caseId, { competencies: rmView.competencies.map((x) => ({ competency_id: x.competency_id, mgr_rating: 4 })) }, true);
  cs = await promo.hrGetCase(compc, caseId);
  check('competency score 80% from the manager rating', cs.status === 'HR_REVIEW' && cs.comp_score === 80, `${cs.status} ${cs.comp_score}`);

  await promo.hrSaveHistory(compc, ACTOR, caseId, [
    { seq: 1, appraisal_year: '2026-27', rating_pct: 80, kpi_pct: 70 },
    { seq: 2, appraisal_year: '2025-26', rating_pct: 90, kpi_pct: 80 },
    { seq: 3, appraisal_year: '2024-25', rating_pct: 70, kpi_pct: null },
  ]);
  check('submitting without the HR recommendation is refused', await rejects(() => promo.hrSubmitReview(compc, ACTOR, caseId)));
  await promo.hrSaveScorecard(compc, ACTOR, caseId, { hr_recommendation: 'Promote with development plan', rationale: 'SMOKE', gap_areas: 'Leadership' });
  cs = await promo.hrGetCase(compc, caseId);
  // perf = avg(80, 75) = 77.5; overall = (80 + 77.5) / 2 = 78.75 → Promote with Development Plan
  check('scorecard: performance 77.5, overall 78.75, band Promote with Development Plan',
    cs.perf_score === 77.5 && cs.overall_score === 78.75 && cs.decision_outcome === 'PROMOTE_DEV', `${cs.perf_score} ${cs.overall_score} ${cs.decision_band}`);
  check('HR review submitted → sign-off', (await promo.hrSubmitReview(compc, ACTOR, caseId)).status === 'SIGNOFF');

  await promo.reviewSignoff(rpt, caseId, { role: 'RM', decision: 'RECOMMEND', remarks: 'yes' });
  check('the RM cannot sign twice', await rejects(() => promo.reviewSignoff(rpt, caseId, { role: 'RM', decision: 'RECOMMEND' })));
  await promo.reviewSignoff(hod, caseId, { role: 'HOD', decision: 'RECOMMEND' });
  const afterHr = await promo.hrSignoff(compc, ACTOR, caseId, { decision: 'RECOMMEND' });
  check('all three recommendations → HOD decision', afterHr.status === 'HOD_FINAL', afterHr.status);
  check('the CEO cannot decide before the HOD', await rejects(() => promo.reviewCeoFinal(mgmt, caseId, { decision: 'APPROVE', effective_date: '2027-07-01' })));
  check('HOD approved → CEO', (await promo.reviewHodFinal(hod, caseId, { decision: 'APPROVE' })).status === 'CEO_FINAL');
  check('the CEO sees the case in the inbox', (await promo.reviewCases(mgmt)).items.some((i) => i.case_id === caseId && i.my_turn));
  check('HR cannot record the CEO decision when a CEO is set up', await rejects(() => promo.hrRecordCeoDecision(compc, ACTOR, caseId, { decision: 'APPROVE', effective_date: '2027-07-01' })));
  const ceo = await promo.reviewCeoFinal(mgmt, caseId, { decision: 'APPROVE', effective_date: '2027-07-01', new_package: 'SMOKE package' });
  check('CEO approved the promotion', ceo.status === 'APPROVED');

  // ── Apply ──
  const recs = await apply.listRecommendations(compc, { cycle_id: cyc.cycle_id });
  const inc = recs.find((r) => r.kind === 'INCREMENT');
  const pro = recs.find((r) => r.kind === 'PROMOTION');
  check('increment approved with the appraisal, promotion approved by the CEO', inc?.status === 'APPROVED' && pro?.status === 'APPROVED' && pro.effective_date === '2027-07-01');
  const expectInc = Math.round(Number(snapshot.gross) * 0.10);
  const ai = await apply.applyIncrement(compc, ACTOR, inc.rec_id, {});
  created.docs.push(ai.doc_no);
  const after = (await q(`SELECT m.GROSS, (SELECT SUM(AMOUNT) FROM HR_EMP_ALLOW a WHERE a.OLD_EMPCODE = m.OLD_EMPCODE AND a.UNIT_ID = m.UNIT_ID AND a.PROC_FLAG = 'Y')
                            FROM HR_EMP_MASTER m WHERE m.EMPCODE = :e`, { e: emp }))[0];
  check('increment applied; payroll allowances follow the new gross', Number(after[0]) === Number(snapshot.gross) + expectInc && Math.abs(Number(after[1]) - Number(after[0])) < 1,
    `${snapshot.gross} → ${after[0]}`);
  await apply.applyPromotion(compc, ACTOR, pro.rec_id, {});
  const desgNow = (await q(`SELECT DESG_CD, TO_CHAR(LAST_PROM_DT,'YYYY-MM-DD') FROM HR_EMP_MASTER WHERE EMPCODE = :e`, { e: emp }))[0];
  check('promotion applied with the CEO effective date', String(desgNow[0]) === otherDesg.desg_cd && desgNow[1] === '2027-07-01', `${desgNow[0]} ${desgNow[1]}`);

  // ── Second employee: no reporting officer → HOD is the line manager; then cancel ──
  await flow.hrReassign(compc, ACTOR, a2, { rpt_empcode: null, hod1_empcode: hod, hod2_empcode: null });
  const v2 = await flow.hrGet(compc, a2);
  check('no reporting officer → HOD is the line manager and the year-end rater', v2.line_manager_role === 'HOD1' && v2.chain.join('>') === 'HOD1>HR', v2.chain.join('>'));
  await flow.hrCancel(compc, ACTOR, a2, 'SMOKE cleanup');

  // ── Summary sheet, dashboard, reports ──
  const sum = await reports.summarySheet(compc, String(cyc.cycle_id), null);
  const row = Object.values(sum.lists).flat().find((e) => e.empcode === emp);
  check('summary sheet lists the employee with grade B and promotion', row?.rating === 'B' && row.promotion.startsWith('Yes'), `${row?.category} ${row?.rating}`);
  check('summary sheet bell curve has 5 grades with standards', sum.bell.length === 5 && sum.bell.every((b) => b.target_pct !== null));
  await reports.saveProfile(compc, ACTOR, emp, { prior_exp_years: 3, remarks: 'SMOKE' });
  const sum2 = await reports.summarySheet(compc, String(cyc.cycle_id), null);
  const row2 = Object.values(sum2.lists).flat().find((e) => e.empcode === emp);
  check('prior experience adds to total experience', row2.prior_exp === 3 && row2.total_exp !== null && row2.total_exp >= 3);
  const dash = await reports.dashboard(compc, cyc.cycle_id);
  check('dashboard runs', dash.completed === 1 && dash.promotions_approved === 1, `completed ${dash.completed}`);
  for (const type of Object.keys(reports.REPORTS)) {
    const r = await reports.runReport(compc, type, { cycle_id: String(cyc.cycle_id), empcode: emp });
    check(`report ${type}`, Array.isArray(r.rows), `${r.rows.length} row(s)`);
  }
}

async function cleanup() {
  const c = await getDirectConnection();
  const del = async (sql, binds = {}) => { try { await c.execute(sql, binds); } catch (e) { console.log(`cleanup: ${e.message.split('\n')[0]}`); } };
  try {
    if (snapshot) await restoreSnapshot(c, snapshot);
    for (const cid of created.cycles) {
      const sub = `(SELECT APPRAISAL_ID FROM HR_APPRAISAL_MASTER WHERE CYCLE_ID = :c)`;
      const cases = `(SELECT CASE_ID FROM HR_PROMOTION_CASE WHERE APPRAISAL_ID IN ${sub})`;
      for (const t of ['HR_PROMO_ELIGIBILITY', 'HR_PROMO_COMPETENCY', 'HR_PROMO_HISTORY', 'HR_PROMO_SIGNOFF']) {
        await del(`DELETE FROM ${t} WHERE CASE_ID IN ${cases}`, { c: cid });
      }
      await del(`DELETE FROM HR_APPRAISAL_LOG WHERE ENTITY = 'PROMO_CASE' AND ENTITY_ID IN ${cases}`, { c: cid });
      await del(`DELETE FROM HR_PROMOTION_CASE WHERE APPRAISAL_ID IN ${sub}`, { c: cid });
      await del(`DELETE FROM HR_TRAINING_LOG WHERE ENTITY = 'REQUEST' AND ENTITY_ID IN (SELECT REQUEST_ID FROM HR_TRAINING_REQUEST WHERE APPRAISAL_ID IN ${sub})`, { c: cid });
      await del(`UPDATE HR_DEVELOPMENT_PLAN SET TRAINING_REQUEST_ID = NULL WHERE APPRAISAL_ID IN ${sub}`, { c: cid });
      await del(`DELETE FROM HR_TRAINING_REQUEST WHERE APPRAISAL_ID IN ${sub}`, { c: cid });
      for (const t of ['HR_APPRAISAL_APPROVAL', 'HR_APPRAISAL_COMMENT', 'HR_APPRAISAL_ATTACHMENT', 'HR_APPRAISAL_DETAIL', 'HR_EMPLOYEE_GOAL',
        'HR_DEVELOPMENT_PLAN', 'HR_PROMOTION_RECOMMENDATION', 'HR_INCREMENT_RECOMMENDATION', 'HR_PERFORMANCE_HISTORY']) {
        await del(`DELETE FROM ${t} WHERE APPRAISAL_ID IN ${sub}`, { c: cid });
      }
      await del(`DELETE FROM HR_APPRAISAL_MASTER WHERE CYCLE_ID = :c`, { c: cid });
      await del(`DELETE FROM HR_GOAL_MASTER WHERE CYCLE_ID = :c`, { c: cid });
      await del(`DELETE FROM HR_APPRAISAL_CYCLE WHERE CYCLE_ID = :c`, { c: cid });
    }
    for (const d of created.docs) {
      await del(`DELETE FROM HR_INCREMENT_HISTORY WHERE "DOC#" = :d`, { d });
      await del(`DELETE FROM HR_INCREMENT_HISTORY_MST WHERE "DOC#" = :d`, { d });
    }
    for (const id of created.mgmt) await del(`DELETE FROM HR_APPR_MGMT_APPROVER WHERE APPROVER_ID = :i`, { i: id });
    for (const id of created.courses) await del(`DELETE FROM HR_TRAINING_COURSE WHERE COURSE_ID = :i`, { i: id });
    if (people) {
      await del(`DELETE FROM HR_EMP_APPR_PROFILE WHERE EMPCODE = :e AND UPDATED_BY = :a`, { e: people.emp, a: ACTOR });
      if (scaleWasEmpty) await del(`DELETE FROM HR_APPR_RATING_SCALE WHERE COMPC = :c`, { c: people.compc });
      if (compSnapshot) {
        // Competency master back exactly as it was: drop the rows the test added, restore the rest.
        const keep = compSnapshot.map((x) => Number(x[0]));
        await del(`DELETE FROM HR_COMPETENCY_MASTER WHERE COMPC = :c AND COMPETENCY_ID NOT IN (${[...keep, -1].join(',')})`, { c: people.compc });
        for (const x of compSnapshot) {
          await del(`UPDATE HR_COMPETENCY_MASTER SET NAME = :n, DESCRIPTION = :d, WEIGHT_PCT = :w, SEQ = :s, IS_ACTIVE = :a WHERE COMPETENCY_ID = :i`,
            { n: x[1], d: x[2], w: x[3], s: x[4], a: x[5], i: x[0] });
        }
      }
      const actors = [ACTOR, people.emp, people.rpt, people.hod, people.mgmt, people.emp2];
      await del(`DELETE FROM HR_APPRAISAL_LOG WHERE LOG_ID > :s AND ACTOR IN (${actors.map((_, i) => `:a${i}`).join(',')})`,
        Object.fromEntries([['s', logStart], ...actors.map((a, i) => [`a${i}`, a])]));
      await del(`DELETE FROM HR_TRAINING_LOG WHERE LOG_ID > :s AND ACTOR = :a`, { s: tlogStart, a: ACTOR });
    }
    await c.commit();
    console.log('cleanup done');
  } finally {
    await c.close();
  }
  if (snapshot) {
    const now = await takeSnapshot(snapshot.empcode);
    const same = JSON.stringify([now.gross, now.basic, now.desg, now.grade, now.allow, now.sal])
      === JSON.stringify([snapshot.gross, snapshot.basic, snapshot.desg, snapshot.grade, snapshot.allow, snapshot.sal]);
    check('employee pay, allowances and designation restored exactly', same);
  }
  if (compSnapshot && people) {
    check('competency master restored exactly', JSON.stringify(await q(COMP_SQL, { c: people.compc })) === JSON.stringify(compSnapshot));
  }
  const left = await q(`SELECT (SELECT COUNT(*) FROM HR_APPRAISAL_CYCLE WHERE NAME LIKE 'SMOKE%') + (SELECT COUNT(*) FROM HR_PROMOTION_CASE)
                             + (SELECT COUNT(*) FROM HR_TRAINING_COURSE WHERE TITLE LIKE 'SMOKE%') FROM DUAL`);
  check('no test rows left behind', Number(left[0][0]) === 0, String(left[0][0]));
}

try {
  await main();
} catch (e) {
  failures++;
  console.error('ERROR', e);
} finally {
  await cleanup();
  console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASSED'}`);
  process.exit(failures ? 1 : 0);
}
