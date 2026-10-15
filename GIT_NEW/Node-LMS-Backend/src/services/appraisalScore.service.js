/**
 * Appraisal scoring of the DCL task sheet. Always computed on the server from
 * the stored ratings — the browser's numbers are never trusted.
 *
 *   row score     weightage% × rating points (A+=5 … D=1)
 *   SELF_SCORE    Total "A" of the employee's self ratings
 *   CALC_SCORE    Total "A" of the agreed ratings (HOD_RATING, given at year end)
 *   FINAL_RATING  HR's normalised grade when set, else the grade of CALC_SCORE
 */

import { OUT_ARRAY, num, s, numOrNull, bandFor, loadScale } from "./appraisalShared.service.js";
import { sheetTotal } from "./appraisalRules.js";

export { rowScore, sheetTotal, weightProblems } from "./appraisalRules.js";

/** Load the ratings of one appraisal, recompute every score and store them. */
export const recomputeScores = async (c, appraisalId) => {
  const head = await c.execute(
    `SELECT COMPC, HR_ADJ_GRADE FROM HR_APPRAISAL_MASTER WHERE APPRAISAL_ID = :id`,
    { id: appraisalId }, { outFormat: OUT_ARRAY },
  );
  const h = head.rows?.[0];
  if (!h) return null;
  const g = await c.execute(
    `SELECT WEIGHTAGE, SELF_RATING, HOD_RATING FROM HR_EMPLOYEE_GOAL WHERE APPRAISAL_ID = :id`,
    { id: appraisalId }, { outFormat: OUT_ARRAY },
  );
  const rows = (g.rows ?? []).map((x) => ({ weightage: num(x[0]), self_rating: numOrNull(x[1]), hod_rating: numOrNull(x[2]) }));
  const selfScore = sheetTotal(rows, (r) => r.self_rating);
  const calc = sheetTotal(rows, (r) => r.hod_rating);

  const scale = await loadScale(c, num(h[0]), { seed: true });
  const adj = s(h[1]) || null;
  const band = adj ? scale.find((b) => b.label === adj) ?? null : bandFor(scale, calc);
  const grade = adj ?? band?.label ?? null;
  await c.execute(
    `UPDATE HR_APPRAISAL_MASTER SET SELF_SCORE = :ss, CALC_SCORE = :cs, FINAL_SCORE = :cs, FINAL_RATING = :fr WHERE APPRAISAL_ID = :id`,
    { ss: selfScore, cs: calc, fr: grade, id: appraisalId },
  );
  return {
    self_score: selfScore, calc_score: calc, final_score: calc, final_rating: grade,
    calc_grade: bandFor(scale, calc)?.label ?? null, is_development: !!band?.is_development,
  };
};
