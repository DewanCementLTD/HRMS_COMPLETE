/**
 * Training dashboard + reports (HR, one company).
 *
 * Training hours for a participant = the session's TOTAL_HOURS × their
 * attendance %, so a half-attended 16-hour course counts as 8 hours.
 * Report periods filter on the session's START_DATE.
 */

import { getDirectConnection } from "../config/database.js";
import { OUT_ARRAY, s, num, numOrNull, r2, ymd, fyLabel, mapOraError, EMP_DEPT_SQL } from "./trainingShared.service.js";
import { SESSION_COST_SQL } from "./trainingMaster.service.js";

const read = async (fn) => {
  const connection = await getDirectConnection();
  try {
    return await fn(connection);
  } catch (err) {
    return mapOraError(err);
  } finally {
    await connection.close();
  }
};

const HOURS_SQL = `NVL(x.TOTAL_HOURS, 0) * NVL(p.ATTEND_PCT, 0) / 100`;
const one = async (c, sql, binds) => (await c.execute(sql, binds, { outFormat: OUT_ARRAY })).rows?.[0] ?? [];

export const dashboard = (compc, fy) => read(async (c) => {
  const b = { compc, fy };
  const [pendingHr, toBook, pendingHod] = await one(c,
    `SELECT SUM(CASE WHEN STATUS = 'PENDING_HR' THEN 1 ELSE 0 END),
            SUM(CASE WHEN STATUS = 'APPROVED' THEN 1 ELSE 0 END),
            SUM(CASE WHEN STATUS IN ('PENDING_HOD1','PENDING_HOD2') THEN 1 ELSE 0 END)
       FROM HR_TRAINING_REQUEST WHERE COMPC = :compc`, { compc });

  const statusRows = (await c.execute(
    `SELECT STATUS, COUNT(*) FROM HR_TRAINING_SESSION WHERE COMPC = :compc AND FY_YEAR = :fy GROUP BY STATUS`,
    b, { outFormat: OUT_ARRAY })).rows ?? [];
  const sessions = Object.fromEntries(statusRows.map(([st, n]) => [s(st), num(n)]));

  const [trained, hours, certs, completed, failed, noShow, avgImp] = await one(c,
    `SELECT COUNT(DISTINCT CASE WHEN p.STATUS = 'COMPLETED' THEN p.EMPCODE END),
            SUM(CASE WHEN p.STATUS IN ('COMPLETED','FAILED') THEN ${HOURS_SQL} ELSE 0 END),
            SUM(CASE WHEN p.CERT_NO IS NOT NULL THEN 1 ELSE 0 END),
            SUM(CASE WHEN p.STATUS = 'COMPLETED' THEN 1 ELSE 0 END),
            SUM(CASE WHEN p.STATUS = 'FAILED' THEN 1 ELSE 0 END),
            SUM(CASE WHEN p.STATUS = 'NO_SHOW' THEN 1 ELSE 0 END),
            AVG(CASE WHEN p.PRE_SCORE_PCT IS NOT NULL AND p.POST_SCORE_PCT IS NOT NULL THEN p.POST_SCORE_PCT - p.PRE_SCORE_PCT END)
       FROM HR_TRAINING_PARTICIPANT p JOIN HR_TRAINING_SESSION x ON x.SESSION_ID = p.SESSION_ID
      WHERE x.COMPC = :compc AND x.FY_YEAR = :fy AND x.STATUS <> 'CANCELLED'`, b);

  const [cost] = await one(c,
    `SELECT NVL(SUM(${SESSION_COST_SQL}), 0) FROM HR_TRAINING_SESSION x
      WHERE x.COMPC = :compc AND x.FY_YEAR = :fy AND x.STATUS <> 'CANCELLED'`, b);
  // The company line is the budget; without one, the department lines add up to it.
  const [companyBudget, deptBudget] = await one(c,
    `SELECT SUM(CASE WHEN DEPT_NO IS NULL THEN AMOUNT END), SUM(CASE WHEN DEPT_NO IS NOT NULL THEN AMOUNT END)
       FROM HR_TRAINING_BUDGET WHERE COMPC = :compc AND FY_YEAR = :fy`, b);
  const budget = companyBudget !== null && companyBudget !== undefined ? num(companyBudget) : numOrNull(deptBudget);

  const [avgRating] = await one(c,
    `SELECT ROUND(AVG(f.RATING_OVERALL), 2) FROM HR_TRAINING_FEEDBACK f JOIN HR_TRAINING_SESSION x ON x.SESSION_ID = f.SESSION_ID
      WHERE x.COMPC = :compc AND x.FY_YEAR = :fy AND f.GIVEN_BY_TYPE = 'EMPLOYEE'`, b);

  const upcoming = (await c.execute(
    `SELECT x.SESSION_ID, x.SESSION_CODE, t.TITLE, x.START_DATE, x.END_DATE, x.MODE_TYPE, x.VENUE, x.CAPACITY, x.STATUS,
            (SELECT COUNT(*) FROM HR_TRAINING_PARTICIPANT p WHERE p.SESSION_ID = x.SESSION_ID AND p.STATUS <> 'WITHDRAWN')
       FROM HR_TRAINING_SESSION x JOIN HR_TRAINING_COURSE t ON t.COURSE_ID = x.COURSE_ID
      WHERE x.COMPC = :compc AND x.STATUS IN ('PLANNED','OPEN','IN_PROGRESS') AND x.END_DATE >= TRUNC(SYSDATE)
      ORDER BY x.START_DATE FETCH FIRST 8 ROWS ONLY`, { compc }, { outFormat: OUT_ARRAY })).rows ?? [];

  const byType = (await c.execute(
    `SELECT t.TRAINING_TYPE, COUNT(DISTINCT x.SESSION_ID), COUNT(CASE WHEN p.STATUS = 'COMPLETED' THEN 1 END)
       FROM HR_TRAINING_SESSION x JOIN HR_TRAINING_COURSE t ON t.COURSE_ID = x.COURSE_ID
       LEFT JOIN HR_TRAINING_PARTICIPANT p ON p.SESSION_ID = x.SESSION_ID
      WHERE x.COMPC = :compc AND x.FY_YEAR = :fy AND x.STATUS <> 'CANCELLED'
      GROUP BY t.TRAINING_TYPE ORDER BY 2 DESC`, b, { outFormat: OUT_ARRAY })).rows ?? [];

  const evaluated = num(completed) + num(failed) + num(noShow);
  return {
    fy_year: fy, fy_label: fyLabel(fy),
    requests: { pending_hr: num(pendingHr), to_book: num(toBook), pending_hod: num(pendingHod) },
    sessions: { ...sessions, total: Object.values(sessions).reduce((a, n) => a + n, 0) },
    employees_trained: num(trained), training_hours: r2(hours), certificates: num(certs),
    completion_rate: evaluated ? r2((100 * num(completed)) / evaluated) : null,
    avg_improvement: avgImp === null || avgImp === undefined ? null : r2(avgImp),
    cost: r2(cost), budget, budget_used_pct: budget ? r2((100 * num(cost)) / budget) : null,
    avg_rating: numOrNull(avgRating),
    upcoming: upcoming.map((x) => ({
      session_id: num(x[0]), session_code: s(x[1]), course_title: s(x[2]), start_date: ymd(x[3]), end_date: ymd(x[4]),
      mode: s(x[5]), venue: s(x[6]), capacity: num(x[7]), status: s(x[8]), participants: num(x[9]),
    })),
    by_type: byType.map((x) => ({ training_type: s(x[0]), sessions: num(x[1]), completed: num(x[2]) })),
  };
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const periodWhere = (binds, { from, to }) => {
  let w = "";
  if (from) { w += " AND x.START_DATE >= TO_DATE(:f, 'YYYY-MM-DD')"; binds.f = from; }
  if (to) { w += " AND x.START_DATE <= TO_DATE(:t, 'YYYY-MM-DD')"; binds.t = to; }
  return w;
};

const REPORTS = {
  // Training Programs Conducted
  conducted: async (c, compc, f) => {
    const binds = { compc };
    const w = periodWhere(binds, f) + (f.dept ? " AND x.DEPT_NO = :d" : "");
    if (f.dept) binds.d = f.dept;
    const r = await c.execute(
      `SELECT x.SESSION_CODE, t.TITLE, t.TRAINING_TYPE, tr.NAME, x.MODE_TYPE, x.START_DATE, x.END_DATE, x.TOTAL_HOURS, x.STATUS,
              COUNT(CASE WHEN p.STATUS <> 'WITHDRAWN' THEN 1 END), COUNT(CASE WHEN p.STATUS = 'COMPLETED' THEN 1 END),
              MAX(${SESSION_COST_SQL}),
              (SELECT ROUND(AVG(fb.RATING_OVERALL), 2) FROM HR_TRAINING_FEEDBACK fb WHERE fb.SESSION_ID = x.SESSION_ID AND fb.GIVEN_BY_TYPE = 'EMPLOYEE')
         FROM HR_TRAINING_SESSION x
         JOIN HR_TRAINING_COURSE t ON t.COURSE_ID = x.COURSE_ID
         LEFT JOIN HR_TRAINER tr ON tr.TRAINER_ID = x.TRAINER_ID
         LEFT JOIN HR_TRAINING_PARTICIPANT p ON p.SESSION_ID = x.SESSION_ID
        WHERE x.COMPC = :compc AND x.STATUS <> 'CANCELLED'${w}
        GROUP BY x.SESSION_ID, x.SESSION_CODE, t.TITLE, t.TRAINING_TYPE, tr.NAME, x.MODE_TYPE, x.START_DATE, x.END_DATE, x.TOTAL_HOURS, x.STATUS
        ORDER BY x.START_DATE DESC`, binds, { outFormat: OUT_ARRAY });
    return {
      title: "Training Programs Conducted",
      columns: ["Session", "Course", "Type", "Trainer", "Mode", "From", "To", "Hours", "Status", "Participants", "Completed", "Cost", "Rating"],
      numeric: [7, 9, 10, 11, 12],
      rows: (r.rows ?? []).map((x) => [s(x[0]), s(x[1]), s(x[2]), s(x[3]), s(x[4]), ymd(x[5]), ymd(x[6]), numOrNull(x[7]), s(x[8]),
        num(x[9]), num(x[10]), r2(x[11]), numOrNull(x[12])]),
    };
  },

  // Employees Trained + Training Hours
  employees: async (c, compc, f) => {
    const binds = { compc };
    const w = periodWhere(binds, f) + (f.dept ? " AND m.DEPT_NO = :d" : "");
    if (f.dept) binds.d = String(f.dept);
    const r = await c.execute(
      `SELECT p.EMPCODE, MAX(m.NAME), MAX(d.DEPT_NAME),
              COUNT(CASE WHEN p.STATUS <> 'WITHDRAWN' THEN 1 END), COUNT(CASE WHEN p.STATUS = 'COMPLETED' THEN 1 END),
              COUNT(CASE WHEN p.STATUS IN ('FAILED','NO_SHOW') THEN 1 END),
              ROUND(SUM(CASE WHEN p.STATUS IN ('COMPLETED','FAILED') THEN ${HOURS_SQL} ELSE 0 END), 2),
              COUNT(p.CERT_NO)
         FROM HR_TRAINING_PARTICIPANT p
         JOIN HR_TRAINING_SESSION x ON x.SESSION_ID = p.SESSION_ID
         LEFT JOIN HR_EMP_MASTER m ON m.EMPCODE = p.EMPCODE
         LEFT JOIN HR_DEPT d ON TO_CHAR(d.DEPT_NO) = m.DEPT_NO AND d.COMPC = m.UNIT_ID
        WHERE x.COMPC = :compc AND x.STATUS <> 'CANCELLED'${w}
        GROUP BY p.EMPCODE ORDER BY 7 DESC, 2`, binds, { outFormat: OUT_ARRAY });
    return {
      title: "Employees Trained & Training Hours",
      columns: ["Code", "Name", "Department", "Trainings", "Completed", "Failed / No-show", "Hours", "Certificates"],
      numeric: [3, 4, 5, 6, 7],
      rows: (r.rows ?? []).map((x) => [s(x[0]), s(x[1]), s(x[2]), num(x[3]), num(x[4]), num(x[5]), r2(x[6]), num(x[7])]),
    };
  },

  // Training Cost Summary vs budget, by the department each session is charged to
  cost: async (c, compc, f) => {
    const binds = { compc };
    const w = periodWhere(binds, f);
    const r = await c.execute(
      `SELECT x.DEPT_NO, NVL(MAX(d.DEPT_NAME), CASE WHEN x.DEPT_NO IS NULL THEN 'Not charged to a department' END),
              COUNT(DISTINCT x.SESSION_ID), SUM(x.TRAINER_COST), SUM(x.VENUE_COST), SUM(x.MATERIAL_COST), SUM(x.OTHER_COST),
              SUM(${SESSION_COST_SQL}), SUM(NVL(pc.CNT, 0))
         FROM HR_TRAINING_SESSION x
         LEFT JOIN HR_DEPT d ON d.DEPT_NO = x.DEPT_NO AND d.COMPC = x.COMPC
         LEFT JOIN (SELECT SESSION_ID, COUNT(*) CNT FROM HR_TRAINING_PARTICIPANT
                     WHERE STATUS <> 'WITHDRAWN' GROUP BY SESSION_ID) pc ON pc.SESSION_ID = x.SESSION_ID
        WHERE x.COMPC = :compc AND x.STATUS <> 'CANCELLED'${w}
        GROUP BY x.DEPT_NO ORDER BY 8 DESC`, binds, { outFormat: OUT_ARRAY });
    return {
      title: "Training Cost Summary",
      columns: ["Department", "Sessions", "Trainer", "Venue", "Material", "Other", "Total", "Participants", "Cost / head"],
      numeric: [1, 2, 3, 4, 5, 6, 7, 8],
      rows: (r.rows ?? []).map((x) => [s(x[1]), num(x[2]), r2(x[3]), r2(x[4]), r2(x[5]), r2(x[6]), r2(x[7]), num(x[8]),
        num(x[8]) ? r2(num(x[7]) / num(x[8])) : null]),
    };
  },

  // Assessment Result / Performance Impact (pre vs post)
  assessment: async (c, compc, f) => {
    const binds = { compc };
    const w = periodWhere(binds, f) + (f.dept ? " AND m.DEPT_NO = :d" : "");
    if (f.dept) binds.d = String(f.dept);
    const r = await c.execute(
      `SELECT x.SESSION_CODE, t.TITLE, p.EMPCODE, m.NAME, ${EMP_DEPT_SQL}, p.ATTEND_PCT, p.PRE_SCORE_PCT, p.POST_SCORE_PCT,
              CASE WHEN p.PRE_SCORE_PCT IS NOT NULL AND p.POST_SCORE_PCT IS NOT NULL THEN p.POST_SCORE_PCT - p.PRE_SCORE_PCT END,
              p.STATUS
         FROM HR_TRAINING_PARTICIPANT p
         JOIN HR_TRAINING_SESSION x ON x.SESSION_ID = p.SESSION_ID
         JOIN HR_TRAINING_COURSE t ON t.COURSE_ID = x.COURSE_ID
         LEFT JOIN HR_EMP_MASTER m ON m.EMPCODE = p.EMPCODE
        WHERE x.COMPC = :compc AND p.STATUS <> 'WITHDRAWN' AND (p.PRE_SCORE_PCT IS NOT NULL OR p.POST_SCORE_PCT IS NOT NULL)${w}
        ORDER BY x.START_DATE DESC, m.NAME`, binds, { outFormat: OUT_ARRAY });
    return {
      title: "Assessment Results & Performance Impact",
      columns: ["Session", "Course", "Code", "Name", "Department", "Attendance %", "Pre %", "Post %", "Improvement", "Result"],
      numeric: [5, 6, 7, 8],
      rows: (r.rows ?? []).map((x) => [s(x[0]), s(x[1]), s(x[2]), s(x[3]), s(x[4]), numOrNull(x[5]), numOrNull(x[6]),
        numOrNull(x[7]), x[8] === null ? null : r2(x[8]), s(x[9])]),
    };
  },

  // Certification Report
  certificates: async (c, compc, f) => {
    const binds = { compc };
    const w = periodWhere(binds, f) + (f.dept ? " AND m.DEPT_NO = :d" : "");
    if (f.dept) binds.d = String(f.dept);
    const r = await c.execute(
      `SELECT p.CERT_NO, p.CERT_ISSUED_AT, p.EMPCODE, m.NAME, ${EMP_DEPT_SQL}, t.TITLE, x.SESSION_CODE, p.POST_SCORE_PCT
         FROM HR_TRAINING_PARTICIPANT p
         JOIN HR_TRAINING_SESSION x ON x.SESSION_ID = p.SESSION_ID
         JOIN HR_TRAINING_COURSE t ON t.COURSE_ID = x.COURSE_ID
         LEFT JOIN HR_EMP_MASTER m ON m.EMPCODE = p.EMPCODE
        WHERE x.COMPC = :compc AND p.CERT_NO IS NOT NULL${w}
        ORDER BY p.CERT_ISSUED_AT DESC`, binds, { outFormat: OUT_ARRAY });
    return {
      title: "Certification Report",
      columns: ["Certificate No", "Issued", "Code", "Name", "Department", "Course", "Session", "Score %"],
      numeric: [7],
      rows: (r.rows ?? []).map((x) => [s(x[0]), ymd(x[1]), s(x[2]), s(x[3]), s(x[4]), s(x[5]), s(x[6]), numOrNull(x[7])]),
    };
  },

  // Trainer Performance
  trainers: async (c, compc, f) => {
    const binds = { compc };
    const w = periodWhere(binds, f);
    const r = await c.execute(
      `SELECT tr.NAME, CASE tr.TRAINER_TYPE WHEN 'I' THEN 'Internal' ELSE 'External' END, tr.ORGANIZATION,
              COUNT(DISTINCT x.SESSION_ID), SUM(NVL(x.TOTAL_HOURS, 0)), SUM(x.TRAINER_COST),
              (SELECT ROUND(AVG(fb.RATING_TRAINER), 2) FROM HR_TRAINING_FEEDBACK fb JOIN HR_TRAINING_SESSION z ON z.SESSION_ID = fb.SESSION_ID
                WHERE z.TRAINER_ID = tr.TRAINER_ID AND fb.RATING_TRAINER IS NOT NULL),
              (SELECT ROUND(100 * SUM(CASE WHEN p.STATUS = 'COMPLETED' THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN p.STATUS IN ('COMPLETED','FAILED','NO_SHOW') THEN 1 ELSE 0 END), 0), 2)
                 FROM HR_TRAINING_PARTICIPANT p JOIN HR_TRAINING_SESSION z ON z.SESSION_ID = p.SESSION_ID WHERE z.TRAINER_ID = tr.TRAINER_ID)
         FROM HR_TRAINER tr
         JOIN HR_TRAINING_SESSION x ON x.TRAINER_ID = tr.TRAINER_ID AND x.STATUS <> 'CANCELLED'
        WHERE tr.COMPC = :compc${w}
        GROUP BY tr.TRAINER_ID, tr.NAME, tr.TRAINER_TYPE, tr.ORGANIZATION
        ORDER BY 7 DESC NULLS LAST`, binds, { outFormat: OUT_ARRAY });
    return {
      title: "Trainer Performance",
      columns: ["Trainer", "Type", "Organisation", "Sessions", "Hours", "Trainer cost", "Avg rating", "Pass rate %"],
      numeric: [3, 4, 5, 6, 7],
      rows: (r.rows ?? []).map((x) => [s(x[0]), s(x[1]), s(x[2]), num(x[3]), r2(x[4]), r2(x[5]), numOrNull(x[6]), numOrNull(x[7])]),
    };
  },

  // Employee Training History (one employee)
  history: async (c, compc, f) => {
    const binds = { compc, e: s(f.empcode) };
    const r = await c.execute(
      `SELECT x.SESSION_CODE, t.TITLE, t.TRAINING_TYPE, x.START_DATE, x.END_DATE, ROUND(${HOURS_SQL}, 2),
              p.ATTEND_PCT, p.PRE_SCORE_PCT, p.POST_SCORE_PCT, p.STATUS, p.CERT_NO
         FROM HR_TRAINING_PARTICIPANT p
         JOIN HR_TRAINING_SESSION x ON x.SESSION_ID = p.SESSION_ID
         JOIN HR_TRAINING_COURSE t ON t.COURSE_ID = x.COURSE_ID
        WHERE x.COMPC = :compc AND p.EMPCODE = :e AND p.STATUS <> 'WITHDRAWN'
        ORDER BY x.START_DATE DESC`, binds, { outFormat: OUT_ARRAY });
    const [name] = await one(c, `SELECT MAX(NAME) FROM HR_EMP_MASTER WHERE EMPCODE = :e`, { e: binds.e });
    return {
      title: `Training History — ${s(name) || binds.e} (${binds.e})`,
      columns: ["Session", "Course", "Type", "From", "To", "Hours", "Attendance %", "Pre %", "Post %", "Result", "Certificate"],
      numeric: [5, 6, 7, 8],
      rows: (r.rows ?? []).map((x) => [s(x[0]), s(x[1]), s(x[2]), ymd(x[3]), ymd(x[4]), r2(x[5]), numOrNull(x[6]),
        numOrNull(x[7]), numOrNull(x[8]), s(x[9]), s(x[10])]),
    };
  },
};

export const REPORT_TYPES = Object.keys(REPORTS);

export const runReport = (compc, type, filters) => read((c) => REPORTS[type](c, compc, filters));
