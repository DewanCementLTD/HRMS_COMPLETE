/**
 * Appraisal cycles (HR): create/edit a cycle, push corporate/department
 * accountabilities, launch it for a set of employees, move it through its
 * phases (objectives → mid-year → year end) and close it.
 *
 * Launch creates one HR_APPRAISAL_MASTER per employee (stage OBJ_SETTING) with:
 *   - a snapshot of their approvers: reporting officer (RPT_OFFICER), HOD1, HOD2
 *     — a level that repeats an earlier one (same person) is dropped
 *   - a copy of the cycle's corporate / department accountabilities
 */

import {
  OUT_ARRAY, s, num, numOrNull, ymd, fyOf, mobileKey, AppraisalError, nextId, writeLog, read, withTx,
  EMP_DEPT_SQL,
} from "./appraisalShared.service.js";
import { SHEET_RULES } from "./appraisalRules.js";

const CYCLE_SELECT = `
  SELECT y.CYCLE_ID, y.NAME, y.CYCLE_TYPE, y.FY_YEAR, y.PERIOD_FROM, y.PERIOD_TO, y.GOAL_DEADLINE,
         y.SELF_DEADLINE, y.REVIEW_DEADLINE, y.STATUS, y.REMARKS, y.PHASE,
         (SELECT COUNT(*) FROM HR_APPRAISAL_MASTER a WHERE a.CYCLE_ID = y.CYCLE_ID AND a.STAGE <> 'CANCELLED'),
         (SELECT COUNT(*) FROM HR_APPRAISAL_MASTER a WHERE a.CYCLE_ID = y.CYCLE_ID AND a.STAGE = 'COMPLETED'),
         (SELECT COUNT(*) FROM HR_GOAL_MASTER g WHERE g.CYCLE_ID = y.CYCLE_ID),
         (SELECT COUNT(*) FROM HR_APPRAISAL_MASTER a WHERE a.CYCLE_ID = y.CYCLE_ID AND a.STAGE IN ('OBJ_SETTING','OBJ_REVIEW')),
         (SELECT COUNT(*) FROM HR_APPRAISAL_MASTER a WHERE a.CYCLE_ID = y.CYCLE_ID AND a.STAGE IN ('MIDYEAR','MID_REVIEW'))
    FROM HR_APPRAISAL_CYCLE y`;

export const rowToCycle = (x) => ({
  cycle_id: num(x[0]), name: s(x[1]), cycle_type: s(x[2]), fy_year: num(x[3]),
  period_from: ymd(x[4]), period_to: ymd(x[5]), goal_deadline: ymd(x[6]), self_deadline: ymd(x[7]),
  review_deadline: ymd(x[8]), status: s(x[9]), remarks: s(x[10]), phase: s(x[11]) || "OBJECTIVES",
  appraisal_count: num(x[12]), completed_count: num(x[13]), goal_count: num(x[14]),
  objectives_open: num(x[15]), midyear_open: num(x[16]),
});

export const listCycles = (compc) => read(async (c) => {
  const r = await c.execute(`${CYCLE_SELECT} WHERE y.COMPC = :compc ORDER BY y.PERIOD_TO DESC, y.CYCLE_ID DESC`, { compc }, { outFormat: OUT_ARRAY });
  return (r.rows ?? []).map(rowToCycle);
});

export const loadCycle = async (c, compc, cycleId) => {
  const r = await c.execute(`${CYCLE_SELECT} WHERE y.CYCLE_ID = :id AND y.COMPC = :compc`, { id: cycleId, compc }, { outFormat: OUT_ARRAY });
  if (!r.rows?.length) throw new AppraisalError("Cycle not found", 404);
  return rowToCycle(r.rows[0]);
};

export const getCycle = (compc, cycleId) => read(async (c) => {
  const cycle = await loadCycle(c, compc, cycleId);
  return { ...cycle, goals: await listCycleGoalsC(c, cycleId) };
});

export const saveCycle = (compc, actor, id, body) => withTx(async (c) => {
  const b = {
    name: s(body.name), ctype: body.cycle_type, fy: numOrNull(body.fy_year) ?? fyOf(body.period_from),
    pf: body.period_from, pt: body.period_to, gd: body.goal_deadline || null, sd: body.self_deadline || null,
    rd: body.review_deadline || null, rem: s(body.remarks) || null, actor,
  };
  if (b.pt < b.pf) throw new AppraisalError("The period ends before it starts");
  if (id) {
    const cur = await loadCycle(c, compc, id);
    if (cur.status === "CLOSED") throw new AppraisalError("This cycle is closed");
    await c.execute(
      `UPDATE HR_APPRAISAL_CYCLE SET NAME = :name, CYCLE_TYPE = :ctype, FY_YEAR = :fy,
              PERIOD_FROM = TO_DATE(:pf,'YYYY-MM-DD'), PERIOD_TO = TO_DATE(:pt,'YYYY-MM-DD'),
              GOAL_DEADLINE = TO_DATE(:gd,'YYYY-MM-DD'), SELF_DEADLINE = TO_DATE(:sd,'YYYY-MM-DD'),
              REVIEW_DEADLINE = TO_DATE(:rd,'YYYY-MM-DD'), REMARKS = :rem, UPDATED_BY = :actor, UPDATED_AT = SYSDATE
        WHERE CYCLE_ID = :id AND COMPC = :compc`,
      { ...b, id, compc },
    );
    await writeLog(c, { compc, entity: "CYCLE", entityId: id, action: "UPDATE", details: { previous: cur }, actor });
    return { cycle_id: id };
  }
  const newId = await nextId(c, "HR_APPRAISAL_CYCLE_SEQ");
  await c.execute(
    `INSERT INTO HR_APPRAISAL_CYCLE (CYCLE_ID, COMPC, NAME, CYCLE_TYPE, FY_YEAR, PERIOD_FROM, PERIOD_TO,
            GOAL_DEADLINE, SELF_DEADLINE, REVIEW_DEADLINE, REMARKS, CREATED_BY)
     VALUES (:id, :compc, :name, :ctype, :fy, TO_DATE(:pf,'YYYY-MM-DD'), TO_DATE(:pt,'YYYY-MM-DD'),
             TO_DATE(:gd,'YYYY-MM-DD'), TO_DATE(:sd,'YYYY-MM-DD'), TO_DATE(:rd,'YYYY-MM-DD'), :rem, :actor)`,
    { ...b, id: newId, compc },
  );
  await writeLog(c, { compc, entity: "CYCLE", entityId: newId, action: "CREATE", actor });
  return { cycle_id: newId };
});

/** Delete a cycle that was never launched. */
export const deleteCycle = (compc, actor, id) => withTx(async (c) => {
  const cur = await loadCycle(c, compc, id);
  const used = await c.execute(`SELECT COUNT(*) FROM HR_APPRAISAL_MASTER WHERE CYCLE_ID = :id`, { id }, { outFormat: OUT_ARRAY });
  if (num(used.rows[0][0]) > 0) throw new AppraisalError("This cycle already has appraisals — close it instead", 409);
  await c.execute(`DELETE FROM HR_GOAL_MASTER WHERE CYCLE_ID = :id`, { id });
  await c.execute(`DELETE FROM HR_APPRAISAL_CYCLE WHERE CYCLE_ID = :id AND COMPC = :compc`, { id, compc });
  await writeLog(c, { compc, entity: "CYCLE", entityId: id, action: "DELETE", details: { name: cur.name }, actor });
  return { deleted: true };
});

/**
 * DRAFT → ACTIVE (launching also activates), ACTIVE → CLOSED, CLOSED → ACTIVE (reopen).
 * Closing leaves unfinished appraisals where they are, read-only.
 */
export const setCycleStatus = (compc, actor, id, status) => withTx(async (c) => {
  const cur = await loadCycle(c, compc, id);
  const allowed = { DRAFT: ["ACTIVE"], ACTIVE: ["CLOSED"], CLOSED: ["ACTIVE"] };
  if (!allowed[cur.status]?.includes(status)) throw new AppraisalError(`A ${cur.status.toLowerCase()} cycle cannot be set to ${status.toLowerCase()}`);
  await c.execute(
    `UPDATE HR_APPRAISAL_CYCLE SET STATUS = :st, UPDATED_BY = :actor, UPDATED_AT = SYSDATE WHERE CYCLE_ID = :id`,
    { st: status, actor, id },
  );
  await writeLog(c, { compc, entity: "CYCLE", entityId: id, action: `STATUS_${status}`, details: { from: cur.status }, actor });
  return { cycle_id: id, status };
});

/**
 * Phase of the cycle, opened by HR in order: OBJECTIVES → MIDYEAR → YEAREND.
 * Employees fill the mid-year review only from MIDYEAR, HODs rate only from YEAREND.
 */
export const setCyclePhase = (compc, actor, id, phase) => withTx(async (c) => {
  const cur = await loadCycle(c, compc, id);
  if (cur.status === "CLOSED") throw new AppraisalError("This cycle is closed");
  const order = ["OBJECTIVES", "MIDYEAR", "YEAREND"];
  if (order.indexOf(phase) < order.indexOf(cur.phase) - 1) throw new AppraisalError("Phases can only go back one step at a time");
  await c.execute(
    `UPDATE HR_APPRAISAL_CYCLE SET PHASE = :ph, UPDATED_BY = :actor, UPDATED_AT = SYSDATE WHERE CYCLE_ID = :id`,
    { ph: phase, actor, id },
  );
  await writeLog(c, { compc, entity: "CYCLE", entityId: id, action: `PHASE_${phase}`, details: { from: cur.phase }, actor });
  return { cycle_id: id, phase, objectives_open: cur.objectives_open, midyear_open: cur.midyear_open };
});

// ---------------------------------------------------------------------------
// Corporate / department accountabilities of a cycle
// ---------------------------------------------------------------------------

const listCycleGoalsC = async (c, cycleId) => {
  const r = await c.execute(
    `SELECT g.GOAL_ID, g.LEVEL_TYPE, g.DEPT_NO,
            (SELECT MAX(d.DEPT_NAME) FROM HR_DEPT d WHERE LTRIM(TO_CHAR(d.DEPT_NO),'0') = LTRIM(g.DEPT_NO,'0') AND d.COMPC = g.COMPC),
            g.OBJECTIVE, g.KPI_TEXT, g.TARGET, g.WEIGHTAGE
       FROM HR_GOAL_MASTER g WHERE g.CYCLE_ID = :id ORDER BY g.LEVEL_TYPE, g.DEPT_NO NULLS FIRST, g.GOAL_ID`,
    { id: cycleId }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => ({
    goal_id: num(x[0]), level_type: s(x[1]), dept_no: s(x[2]) || null, dept_name: s(x[3]),
    objective: s(x[4]), kpi_text: s(x[5]), target: s(x[6]), weightage: num(x[7]),
  }));
};

export const saveCycleGoal = (compc, actor, cycleId, goalId, body) => withTx(async (c) => {
  const cycle = await loadCycle(c, compc, cycleId);
  if (cycle.status === "CLOSED") throw new AppraisalError("This cycle is closed");
  const b = {
    lvl: body.level_type, dept: body.level_type === "DEPARTMENT" ? s(body.dept_no) : null,
    obj: s(body.objective), kpi: s(body.kpi_text) || null, tgt: s(body.target) || null, w: num(body.weightage), actor,
  };
  if (b.lvl === "DEPARTMENT" && !b.dept) throw new AppraisalError("Choose the department for a department goal");
  if (b.w < SHEET_RULES.minWeight || b.w > SHEET_RULES.maxWeight) {
    throw new AppraisalError(`Weightage must be between ${SHEET_RULES.minWeight}% and ${SHEET_RULES.maxWeight}%`);
  }
  if (goalId) {
    const r = await c.execute(
      `UPDATE HR_GOAL_MASTER SET LEVEL_TYPE = :lvl, DEPT_NO = :dept, OBJECTIVE = :obj, KPI_TEXT = :kpi, TARGET = :tgt,
              WEIGHTAGE = :w, UPDATED_BY = :actor, UPDATED_AT = SYSDATE
        WHERE GOAL_ID = :gid AND CYCLE_ID = :cid`,
      { ...b, gid: goalId, cid: cycleId },
    );
    if (!r.rowsAffected) throw new AppraisalError("Goal not found", 404);
    return { goal_id: goalId, note: cycle.appraisal_count ? "Already launched appraisals keep their copy of this goal" : undefined };
  }
  const id = await nextId(c, "HR_GOAL_MASTER_SEQ");
  await c.execute(
    `INSERT INTO HR_GOAL_MASTER (GOAL_ID, COMPC, CYCLE_ID, LEVEL_TYPE, DEPT_NO, OBJECTIVE, KPI_TEXT, TARGET, WEIGHTAGE, CREATED_BY)
     VALUES (:id, :compc, :cid, :lvl, :dept, :obj, :kpi, :tgt, :w, :actor)`,
    { ...b, id, compc, cid: cycleId },
  );
  return { goal_id: id };
});

export const deleteCycleGoal = (compc, cycleId, goalId) => withTx(async (c) => {
  await loadCycle(c, compc, cycleId);
  const used = await c.execute(`SELECT COUNT(*) FROM HR_EMPLOYEE_GOAL WHERE GOAL_ID = :g`, { g: goalId }, { outFormat: OUT_ARRAY });
  if (num(used.rows[0][0]) > 0) throw new AppraisalError("This goal has been copied into launched appraisals and cannot be deleted", 409);
  const r = await c.execute(`DELETE FROM HR_GOAL_MASTER WHERE GOAL_ID = :g AND CYCLE_ID = :cid`, { g: goalId, cid: cycleId });
  if (!r.rowsAffected) throw new AppraisalError("Goal not found", 404);
  return { deleted: true };
});

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

/**
 * Employees a launch would cover. Filters (all optional): explicit empcodes,
 * departments, branch, employment statuses (HR_EMP_STATUS codes, e.g. '1' =
 * probationary). Probation / confirmation cycles default to probationers.
 */
const candidates = async (c, compc, cycle, f) => {
  const binds = { compc, cid: cycle.cycle_id };
  let where = "";
  const list = (vals, col, prefix) => {
    const ph = vals.map((v, i) => { binds[`${prefix}${i}`] = String(v); return `:${prefix}${i}`; });
    where += ` AND ${col} IN (${ph.join(",")})`;
  };
  if (f.empcodes?.length) list(f.empcodes, "m.EMPCODE", "e");
  if (f.dept_nos?.length) {
    const ph = f.dept_nos.map((v, i) => { binds[`d${i}`] = String(v).replace(/^0+/, ""); return `:d${i}`; });
    where += ` AND LTRIM(m.DEPT_NO,'0') IN (${ph.join(",")})`;
  }
  if (f.brnch) { where += " AND TO_CHAR(m.LOCATION) = :b"; binds.b = String(f.brnch); }
  const statuses = f.emp_statuses?.length ? f.emp_statuses
    : (!f.empcodes?.length && ["PROBATION", "CONFIRMATION"].includes(cycle.cycle_type) ? ["1"] : []);
  if (statuses.length) list(statuses, "m.EMP_STATUS", "st");

  const r = await c.execute(
    `SELECT m.EMPCODE, m.NAME, m.LOCATION, m.DEPT_NO, m.DESG_CD, m.GRADE_CD,
            (SELECT MAX(g.DESG_GRP) FROM HR_DESG g WHERE TO_CHAR(g.DESG_CD) = m.DESG_CD AND g.COMPC = m.UNIT_ID),
            TO_CHAR(m."MOBILE#"),
            (SELECT MAX(r.EMPCODE) FROM HR_EMP_MASTER r WHERE r.EMPCODE = m.RPT_OFFICER AND NVL(r.STATUS,'A') = 'A'),
            (SELECT MAX(TO_CHAR(r."MOBILE#")) FROM HR_EMP_MASTER r WHERE r.EMPCODE = m.RPT_OFFICER),
            (SELECT MAX(TO_CHAR(e.HOD1)) FROM EMPLOYEE e WHERE e.EMPCODE = m.EMPCODE),
            (SELECT MAX(TO_CHAR(e.HOD2)) FROM EMPLOYEE e WHERE e.EMPCODE = m.EMPCODE),
            ${EMP_DEPT_SQL},
            (SELECT COUNT(*) FROM HR_APPRAISAL_MASTER a WHERE a.CYCLE_ID = :cid AND a.EMPCODE = m.EMPCODE)
       FROM HR_EMP_MASTER m
      WHERE m.UNIT_ID = :compc AND NVL(m.STATUS,'A') = 'A'${where}
      ORDER BY UPPER(m.NAME)`,
    binds, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => ({
    empcode: s(x[0]), name: s(x[1]), brnch: numOrNull(x[2]), dept_no: s(x[3]), desg_cd: s(x[4]), grade_cd: s(x[5]),
    desg_grp: s(x[6]), mobile: s(x[7]), rpt: s(x[8]), rpt_mobile: s(x[9]), hod1: s(x[10]), hod2: s(x[11]),
    dept_name: s(x[12]), already: num(x[13]) > 0,
  }));
};

/** Approver snapshot with repeated people removed (BRD §22: each level is a different person). */
export const approverSnapshot = (emp) => {
  const own = mobileKey(emp.mobile);
  const rpt = emp.rpt && emp.rpt !== emp.empcode ? emp.rpt : null;
  const seen = new Set([own, rpt ? mobileKey(emp.rpt_mobile) : null].filter(Boolean));
  const keep = (mno) => {
    const k = mobileKey(mno);
    if (!k || seen.has(k)) return null;
    seen.add(k);
    return mno;
  };
  const hod1 = keep(emp.hod1);
  const hod2 = keep(emp.hod2);
  const goalReviewer = rpt ? "RPT" : hod1 ? "HOD1" : hod2 ? "HOD2" : "HR";
  return { rpt, hod1, hod2, goalReviewer };
};

/** What a launch would do, without doing it. */
export const previewLaunch = (compc, cycleId, filters) => read(async (c) => {
  const cycle = await loadCycle(c, compc, cycleId);
  const emps = await candidates(c, compc, cycle, filters);
  return {
    total: emps.length,
    items: emps.map((e) => {
      const snap = approverSnapshot(e);
      return {
        empcode: e.empcode, name: e.name, dept_name: e.dept_name, already: e.already,
        has_rpt: !!snap.rpt, has_hod1: !!snap.hod1, has_hod2: !!snap.hod2,
      };
    }),
  };
});

export const launchCycle = (compc, actor, cycleId, filters) => withTx(async (c) => {
  const cycle = await loadCycle(c, compc, cycleId);
  if (cycle.status === "CLOSED") throw new AppraisalError("This cycle is closed");
  const goals = await listCycleGoalsC(c, cycleId);
  const emps = await candidates(c, compc, cycle, filters);
  if (!emps.length) throw new AppraisalError("No active employees match these filters");

  let created = 0;
  const skipped = [];
  for (const e of emps) {
    if (e.already) { skipped.push({ empcode: e.empcode, name: e.name, reason: "Already in this cycle" }); continue; }
    const snap = approverSnapshot(e);
    const myGoals = goals.filter((g) => g.level_type === "CORPORATE"
      || s(g.dept_no).replace(/^0+/, "") === s(e.dept_no).replace(/^0+/, ""));
    const stage = "OBJ_SETTING";

    const id = await nextId(c, "HR_APPRAISAL_MASTER_SEQ");
    await c.execute(
      `INSERT INTO HR_APPRAISAL_MASTER (APPRAISAL_ID, COMPC, CYCLE_ID, EMPCODE, BRNCH, DEPT_NO, DESG_CD, GRADE_CD,
              RPT_EMPCODE, HOD1_MNO, HOD2_MNO, STAGE, GOAL_REVIEWER, CREATED_BY)
       VALUES (:id, :compc, :cid, :e, :b, :dept, :desg, :grade, :rpt, :h1, :h2, :stg, :gr, :actor)`,
      {
        id, compc, cid: cycleId, e: e.empcode, b: e.brnch, dept: e.dept_no || null, desg: e.desg_cd || null,
        grade: e.grade_cd || null, rpt: snap.rpt, h1: snap.hod1, h2: snap.hod2, stg: stage, gr: snap.goalReviewer, actor,
      },
    );
    let seq = 0;
    for (const g of myGoals) {
      await c.execute(
        `INSERT INTO HR_EMPLOYEE_GOAL (EMP_GOAL_ID, APPRAISAL_ID, SOURCE, GOAL_ID, ACCOUNTABILITY, OBJECTIVE, KPI_TEXT, TARGET, WEIGHTAGE, SEQ)
         VALUES (HR_EMPLOYEE_GOAL_SEQ.NEXTVAL, :a, :src, :g, :acc, :obj, :kpi, :tgt, :w, :seq)`,
        {
          a: id, src: g.level_type, g: g.goal_id, acc: g.level_type === "CORPORATE" ? "Corporate objective" : "Department objective",
          obj: g.objective, kpi: g.kpi_text || null, tgt: g.target || null, w: g.weightage, seq: seq++,
        },
      );
    }
    await writeLog(c, {
      compc, entity: "APPRAISAL", entityId: id, action: "LAUNCH",
      details: { cycle_id: cycleId, rpt: snap.rpt, hod1: !!snap.hod1, hod2: !!snap.hod2 }, actor,
    });
    created++;
  }
  if (cycle.status === "DRAFT" && created) {
    await c.execute(`UPDATE HR_APPRAISAL_CYCLE SET STATUS = 'ACTIVE', UPDATED_BY = :actor, UPDATED_AT = SYSDATE WHERE CYCLE_ID = :id`, { actor, id: cycleId });
  }
  await writeLog(c, { compc, entity: "CYCLE", entityId: cycleId, action: "LAUNCH", details: { created, skipped: skipped.length }, actor });
  return { created, skipped };
});
