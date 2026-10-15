/**
 * Promotion / increment recommendations after final approval, and HR's
 * "Apply" that writes them into the employee master (BRD §20, §22).
 *
 * Applying an increment:
 *   - HR_INCREMENT_HISTORY_MST + HR_INCREMENT_HISTORY get one document
 *   - HR_EMP_MASTER.GROSS and LAST_INC_DT are updated. The database triggers on
 *     HR_EMP_MASTER then do the rest, exactly as when HR edits the gross in the
 *     ERP: TRG_HR_EMP_MASTER_BIU sets BASIC = GROSS / 1.55, and
 *     TRG_HR_EMP_MASTER_AIU rebuilds HR_EMP_ALLOW (basic / house rent / utility,
 *     which payroll pays from) and snapshots HR_EMP_MASTER_SAL.
 * Applying a promotion updates DESG_CD (and GRADE_CD) and LAST_PROM_DT.
 * Previous values go to HR_APPRAISAL_LOG.
 */

import {
  OUT_ARRAY, s, num, numOrNull, r2, ymd, ymdhm, AppraisalError, writeLog, read, withTx, loadPerson,
} from "./appraisalShared.service.js";

const REC_SQL = {
  INCREMENT: `
    SELECT n.REC_ID, n.APPRAISAL_ID, n.EMPCODE, m.NAME, y.NAME, a.FINAL_SCORE, a.FINAL_RATING, n.STATUS,
           n.PREV_GROSS, n.INC_PCT, n.INC_AMOUNT, n.NEW_GROSS, m.GROSS, n.JUSTIFICATION,
           (SELECT MAX(r.NAME) FROM HR_EMP_MASTER r WHERE r.EMPCODE = n.RECOMMENDED_BY),
           n.EFFECTIVE_PERIOD, n.WITH_ARREAR, n.HIST_DOC_NO, n.APPLIED_AT,
           (SELECT MAX(d.DEPT_NAME) FROM HR_DEPT d WHERE TO_CHAR(d.DEPT_NO) = m.DEPT_NO AND d.COMPC = m.UNIT_ID),
           a.CYCLE_ID, a.STAGE
      FROM HR_INCREMENT_RECOMMENDATION n
      JOIN HR_APPRAISAL_MASTER a ON a.APPRAISAL_ID = n.APPRAISAL_ID
      JOIN HR_APPRAISAL_CYCLE y ON y.CYCLE_ID = a.CYCLE_ID
      LEFT JOIN HR_EMP_MASTER m ON m.EMPCODE = n.EMPCODE`,
  PROMOTION: `
    SELECT p.REC_ID, p.APPRAISAL_ID, p.EMPCODE, m.NAME, y.NAME, a.FINAL_SCORE, a.FINAL_RATING, p.STATUS,
           p.CUR_DESG_CD, (SELECT MAX(g.DESG_DESC) FROM HR_DESG g WHERE TO_CHAR(g.DESG_CD) = p.CUR_DESG_CD AND g.COMPC = p.COMPC),
           p.PROP_DESG_CD, (SELECT MAX(g.DESG_DESC) FROM HR_DESG g WHERE TO_CHAR(g.DESG_CD) = p.PROP_DESG_CD AND g.COMPC = p.COMPC),
           p.CUR_GRADE_CD, p.PROP_GRADE_CD, p.JUSTIFICATION,
           (SELECT MAX(r.NAME) FROM HR_EMP_MASTER r WHERE r.EMPCODE = p.RECOMMENDED_BY),
           p.EFFECTIVE_DATE, p.APPLIED_AT,
           (SELECT MAX(d.DEPT_NAME) FROM HR_DEPT d WHERE TO_CHAR(d.DEPT_NO) = m.DEPT_NO AND d.COMPC = m.UNIT_ID),
           a.CYCLE_ID, a.STAGE, m.DESG_CD
      FROM HR_PROMOTION_RECOMMENDATION p
      JOIN HR_APPRAISAL_MASTER a ON a.APPRAISAL_ID = p.APPRAISAL_ID
      JOIN HR_APPRAISAL_CYCLE y ON y.CYCLE_ID = a.CYCLE_ID
      LEFT JOIN HR_EMP_MASTER m ON m.EMPCODE = p.EMPCODE`,
};

const rowToIncrement = (x) => ({
  kind: "INCREMENT", rec_id: num(x[0]), appraisal_id: num(x[1]), empcode: s(x[2]), emp_name: s(x[3]), cycle_name: s(x[4]),
  final_score: numOrNull(x[5]), final_rating: s(x[6]), status: s(x[7]),
  prev_gross: numOrNull(x[8]), inc_pct: numOrNull(x[9]), inc_amount: num(x[10]), new_gross: numOrNull(x[11]),
  current_gross: numOrNull(x[12]), justification: s(x[13]), recommended_by_name: s(x[14]),
  effective_period: numOrNull(x[15]), with_arrear: s(x[16]) === "Y", hist_doc_no: numOrNull(x[17]), applied_at: ymdhm(x[18]),
  dept_name: s(x[19]), cycle_id: num(x[20]), appraisal_stage: s(x[21]),
});

const rowToPromotion = (x) => ({
  kind: "PROMOTION", rec_id: num(x[0]), appraisal_id: num(x[1]), empcode: s(x[2]), emp_name: s(x[3]), cycle_name: s(x[4]),
  final_score: numOrNull(x[5]), final_rating: s(x[6]), status: s(x[7]),
  cur_desg_cd: s(x[8]), cur_desg_desc: s(x[9]), prop_desg_cd: s(x[10]), prop_desg_desc: s(x[11]),
  cur_grade_cd: s(x[12]) || null, prop_grade_cd: s(x[13]) || null, justification: s(x[14]), recommended_by_name: s(x[15]),
  effective_date: ymd(x[16]), applied_at: ymdhm(x[17]), dept_name: s(x[18]), cycle_id: num(x[19]), appraisal_stage: s(x[20]),
  current_desg_cd: s(x[21]),
});

export const listRecommendations = (compc, f = {}) => read(async (c) => {
  const binds = { compc };
  let where = " WHERE a.COMPC = :compc AND a.STAGE <> 'CANCELLED'";
  if (f.cycle_id) { where += " AND a.CYCLE_ID = :cid"; binds.cid = num(f.cycle_id); }
  const statusFilter = (alias) => (f.status ? ` AND ${alias}.STATUS = :st` : "");
  if (f.status) binds.st = s(f.status);
  const out = [];
  if (!f.kind || f.kind === "INCREMENT") {
    const r = await c.execute(`${REC_SQL.INCREMENT}${where}${statusFilter("n")} ORDER BY UPPER(m.NAME)`, binds, { outFormat: OUT_ARRAY });
    out.push(...(r.rows ?? []).map(rowToIncrement));
  }
  if (!f.kind || f.kind === "PROMOTION") {
    const r = await c.execute(`${REC_SQL.PROMOTION}${where}${statusFilter("p")} ORDER BY UPPER(m.NAME)`, binds, { outFormat: OUT_ARRAY });
    out.push(...(r.rows ?? []).map(rowToPromotion));
  }
  return out;
});

const loadRec = async (c, compc, kind, recId) => {
  const alias = kind === "INCREMENT" ? "n" : "p";
  await c.execute(
    `SELECT 1 FROM ${kind === "INCREMENT" ? "HR_INCREMENT_RECOMMENDATION" : "HR_PROMOTION_RECOMMENDATION"} WHERE REC_ID = :id FOR UPDATE`,
    { id: recId }, { outFormat: OUT_ARRAY },
  );
  const r = await c.execute(`${REC_SQL[kind]} WHERE ${alias}.REC_ID = :id AND a.COMPC = :compc`, { id: recId, compc }, { outFormat: OUT_ARRAY });
  if (!r.rows?.length) throw new AppraisalError("Recommendation not found", 404);
  return kind === "INCREMENT" ? rowToIncrement(r.rows[0]) : rowToPromotion(r.rows[0]);
};

const assertApplicable = (rec) => {
  if (rec.status === "APPLIED") throw new AppraisalError("This recommendation has already been applied", 409);
  if (rec.status !== "APPROVED") throw new AppraisalError("Only recommendations of completed (finally approved) appraisals can be applied");
};

/** Latest payroll period of a company (default "effective from" of an increment). */
const latestPeriod = async (c, compc) => {
  const r = await c.execute(`SELECT MAX("PERIOD#") FROM HR_ATTND_PERIOD WHERE UNIT_ID = :u`, { u: compc }, { outFormat: OUT_ARRAY });
  return numOrNull(r.rows?.[0]?.[0]);
};

export const applyIncrement = (compc, actor, recId, body = {}) => withTx(async (c) => {
  const rec = await loadRec(c, compc, "INCREMENT", recId);
  assertApplicable(rec);
  const emp = await loadPerson(c, rec.empcode);
  if (!emp) throw new AppraisalError("Employee not found", 404);
  if (emp.status !== "A") throw new AppraisalError("The employee is no longer active");
  if (!emp.old_empcode) throw new AppraisalError("The employee has no payroll code (OLD_EMPCODE)");

  const prev = num(emp.gross);
  const amount = r2(numOrNull(body.inc_amount) ?? rec.inc_amount);
  if (!(amount > 0)) throw new AppraisalError("The increment amount must be more than 0");
  const newGross = r2(prev + amount);
  const period = numOrNull(body.effective_period) ?? (await latestPeriod(c, compc));
  if (period !== null) {
    const p = await c.execute(`SELECT 1 FROM HR_ATTND_PERIOD WHERE UNIT_ID = :u AND "PERIOD#" = :p`, { u: compc, p: period }, { outFormat: OUT_ARRAY });
    if (!p.rows?.length) throw new AppraisalError("Choose a payroll period of this company");
  }
  const arrear = body.with_arrear ? "Y" : "N";
  const effDate = body.effective_date || null;

  // Document number: serialise with any other increment being written.
  await c.execute(`LOCK TABLE HR_INCREMENT_HISTORY_MST IN EXCLUSIVE MODE`);
  const d = await c.execute(`SELECT NVL(MAX("DOC#"), 0) + 1 FROM HR_INCREMENT_HISTORY_MST`, {}, { outFormat: OUT_ARRAY });
  const docNo = num(d.rows[0][0]);
  await c.execute(`INSERT INTO HR_INCREMENT_HISTORY_MST ("DOC#", DOC_DATE) VALUES (:d, NVL(TO_DATE(:dt,'YYYY-MM-DD'), TRUNC(SYSDATE)))`, { d: docNo, dt: effDate });
  await c.execute(
    `INSERT INTO HR_INCREMENT_HISTORY ("DOC#", OLD_EMPCODE, UNIT_ID, "PERIOD#", PREV_GROSS, INC_PERCENTAGE, INC_AMOUNT,
            INC_ADJ_AMOUNT, NEW_GROSS, "WITH_PERIOD#_FROM", WITH_AREAR)
     VALUES (:d, :oe, :u, :p, :pg, :pct, :amt, 0, :ng, :p, :ar)`,
    {
      d: docNo, oe: emp.old_empcode, u: compc, p: period, pg: prev, pct: prev ? r2((amount / prev) * 100) : null,
      amt: amount, ng: newGross, ar: arrear,
    },
  );

  const before = await c.execute(
    `SELECT ALLOWANCE_ID, AMOUNT FROM HR_EMP_ALLOW WHERE OLD_EMPCODE = :oe AND UNIT_ID = :u ORDER BY ALLOWANCE_ID`,
    { oe: emp.old_empcode, u: compc }, { outFormat: OUT_ARRAY },
  );
  await c.execute(
    `UPDATE HR_EMP_MASTER SET GROSS = :ng, LAST_INC_DT = NVL(TO_DATE(:dt,'YYYY-MM-DD'), TRUNC(SYSDATE)) WHERE EMPCODE = :e`,
    { ng: newGross, dt: effDate, e: emp.empcode },
  );
  const after = await c.execute(
    `SELECT m.BASIC, (SELECT NVL(SUM(a.AMOUNT),0) FROM HR_EMP_ALLOW a WHERE a.OLD_EMPCODE = m.OLD_EMPCODE AND a.UNIT_ID = m.UNIT_ID AND a.PROC_FLAG = 'Y')
       FROM HR_EMP_MASTER m WHERE m.EMPCODE = :e`,
    { e: emp.empcode }, { outFormat: OUT_ARRAY },
  );

  await c.execute(
    `UPDATE HR_INCREMENT_RECOMMENDATION SET STATUS = 'APPLIED', PREV_GROSS = :pg, INC_AMOUNT = :amt, NEW_GROSS = :ng,
            INC_PCT = :pct, EFFECTIVE_PERIOD = :p, WITH_ARREAR = :ar, HIST_DOC_NO = :d, APPLIED_BY = :actor, APPLIED_AT = SYSDATE,
            UPDATED_AT = SYSDATE
      WHERE REC_ID = :id`,
    {
      pg: prev, amt: amount, ng: newGross, pct: prev ? r2((amount / prev) * 100) : null, p: period, ar: arrear, d: docNo,
      actor: s(actor).slice(0, 30), id: recId,
    },
  );
  const result = {
    rec_id: recId, doc_no: docNo, prev_gross: prev, inc_amount: amount, new_gross: newGross,
    new_basic: numOrNull(after.rows?.[0]?.[0]), payroll_total: numOrNull(after.rows?.[0]?.[1]), effective_period: period,
  };
  await writeLog(c, {
    compc, entity: "INCREMENT", entityId: recId, action: "APPLY",
    details: {
      ...result, empcode: emp.empcode, previous: { gross: emp.gross, basic: emp.basic, allowances: before.rows },
    },
    actor,
  });
  return result;
});

export const applyPromotion = (compc, actor, recId, body = {}) => withTx(async (c) => {
  const rec = await loadRec(c, compc, "PROMOTION", recId);
  assertApplicable(rec);
  const emp = await loadPerson(c, rec.empcode);
  if (!emp) throw new AppraisalError("Employee not found", 404);
  if (emp.status !== "A") throw new AppraisalError("The employee is no longer active");

  const desg = s(body.prop_desg_cd) || rec.prop_desg_cd;
  const g = await c.execute(
    `SELECT DESG_DESC FROM HR_DESG WHERE TO_CHAR(DESG_CD) = :d AND COMPC = :compc`,
    { d: desg, compc }, { outFormat: OUT_ARRAY },
  );
  // Payroll joins HR_DESG on (DESG_CD, COMPC); an unknown designation would drop the employee from the salary run.
  if (!g.rows?.length) throw new AppraisalError("The new designation does not exist for this company");
  const grade = s(body.prop_grade_cd) || rec.prop_grade_cd || emp.grade_cd || null;
  // Default: the effective date the CEO approved in the promotion evaluation.
  const effDate = body.effective_date || rec.effective_date || null;

  await c.execute(
    `UPDATE HR_EMP_MASTER SET DESG_CD = :d, GRADE_CD = :g, LAST_PROM_DT = NVL(TO_DATE(:dt,'YYYY-MM-DD'), TRUNC(SYSDATE)) WHERE EMPCODE = :e`,
    { d: desg, g: grade, dt: effDate, e: emp.empcode },
  );
  await c.execute(
    `UPDATE HR_PROMOTION_RECOMMENDATION SET STATUS = 'APPLIED', PROP_DESG_CD = :d, PROP_GRADE_CD = :g,
            EFFECTIVE_DATE = NVL(TO_DATE(:dt,'YYYY-MM-DD'), TRUNC(SYSDATE)), APPLIED_BY = :actor, APPLIED_AT = SYSDATE, UPDATED_AT = SYSDATE
      WHERE REC_ID = :id`,
    { d: desg, g: grade, dt: effDate, actor: s(actor).slice(0, 30), id: recId },
  );
  const result = { rec_id: recId, desg_cd: desg, desg_desc: s(g.rows[0][0]), grade_cd: grade };
  await writeLog(c, {
    compc, entity: "PROMOTION", entityId: recId, action: "APPLY",
    details: { ...result, empcode: emp.empcode, previous: { desg_cd: emp.desg_cd, grade_cd: emp.grade_cd } }, actor,
  });
  return result;
});

export const rejectRecommendation = (compc, actor, kind, recId, remarks) => withTx(async (c) => {
  const rec = await loadRec(c, compc, kind, recId);
  if (rec.status === "APPLIED") throw new AppraisalError("An applied recommendation cannot be rejected", 409);
  if (rec.status === "REJECTED") return { rec_id: recId, status: "REJECTED" };
  if (!s(remarks)) throw new AppraisalError("Please give a reason");
  await c.execute(
    `UPDATE ${kind === "INCREMENT" ? "HR_INCREMENT_RECOMMENDATION" : "HR_PROMOTION_RECOMMENDATION"}
        SET STATUS = 'REJECTED', UPDATED_AT = SYSDATE WHERE REC_ID = :id`,
    { id: recId },
  );
  await writeLog(c, { compc, entity: kind, entityId: recId, action: "REJECT", details: { remarks, previous: rec.status }, actor });
  return { rec_id: recId, status: "REJECTED" };
});
