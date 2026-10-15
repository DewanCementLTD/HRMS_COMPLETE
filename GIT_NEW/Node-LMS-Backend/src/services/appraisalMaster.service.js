/**
 * Appraisal masters (HR only, one company at a time): promotion competencies,
 * grade scale, promotion settings and decision bands, CEO (management)
 * approvers — plus the lookups the HR screens need (designations, grades,
 * payroll periods).
 */

import {
  OUT_ARRAY, s, num, numOrNull, r2, ymd, AppraisalError, nextId, writeLog, read, withTx,
  loadScale, loadSettings, loadPromoBands, yn, DEFAULT_SCALE, DEFAULT_PROMO_BANDS,
} from "./appraisalShared.service.js";
import { DCL_COMPETENCIES } from "./appraisalRules.js";

// ---------------------------------------------------------------------------
// Promotion competencies (sheet 2 of the promotion form): name, definition, weight
// ---------------------------------------------------------------------------

export const listCompetencies = (compc) => read(async (c) => {
  const r = await c.execute(
    `SELECT x.COMPETENCY_ID, x.NAME, x.DESCRIPTION, x.WEIGHT_PCT, x.SEQ, x.IS_ACTIVE,
            (SELECT COUNT(*) FROM HR_PROMO_COMPETENCY p WHERE p.COMPETENCY_ID = x.COMPETENCY_ID)
       FROM HR_COMPETENCY_MASTER x WHERE x.COMPC = :compc
      ORDER BY x.IS_ACTIVE DESC, x.SEQ, UPPER(x.NAME)`,
    { compc }, { outFormat: OUT_ARRAY },
  );
  const items = (r.rows ?? []).map((x) => ({
    id: num(x[0]), name: s(x[1]), description: s(x[2]), weight_pct: num(x[3]), seq: num(x[4]),
    is_active: s(x[5]) === "Y", used_count: num(x[6]),
  }));
  const activeWeight = r2(items.filter((i) => i.is_active).reduce((t, i) => t + i.weight_pct, 0));
  return { items, active_weight: activeWeight };
});

export const saveCompetency = (compc, actor, id, body) => withTx(async (c) => {
  const b = {
    name: s(body.name), descr: s(body.description) || null, w: num(body.weight_pct ?? 10), seq: num(body.seq ?? 0),
    act: yn(body.is_active ?? true), actor,
  };
  if (!(b.w > 0 && b.w <= 100)) throw new AppraisalError("Weight must be between 1% and 100%");
  if (id) {
    const r = await c.execute(
      `UPDATE HR_COMPETENCY_MASTER SET NAME = :name, DESCRIPTION = :descr, WEIGHT_PCT = :w, SEQ = :seq, IS_ACTIVE = :act,
              UPDATED_BY = :actor, UPDATED_AT = SYSDATE
        WHERE COMPETENCY_ID = :id AND COMPC = :compc`,
      { ...b, id, compc },
    );
    if (!r.rowsAffected) throw new AppraisalError("Competency not found", 404);
    return { id };
  }
  const newId = await nextId(c, "HR_COMPETENCY_MASTER_SEQ");
  await c.execute(
    `INSERT INTO HR_COMPETENCY_MASTER (COMPETENCY_ID, COMPC, NAME, DESCRIPTION, WEIGHT_PCT, SEQ, IS_ACTIVE, CREATED_BY)
     VALUES (:id, :compc, :name, :descr, :w, :seq, :act, :actor)`,
    { ...b, id: newId, compc },
  );
  return { id: newId };
}, { HR_COMPETENCY_MASTER_UK: "A competency with this name already exists" });

export const deleteCompetency = (compc, id) => withTx(async (c) => {
  const used = await c.execute(`SELECT COUNT(*) FROM HR_PROMO_COMPETENCY WHERE COMPETENCY_ID = :id`, { id }, { outFormat: OUT_ARRAY });
  if (num(used.rows[0][0]) > 0) throw new AppraisalError("This competency is used in promotion evaluations — deactivate it instead", 409);
  const r = await c.execute(`DELETE FROM HR_COMPETENCY_MASTER WHERE COMPETENCY_ID = :id AND COMPC = :compc`, { id, compc });
  if (!r.rowsAffected) throw new AppraisalError("Competency not found", 404);
  return { deleted: true };
});

/**
 * Load the ten competencies of the DCL promotion form (10% each, with their
 * definitions) and deactivate every other competency, so the active weights total 100%.
 */
export const loadDclCompetencies = (compc, actor) => withTx(async (c) => {
  let added = 0;
  let seq = 1;
  for (const [name, def] of DCL_COMPETENCIES) {
    const u = await c.execute(
      `UPDATE HR_COMPETENCY_MASTER SET DESCRIPTION = :def, WEIGHT_PCT = 10, SEQ = :seq, IS_ACTIVE = 'Y', UPDATED_BY = :actor, UPDATED_AT = SYSDATE
        WHERE COMPC = :compc AND UPPER(NAME) = UPPER(:name)`,
      { def, seq, actor, compc, name },
    );
    if (!u.rowsAffected) {
      await c.execute(
        `INSERT INTO HR_COMPETENCY_MASTER (COMPETENCY_ID, COMPC, NAME, DESCRIPTION, WEIGHT_PCT, SEQ, CREATED_BY)
         VALUES (HR_COMPETENCY_MASTER_SEQ.NEXTVAL, :compc, :name, :def, 10, :seq, :actor)`,
        { compc, name, def, seq, actor },
      );
      added++;
    }
    seq++;
  }
  const names = DCL_COMPETENCIES.map(([n]) => n.toUpperCase());
  const off = await c.execute(
    `UPDATE HR_COMPETENCY_MASTER SET IS_ACTIVE = 'N', UPDATED_BY = :actor, UPDATED_AT = SYSDATE
      WHERE COMPC = :compc AND IS_ACTIVE = 'Y' AND UPPER(NAME) NOT IN (${names.map((_, i) => `:n${i}`).join(",")})`,
    Object.fromEntries([["actor", actor], ["compc", compc], ...names.map((n, i) => [`n${i}`, n])]),
  );
  await writeLog(c, { compc, entity: "COMPETENCY", entityId: compc, action: "LOAD_DCL", details: { added, deactivated: off.rowsAffected }, actor });
  return { added, deactivated: off.rowsAffected ?? 0 };
});

// ---------------------------------------------------------------------------
// Rating scale
// ---------------------------------------------------------------------------

export const getScale = (compc) => withTx((c) => loadScale(c, compc, { seed: true }));

/**
 * Replace the whole grade scale. Bands must not overlap and must cover 1–5 with no
 * gaps, otherwise some scores would have no rating.
 */
export const saveScale = (compc, actor, bands) => withTx(async (c) => {
  const rows = [...bands].map((b) => ({ ...b, min_score: r2(b.min_score), max_score: r2(b.max_score) }))
    .sort((a, b) => a.min_score - b.min_score);
  if (!rows.length) throw new AppraisalError("Add at least one rating band");
  // Grades sit on the Total "A" score of the task sheet (1.00–5.00).
  if (rows[0].min_score > 1) throw new AppraisalError("The lowest grade must start at 1 or below");
  if (rows[rows.length - 1].max_score < 5) throw new AppraisalError("The highest grade must reach 5");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].max_score < rows[i].min_score) throw new AppraisalError(`Band "${rows[i].label}": the maximum is below the minimum`);
    if (i > 0 && rows[i].min_score <= rows[i - 1].max_score) {
      throw new AppraisalError(`Bands "${rows[i - 1].label}" and "${rows[i].label}" overlap`);
    }
    // Compare in hundredths: 65 - 64.99 is 0.0100000000000016 in floating point.
    if (i > 0 && Math.round((rows[i].min_score - rows[i - 1].max_score) * 100) > 1) {
      throw new AppraisalError(`There is a gap between "${rows[i - 1].label}" and "${rows[i].label}"`);
    }
  }
  const targets = rows.reduce((t, b) => t + num(b.target_pct), 0);
  if (rows.some((b) => b.target_pct !== null && b.target_pct !== undefined) && Math.abs(targets - 100) > 0.01) {
    throw new AppraisalError(`Bell curve targets add up to ${r2(targets)}% — they must total 100%`);
  }
  const prev = await loadScale(c, compc);
  await c.execute(`DELETE FROM HR_APPR_RATING_SCALE WHERE COMPC = :compc`, { compc });
  for (const b of rows) {
    await c.execute(
      `INSERT INTO HR_APPR_RATING_SCALE (SCALE_ID, COMPC, MIN_SCORE, MAX_SCORE, LABEL, DESCRIPTION, TARGET_PCT, IS_DEVELOPMENT, CREATED_BY)
       VALUES (HR_APPR_RATING_SCALE_SEQ.NEXTVAL, :compc, :mn, :mx, :l, :descr, :t, :d, :actor)`,
      {
        compc, mn: b.min_score, mx: b.max_score, l: s(b.label).toUpperCase(), descr: s(b.description) || null,
        t: numOrNull(b.target_pct), d: yn(b.is_development), actor,
      },
    );
  }
  await writeLog(c, { compc, entity: "SCALE", entityId: compc, action: "REPLACE", details: { previous: prev }, actor });
  return { saved: rows.length };
});

export const resetScale = (compc, actor) => saveScale(compc, actor, DEFAULT_SCALE);

// ---------------------------------------------------------------------------
// Management (final) approvers
// ---------------------------------------------------------------------------

export const listMgmtApprovers = (compc) => read(async (c) => {
  const r = await c.execute(
    `SELECT a.APPROVER_ID, a.EMPCODE, m.NAME, a.IS_ACTIVE,
            (SELECT MAX(g.DESG_DESC) FROM HR_DESG g WHERE TO_CHAR(g.DESG_CD) = m.DESG_CD AND g.COMPC = m.UNIT_ID)
       FROM HR_APPR_MGMT_APPROVER a LEFT JOIN HR_EMP_MASTER m ON m.EMPCODE = a.EMPCODE
      WHERE a.COMPC = :compc ORDER BY a.IS_ACTIVE DESC, UPPER(m.NAME)`,
    { compc }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => ({
    approver_id: num(x[0]), empcode: s(x[1]), name: s(x[2]) || s(x[1]), is_active: s(x[3]) === "Y", desg_desc: s(x[4]),
  }));
});

export const addMgmtApprover = (compc, actor, empcode) => withTx(async (c) => {
  const e = await c.execute(`SELECT NAME FROM HR_EMP_MASTER WHERE EMPCODE = :e`, { e: s(empcode) }, { outFormat: OUT_ARRAY });
  if (!e.rows?.length) throw new AppraisalError("Employee not found", 404);
  const id = await nextId(c, "HR_APPR_MGMT_APPROVER_SEQ");
  await c.execute(
    `INSERT INTO HR_APPR_MGMT_APPROVER (APPROVER_ID, COMPC, EMPCODE, CREATED_BY) VALUES (:id, :compc, :e, :actor)`,
    { id, compc, e: s(empcode), actor },
  );
  await writeLog(c, { compc, entity: "MGMT_APPR", entityId: id, action: "ADD", details: { empcode }, actor });
  return { approver_id: id };
}, { HR_APPR_MGMT_APPROVER_UK: "This employee is already a management approver" });

export const setMgmtApprover = (compc, actor, id, isActive) => withTx(async (c) => {
  const r = await c.execute(
    `UPDATE HR_APPR_MGMT_APPROVER SET IS_ACTIVE = :a WHERE APPROVER_ID = :id AND COMPC = :compc`,
    { a: yn(isActive), id, compc },
  );
  if (!r.rowsAffected) throw new AppraisalError("Approver not found", 404);
  await writeLog(c, { compc, entity: "MGMT_APPR", entityId: id, action: isActive ? "ACTIVATE" : "DEACTIVATE", actor });
  return { approver_id: id };
});

export const deleteMgmtApprover = (compc, actor, id) => withTx(async (c) => {
  const r = await c.execute(`DELETE FROM HR_APPR_MGMT_APPROVER WHERE APPROVER_ID = :id AND COMPC = :compc`, { id, compc });
  if (!r.rowsAffected) throw new AppraisalError("Approver not found", 404);
  await writeLog(c, { compc, entity: "MGMT_APPR", entityId: id, action: "DELETE", actor });
  return { deleted: true };
});

// ---------------------------------------------------------------------------
// Promotion scorecard settings and decision bands (sheet 4)
// ---------------------------------------------------------------------------

export const getPromotionSetup = (compc) => read(async (c) => ({
  settings: await loadSettings(c, compc),
  bands: await loadPromoBands(c, compc),
}));

export const savePromotionSetup = (compc, actor, body) => withTx(async (c) => {
  const cw = num(body.settings?.comp_weight_pct);
  const pw = num(body.settings?.perf_weight_pct);
  if (Math.abs(cw + pw - 100) > 0.01) throw new AppraisalError("Competency and performance weights must total 100%");
  const tenure = num(body.settings?.min_tenure_yrs);
  if (tenure < 0 || tenure > 20) throw new AppraisalError("Minimum tenure must be between 0 and 20 years");
  const bands = [...(body.bands ?? [])].sort((x, y) => num(y.min_score) - num(x.min_score));
  if (!bands.length) throw new AppraisalError("Add at least one decision band");
  if (num(bands[bands.length - 1].min_score) > 0) throw new AppraisalError("The lowest decision band must start at 0");
  if (new Set(bands.map((x) => num(x.min_score))).size !== bands.length) throw new AppraisalError("Two decision bands start at the same score");
  const prev = { settings: await loadSettings(c, compc), bands: await loadPromoBands(c, compc) };
  await c.execute(
    `MERGE INTO HR_APPR_SETTING s USING (SELECT :compc COMPC FROM DUAL) x ON (s.COMPC = x.COMPC)
      WHEN MATCHED THEN UPDATE SET COMP_WEIGHT_PCT = :cw, PERF_WEIGHT_PCT = :pw, MIN_TENURE_YRS = :tn, UPDATED_BY = :actor, UPDATED_AT = SYSDATE
      WHEN NOT MATCHED THEN INSERT (COMPC, COMP_WEIGHT_PCT, PERF_WEIGHT_PCT, MIN_TENURE_YRS, UPDATED_BY, UPDATED_AT)
           VALUES (:compc, :cw, :pw, :tn, :actor, SYSDATE)`,
    { compc, cw, pw, tn: tenure, actor },
  );
  await c.execute(`DELETE FROM HR_PROMO_BAND WHERE COMPC = :compc`, { compc });
  for (const x of bands) {
    await c.execute(
      `INSERT INTO HR_PROMO_BAND (BAND_ID, COMPC, MIN_SCORE, LABEL, OUTCOME, CREATED_BY)
       VALUES (HR_PROMO_BAND_SEQ.NEXTVAL, :compc, :mn, :l, :oc, :actor)`,
      { compc, mn: r2(x.min_score), l: s(x.label).slice(0, 60), oc: x.outcome, actor },
    );
  }
  await writeLog(c, { compc, entity: "PROMO_SETUP", entityId: compc, action: "SAVE", details: { previous: prev }, actor });
  return { saved: true };
});

export const resetPromotionBands = (compc, actor) => savePromotionSetup(compc, actor, {
  settings: { comp_weight_pct: 50, perf_weight_pct: 50, min_tenure_yrs: 2 }, bands: DEFAULT_PROMO_BANDS,
});

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Designations of the company (promotion picker) with their grade and group. */
export const listDesignations = (compc) => read(async (c) => {
  const r = await c.execute(
    `SELECT TO_CHAR(DESG_CD), DESG_DESC, GRADE_CD, DESG_GRP, DESG_ORDER
       FROM HR_DESG WHERE COMPC = :compc ORDER BY NVL(DESG_ORDER, 999), UPPER(DESG_DESC)`,
    { compc }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => ({
    desg_cd: s(x[0]), desg_desc: s(x[1]), grade_cd: s(x[2]) || null, desg_grp: s(x[3]) || null, desg_order: numOrNull(x[4]),
  }));
});

/** Grade codes and designation groups actually used by the company's employees (template filters). */
export const listFilterValues = (compc) => read(async (c) => {
  const g = await c.execute(
    `SELECT GRADE_CD, COUNT(*) FROM HR_EMP_MASTER WHERE UNIT_ID = :compc AND NVL(STATUS,'A') = 'A' AND GRADE_CD IS NOT NULL
      GROUP BY GRADE_CD ORDER BY GRADE_CD`,
    { compc }, { outFormat: OUT_ARRAY },
  );
  const d = await c.execute(
    `SELECT g.DESG_GRP, COUNT(*) FROM HR_EMP_MASTER m
       JOIN HR_DESG g ON TO_CHAR(g.DESG_CD) = m.DESG_CD AND g.COMPC = m.UNIT_ID
      WHERE m.UNIT_ID = :compc AND NVL(m.STATUS,'A') = 'A' AND g.DESG_GRP IS NOT NULL
      GROUP BY g.DESG_GRP ORDER BY g.DESG_GRP`,
    { compc }, { outFormat: OUT_ARRAY },
  );
  return {
    grades: (g.rows ?? []).map((x) => ({ value: s(x[0]), employees: num(x[1]) })),
    desg_groups: (d.rows ?? []).map((x) => ({ value: s(x[0]), employees: num(x[1]) })),
  };
});

/** Payroll periods of the company (increment "effective from"), newest first. */
export const listPeriods = (compc) => read(async (c) => {
  const r = await c.execute(
    `SELECT "PERIOD#", PERIOD_FRM, PERIOD_TO, STATUS
       FROM HR_ATTND_PERIOD WHERE UNIT_ID = :compc ORDER BY PERIOD_FRM DESC FETCH FIRST 36 ROWS ONLY`,
    { compc }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => ({ period_no: num(x[0]), period_from: ymd(x[1]), period_to: ymd(x[2]), status: s(x[3]) }));
});
