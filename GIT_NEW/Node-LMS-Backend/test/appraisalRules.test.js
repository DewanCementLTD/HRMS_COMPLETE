import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GRADE_POINTS, gradeOfPoints, rowScore, sheetTotal, weightProblems, bandFor, DEFAULT_SCALE,
  yearEndChain, nextStageOf, prevStageOf,
  eligibilityResult, ELIGIBILITY_CRITERIA, competencyScore, performanceScore, overallScore, decisionBand, DEFAULT_PROMO_BANDS,
  categoryOf, DCL_COMPETENCIES,
} from '../src/services/appraisalRules.js';

// These pin down the numbers of the DCL forms that HR will be asked to defend:
// the task sheet's Total "A", the grade it maps to, the promotion scorecard and
// decision band, and the summary-sheet category. The workflow itself is
// exercised against Oracle by scripts/appraisal_smoke_test.mjs.

// ── Task sheet ──────────────────────────────────────────────────────
test('rating points: A+ 5, A 4, B 3, C 2, D 1', () => {
  assert.deepEqual(GRADE_POINTS, { 'A+': 5, A: 4, B: 3, C: 2, D: 1 });
  assert.equal(gradeOfPoints(4), 'A');
  assert.equal(gradeOfPoints(null), null);
});

test('row score = weightage% x points; Total "A" sums the rated rows', () => {
  assert.equal(rowScore(20, 4), 0.8);
  assert.equal(rowScore(20, null), null);
  const rows = [{ weightage: 40, r: 5 }, { weightage: 35, r: 3 }, { weightage: 25, r: 4 }];
  // 2.00 + 1.05 + 1.00
  assert.equal(sheetTotal(rows, (x) => x.r), 4.05);
  assert.equal(sheetTotal([{ weightage: 100, r: null }], (x) => x.r), null);
});

test('a fully A+ sheet scores 5.00 and a fully D sheet 1.00', () => {
  const rows = [30, 30, 40].map((w) => ({ weightage: w }));
  assert.equal(sheetTotal(rows, () => 5), 5);
  assert.equal(sheetTotal(rows, () => 1), 1);
});

test('weightage rules: 5–40% per row, total exactly 100%, at most 8 rows', () => {
  assert.deepEqual(weightProblems([{ weightage: 40 }, { weightage: 40 }, { weightage: 20 }]), []);
  assert.match(weightProblems([{ weightage: 50 }, { weightage: 50 }]).join(' '), /5%–40%/);
  assert.match(weightProblems([{ weightage: 4 }, { weightage: 40 }, { weightage: 40 }, { weightage: 16 }]).join(' '), /Row 1/);
  assert.match(weightProblems([{ weightage: 30 }, { weightage: 30 }]).join(' '), /now 60%/);
  assert.match(weightProblems(Array.from({ length: 9 }, () => ({ weightage: 11.11 }))).join(' '), /At most 8/);
  assert.match(weightProblems([]).join(' '), /at least one/);
});

// ── Grades (user decision: ≥4.5 A+, ≥3.5 A, ≥2.5 B, ≥1.5 C, else D) ──
test('total score maps to the DCL grade', () => {
  const g = (sc) => bandFor(DEFAULT_SCALE, sc)?.label;
  assert.equal(g(5), 'A+');
  assert.equal(g(4.5), 'A+');
  assert.equal(g(4.49), 'A');
  assert.equal(g(3.5), 'A');
  assert.equal(g(3.49), 'B');
  assert.equal(g(2.5), 'B');
  assert.equal(g(2.49), 'C');
  assert.equal(g(1.5), 'C');
  assert.equal(g(1.49), 'D');
  assert.equal(g(1), 'D');
});

test('bell curve standard is 5 / 19 / 63 / 8 / 5 and C, D get a development plan', () => {
  assert.deepEqual(DEFAULT_SCALE.map((b) => b.target_pct), [5, 19, 63, 8, 5]);
  assert.equal(DEFAULT_SCALE.reduce((t, b) => t + b.target_pct, 0), 100);
  assert.deepEqual(DEFAULT_SCALE.filter((b) => b.is_development).map((b) => b.label), ['C', 'D']);
});

// ── Year-end chain: HOD1 → HOD2 (if set) → HR ───────────────────────
test('year-end chain uses HOD1, HOD2 if set, then HR', () => {
  assert.deepEqual(yearEndChain({ hasRpt: true, hasHod1: true, hasHod2: true }), ['HOD1', 'HOD2', 'HR']);
  assert.deepEqual(yearEndChain({ hasRpt: true, hasHod1: true, hasHod2: false }), ['HOD1', 'HR']);
  // No HOD1: the reporting officer gives the year-end rating.
  assert.deepEqual(yearEndChain({ hasRpt: true, hasHod1: false, hasHod2: false }), ['RPT', 'HR']);
  assert.deepEqual(yearEndChain({ hasRpt: false, hasHod1: false, hasHod2: false }), ['HR']);
});

test('after the mid-year sign-off the first rater is next; HR finalises', () => {
  const chain = ['HOD1', 'HOD2', 'HR'];
  assert.equal(nextStageOf(chain, 'MID_REVIEW'), 'HOD1');
  assert.equal(nextStageOf(chain, 'HOD1'), 'HOD2');
  assert.equal(nextStageOf(chain, 'HR'), 'COMPLETED');
});

test('returns stay inside the year-end chain (the half-year review is locked)', () => {
  const chain = ['HOD1', 'HOD2', 'HR'];
  assert.equal(prevStageOf(chain, 'HR'), 'HOD2');
  assert.equal(prevStageOf(chain, 'HOD2'), 'HOD1');
  assert.equal(prevStageOf(chain, 'HOD1'), null);
});

// ── Promotion sheet 1: eligibility gate ─────────────────────────────
test('eligibility: all Yes = eligible, any No = not eligible, any blank = incomplete', () => {
  const all = (st) => ELIGIBILITY_CRITERIA.map((k) => ({ criterion: k.code, status: st }));
  assert.equal(ELIGIBILITY_CRITERIA.length, 7);
  assert.equal(eligibilityResult(all('Y')), 'ELIGIBLE');
  assert.equal(eligibilityResult(all(null)), 'INCOMPLETE');
  const oneNo = all('Y');
  oneNo[3].status = 'N';
  assert.equal(eligibilityResult(oneNo), 'NOT_ELIGIBLE');
  const oneBlank = all('Y');
  oneBlank[6].status = null;
  assert.equal(eligibilityResult(oneBlank), 'INCOMPLETE');
});

// ── Promotion sheets 2–4: scorecard ─────────────────────────────────
test('the DCL form has ten competencies at 10% each', () => {
  assert.equal(DCL_COMPETENCIES.length, 10);
});

test('competency score % = Σ weight × rating / 5, only when all are rated', () => {
  const items = DCL_COMPETENCIES.map((_, i) => ({ weight_pct: 10, mgr_rating: i < 5 ? 4 : 5 }));
  // 5 × 10% × 0.8 + 5 × 10% × 1.0 = 90%
  assert.equal(competencyScore(items, 'mgr_rating'), 90);
  items[0].mgr_rating = null;
  assert.equal(competencyScore(items, 'mgr_rating'), null);
});

test('performance score = average of the 3-year rating % and 3-year KPI %', () => {
  const p = performanceScore([
    { rating_pct: 80, kpi_pct: 70 }, { rating_pct: 90, kpi_pct: 80 }, { rating_pct: 70, kpi_pct: null },
  ]);
  assert.equal(p.rating_avg, 80);
  assert.equal(p.kpi_avg, 75);
  assert.equal(p.score, 77.5);
  assert.equal(performanceScore([]).score, null);
});

test('overall score weights competency and performance 50/50 by default', () => {
  assert.equal(overallScore(90, 77.5, 50, 50), 83.75);
  assert.equal(overallScore(null, 77.5, 50, 50), null);
});

test('decision band: score band only when eligible; otherwise INCOMPLETE / NOT ELIGIBLE', () => {
  assert.equal(decisionBand(DEFAULT_PROMO_BANDS, 83.75, 'ELIGIBLE').outcome, 'PROMOTE');
  assert.equal(decisionBand(DEFAULT_PROMO_BANDS, 72, 'ELIGIBLE').outcome, 'PROMOTE_DEV');
  assert.equal(decisionBand(DEFAULT_PROMO_BANDS, 60, 'ELIGIBLE').outcome, 'DEFER');
  assert.equal(decisionBand(DEFAULT_PROMO_BANDS, 40, 'ELIGIBLE').outcome, 'NOT_RECOMMEND');
  assert.equal(decisionBand(DEFAULT_PROMO_BANDS, 95, 'NOT_ELIGIBLE').label, 'NOT ELIGIBLE');
  assert.equal(decisionBand(DEFAULT_PROMO_BANDS, 95, 'INCOMPLETE').label, 'INCOMPLETE');
  assert.equal(decisionBand(DEFAULT_PROMO_BANDS, null, 'ELIGIBLE').label, 'INCOMPLETE');
});

// ── Summary sheet categories ────────────────────────────────────────
test('summary sheet category: override, TE/MTO, probation, pro-rata, full year', () => {
  const base = { desgDesc: 'Manager', empStatus: '2', joinDate: '2020-01-01', periodTo: '2027-06-30' };
  assert.equal(categoryOf(base), 'FULL');
  assert.equal(categoryOf({ ...base, joinDate: '2026-10-01' }), 'PRORATA');
  assert.equal(categoryOf({ ...base, empStatus: '1' }), 'PROBATION');
  assert.equal(categoryOf({ ...base, desgDesc: 'MTO' }), 'TE_MTO');
  assert.equal(categoryOf({ ...base, desgDesc: 'Trainee Engineer' }), 'TE_MTO');
  assert.equal(categoryOf({ ...base, desgDesc: 'Internal Auditor' }), 'FULL');
  assert.equal(categoryOf({ ...base, override: 'PROBATION' }), 'PROBATION');
});
