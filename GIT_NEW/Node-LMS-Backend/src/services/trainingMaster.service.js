/**
 * Training masters (HR only, one company at a time): categories, trainers,
 * course catalog, budget — plus the lookups the HR screens need.
 */

import { getDirectConnection } from "../config/database.js";
import {
  OUT_ARRAY, s, num, numOrNull, r2, ymd, fyLabel,
  TrainingError, nextId, writeLog, withTx, mapOraError, EMP_DEPT_SQL, EMP_DESG_SQL,
} from "./trainingShared.service.js";

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

const yn = (v) => (v === false || v === "N" ? "N" : "Y");

// SQL for a session's total cost, for a HR_TRAINING_SESSION row aliased `x`.
export const SESSION_COST_SQL = `(NVL(x.TRAINER_COST,0) + NVL(x.VENUE_COST,0) + NVL(x.MATERIAL_COST,0) + NVL(x.OTHER_COST,0))`;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const listCategories = (compc) => read(async (c) => {
  const r = await c.execute(
    `SELECT k.CATEGORY_ID, k.NAME, k.IS_ACTIVE,
            (SELECT COUNT(*) FROM HR_TRAINING_COURSE t WHERE t.CATEGORY_ID = k.CATEGORY_ID)
       FROM HR_TRAINING_CATEGORY k
      WHERE k.COMPC = :compc
      ORDER BY UPPER(k.NAME)`,
    { compc },
    { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => ({
    category_id: num(x[0]), name: s(x[1]), is_active: s(x[2]) === "Y", course_count: num(x[3]),
  }));
});

export const saveCategory = (compc, actor, id, body) => withTx(async (c) => {
  const name = s(body.name);
  if (id) {
    const r = await c.execute(
      `UPDATE HR_TRAINING_CATEGORY SET NAME = :name, IS_ACTIVE = :act, UPDATED_BY = :actor, UPDATED_AT = SYSDATE
        WHERE CATEGORY_ID = :id AND COMPC = :compc`,
      { name, act: yn(body.is_active), actor, id, compc },
    );
    if (!r.rowsAffected) throw new TrainingError("Category not found", 404);
    return { category_id: id };
  }
  const newId = await nextId(c, "HR_TRAINING_CATEGORY_SEQ");
  await c.execute(
    `INSERT INTO HR_TRAINING_CATEGORY (CATEGORY_ID, COMPC, NAME, IS_ACTIVE, CREATED_BY)
     VALUES (:id, :compc, :name, :act, :actor)`,
    { id: newId, compc, name, act: yn(body.is_active), actor },
  );
  return { category_id: newId };
}, { HR_TRAINING_CATEGORY_UK: "A category with this name already exists" });

export const deleteCategory = (compc, id) => withTx(async (c) => {
  const r = await c.execute(`DELETE FROM HR_TRAINING_CATEGORY WHERE CATEGORY_ID = :id AND COMPC = :compc`, { id, compc });
  if (!r.rowsAffected) throw new TrainingError("Category not found", 404);
  return { deleted: true };
});

// ---------------------------------------------------------------------------
// Trainers
// ---------------------------------------------------------------------------

// Columns of a trainer (HR_TRAINER aliased `t`) — shared with the trainer portal.
export const TRAINER_SELECT = `
  SELECT t.TRAINER_ID, t.TRAINER_TYPE, t.EMPCODE, t.NAME, t.ORGANIZATION, t.PHONE, t.EMAIL,
         t.EXPERTISE, t.DEFAULT_RATE, t.IS_ACTIVE,
         (SELECT COUNT(*) FROM HR_TRAINING_SESSION x WHERE x.TRAINER_ID = t.TRAINER_ID AND x.STATUS <> 'CANCELLED'),
         (SELECT ROUND(AVG(f.RATING_TRAINER), 2) FROM HR_TRAINING_FEEDBACK f
            JOIN HR_TRAINING_SESSION x ON x.SESSION_ID = f.SESSION_ID
           WHERE x.TRAINER_ID = t.TRAINER_ID AND f.RATING_TRAINER IS NOT NULL),
         t.BIO, t.QUALIFICATIONS, t.RATE_UNIT, t.IS_FREE,
         (SELECT COUNT(*) FROM HR_TRAINER_SLOT z WHERE z.TRAINER_ID = t.TRAINER_ID AND z.SLOT_DATE >= TRUNC(SYSDATE)),
         t.COMPC`;

export const rowToTrainer = (x) => ({
  trainer_id: num(x[0]), trainer_type: s(x[1]), empcode: s(x[2]) || null, name: s(x[3]),
  organization: s(x[4]), phone: s(x[5]), email: s(x[6]), expertise: s(x[7]),
  default_rate: numOrNull(x[8]), is_active: s(x[9]) === "Y",
  session_count: num(x[10]), avg_rating: numOrNull(x[11]),
  bio: s(x[12]), qualifications: s(x[13]), rate_unit: s(x[14]) || "SESSION", is_free: s(x[15]) === "Y",
  upcoming_slots: num(x[16]), compc: num(x[17]),
});

/** A trainer's free slots from today on (HR sees them while scheduling). */
export const listTrainerSlots = (compc, trainerId) => read(async (c) => {
  const r = await c.execute(
    `SELECT z.SLOT_ID, z.SLOT_DATE, z.TIME_FROM, z.TIME_TO, z.REMARKS
       FROM HR_TRAINER_SLOT z JOIN HR_TRAINER t ON t.TRAINER_ID = z.TRAINER_ID
      WHERE z.TRAINER_ID = :id AND t.COMPC = :compc AND z.SLOT_DATE >= TRUNC(SYSDATE)
      ORDER BY z.SLOT_DATE, z.TIME_FROM`,
    { id: trainerId, compc }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => ({ slot_id: num(x[0]), slot_date: ymd(x[1]), time_from: s(x[2]), time_to: s(x[3]), remarks: s(x[4]) }));
});

export const listTrainers = (compc) => read(async (c) => {
  const r = await c.execute(
    `${TRAINER_SELECT}
       FROM HR_TRAINER t
      WHERE t.COMPC = :compc
      ORDER BY t.IS_ACTIVE DESC, UPPER(t.NAME)`,
    { compc },
    { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map(rowToTrainer);
});

export const saveTrainer = (compc, actor, id, body) => withTx(async (c) => {
  let name = s(body.name);
  let empcode = body.trainer_type === "I" ? s(body.empcode) : null;
  if (body.trainer_type === "I") {
    if (!empcode) throw new TrainingError("Pick the employee who will train");
    const r = await c.execute(
      `SELECT NAME, "MOBILE#", EMAIL FROM HR_EMP_MASTER WHERE EMPCODE = :e AND UNIT_ID = :compc`,
      { e: empcode, compc },
      { outFormat: OUT_ARRAY },
    );
    if (!r.rows?.length) throw new TrainingError("Internal trainer must be an employee of this company");
    name = name || s(r.rows[0][0]);
    // One trainer record per internal employee — it is what their portal reads.
    const dup = await c.execute(
      `SELECT 1 FROM HR_TRAINER WHERE COMPC = :compc AND EMPCODE = :e AND TRAINER_ID <> NVL(:id, -1)`,
      { compc, e: empcode, id: id ?? null }, { outFormat: OUT_ARRAY },
    );
    if (dup.rows?.length) throw new TrainingError("This employee is already set up as a trainer", 409);
  }
  if (!name) throw new TrainingError("Trainer name is required");
  const binds = {
    type: body.trainer_type, empcode, name,
    org: s(body.organization) || null, phone: s(body.phone) || null, email: s(body.email) || null,
    exp: s(body.expertise) || null, rate: body.is_free ? 0 : body.default_rate ?? null, act: yn(body.is_active), actor, compc,
    bio: s(body.bio) || null, qual: s(body.qualifications) || null, unit: body.rate_unit || "SESSION", free: body.is_free ? "Y" : "N",
  };
  if (id) {
    const r = await c.execute(
      `UPDATE HR_TRAINER SET TRAINER_TYPE = :type, EMPCODE = :empcode, NAME = :name, ORGANIZATION = :org,
              PHONE = :phone, EMAIL = :email, EXPERTISE = :exp, DEFAULT_RATE = :rate, IS_ACTIVE = :act,
              BIO = :bio, QUALIFICATIONS = :qual, RATE_UNIT = :unit, IS_FREE = :free,
              UPDATED_BY = :actor, UPDATED_AT = SYSDATE
        WHERE TRAINER_ID = :id AND COMPC = :compc`,
      { ...binds, id },
    );
    if (!r.rowsAffected) throw new TrainingError("Trainer not found", 404);
    return { trainer_id: id };
  }
  const newId = await nextId(c, "HR_TRAINER_SEQ");
  await c.execute(
    `INSERT INTO HR_TRAINER (TRAINER_ID, COMPC, TRAINER_TYPE, EMPCODE, NAME, ORGANIZATION, PHONE, EMAIL,
                             EXPERTISE, DEFAULT_RATE, IS_ACTIVE, BIO, QUALIFICATIONS, RATE_UNIT, IS_FREE, CREATED_BY)
     VALUES (:id, :compc, :type, :empcode, :name, :org, :phone, :email, :exp, :rate, :act, :bio, :qual, :unit, :free, :actor)`,
    { ...binds, id: newId },
  );
  return { trainer_id: newId };
});

export const deleteTrainer = (compc, id) => withTx(async (c) => {
  const r = await c.execute(`DELETE FROM HR_TRAINER WHERE TRAINER_ID = :id AND COMPC = :compc`, { id, compc });
  if (!r.rowsAffected) throw new TrainingError("Trainer not found", 404);
  return { deleted: true };
});

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

const COURSE_SELECT = `
  SELECT t.COURSE_ID, t.COURSE_CODE, t.TITLE, t.CATEGORY_ID,
         (SELECT k.NAME FROM HR_TRAINING_CATEGORY k WHERE k.CATEGORY_ID = t.CATEGORY_ID),
         t.TRAINING_TYPE, t.DEFAULT_MODE, t.DURATION_HRS, t.DESCRIPTION, t.CERT_REQUIRED,
         t.PASS_PCT, t.MIN_ATTEND_PCT, t.IS_ACTIVE,
         (SELECT COUNT(*) FROM HR_TRAINING_SESSION x WHERE x.COURSE_ID = t.COURSE_ID AND x.STATUS <> 'CANCELLED'),
         (SELECT COUNT(*) FROM HR_TRAINING_TEST q WHERE q.COURSE_ID = t.COURSE_ID AND q.TEST_KIND = 'PRE' AND q.IS_ACTIVE = 'Y'),
         (SELECT COUNT(*) FROM HR_TRAINING_TEST q WHERE q.COURSE_ID = t.COURSE_ID AND q.TEST_KIND = 'POST' AND q.IS_ACTIVE = 'Y')
    FROM HR_TRAINING_COURSE t`;

export const rowToCourse = (x) => ({
  course_id: num(x[0]), course_code: s(x[1]), title: s(x[2]), category_id: numOrNull(x[3]),
  category_name: s(x[4]), training_type: s(x[5]), default_mode: s(x[6]), duration_hrs: numOrNull(x[7]),
  description: s(x[8]), cert_required: s(x[9]) === "Y", pass_pct: num(x[10]), min_attend_pct: num(x[11]),
  is_active: s(x[12]) === "Y", session_count: num(x[13]), has_pre_test: num(x[14]) > 0, has_post_test: num(x[15]) > 0,
});

export const listCourses = (compc, { activeOnly = false } = {}) => read(async (c) => {
  const r = await c.execute(
    `${COURSE_SELECT} WHERE t.COMPC = :compc ${activeOnly ? "AND t.IS_ACTIVE = 'Y'" : ""}
      ORDER BY t.IS_ACTIVE DESC, UPPER(t.TITLE)`,
    { compc },
    { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map(rowToCourse);
});

export const saveCourse = (compc, actor, id, body) => withTx(async (c) => {
  if (body.category_id) {
    const k = await c.execute(
      `SELECT 1 FROM HR_TRAINING_CATEGORY WHERE CATEGORY_ID = :id AND COMPC = :compc`,
      { id: body.category_id, compc }, { outFormat: OUT_ARRAY },
    );
    if (!k.rows?.length) throw new TrainingError("Category not found in this company");
  }
  const binds = {
    title: s(body.title), cat: body.category_id ?? null, type: body.training_type, dmode: body.default_mode,
    dur: body.duration_hrs ?? null, descr: s(body.description) || null, cert: yn(body.cert_required),
    pass: body.pass_pct ?? 70, att: body.min_attend_pct ?? 80, act: yn(body.is_active), actor, compc,
  };
  if (id) {
    const r = await c.execute(
      `UPDATE HR_TRAINING_COURSE SET TITLE = :title, CATEGORY_ID = :cat, TRAINING_TYPE = :type, DEFAULT_MODE = :dmode,
              DURATION_HRS = :dur, DESCRIPTION = :descr, CERT_REQUIRED = :cert, PASS_PCT = :pass,
              MIN_ATTEND_PCT = :att, IS_ACTIVE = :act, UPDATED_BY = :actor, UPDATED_AT = SYSDATE
        WHERE COURSE_ID = :id AND COMPC = :compc`,
      { ...binds, id },
    );
    if (!r.rowsAffected) throw new TrainingError("Course not found", 404);
    await writeLog(c, { compc, entity: "COURSE", entityId: id, action: "UPDATE", details: body, actor });
    return { course_id: id };
  }
  const seq = await c.execute(
    `SELECT NVL(MAX(TO_NUMBER(SUBSTR(COURSE_CODE, 5))), 0) + 1 FROM HR_TRAINING_COURSE
      WHERE COMPC = :compc AND REGEXP_LIKE(COURSE_CODE, '^TRN-[0-9]+$')`,
    { compc }, { outFormat: OUT_ARRAY },
  );
  const code = `TRN-${String(num(seq.rows[0][0])).padStart(4, "0")}`;
  const newId = await nextId(c, "HR_TRAINING_COURSE_SEQ");
  await c.execute(
    `INSERT INTO HR_TRAINING_COURSE (COURSE_ID, COMPC, COURSE_CODE, TITLE, CATEGORY_ID, TRAINING_TYPE, DEFAULT_MODE,
                                     DURATION_HRS, DESCRIPTION, CERT_REQUIRED, PASS_PCT, MIN_ATTEND_PCT, IS_ACTIVE, CREATED_BY)
     VALUES (:id, :compc, :code, :title, :cat, :type, :dmode, :dur, :descr, :cert, :pass, :att, :act, :actor)`,
    { ...binds, id: newId, code },
  );
  await writeLog(c, { compc, entity: "COURSE", entityId: newId, action: "CREATE", details: { code, title: binds.title }, actor });
  return { course_id: newId, course_code: code };
}, { HR_TRAINING_COURSE_UK: "Course code clash — please save again" });

export const deleteCourse = (compc, id) => withTx(async (c) => {
  const r = await c.execute(`DELETE FROM HR_TRAINING_COURSE WHERE COURSE_ID = :id AND COMPC = :compc`, { id, compc });
  if (!r.rowsAffected) throw new TrainingError("Course not found", 404);
  return { deleted: true };
});

// ---------------------------------------------------------------------------
// Budget — allocations per fiscal year, company-level (DEPT_NO NULL) or per
// department, with what the year's sessions have used.
// ---------------------------------------------------------------------------

export const getBudget = (compc, fy) => read(async (c) => {
  const alloc = await c.execute(
    `SELECT b.BUDGET_ID, b.DEPT_NO,
            (SELECT MAX(d.DEPT_NAME) FROM HR_DEPT d WHERE d.DEPT_NO = b.DEPT_NO AND d.COMPC = b.COMPC),
            b.AMOUNT, b.REMARKS
       FROM HR_TRAINING_BUDGET b
      WHERE b.COMPC = :compc AND b.FY_YEAR = :fy
      ORDER BY b.DEPT_NO NULLS FIRST`,
    { compc, fy }, { outFormat: OUT_ARRAY },
  );
  const used = await c.execute(
    `SELECT x.DEPT_NO, SUM(${SESSION_COST_SQL}), COUNT(*)
       FROM HR_TRAINING_SESSION x
      WHERE x.COMPC = :compc AND x.FY_YEAR = :fy AND x.STATUS <> 'CANCELLED'
      GROUP BY x.DEPT_NO`,
    { compc, fy }, { outFormat: OUT_ARRAY },
  );
  const usedBy = new Map((used.rows ?? []).map((x) => [x[0] === null ? "" : String(x[0]), { used: r2(x[1]), sessions: num(x[2]) }]));
  const totalUsed = r2([...usedBy.values()].reduce((t, v) => t + v.used, 0));

  const lines = (alloc.rows ?? []).map((x) => {
    const dept = x[1] === null ? null : num(x[1]);
    // The company line is measured against every session; a department line
    // against the sessions charged to that department.
    const u = dept === null ? { used: totalUsed } : (usedBy.get(String(dept)) ?? { used: 0 });
    const amount = r2(x[3]);
    return {
      budget_id: num(x[0]), dept_no: dept, dept_name: dept === null ? "Company (all departments)" : s(x[2]) || `Dept ${dept}`,
      amount, used: u.used, remaining: r2(amount - u.used), remarks: s(x[4]),
      used_pct: amount > 0 ? r2((u.used / amount) * 100) : null,
    };
  });
  return { fy_year: fy, fy_label: fyLabel(fy), lines, total_used: totalUsed };
});

export const saveBudget = (compc, actor, body) => withTx(async (c) => {
  const binds = { compc, fy: body.fy_year, dept: body.dept_no ?? null };
  const existing = await c.execute(
    `SELECT BUDGET_ID, AMOUNT FROM HR_TRAINING_BUDGET WHERE COMPC = :compc AND FY_YEAR = :fy AND NVL(DEPT_NO, -1) = NVL(:dept, -1)`,
    binds, { outFormat: OUT_ARRAY },
  );
  if (existing.rows?.length) {
    const id = num(existing.rows[0][0]);
    await c.execute(
      `UPDATE HR_TRAINING_BUDGET SET AMOUNT = :amt, REMARKS = :rem, UPDATED_BY = :actor, UPDATED_AT = SYSDATE WHERE BUDGET_ID = :id`,
      { amt: body.amount, rem: s(body.remarks) || null, actor, id },
    );
    await writeLog(c, { compc, entity: "BUDGET", entityId: id, action: "UPDATE", details: { from: num(existing.rows[0][1]), to: body.amount }, actor });
    return { budget_id: id };
  }
  const id = await nextId(c, "HR_TRAINING_BUDGET_SEQ");
  await c.execute(
    `INSERT INTO HR_TRAINING_BUDGET (BUDGET_ID, COMPC, FY_YEAR, DEPT_NO, AMOUNT, REMARKS, CREATED_BY)
     VALUES (:id, :compc, :fy, :dept, :amt, :rem, :actor)`,
    { ...binds, id, amt: body.amount, rem: s(body.remarks) || null, actor },
  );
  await writeLog(c, { compc, entity: "BUDGET", entityId: id, action: "CREATE", details: { fy: body.fy_year, dept: body.dept_no, amount: body.amount }, actor });
  return { budget_id: id };
});

export const deleteBudget = (compc, id) => withTx(async (c) => {
  const r = await c.execute(`DELETE FROM HR_TRAINING_BUDGET WHERE BUDGET_ID = :id AND COMPC = :compc`, { id, compc });
  if (!r.rowsAffected) throw new TrainingError("Budget line not found", 404);
  return { deleted: true };
});

/**
 * Budget position a new cost would land in — used to warn (never block) when a
 * session is saved over budget.
 */
export const budgetWarning = async (c, compc, fy, deptNo, extraCost, excludeSessionId = null) => {
  const lines = await c.execute(
    `SELECT DEPT_NO, AMOUNT FROM HR_TRAINING_BUDGET
      WHERE COMPC = :compc AND FY_YEAR = :fy AND (DEPT_NO IS NULL OR DEPT_NO = :dept)`,
    { compc, fy, dept: deptNo ?? -999 }, { outFormat: OUT_ARRAY },
  );
  const warnings = [];
  for (const [dept, amount] of lines.rows ?? []) {
    const used = await c.execute(
      `SELECT NVL(SUM(${SESSION_COST_SQL}), 0) FROM HR_TRAINING_SESSION x
        WHERE x.COMPC = :compc AND x.FY_YEAR = :fy AND x.STATUS <> 'CANCELLED'
          AND x.SESSION_ID <> NVL(:ex, -1) ${dept === null ? "" : "AND x.DEPT_NO = :dept"}`,
      dept === null ? { compc, fy, ex: excludeSessionId } : { compc, fy, ex: excludeSessionId, dept },
      { outFormat: OUT_ARRAY },
    );
    const after = r2(num(used.rows[0][0]) + num(extraCost));
    if (after > num(amount)) {
      warnings.push(
        `${dept === null ? "Company" : "Department"} training budget for FY ${fyLabel(fy)} exceeded: ` +
        `${after.toLocaleString()} of ${num(amount).toLocaleString()}`,
      );
    }
  }
  return warnings;
};

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export const listDepartments = (compc) => read(async (c) => {
  const r = await c.execute(
    `SELECT DEPT_NO, DEPT_NAME FROM HR_DEPT WHERE COMPC = :compc ORDER BY UPPER(DEPT_NAME)`,
    { compc }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => ({ dept_no: num(x[0]), dept_name: s(x[1]) }));
});

/** Active employees of the company, for trainer / participant pickers. */
export const listEmployees = (compc, { branch, dept } = {}) => read(async (c) => {
  const binds = { compc };
  let extra = "";
  if (branch) { extra += " AND TO_CHAR(m.LOCATION) = :b"; binds.b = String(branch); }
  if (dept) { extra += " AND m.DEPT_NO = :d"; binds.d = String(dept); }
  const r = await c.execute(
    `SELECT m.EMPCODE, m.NAME, m.DEPT_NO, ${EMP_DEPT_SQL}, ${EMP_DESG_SQL}, m.LOCATION
       FROM HR_EMP_MASTER m
      WHERE m.UNIT_ID = :compc AND NVL(m.STATUS, 'A') = 'A'${extra}
      ORDER BY UPPER(m.NAME)`,
    binds, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => ({
    empcode: s(x[0]), name: s(x[1]), dept_no: s(x[2]), dept_name: s(x[3]), desg_desc: s(x[4]), brnch: numOrNull(x[5]),
  }));
});

