/**
 * Appraisal dashboard, reports and the "Performance Appraisal Summary Sheet"
 * (DCL) for HR, one company at a time.
 *
 * Scores are the Total "A" of the task sheet (1.00–5.00); grades A+ … D come
 * from the company scale (HR may normalise a grade). An appraisal counts as
 * graded once it has reached the HR stage.
 */

import { OUT_ARRAY, s, num, numOrNull, r2, ymd, read, withTx, AppraisalError, STAGE_LABEL, loadScale } from "./appraisalShared.service.js";
import { categoryOf, yearsBetween, CATEGORY_LABEL } from "./appraisalRules.js";
import { bellCurve } from "./appraisalWorkflow.service.js";
import { listRecommendations } from "./appraisalApply.service.js";
import { CASE_STATUS_LABEL } from "./appraisalPromotion.service.js";

const GRADED = "('HR','COMPLETED')";
const DEPT_SQL = `(SELECT MAX(d.DEPT_NAME) FROM HR_DEPT d WHERE LTRIM(TO_CHAR(d.DEPT_NO),'0') = LTRIM(a.DEPT_NO,'0') AND d.COMPC = a.COMPC)`;
const DESG_SQL = `(SELECT MAX(g.DESG_DESC) FROM HR_DESG g WHERE TO_CHAR(g.DESG_CD) = a.DESG_CD AND g.COMPC = a.COMPC)`;

/** The cycle a dashboard/report is about: the one asked for, else the latest active, else the latest. */
const pickCycle = async (c, compc, cycleId) => {
  const r = await c.execute(
    `SELECT CYCLE_ID, NAME, STATUS, CYCLE_TYPE, PERIOD_FROM, PERIOD_TO, PHASE FROM HR_APPRAISAL_CYCLE
      WHERE COMPC = :compc AND (:cid IS NULL OR CYCLE_ID = :cid) AND STATUS <> 'DRAFT'
      ORDER BY CASE WHEN STATUS = 'ACTIVE' THEN 0 ELSE 1 END, PERIOD_TO DESC, CYCLE_ID DESC
      FETCH FIRST 1 ROWS ONLY`,
    { compc, cid: cycleId ? num(cycleId) : null }, { outFormat: OUT_ARRAY },
  );
  const x = r.rows?.[0];
  if (!x) return null;
  return { cycle_id: num(x[0]), name: s(x[1]), status: s(x[2]), cycle_type: s(x[3]), period_from: ymd(x[4]), period_to: ymd(x[5]), phase: s(x[6]) };
};

const performers = async (c, compc, cycleId, order, limit) => {
  const r = await c.execute(
    `SELECT a.APPRAISAL_ID, a.EMPCODE, m.NAME, ${DEPT_SQL}, ${DESG_SQL}, a.FINAL_SCORE, a.FINAL_RATING, a.STAGE
       FROM HR_APPRAISAL_MASTER a LEFT JOIN HR_EMP_MASTER m ON m.EMPCODE = a.EMPCODE
      WHERE a.COMPC = :compc AND a.CYCLE_ID = :cid AND a.STAGE IN ${GRADED} AND a.FINAL_SCORE IS NOT NULL
      ORDER BY a.FINAL_SCORE ${order}, UPPER(m.NAME)
      FETCH FIRST ${Number(limit) || 10} ROWS ONLY`,
    { compc, cid: cycleId }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => ({
    appraisal_id: num(x[0]), empcode: s(x[1]), name: s(x[2]), dept_name: s(x[3]), desg_desc: s(x[4]),
    final_score: numOrNull(x[5]), final_rating: s(x[6]), stage: s(x[7]),
  }));
};

const departments = async (c, compc, cycleId) => {
  const r = await c.execute(
    `SELECT a.DEPT_NO, MAX(${DEPT_SQL}), COUNT(*),
            SUM(CASE WHEN a.STAGE IN ${GRADED} AND a.FINAL_SCORE IS NOT NULL THEN 1 ELSE 0 END),
            ROUND(AVG(CASE WHEN a.STAGE IN ${GRADED} THEN a.FINAL_SCORE END), 2),
            MIN(CASE WHEN a.STAGE IN ${GRADED} THEN a.FINAL_SCORE END),
            MAX(CASE WHEN a.STAGE IN ${GRADED} THEN a.FINAL_SCORE END),
            SUM(CASE WHEN a.STAGE = 'COMPLETED' THEN 1 ELSE 0 END)
       FROM HR_APPRAISAL_MASTER a
      WHERE a.COMPC = :compc AND a.CYCLE_ID = :cid AND a.STAGE <> 'CANCELLED'
      GROUP BY a.DEPT_NO
      ORDER BY 5 DESC NULLS LAST`,
    { compc, cid: cycleId }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x, i) => ({
    rank: x[4] === null ? null : i + 1, dept_no: s(x[0]), dept_name: s(x[1]) || s(x[0]) || "—", employees: num(x[2]),
    scored: num(x[3]), avg_score: numOrNull(x[4]), min_score: numOrNull(x[5]), max_score: numOrNull(x[6]), completed: num(x[7]),
  }));
};

export const dashboard = (compc, cycleId) => read(async (c) => {
  const cycle = await pickCycle(c, compc, cycleId);
  const cyclesR = await c.execute(
    `SELECT y.CYCLE_ID, y.NAME, y.STATUS, y.PERIOD_TO, y.PHASE,
            (SELECT COUNT(*) FROM HR_APPRAISAL_MASTER a WHERE a.CYCLE_ID = y.CYCLE_ID AND a.STAGE <> 'CANCELLED'),
            (SELECT COUNT(*) FROM HR_APPRAISAL_MASTER a WHERE a.CYCLE_ID = y.CYCLE_ID AND a.STAGE = 'COMPLETED')
       FROM HR_APPRAISAL_CYCLE y WHERE y.COMPC = :compc AND y.STATUS = 'ACTIVE' ORDER BY y.PERIOD_TO DESC`,
    { compc }, { outFormat: OUT_ARRAY },
  );
  const active_cycles = (cyclesR.rows ?? []).map((x) => ({
    cycle_id: num(x[0]), name: s(x[1]), status: s(x[2]), period_to: ymd(x[3]), phase: s(x[4]), appraisals: num(x[5]), completed: num(x[6]),
  }));
  if (!cycle) return { cycle: null, active_cycles };

  const st = await c.execute(
    `SELECT STAGE, COUNT(*) FROM HR_APPRAISAL_MASTER WHERE COMPC = :compc AND CYCLE_ID = :cid GROUP BY STAGE`,
    { compc, cid: cycle.cycle_id }, { outFormat: OUT_ARRAY },
  );
  const byStage = Object.fromEntries((st.rows ?? []).map((x) => [s(x[0]), num(x[1])]));
  const stages = ["OBJ_SETTING", "OBJ_REVIEW", "MIDYEAR", "MID_REVIEW", "RPT", "HOD1", "HOD2", "HR", "COMPLETED"]
    .map((k) => ({ stage: k, label: STAGE_LABEL[k], count: byStage[k] ?? 0 }));
  const total = stages.reduce((t, x) => t + x.count, 0);

  const recs = await c.execute(
    `SELECT (SELECT COUNT(*) FROM HR_APPRAISAL_MASTER WHERE CYCLE_ID = :cid AND PROMO_RECOMMENDED = 'Y' AND STAGE <> 'CANCELLED'),
            (SELECT COUNT(*) FROM HR_PROMOTION_CASE p JOIN HR_APPRAISAL_MASTER a ON a.APPRAISAL_ID = p.APPRAISAL_ID
              WHERE a.CYCLE_ID = :cid AND p.STATUS NOT IN ('APPROVED','REJECTED','NOT_ELIGIBLE','CANCELLED')),
            (SELECT COUNT(*) FROM HR_PROMOTION_CASE p JOIN HR_APPRAISAL_MASTER a ON a.APPRAISAL_ID = p.APPRAISAL_ID
              WHERE a.CYCLE_ID = :cid AND p.STATUS = 'APPROVED'),
            (SELECT COUNT(*) FROM HR_INCREMENT_RECOMMENDATION n JOIN HR_APPRAISAL_MASTER a ON a.APPRAISAL_ID = n.APPRAISAL_ID
              WHERE a.CYCLE_ID = :cid AND n.STATUS IN ('PROPOSED','APPROVED','APPLIED')),
            (SELECT NVL(SUM(n.INC_AMOUNT),0) FROM HR_INCREMENT_RECOMMENDATION n JOIN HR_APPRAISAL_MASTER a ON a.APPRAISAL_ID = n.APPRAISAL_ID
              WHERE a.CYCLE_ID = :cid AND n.STATUS IN ('PROPOSED','APPROVED','APPLIED')),
            (SELECT ROUND(AVG(FINAL_SCORE),2) FROM HR_APPRAISAL_MASTER WHERE CYCLE_ID = :cid AND STAGE IN ${GRADED}),
            (SELECT COUNT(*) FROM HR_TRAINING_REQUEST q JOIN HR_APPRAISAL_MASTER a ON a.APPRAISAL_ID = q.APPRAISAL_ID WHERE a.CYCLE_ID = :cid),
            (SELECT COUNT(*) FROM HR_APPRAISAL_MASTER WHERE CYCLE_ID = :cid AND STAGE = 'COMPLETED' AND EMP_ACK_AT IS NULL)
       FROM DUAL`,
    { cid: cycle.cycle_id }, { outFormat: OUT_ARRAY },
  );
  const x = recs.rows[0];
  return {
    cycle,
    active_cycles,
    total,
    completed: byStage.COMPLETED ?? 0,
    pending_hr: byStage.HR ?? 0,
    stages,
    avg_score: numOrNull(x[5]),
    promotions_recommended: num(x[0]),
    promotion_cases_open: num(x[1]),
    promotions_approved: num(x[2]),
    increments: num(x[3]),
    increment_cost: num(x[4]),
    training_requests: num(x[6]),
    awaiting_ack: num(x[7]),
    bell_curve: await bellCurve(compc, cycle.cycle_id),
    departments: await departments(c, compc, cycle.cycle_id),
    top: await performers(c, compc, cycle.cycle_id, "DESC", 5),
    low: await performers(c, compc, cycle.cycle_id, "ASC", 5),
  };
});

// ---------------------------------------------------------------------------
// Performance Appraisal Summary Sheet (per department)
// ---------------------------------------------------------------------------

/**
 * Every active employee of the company (optionally one department) with their
 * appraisal of the cycle, summary-sheet category and the columns of the DCL sheet.
 */
const summaryEmployees = async (c, compc, cycle, dept) => {
  const binds = { compc, cid: cycle.cycle_id };
  let where = "";
  if (dept) { where = " AND LTRIM(m.DEPT_NO,'0') = LTRIM(:dept,'0')"; binds.dept = s(dept); }
  const r = await c.execute(
    `SELECT m.EMPCODE, m.NAME, m.DTOFBRTH, m.DTOFAPPT, m.DESG_CD,
            (SELECT MAX(g.DESG_DESC) FROM HR_DESG g WHERE TO_CHAR(g.DESG_CD) = m.DESG_CD AND g.COMPC = m.UNIT_ID),
            m.GRADE_CD, (SELECT MAX(gc.DESCR) FROM HR_GRADE_CD gc WHERE gc.GRADE_CD = m.GRADE_CD),
            m.DEPT_NO, (SELECT MAX(d.DEPT_NAME) FROM HR_DEPT d WHERE LTRIM(TO_CHAR(d.DEPT_NO),'0') = LTRIM(m.DEPT_NO,'0') AND d.COMPC = m.UNIT_ID),
            m.QFICATION, (SELECT MAX(l.LOC_NAME) FROM HR_LOCATION l WHERE TO_CHAR(l.LOC_ID) = TO_CHAR(m.LOCATION)),
            m.EMP_STATUS, (SELECT MAX(x.EMP_STATUS_DESC) FROM HR_EMP_STATUS x WHERE x.EMP_STATUS = m.EMP_STATUS),
            p.PRIOR_EXP_YEARS, p.CATEGORY_OVERRIDE, p.RESOURCE_TYPE, p.REMARKS,
            a.APPRAISAL_ID, a.STAGE, a.FINAL_RATING, a.HOD_GRADE, a.FINAL_SCORE, a.PROMO_RECOMMENDED,
            (SELECT MAX(pc.STATUS) FROM HR_PROMOTION_CASE pc WHERE pc.APPRAISAL_ID = a.APPRAISAL_ID)
       FROM HR_EMP_MASTER m
       LEFT JOIN HR_EMP_APPR_PROFILE p ON p.EMPCODE = m.EMPCODE
       LEFT JOIN HR_APPRAISAL_MASTER a ON a.EMPCODE = m.EMPCODE AND a.CYCLE_ID = :cid AND a.STAGE <> 'CANCELLED'
      WHERE m.UNIT_ID = :compc AND NVL(m.STATUS,'A') = 'A'${where}
      ORDER BY UPPER(m.NAME)`,
    binds, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => {
    const graded = ["HR", "COMPLETED"].includes(s(x[19]));
    const inDcl = yearsBetween(x[3], cycle.period_to);
    const prior = numOrNull(x[14]);
    const category = categoryOf({ override: s(x[15]) || null, desgDesc: s(x[5]), empStatus: s(x[12]), joinDate: x[3], periodTo: cycle.period_to });
    return {
      empcode: s(x[0]), name: s(x[1]), age: yearsBetween(x[2]) === null ? null : Math.floor(yearsBetween(x[2])),
      doa: ymd(x[3]), desg_desc: s(x[5]), grade: s(x[6]), grade_title: s(x[7]), dept_no: s(x[8]), dept_name: s(x[9]) || s(x[8]),
      qualification: s(x[10]), location: s(x[11]), resource_type: s(x[16]) || s(x[13]),
      exp_dcl: inDcl, prior_exp: prior, total_exp: inDcl === null && prior === null ? null : r2((inDcl ?? 0) + (prior ?? 0)),
      category, category_override: s(x[15]) || null, remarks: s(x[17]),
      appraisal_id: numOrNull(x[18]), stage: s(x[19]) || null, stage_label: x[19] ? STAGE_LABEL[s(x[19])] ?? s(x[19]) : "Not launched",
      rating: graded ? s(x[20]) || null : null, hod_grade: graded ? s(x[21]) || s(x[20]) || null : null, score: graded ? numOrNull(x[22]) : null,
      promotion: s(x[23]) === "Y" ? (x[24] ? `Yes — ${CASE_STATUS_LABEL[s(x[24])] ?? s(x[24])}` : "Yes") : "",
    };
  });
};

export const summarySheet = (compc, cycleId, dept) => read(async (c) => {
  const cycle = await pickCycle(c, compc, cycleId);
  if (!cycle) return { cycle: null };
  const scale = await loadScale(c, compc);
  const emps = await summaryEmployees(c, compc, cycle, dept);
  const eligible = emps.filter((e) => ["FULL", "PRORATA"].includes(e.category));
  const graded = eligible.filter((e) => e.rating);
  const total = graded.length;

  // Bell curve of the eligible staff: standard vs actual vs the HODs' grades.
  const bell = scale.map((b) => {
    const count = graded.filter((e) => e.rating === b.label).length;
    const hodCount = graded.filter((e) => e.hod_grade === b.label).length;
    const standardCount = b.target_pct === null ? null : Math.round((total * b.target_pct) / 100);
    return {
      label: b.label, description: b.description, target_pct: b.target_pct, standard_count: standardCount, count, hod_count: hodCount,
      actual_pct: total ? r2((count / total) * 100) : 0,
      remark: standardCount === null || count === standardCount ? "MATCHED" : count > standardCount ? "ABOVE STANDARD" : "BELOW STANDARD",
    };
  });

  // Category table: counts per category and per grade.
  const categories = ["FULL", "PRORATA", "PROBATION", "TE_MTO"].map((k) => {
    const list = emps.filter((e) => e.category === k);
    return {
      category: k, label: CATEGORY_LABEL[k], count: list.length, eligible: ["FULL", "PRORATA"].includes(k),
      by_grade: Object.fromEntries(scale.map((b) => [b.label, list.filter((e) => e.rating === b.label).length])),
      not_graded: list.filter((e) => !e.rating).length,
    };
  });

  const deptsR = await c.execute(`SELECT DEPT_NO, DEPT_NAME FROM HR_DEPT WHERE COMPC = :compc ORDER BY UPPER(DEPT_NAME)`, { compc }, { outFormat: OUT_ARRAY });
  return {
    cycle, dept: dept || null,
    dept_name: dept ? emps[0]?.dept_name ?? s(dept) : "All departments",
    departments: (deptsR.rows ?? []).map((x) => ({ dept_no: s(x[0]), dept_name: s(x[1]) })),
    grades: scale.map((b) => ({ label: b.label, description: b.description })),
    totals: { strength: emps.length, eligible: eligible.length, graded: total },
    bell, categories,
    lists: Object.fromEntries(["FULL", "PRORATA", "PROBATION", "TE_MTO"].map((k) => [k, emps.filter((e) => e.category === k)])),
  };
});

/** HR keeps the summary-sheet data the ERP does not hold: prior experience, category override, resource type, remarks. */
export const saveProfile = (compc, actor, empcode, body) => withTx(async (c) => {
  const e = await c.execute(`SELECT 1 FROM HR_EMP_MASTER WHERE EMPCODE = :e AND UNIT_ID = :compc`, { e: s(empcode), compc }, { outFormat: OUT_ARRAY });
  if (!e.rows?.length) throw new AppraisalError("Employee not found in this company", 404);
  const prior = numOrNull(body.prior_exp_years);
  if (prior !== null && (prior < 0 || prior > 60)) throw new AppraisalError("Prior experience must be between 0 and 60 years");
  await c.execute(
    `MERGE INTO HR_EMP_APPR_PROFILE p USING (SELECT :e EMPCODE FROM DUAL) x ON (p.EMPCODE = x.EMPCODE)
      WHEN MATCHED THEN UPDATE SET PRIOR_EXP_YEARS = :pe, CATEGORY_OVERRIDE = :co, RESOURCE_TYPE = :rt, REMARKS = :rm,
                                   UPDATED_BY = :actor, UPDATED_AT = SYSDATE
      WHEN NOT MATCHED THEN INSERT (EMPCODE, PRIOR_EXP_YEARS, CATEGORY_OVERRIDE, RESOURCE_TYPE, REMARKS, UPDATED_BY, UPDATED_AT)
           VALUES (:e, :pe, :co, :rt, :rm, :actor, SYSDATE)`,
    {
      e: s(empcode), pe: prior, co: body.category_override || null, rt: s(body.resource_type).slice(0, 40) || null,
      rm: s(body.remarks).slice(0, 500) || null, actor: s(actor).slice(0, 30),
    },
  );
  return { saved: true };
});

// ---------------------------------------------------------------------------
// Reports — each returns { title, columns:[{key,label}], rows:[...] } for a generic table + CSV
// ---------------------------------------------------------------------------

const col = (key, label) => ({ key, label });

const employeeRows = async (c, compc, cycleId, f) => {
  const binds = { compc, cid: cycleId };
  let where = "";
  if (f.dept) { where += " AND LTRIM(a.DEPT_NO,'0') = LTRIM(:dept,'0')"; binds.dept = s(f.dept); }
  const r = await c.execute(
    `SELECT a.EMPCODE, m.NAME, ${DEPT_SQL}, ${DESG_SQL}, a.STAGE, a.SELF_SCORE, a.CALC_SCORE, a.HOD_GRADE, a.HR_ADJ_GRADE,
            a.FINAL_RATING, a.PROMO_RECOMMENDED,
            (SELECT MAX(n.INC_AMOUNT) FROM HR_INCREMENT_RECOMMENDATION n WHERE n.APPRAISAL_ID = a.APPRAISAL_ID AND n.STATUS <> 'REJECTED'),
            CASE WHEN a.EMP_ACK_AT IS NULL THEN '' ELSE 'Yes' END
       FROM HR_APPRAISAL_MASTER a LEFT JOIN HR_EMP_MASTER m ON m.EMPCODE = a.EMPCODE
      WHERE a.COMPC = :compc AND a.CYCLE_ID = :cid AND a.STAGE <> 'CANCELLED'${where}
      ORDER BY a.CALC_SCORE DESC NULLS LAST, UPPER(m.NAME)`,
    binds, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => {
    const graded = ["HR", "COMPLETED"].includes(s(x[4]));
    return {
      empcode: s(x[0]), name: s(x[1]), dept_name: s(x[2]), desg_desc: s(x[3]), stage: STAGE_LABEL[s(x[4])] ?? s(x[4]),
      self_score: numOrNull(x[5]), calc_score: numOrNull(x[6]), hod_grade: s(x[7]), hr_adj_grade: s(x[8]),
      final_rating: graded ? s(x[9]) : "", promotion: s(x[10]) === "Y" ? "Yes" : "", increment: numOrNull(x[11]), acknowledged: s(x[12]),
    };
  });
};

const caseRows = async (c, compc, cycleId) => {
  const r = await c.execute(
    `SELECT p.EMPCODE, m.NAME, (SELECT MAX(g.DESG_DESC) FROM HR_DESG g WHERE TO_CHAR(g.DESG_CD) = p.CUR_DESG_CD AND g.COMPC = p.COMPC),
            (SELECT MAX(g.DESG_DESC) FROM HR_DESG g WHERE TO_CHAR(g.DESG_CD) = p.PROP_DESG_CD AND g.COMPC = p.COMPC),
            p.ELIGIBILITY_RESULT, p.COMP_SCORE, p.PERF_SCORE, p.OVERALL_SCORE, p.DECISION_BAND, p.STATUS, p.EFFECTIVE_DATE
       FROM HR_PROMOTION_CASE p JOIN HR_APPRAISAL_MASTER a ON a.APPRAISAL_ID = p.APPRAISAL_ID
       LEFT JOIN HR_EMP_MASTER m ON m.EMPCODE = p.EMPCODE
      WHERE p.COMPC = :compc AND a.CYCLE_ID = :cid ORDER BY UPPER(m.NAME)`,
    { compc, cid: cycleId }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => ({
    empcode: s(x[0]), name: s(x[1]), cur_desg: s(x[2]), prop_desg: s(x[3]), eligibility: s(x[4]).replace("_", " "),
    comp_score: numOrNull(x[5]), perf_score: numOrNull(x[6]), overall: numOrNull(x[7]), band: s(x[8]),
    status: CASE_STATUS_LABEL[s(x[9])] ?? s(x[9]), effective_date: ymd(x[10]),
  }));
};

const trendRows = async (c, compc, f) => {
  const binds = { compc };
  let where = "";
  if (f.dept) { where += " AND LTRIM(h.DEPT_NO,'0') = LTRIM(:dept,'0')"; binds.dept = s(f.dept); }
  if (f.empcode) { where += " AND h.EMPCODE = :e"; binds.e = s(f.empcode); }
  const r = await c.execute(
    `SELECT h.EMPCODE, m.NAME, y.NAME, h.PERIOD_TO, h.FINAL_SCORE, h.FINAL_RATING
       FROM HR_PERFORMANCE_HISTORY h
       JOIN HR_APPRAISAL_CYCLE y ON y.CYCLE_ID = h.CYCLE_ID
       LEFT JOIN HR_EMP_MASTER m ON m.EMPCODE = h.EMPCODE
      WHERE h.COMPC = :compc${where}
      ORDER BY UPPER(m.NAME), h.PERIOD_TO`,
    binds, { outFormat: OUT_ARRAY },
  );
  const byEmp = new Map();
  for (const x of r.rows ?? []) {
    const e = byEmp.get(s(x[0])) ?? { empcode: s(x[0]), name: s(x[1]), points: [] };
    e.points.push({ cycle: s(x[2]), period_to: ymd(x[3]), score: numOrNull(x[4]), rating: s(x[5]) });
    byEmp.set(s(x[0]), e);
  }
  return [...byEmp.values()].map((e) => ({
    empcode: e.empcode, name: e.name, cycles: e.points.length,
    history: e.points.map((p) => `${p.cycle}: ${p.rating || "—"} (${p.score ?? "—"})`).join(" · "),
    latest_rating: e.points[e.points.length - 1]?.rating ?? "",
    points: e.points,
  }));
};

export const REPORTS = {
  employees: "Employee performance",
  departments: "Department performance",
  promotion_cases: "Promotion evaluations",
  promotions: "Promotion recommendations",
  increments: "Increment summary",
  distribution: "Bell curve / grade distribution",
  top: "Top performers",
  low: "Low performers",
  trend: "Performance trend",
};

export const runReport = (compc, type, f = {}) => read(async (c) => {
  if (!REPORTS[type]) throw new AppraisalError("Unknown report", 404);
  const title = REPORTS[type];
  if (type === "trend") {
    return {
      title, columns: [col("empcode", "Code"), col("name", "Employee"), col("cycles", "Cycles"), col("history", "Grades"), col("latest_rating", "Latest")],
      rows: await trendRows(c, compc, f),
    };
  }
  const cycle = await pickCycle(c, compc, f.cycle_id);
  if (!cycle) return { title, cycle: null, columns: [], rows: [] };
  const cid = cycle.cycle_id;
  const empCols = [col("empcode", "Code"), col("name", "Employee"), col("dept_name", "Department"), col("desg_desc", "Designation")];
  switch (type) {
    case "employees":
      return {
        title, cycle, rows: await employeeRows(c, compc, cid, f),
        columns: [...empCols, col("stage", "Stage"), col("self_score", "Self total"), col("calc_score", "Total \"A\""),
          col("hod_grade", "HOD grade"), col("hr_adj_grade", "HR grade"), col("final_rating", "Final grade"),
          col("promotion", "Promotion"), col("increment", "Increment"), col("acknowledged", "Employee signed")],
      };
    case "departments":
      return {
        title, cycle, rows: await departments(c, compc, cid),
        columns: [col("rank", "Rank"), col("dept_name", "Department"), col("employees", "Employees"), col("scored", "Graded"),
          col("completed", "Completed"), col("avg_score", "Average total"), col("min_score", "Lowest"), col("max_score", "Highest")],
      };
    case "promotion_cases":
      return {
        title, cycle, rows: await caseRows(c, compc, cid),
        columns: [col("empcode", "Code"), col("name", "Employee"), col("cur_desg", "Current"), col("prop_desg", "Proposed"),
          col("eligibility", "Eligibility"), col("comp_score", "Competency %"), col("perf_score", "Performance %"), col("overall", "Overall %"),
          col("band", "Decision band"), col("status", "Status"), col("effective_date", "Effective")],
      };
    case "promotions": {
      const rows = (await listRecommendations(compc, { cycle_id: cid, kind: "PROMOTION" }));
      return {
        title, cycle, rows,
        columns: [col("empcode", "Code"), col("emp_name", "Employee"), col("dept_name", "Department"), col("final_rating", "Grade"),
          col("cur_desg_desc", "Current"), col("prop_desg_desc", "Proposed"), col("recommended_by_name", "Recommended by"),
          col("status", "Status"), col("effective_date", "Effective")],
      };
    }
    case "increments": {
      const rows = (await listRecommendations(compc, { cycle_id: cid, kind: "INCREMENT" }));
      return {
        title, cycle, rows,
        columns: [col("empcode", "Code"), col("emp_name", "Employee"), col("dept_name", "Department"), col("final_rating", "Grade"),
          col("prev_gross", "Gross before"), col("inc_pct", "Inc %"), col("inc_amount", "Increment"), col("new_gross", "New gross"),
          col("status", "Status"), col("hist_doc_no", "Doc #")],
      };
    }
    case "distribution": {
      const bc = await bellCurve(compc, cid, { dept: f.dept });
      return {
        title, cycle, warnings: bc.warnings, rows: bc.bands,
        columns: [col("label", "Grade"), col("description", "Meaning"), col("target_pct", "Standard %"), col("standard_count", "Standard #"),
          col("count", "Actual #"), col("actual_pct", "Actual %"), col("hod_count", "HOD recommendation #"), col("remark", "Remarks")],
      };
    }
    case "top":
    case "low":
      return {
        title, cycle, rows: await performers(c, compc, cid, type === "top" ? "DESC" : "ASC", num(f.limit) || 20),
        columns: [...empCols, col("final_score", "Total \"A\""), col("final_rating", "Grade")],
      };
    default:
      throw new AppraisalError("Unknown report", 404);
  }
});
