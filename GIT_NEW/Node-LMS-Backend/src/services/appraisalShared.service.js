/**
 * Helpers shared by the Performance Appraisal services (tables:
 * scripts/appraisal_ddl.sql). Identity and formatting helpers come from the
 * training module so both modules treat employees, companies and HOD mobiles
 * the same way.
 *
 * DCL process per appraisal (approvers snapshotted at launch):
 *   objectives + mid-year review: line manager = reporting officer (RPT_OFFICER),
 *     else HOD1, else HR
 *   year end: HOD1 (or the reporting officer when there is no HOD1) → HOD2 (if set) → HR
 *   promotion final decision: HOD, then CEO (HR_APPR_MGMT_APPROVER)
 */

import { getDirectConnection } from "../config/database.js";
import { logger } from "../utils/logger.js";
import {
  OUT_ARRAY, s, num, numOrNull, mobileKey, mapOraError, TrainingError, EMP_DEPT_SQL, EMP_DESG_SQL,
} from "./trainingShared.service.js";
import { DEFAULT_SCALE, DEFAULT_PROMO_BANDS, yearEndChain } from "./appraisalRules.js";

export {
  OUT_ARRAY, s, num, numOrNull, r2, ymd, ymdhm, fyOf, fyLabel, mobileKey, mobileKeySql,
  EMP_DEPT_SQL, EMP_DESG_SQL, resolveEmpcode, nameOf, nextId,
} from "./trainingShared.service.js";

export { bandFor, DEFAULT_SCALE, DEFAULT_PROMO_BANDS, GRADES, GRADE_POINTS } from "./appraisalRules.js";

/** Business-rule failure; the global handler answers it as {detail} with err.status. */
export { TrainingError as AppraisalError };

export const STAGES = ["OBJ_SETTING", "OBJ_REVIEW", "MIDYEAR", "MID_REVIEW", "RPT", "HOD1", "HOD2", "HR", "COMPLETED", "CANCELLED"];
export const STAGE_LABEL = {
  OBJ_SETTING: "Objective setting", OBJ_REVIEW: "Objectives — line manager approval", MIDYEAR: "Mid-year self review",
  MID_REVIEW: "Mid-year — line manager review", RPT: "Year-end rating (reporting officer)", HOD1: "Year-end rating (HOD)",
  HOD2: "Year-end review (HOD 2)", HR: "HR review", COMPLETED: "Completed", CANCELLED: "Cancelled",
};
// Cycle phases opened by HR: mid-year actions need MIDYEAR or later, year-end actions need YEAREND.
export const PHASES = ["OBJECTIVES", "MIDYEAR", "YEAREND"];
export const phaseAtLeast = (phase, wanted) => PHASES.indexOf(phase) >= PHASES.indexOf(wanted);

export const yn = (v) => (v === true || v === "Y" ? "Y" : "N");

const notInstalled = (err) => {
  if (err?.errorNum === 942) {
    // 4xx on purpose: the global handler masks 5xx messages, and HR needs to see this one.
    throw new TrainingError("Appraisal tables are not installed yet. Run: node scripts/run_appraisal_ddl.mjs", 400);
  }
};

/** Run a read-only `fn(connection)`, mapping Oracle errors, always releasing the connection. */
export const read = async (fn) => {
  const connection = await getDirectConnection();
  try {
    return await fn(connection);
  } catch (err) {
    if (err instanceof TrainingError) throw err;
    notInstalled(err);
    return mapOraError(err);
  } finally {
    await connection.close();
  }
};

/** Run `fn(connection)` in one transaction: commit on success, roll back on any throw. */
export const withTx = async (fn, oraMessages) => {
  const connection = await getDirectConnection();
  try {
    const out = await fn(connection);
    await connection.commit();
    return out;
  } catch (err) {
    try { await connection.rollback(); } catch { /* connection already broken */ }
    if (err instanceof TrainingError) throw err;
    notInstalled(err);
    return mapOraError(err, oraMessages);
  } finally {
    await connection.close();
  }
};

/** Audit trail row (BRD §30). Never fails the caller's action. */
export const writeLog = async (connection, { compc, entity, entityId, action, details, actor }) => {
  try {
    await connection.execute(
      `INSERT INTO HR_APPRAISAL_LOG (LOG_ID, COMPC, ENTITY, ENTITY_ID, ACTION, DETAILS, ACTOR)
       VALUES (HR_APPRAISAL_LOG_SEQ.NEXTVAL, :compc, :entity, :id, :action, :details, :actor)`,
      {
        compc: compc ?? null,
        entity,
        id: entityId,
        action,
        details: details ? JSON.stringify(details).slice(0, 4000) : null,
        actor: actor ? s(actor).slice(0, 30) : null,
      },
    );
  } catch (e) {
    logger.warn(`[APPRAISAL] audit log failed for ${entity} ${entityId} ${action}: ${e.message}`);
  }
};

/** One employee with what appraisal needs: org placement, approvers, pay. */
export const loadPerson = async (connection, empcode) => {
  const r = await connection.execute(
    `SELECT m.EMPCODE, m.NAME, m.UNIT_ID, m.LOCATION, m.DEPT_NO, ${EMP_DEPT_SQL}, ${EMP_DESG_SQL},
            TO_CHAR(m."MOBILE#"), NVL(m.STATUS, 'A'), m.RPT_OFFICER, m.DESG_CD, m.GRADE_CD,
            (SELECT MAX(g.DESG_GRP) FROM HR_DESG g WHERE TO_CHAR(g.DESG_CD) = m.DESG_CD AND g.COMPC = m.UNIT_ID),
            m.OLD_EMPCODE, m.GROSS, m.BASIC, m.EMP_STATUS,
            (SELECT MAX(TO_CHAR(e.HOD1)) FROM EMPLOYEE e WHERE e.EMPCODE = m.EMPCODE),
            (SELECT MAX(TO_CHAR(e.HOD2)) FROM EMPLOYEE e WHERE e.EMPCODE = m.EMPCODE)
       FROM HR_EMP_MASTER m
      WHERE m.EMPCODE = :e`,
    { e: s(empcode) },
    { outFormat: OUT_ARRAY },
  );
  const x = r.rows?.[0];
  if (!x) return null;
  return {
    empcode: s(x[0]), name: s(x[1]), compc: numOrNull(x[2]), brnch: numOrNull(x[3]),
    dept_no: s(x[4]), dept_name: s(x[5]), desg_desc: s(x[6]), mobile: s(x[7]), status: s(x[8]),
    rpt_officer: s(x[9]), desg_cd: s(x[10]), grade_cd: s(x[11]), desg_grp: s(x[12]),
    old_empcode: s(x[13]), gross: numOrNull(x[14]), basic: numOrNull(x[15]), emp_status: s(x[16]),
    hod1_mno: s(x[17]), hod2_mno: s(x[18]),
  };
};

/** Is `empcode` an active management (final) approver of company `compc`? */
export const isMgmtApprover = async (connection, compc, empcode) => {
  const r = await connection.execute(
    `SELECT 1 FROM HR_APPR_MGMT_APPROVER WHERE COMPC = :compc AND EMPCODE = :e AND IS_ACTIVE = 'Y'`,
    { compc, e: s(empcode) }, { outFormat: OUT_ARRAY },
  );
  return !!r.rows?.length;
};

/** Does company `compc` have a management level for an appraisee `empcode` (someone other than themself)? */
export const hasMgmtLevel = async (connection, compc, empcode) => {
  const r = await connection.execute(
    `SELECT 1 FROM HR_APPR_MGMT_APPROVER WHERE COMPC = :compc AND IS_ACTIVE = 'Y' AND EMPCODE <> :e FETCH FIRST 1 ROWS ONLY`,
    { compc, e: s(empcode) }, { outFormat: OUT_ARRAY },
  );
  return !!r.rows?.length;
};

/** Year-end stages of an appraisal from its approver snapshot. */
export const chainOf = (appr) => yearEndChain({
  hasRpt: !!appr.rpt_empcode, hasHod1: !!mobileKey(appr.hod1_mno), hasHod2: !!mobileKey(appr.hod2_mno),
});

/** Who the line manager is (objectives and mid-year): RPT, else HOD1, else HOD2, else HR. */
export const lineManagerRole = (appr) =>
  (appr.rpt_empcode ? "RPT" : mobileKey(appr.hod1_mno) ? "HOD1" : mobileKey(appr.hod2_mno) ? "HOD2" : "HR");

/** Roles the signed-in person holds on an appraisal (RPT / HOD1 / HOD2 / MGMT = CEO). */
export const rolesOn = (appr, me, mgmt) => {
  const roles = [];
  const key = mobileKey(me.mobile);
  if (appr.rpt_empcode && appr.rpt_empcode === me.empcode) roles.push("RPT");
  if (key && mobileKey(appr.hod1_mno) === key) roles.push("HOD1");
  if (key && mobileKey(appr.hod2_mno) === key) roles.push("HOD2");
  if (mgmt) roles.push("MGMT");
  return roles;
};
/**
 * The company's rating scale (A+ … D on the 1–5 total). A company that has none gets the DCL default:
 * written to the table when `seed` is set (callers inside a transaction),
 * otherwise only returned (read-only callers).
 */
export const loadScale = async (connection, compc, { seed = false } = {}) => {
  const q = () => connection.execute(
    `SELECT SCALE_ID, MIN_SCORE, MAX_SCORE, LABEL, TARGET_PCT, IS_DEVELOPMENT, DESCRIPTION
       FROM HR_APPR_RATING_SCALE WHERE COMPC = :compc ORDER BY MIN_SCORE DESC`,
    { compc }, { outFormat: OUT_ARRAY },
  );
  let r = await q();
  if (!r.rows?.length) {
    if (!seed) return DEFAULT_SCALE.map((b) => ({ scale_id: null, ...b }));
    for (const b of DEFAULT_SCALE) {
      await connection.execute(
        `INSERT INTO HR_APPR_RATING_SCALE (SCALE_ID, COMPC, MIN_SCORE, MAX_SCORE, LABEL, DESCRIPTION, TARGET_PCT, IS_DEVELOPMENT, CREATED_BY)
         VALUES (HR_APPR_RATING_SCALE_SEQ.NEXTVAL, :compc, :mn, :mx, :l, :descr, :t, :d, 'SYSTEM')`,
        { compc, mn: b.min_score, mx: b.max_score, l: b.label, descr: b.description, t: b.target_pct, d: b.is_development ? "Y" : "N" },
      );
    }
    r = await q();
  }
  return (r.rows ?? []).map((x) => ({
    scale_id: num(x[0]), min_score: num(x[1]), max_score: num(x[2]), label: s(x[3]),
    target_pct: numOrNull(x[4]), is_development: s(x[5]) === "Y", description: s(x[6]),
  }));
};

/** Promotion scorecard settings of a company (defaults when none saved). */
export const loadSettings = async (connection, compc) => {
  const r = await connection.execute(
    `SELECT COMP_WEIGHT_PCT, PERF_WEIGHT_PCT, MIN_TENURE_YRS FROM HR_APPR_SETTING WHERE COMPC = :compc`,
    { compc }, { outFormat: OUT_ARRAY },
  );
  const x = r.rows?.[0];
  return { comp_weight_pct: x ? num(x[0]) : 50, perf_weight_pct: x ? num(x[1]) : 50, min_tenure_yrs: x ? num(x[2]) : 2 };
};

/** Promotion decision bands of a company (defaults when none saved). */
export const loadPromoBands = async (connection, compc) => {
  const r = await connection.execute(
    `SELECT BAND_ID, MIN_SCORE, LABEL, OUTCOME FROM HR_PROMO_BAND WHERE COMPC = :compc ORDER BY MIN_SCORE DESC`,
    { compc }, { outFormat: OUT_ARRAY },
  );
  if (!r.rows?.length) return DEFAULT_PROMO_BANDS.map((b) => ({ band_id: null, ...b }));
  return r.rows.map((x) => ({ band_id: num(x[0]), min_score: num(x[1]), label: s(x[2]), outcome: s(x[3]) }));
};
