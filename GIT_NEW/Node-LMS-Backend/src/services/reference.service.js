import oracledb from "oracledb";
import { getDirectConnection } from "../config/database.js";

import { logger } from '../utils/logger.js';
const OUT_FORMAT_OBJECT = 4002;
const OUT_FORMAT_ARRAY = 4001;

const coerce = (val) => {
  if (val === null || val === undefined || val === "") return null;
  const num = Number(val);
  return isNaN(num) ? val : num;
};

// _try_progressive logic translated to JS.
const tryProgressive = async (connection, sqlTemplate, compc, brnch) => {
  const attempts = [];
  
  if (compc && brnch) {
    attempts.push({
      filterSql: "AND COMPC = :fcompc AND BRNCH = :fbrnch",
      params: { fcompc: coerce(compc), fbrnch: coerce(brnch) },
    });
  }
  if (compc) {
    attempts.push({
      filterSql: "AND COMPC = :fcompc",
      params: { fcompc: coerce(compc) },
    });
  }
  if (brnch) {
    attempts.push({
      filterSql: "AND BRNCH = :fbrnch",
      params: { fbrnch: coerce(brnch) },
    });
  }
  attempts.push({ filterSql: "", params: {} });

  let lastErr = null;
  for (const { filterSql, params } of attempts) {
    try {
      const sql = sqlTemplate.replace("{filter}", filterSql);
      const result = await connection.execute(sql, params, { outFormat: OUT_FORMAT_ARRAY });
      return result.rows || [];
    } catch (e) {
      if (e.message && e.message.includes("ORA-00904")) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  logger.info(`[REFERENCE] All filter attempts failed: ${lastErr?.message}`);
  return [];
};

const insertProgressive = async (connection, attempts) => {
  let lastErr = null;
  for (const { sql, params } of attempts) {
    try {
      await connection.execute(sql, params, { autoCommit: true });
      return;
    } catch (e) {
      if (e.message && e.message.includes("ORA-00904")) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  if (lastErr) throw lastErr;
};

const nextCode = async (connection, table, col) => {
  const result = await connection.execute(
    `SELECT NVL(MAX(TO_NUMBER(${col})), 0) + 1 FROM ${table} WHERE REGEXP_LIKE(${col}, '^[0-9]+$')`,
    {},
    { outFormat: OUT_FORMAT_ARRAY }
  );
  return String(result.rows[0][0]);
};

// ---------------------------------------------------------------------------
// READ FUNCTIONS
// ---------------------------------------------------------------------------

export const getDepartments = async (compc = null, brnch = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const rows = await tryProgressive(
      conn,
      "SELECT DEPT_NO, DEPT_NAME FROM HR_DEPT WHERE 1=1 {filter} ORDER BY DEPT_NAME",
      compc,
      brnch
    );
    return rows.map((r) => ({ dept_no: r[0], dept_name: String(r[1] ?? "").trim() }));
  } finally {
    if (conn) await conn.close();
  }
};

export const getGrades = async (compc = null, brnch = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const rows = await tryProgressive(
      conn,
      "SELECT GRADE_CD, DESCR FROM HR_GRADE_CD WHERE (STATUS = 'A' OR STATUS IS NULL) {filter} ORDER BY GRADE_CD",
      compc,
      brnch
    );
    return rows.map((r) => ({ grade_cd: String(r[0] ?? "").trim(), descr: String(r[1] ?? "").trim() }));
  } finally {
    if (conn) await conn.close();
  }
};

export const getEmpStatuses = async (compc = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const c = coerce(compc);
    let rows = [];
    if (c !== null && c !== undefined) {
      try {
        const res = await conn.execute(
          "SELECT EMP_STATUS, EMP_STATUS_DESC FROM HR_EMP_STATUS WHERE EMP_STATUS IS NOT NULL AND (UNIT_ID = :u OR UNIT_ID IS NULL) ORDER BY EMP_STATUS",
          { u: c },
          { outFormat: OUT_FORMAT_ARRAY }
        );
        rows = res.rows || [];
        return rows.map((r) => ({ emp_status: String(r[0] ?? "").trim(), descr: String(r[1] ?? "").trim() }));
      } catch (e) {
        // Fallback
      }
    }
    const res = await conn.execute(
      "SELECT EMP_STATUS, EMP_STATUS_DESC FROM HR_EMP_STATUS WHERE EMP_STATUS IS NOT NULL ORDER BY EMP_STATUS",
      {},
      { outFormat: OUT_FORMAT_ARRAY }
    );
    rows = res.rows || [];
    return rows.map((r) => ({ emp_status: String(r[0] ?? "").trim(), descr: String(r[1] ?? "").trim() }));
  } finally {
    if (conn) await conn.close();
  }
};

export const getBanks = async (compc = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const c = coerce(compc);
    let rows = [];
    if (c !== null && c !== undefined) {
      try {
        const res = await conn.execute(
          "SELECT BNKCODE, BNKNAME FROM HR_BANK WHERE (UNIT_ID = :u OR UNIT_ID IS NULL) AND BNKCODE IS NOT NULL ORDER BY BNKNAME",
          { u: c },
          { outFormat: OUT_FORMAT_ARRAY }
        );
        rows = res.rows || [];
        return rows.map((r) => ({ bnkcode: String(r[0] ?? "").trim(), bnkname: String(r[1] ?? "").trim() }));
      } catch (e) {
        // Fallback
      }
    }
    const res = await conn.execute(
      "SELECT BNKCODE, BNKNAME FROM HR_BANK WHERE BNKCODE IS NOT NULL ORDER BY BNKNAME",
      {},
      { outFormat: OUT_FORMAT_ARRAY }
    );
    rows = res.rows || [];
    return rows.map((r) => ({ bnkcode: String(r[0] ?? "").trim(), bnkname: String(r[1] ?? "").trim() }));
  } finally {
    if (conn) await conn.close();
  }
};

export const getBankBranches = async (bnkcode = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    let res;
    if (bnkcode) {
      res = await conn.execute(
        "SELECT BRNCODE, BRNNAME FROM HR_BRANCH WHERE BNKCODE = :b AND BRNCODE IS NOT NULL ORDER BY BRNNAME",
        { b: String(bnkcode).trim() },
        { outFormat: OUT_FORMAT_ARRAY }
      );
    } else {
      res = await conn.execute(
        "SELECT BRNCODE, BRNNAME FROM HR_BRANCH WHERE BRNCODE IS NOT NULL ORDER BY BRNNAME",
        {},
        { outFormat: OUT_FORMAT_ARRAY }
      );
    }
    const rows = res.rows || [];
    return rows.map((r) => ({ brncode: String(r[0] ?? "").trim(), brnname: String(r[1] ?? "").trim() }));
  } finally {
    if (conn) await conn.close();
  }
};

export const getQualifications = async (compc = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const c = coerce(compc);
    let rows = [];
    if (c !== null && c !== undefined) {
      try {
        const res = await conn.execute(
          "SELECT DISTINCT TRIM(DESCR) FROM HR_EMP_QUALIFICATION WHERE DESCR IS NOT NULL AND TRIM(DESCR) IS NOT NULL AND (UNIT_ID = :u OR UNIT_ID IS NULL) ORDER BY 1",
          { u: c },
          { outFormat: OUT_FORMAT_ARRAY }
        );
        rows = res.rows || [];
        return rows.filter((r) => String(r[0] ?? "").trim()).map((r) => ({ descr: String(r[0] ?? "").trim() }));
      } catch (e) {
        // Fallback
      }
    }
    const res = await conn.execute(
      "SELECT DISTINCT TRIM(DESCR) FROM HR_EMP_QUALIFICATION WHERE DESCR IS NOT NULL AND TRIM(DESCR) IS NOT NULL ORDER BY 1",
      {},
      { outFormat: OUT_FORMAT_ARRAY }
    );
    rows = res.rows || [];
    return rows.filter((r) => String(r[0] ?? "").trim()).map((r) => ({ descr: String(r[0] ?? "").trim() }));
  } finally {
    if (conn) await conn.close();
  }
};

export const getDesignations = async (grade_cd = null, compc = null, brnch = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    let baseFilter = "1=1";
    let baseParams = {};
    if (grade_cd) {
      baseFilter += " AND GRADE_CD = :gradecd";
      baseParams.gradecd = grade_cd;
    }
    const template = `SELECT GRADE_CD, DESG_CD, DESG_DESC FROM HR_DESG WHERE ${baseFilter} {filter} ORDER BY GRADE_CD, DESG_CD`;
    
    const attempts = [];
    if (compc && brnch) {
      attempts.push({
        filterSql: "AND COMPC = :fcompc AND BRNCH = :fbrnch",
        params: { ...baseParams, fcompc: coerce(compc), fbrnch: coerce(brnch) },
      });
    }
    if (compc) {
      attempts.push({
        filterSql: "AND COMPC = :fcompc",
        params: { ...baseParams, fcompc: coerce(compc) },
      });
    }
    if (brnch) {
      attempts.push({
        filterSql: "AND BRNCH = :fbrnch",
        params: { ...baseParams, fbrnch: coerce(brnch) },
      });
    }
    attempts.push({ filterSql: "", params: baseParams });

    let rows = [];
    for (const { filterSql, params } of attempts) {
      try {
        const sql = template.replace("{filter}", filterSql);
        const res = await conn.execute(sql, params, { outFormat: OUT_FORMAT_ARRAY });
        rows = res.rows || [];
        break;
      } catch (e) {
        if (e.message && e.message.includes("ORA-00904")) {
          continue;
        }
        throw e;
      }
    }
    return rows.map((r) => ({
      grade_cd: String(r[0] ?? "").trim(),
      desg_cd: String(r[1] ?? "").trim(),
      desg_desc: String(r[2] ?? "").trim(),
    }));
  } finally {
    if (conn) await conn.close();
  }
};

const SHIFT_HEAD_COLS = [
  "SHIFT_HEAD_PK", "SHIFT", "SHIFT_DESC", "TIME_FROM", "TIME_TO",
  "OVERTIME_START_TIME", "ALLOW_IN_TIME", "LATE_START_TM",
  "HALF_DAY_TM", "LATE_SIT_TM", "LATE_SIT_ALLOW_TM",
  "DUTY_HRS", "EARLY_OUT_LATE_START", "EARLY_OUT_LATE_END",
  "EARLY_OUT_HDAY_START", "EARLY_OUT_HDAY_END",
  "LATE_END_TM", "HALF_DAY_END_TM", "DAY_NAME", "COMPC", "BRNCH"
];
const SHIFT_HEAD_FIELDS = SHIFT_HEAD_COLS.filter((c) => !["SHIFT_HEAD_PK", "COMPC", "BRNCH"].includes(c));

export const getShifts = async (compc = null, brnch = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const colSql = SHIFT_HEAD_COLS.join(", ");
    const rows = await tryProgressive(
      conn,
      `SELECT ${colSql} FROM SHIFT_HEAD WHERE 1=1 {filter} ORDER BY SHIFT`,
      compc,
      brnch
    );
    const out = [];
    for (const r of rows) {
      const d = {};
      SHIFT_HEAD_COLS.forEach((c, i) => {
        const v = r[i];
        d[c.toLowerCase()] = typeof v === "string" ? v.trim() : v;
      });
      out.push(d);
    }
    return out;
  } finally {
    if (conn) await conn.close();
  }
};

/**
 * The rest day is a roster STATE, not a shift a company runs.
 *
 * 'R' means the person is off that day: DUTY_ROSTER.ROSTER_SHIFT = 'R' is what
 * the attendance derivation, the leave check and the weekly-off calculation all
 * read. Only company 1 / branch 1 happens to have an 'R' row in SHIFT_HEAD, so
 * scoping the picker to SHIFT_HEAD left HR unable to mark a rest day for the
 * other nineteen company/branch combinations. It belongs in every list.
 */
const REST_SHIFT_CODE = 'R';
const REST_SHIFT_FALLBACK_DESC = 'REST';

/** Add the rest day to a shift list that lacks it, keeping the list sorted. */
const withRestDay = async (conn, rows) => {
  const hasRest = rows.some(
    (r) => String(r.shift ?? '').trim().toUpperCase() === REST_SHIFT_CODE,
  );
  if (hasRest) return rows;

  // Take HR's own wording for it where the global shift table has one, so the
  // label does not drift from what the rest of the ERP calls it.
  let descr = REST_SHIFT_FALLBACK_DESC;
  try {
    const res = await conn.execute(
      "SELECT DESCR FROM HR_SHIFT WHERE TRIM(SHIFT) = :s AND ROWNUM = 1",
      { s: REST_SHIFT_CODE },
      { outFormat: OUT_FORMAT_ARRAY },
    );
    const found = String(res.rows?.[0]?.[0] ?? '').trim();
    if (found) descr = found;
  } catch (e) {
    logger.info(`[REFERENCE] rest-day description lookup failed: ${String(e.message).slice(0, 90)}`);
  }

  return [...rows, { shift: REST_SHIFT_CODE, descr }].sort((a, b) =>
    String(a.shift).localeCompare(String(b.shift)),
  );
};

/**
 * Shift list of values for the duty roster.
 *
 * Shifts are defined per company (and branch) in SHIFT_HEAD — company 5 has only
 * GENERAL, company 1 has A/B/C/G/N/R — so the roster's shift picker is scoped to
 * the selected company instead of offering the global HR_SHIFT list, which let
 * HR assign a shift their company doesn't run.
 *
 * The one exception is the rest day, which every company needs and most do not
 * define; see withRestDay above.
 *
 * Falls back to HR_SHIFT when SHIFT_HEAD holds nothing for that company, so the
 * dropdown is never empty.
 */
export const getShiftLov = async (compc = null, brnch = null) => {
  let conn;
  try {
    conn = await getDirectConnection();

    const scoped = String(compc ?? "").trim();
    if (scoped) {
      const binds = { compc: scoped };
      let branchCond = "";
      if (String(brnch ?? "").trim()) {
        branchCond = "AND TO_CHAR(BRNCH) = TO_CHAR(:brnch)";
        binds.brnch = String(brnch).trim();
      }
      try {
        const res = await conn.execute(
          `SELECT SHIFT, MIN(SHIFT_DESC)
             FROM SHIFT_HEAD
            WHERE TO_CHAR(COMPC) = TO_CHAR(:compc) ${branchCond}
              AND SHIFT IS NOT NULL
            GROUP BY SHIFT
            ORDER BY SHIFT`,
          binds,
          { outFormat: OUT_FORMAT_ARRAY }
        );
        const rows = res.rows || [];
        if (rows.length) {
          return await withRestDay(
            conn,
            rows.map((r) => ({
              shift: String(r[0] ?? "").trim(),
              descr: String(r[1] ?? "").trim(),
            })),
          );
        }
      } catch (e) {
        logger.info(`[REFERENCE] SHIFT_HEAD lov failed, using HR_SHIFT: ${String(e.message).slice(0, 90)}`);
      }
    }

    const res = await conn.execute(
      "SELECT SHIFT, DESCR FROM HR_SHIFT WHERE NVL(STATS, 'Y') = 'Y' ORDER BY SHIFT",
      {},
      { outFormat: OUT_FORMAT_ARRAY }
    );
    const rows = res.rows || [];
    return await withRestDay(
      conn,
      rows.map((r) => ({ shift: String(r[0] ?? "").trim(), descr: String(r[1] ?? "").trim() })),
    );
  } finally {
    if (conn) await conn.close();
  }
};

export const getBloodGroups = async (compc = null, brnch = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const rows = await tryProgressive(
      conn,
      "SELECT BLOOD_GROUP_PK, BLOOD_GROUP FROM BLOOD_GROUP WHERE 1=1 {filter} ORDER BY BLOOD_GROUP_PK",
      compc,
      brnch
    );
    return rows.map((r) => ({ pk: r[0], blood_group: r[1] }));
  } finally {
    if (conn) await conn.close();
  }
};

export const getCadre = async (compc = null, brnch = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const rows = await tryProgressive(
      conn,
      "SELECT CADRE_PK, CADRE FROM CADRE WHERE 1=1 {filter} ORDER BY CADRE",
      compc,
      brnch
    );
    return rows.map((r) => ({ pk: r[0], cadre: r[1] }));
  } finally {
    if (conn) await conn.close();
  }
};

export const getUnits = async () => {
  let conn;
  try {
    conn = await getDirectConnection();
    const res = await conn.execute(
      "SELECT UNIT_ID, UNIT_NAME FROM UNIT_MST ORDER BY UNIT_NAME",
      {},
      { outFormat: OUT_FORMAT_ARRAY }
    );
    const rows = res.rows || [];
    return rows.map((r) => ({ unit_id: r[0], unit_name: String(r[1] ?? "").trim() }));
  } finally {
    if (conn) await conn.close();
  }
};

export const getReligions = async () => {
  let conn;
  try {
    conn = await getDirectConnection();
    const res = await conn.execute(
      "SELECT DISTINCT RELIGION FROM HR_EMP_MASTER WHERE RELIGION IS NOT NULL AND TRIM(RELIGION) IS NOT NULL ORDER BY RELIGION",
      {},
      { outFormat: OUT_FORMAT_ARRAY }
    );
    const existing = new Set((res.rows || []).map((r) => String(r[0] ?? "").trim()).filter(Boolean));
    const defaults = ["ISLM", "CHRS", "HIND", "BUDH", "JAIN", "SIKK", "OTHR"];
    defaults.forEach((d) => existing.add(d));
    const combined = Array.from(existing).sort();
    const labelMap = {
      ISLM: "Islam", CHRS: "Christian", HIND: "Hindu",
      BUDH: "Buddhist", JAIN: "Jain", SIKK: "Sikh", OTHR: "Other",
    };
    return combined.map((c) => ({ code: c, label: labelMap[c] || c }));
  } finally {
    if (conn) await conn.close();
  }
};

// A reporting officer must be from the employee's own company, but may be in
// any of its branches — so the list is scoped by company only (brnch is
// ignored). Without a company nothing is returned: the old unfiltered fallback
// is what let people from other companies show up.
export const getReportingOfficers = async (compc = null) => {
  const vals = compc === null || compc === undefined || compc === ""
    ? [] : (Array.isArray(compc) ? compc : [compc]);
  const compNums = vals.map((x) => parseInt(String(x).trim(), 10)).filter((x) => !isNaN(x));
  if (!compNums.length) return [];

  let conn;
  try {
    conn = await getDirectConnection();
    const params = {};
    compNums.forEach((n, i) => { params[`c${i}`] = String(n); });
    const cph = compNums.map((_, i) => `:c${i}`).join(", ");
    // TO_CHAR rather than TO_NUMBER so a stray non-numeric UNIT_ID row cannot
    // make the whole query fail.
    const sql = `SELECT EMPCODE, NAME FROM HR_EMP_MASTER
                  WHERE (STATUS = 'A' OR STATUS IS NULL) AND NAME IS NOT NULL
                    AND LTRIM(TRIM(TO_CHAR(UNIT_ID)), '0') IN (${cph})
                  ORDER BY NAME`;
    try {
      const res = await conn.execute(sql, params, { outFormat: OUT_FORMAT_ARRAY });
      return (res.rows || []).map((r) => ({ empcode: r[0], name: String(r[1] ?? "").trim() }));
    } catch (e) {
      logger.info(`[REPORTING_OFFICERS] query failed: ${e?.message}`);
      return [];
    }
  } finally {
    if (conn) await conn.close();
  }
};

export const getNextLocationCode = async () => {
  let conn;
  try {
    conn = await getDirectConnection();
    // LCODE is a globally unique code shared across all companies (unlike
    // HR_DEPT/HR_DESG, whose codes repeat per COMPC) — see PK_LOC. Suggest the
    // next free one so admins don't collide with another company's branch.
    return await nextCode(conn, "COM_LOCATION", "LCODE");
  } finally {
    if (conn) await conn.close();
  }
};

export const getLocations = async (allowedBranches = null, compc = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const params = {};
    const conds = [];
    if (compc !== null && String(compc).trim() !== "") {
      conds.push("TO_CHAR(COMPC) = TO_CHAR(:cmp)");
      params.cmp = String(compc).trim();
    }
    if (allowedBranches && Array.isArray(allowedBranches)) {
      const nums = allowedBranches.map((b) => parseInt(String(b).trim(), 10)).filter((n) => !isNaN(n));
      if (nums.length) {
        const ph = nums.map((_, i) => `:lc${i}`).join(", ");
        conds.push(`TO_NUMBER(LCODE) IN (${ph})`);
        nums.forEach((n, i) => { params[`lc${i}`] = n; });
      }
    }
    const where = conds.length ? " WHERE " + conds.join(" AND ") : "";
    const sql = `SELECT LCODE, DESCR, SNAME, NVL(REGIONCODE,'') AS REGIONCODE, NVL(CITY,'') AS CITY FROM COM_LOCATION${where} ORDER BY LPAD(LCODE, 6)`;
    const res = await conn.execute(sql, params, { outFormat: OUT_FORMAT_ARRAY });
    const rows = res.rows || [];
    return rows.map((r) => ({
      lcode: String(r[0] ?? "").trim(),
      descr: String(r[1] ?? "").trim(),
      sname: String(r[2] ?? "").trim(),
      regioncode: String(r[3] ?? "").trim(),
      city: String(r[4] ?? "").trim(),
    }));
  } finally {
    if (conn) await conn.close();
  }
};

// ---------------------------------------------------------------------------
// ADD / REMOVE FUNCTIONS (HR admin only)
// ---------------------------------------------------------------------------

export const addDepartment = async (deptName, compc = 1, brnch = 1) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const res = await conn.execute("SELECT NVL(MAX(DEPT_NO), 0) + 1 FROM HR_DEPT", {}, { outFormat: OUT_FORMAT_ARRAY });
    const newPk = res.rows[0][0];
    const name = String(deptName).trim();
    await insertProgressive(conn, [
      {
        sql: "INSERT INTO HR_DEPT (DEPT_NO, DEPT_NAME, COMPC, BRNCH) VALUES (:pk, :name, :compc, :brnch)",
        params: { pk: newPk, name, compc, brnch },
      },
      {
        sql: "INSERT INTO HR_DEPT (DEPT_NO, DEPT_NAME, COMPC) VALUES (:pk, :name, :compc)",
        params: { pk: newPk, name, compc },
      },
      {
        sql: "INSERT INTO HR_DEPT (DEPT_NO, DEPT_NAME) VALUES (:pk, :name)",
        params: { pk: newPk, name },
      },
    ]);
    return { status: "success", dept_no: newPk, dept_name: name };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const addGrade = async (gradeCd, descr, compc = 1, brnch = 1) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const cd = String(gradeCd).trim();
    const ds = String(descr).trim();
    await insertProgressive(conn, [
      {
        sql: "INSERT INTO HR_GRADE_CD (GRADE_CD, DESCR, STATUS, COMPC, BRNCH) VALUES (:cd, :descr, 'A', :compc, :brnch)",
        params: { cd, descr: ds, compc, brnch },
      },
      {
        sql: "INSERT INTO HR_GRADE_CD (GRADE_CD, DESCR, STATUS, COMPC) VALUES (:cd, :descr, 'A', :compc)",
        params: { cd, descr: ds, compc },
      },
      {
        sql: "INSERT INTO HR_GRADE_CD (GRADE_CD, DESCR, STATUS) VALUES (:cd, :descr, 'A')",
        params: { cd, descr: ds },
      },
    ]);
    return { status: "success", grade_cd: cd, descr: ds };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const addDesignation = async (gradeCd, desgDesc, compc = 1, brnch = 1) => {
  let conn;
  try {
    conn = await getDirectConnection();
    // HR_DESG's primary key is (DESG_CD, COMPC) — PK_DESG_NO — so the next code
    // has to be free within the COMPANY. Taking MAX per GRADE_CD meant a code
    // already used by another grade in the same company was handed out again,
    // which is the ORA-00001 on PK_DESG_NO.
    const res = await conn.execute(
      "SELECT NVL(MAX(DESG_CD), 0) + 1 FROM HR_DESG WHERE TO_CHAR(COMPC) = TO_CHAR(:compc)",
      { compc },
      { outFormat: OUT_FORMAT_ARRAY }
    );
    const newCd = res.rows[0][0];
    const dd = String(desgDesc).trim();
    await insertProgressive(conn, [
      {
        sql: "INSERT INTO HR_DESG (GRADE_CD, DESG_CD, DESG_DESC, COMPC, BRNCH) VALUES (:g, :cd, :desg_text, :compc, :brnch)",
        params: { g: gradeCd, cd: newCd, desg_text: dd, compc, brnch },
      },
      {
        sql: "INSERT INTO HR_DESG (GRADE_CD, DESG_CD, DESG_DESC, COMPC) VALUES (:g, :cd, :desg_text, :compc)",
        params: { g: gradeCd, cd: newCd, desg_text: dd, compc },
      },
      {
        sql: "INSERT INTO HR_DESG (GRADE_CD, DESG_CD, DESG_DESC) VALUES (:g, :cd, :desg_text)",
        params: { g: gradeCd, cd: newCd, desg_text: dd },
      },
    ]);
    return { status: "success", grade_cd: gradeCd, desg_cd: String(newCd), desg_desc: dd };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

const shiftFieldValue = (col, fields) => {
  const raw = fields[col.toLowerCase()];
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  if (col === "SHIFT") return s.toUpperCase().substring(0, 1);
  if (col === "DUTY_HRS") {
    const num = parseFloat(s);
    return isNaN(num) ? null : num;
  }
  return s.substring(0, 20);
};

export const addShiftHead = async (fields, compc = 1, brnch = 1) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const shift = (fields.shift || "").trim().toUpperCase().substring(0, 1);
    if (!shift) return { status: "error", message: "Shift code is required" };
    
    const checkRes = await conn.execute(
      "SELECT COUNT(*) FROM SHIFT_HEAD WHERE SHIFT = :s AND NVL(COMPC, 0) = :c AND NVL(BRNCH, 0) = :b",
      { s: shift, c: coerce(compc), b: coerce(brnch) },
      { outFormat: OUT_FORMAT_ARRAY }
    );
    if (checkRes.rows[0][0] > 0) {
      return { status: "error", message: `Shift '${shift}' is already configured for this company/branch` };
    }
    
    const pkRes = await conn.execute("SELECT NVL(MAX(SHIFT_HEAD_PK), 0) + 1 FROM SHIFT_HEAD", {}, { outFormat: OUT_FORMAT_ARRAY });
    const newPk = pkRes.rows[0][0];
    
    const cols = ["SHIFT_HEAD_PK", ...SHIFT_HEAD_FIELDS, "COMPC", "BRNCH"];
    const binds = { SHIFT_HEAD_PK: newPk, COMPC: coerce(compc), BRNCH: coerce(brnch) };
    SHIFT_HEAD_FIELDS.forEach((c) => { binds[c] = shiftFieldValue(c, fields); });
    
    const placeholders = cols.map((c) => ":" + c).join(", ");
    await conn.execute(
      `INSERT INTO SHIFT_HEAD (${cols.join(", ")}) VALUES (${placeholders})`,
      binds,
      { autoCommit: true }
    );
    return { status: "success", shift, shift_head_pk: newPk };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const updateShiftHead = async (pk, fields) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const setParts = [];
    const binds = { pk };
    SHIFT_HEAD_FIELDS.forEach((c) => {
      setParts.push(`${c} = :${c}`);
      binds[c] = shiftFieldValue(c, fields);
    });
    await conn.execute(
      `UPDATE SHIFT_HEAD SET ${setParts.join(", ")} WHERE SHIFT_HEAD_PK = :pk`,
      binds,
      { autoCommit: true }
    );
    return { status: "success" };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const deleteShiftHead = async (pk) => {
  let conn;
  try {
    conn = await getDirectConnection();
    await conn.execute("DELETE FROM SHIFT_HEAD WHERE SHIFT_HEAD_PK = :pk", { pk }, { autoCommit: true });
    return { status: "success" };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const addBloodGroup = async (bloodGroup, compc = 1, brnch = 1) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const res = await conn.execute("SELECT NVL(MAX(BLOOD_GROUP_PK), 0) + 1 FROM BLOOD_GROUP", {}, { outFormat: OUT_FORMAT_ARRAY });
    const newPk = res.rows[0][0];
    await conn.execute(
      "INSERT INTO BLOOD_GROUP (BLOOD_GROUP_PK, BLOOD_GROUP, COMPC, BRNCH) VALUES (:pk, :bg, :compc, :brnch)",
      { pk: newPk, bg: String(bloodGroup).trim(), compc, brnch },
      { autoCommit: true }
    );
    return { status: "success", pk: newPk, blood_group: String(bloodGroup).trim() };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const addCadre = async (cadre, compc = 1, brnch = 1) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const res = await conn.execute("SELECT NVL(MAX(CADRE_PK), 0) + 1 FROM CADRE", {}, { outFormat: OUT_FORMAT_ARRAY });
    const newPk = res.rows[0][0];
    await conn.execute(
      "INSERT INTO CADRE (CADRE_PK, CADRE, COMPC, BRNCH) VALUES (:pk, :c, :compc, :brnch)",
      { pk: newPk, c: String(cadre).trim(), compc, brnch },
      { autoCommit: true }
    );
    return { status: "success", pk: newPk, cadre: String(cadre).trim() };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const addUnit = async (unitName) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const res = await conn.execute("SELECT NVL(MAX(UNIT_ID), 0) + 1 FROM UNIT_MST", {}, { outFormat: OUT_FORMAT_ARRAY });
    const newPk = res.rows[0][0];
    await conn.execute(
      "INSERT INTO UNIT_MST (UNIT_ID, UNIT_NAME) VALUES (:pk, :name)",
      { pk: newPk, name: String(unitName).trim() },
      { autoCommit: true }
    );
    return { status: "success", unit_id: newPk, unit_name: String(unitName).trim() };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const addLocation = async (lcode, descr, sname, regioncode, city, compc = null, usrid = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    await conn.execute(
      // COM_LOCATION.USRID is an ERP-owned NOT NULL ownership column with no
      // default and no trigger, so the insert MUST supply it — omitting it fails
      // with ORA-01400. Stamped with the acting admin's SEC_USERNAME.USRID.
      "INSERT INTO COM_LOCATION (LCODE, DESCR, SNAME, REGIONCODE, CITY, COMPC, USRID)" +
        " VALUES (:lcode, :descr, :sname, :region, :city, :compc, :usrid)",
      {
        lcode: String(lcode).trim(),
        descr: String(descr).trim(),
        sname: String(sname || descr).trim(),
        region: String(regioncode).trim(),
        city: String(city).trim(),
        compc: compc !== null && String(compc).trim() !== "" ? String(compc).trim() : null,
        usrid: usrid !== null && String(usrid).trim() !== "" ? String(usrid).trim() : "1",
      },
      { autoCommit: true }
    );
    return { status: "success", lcode: String(lcode).trim() };
  } catch (e) {
    if (conn) await conn.rollback();
    if (e.message.includes("ORA-00001") && e.message.includes("PK_LOC")) {
      return { status: "error", message: `Location code "${String(lcode).trim()}" already exists. Please choose a different code.` };
    }
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const updateLocation = async (lcode, descr, sname, regioncode, city) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const res = await conn.execute(
      "UPDATE COM_LOCATION SET DESCR=:descr, SNAME=:sname, REGIONCODE=:region, CITY=:city WHERE LCODE=:lcode",
      {
        lcode: String(lcode).trim(),
        descr: String(descr).trim(),
        sname: String(sname || descr).trim(),
        region: String(regioncode).trim(),
        city: String(city).trim(),
      },
      { autoCommit: true }
    );
    if (res.rowsAffected === 0) return { status: "error", message: `Location ${lcode} not found` };
    return { status: "success", lcode: String(lcode).trim() };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const addEmpStatus = async (descr, compc = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const code = await nextCode(conn, "HR_EMP_STATUS", "EMP_STATUS");
    const d = String(descr).trim();
    await insertProgressive(conn, [
      {
        sql: "INSERT INTO HR_EMP_STATUS (EMP_STATUS, EMP_STATUS_DESC, UNIT_ID) VALUES (:c, :d, :u)",
        params: { c: code, d, u: coerce(compc) },
      },
      {
        sql: "INSERT INTO HR_EMP_STATUS (EMP_STATUS, EMP_STATUS_DESC) VALUES (:c, :d)",
        params: { c: code, d },
      },
    ]);
    return { status: "success", emp_status: code, descr: d };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const deleteEmpStatus = async (empStatus, compc = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const res = await conn.execute(
      "DELETE FROM HR_EMP_STATUS WHERE EMP_STATUS = :c AND UNIT_ID = :u",
      { c: String(empStatus), u: coerce(compc) },
      { autoCommit: true }
    );
    if (res.rowsAffected === 0) return { status: "error", message: "Only entries added for this company can be removed." };
    return { status: "success" };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const addBank = async (bnkname, compc = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const code = await nextCode(conn, "HR_BANK", "BNKCODE");
    const nm = String(bnkname).trim();
    await insertProgressive(conn, [
      {
        sql: "INSERT INTO HR_BANK (BNKCODE, BNKNAME, UNIT_ID) VALUES (:c, :n, :u)",
        params: { c: code, n: nm, u: coerce(compc) },
      },
      {
        sql: "INSERT INTO HR_BANK (BNKCODE, BNKNAME) VALUES (:c, :n)",
        params: { c: code, n: nm },
      },
    ]);
    return { status: "success", bnkcode: code, bnkname: nm };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const deleteBank = async (bnkcode, compc = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    await conn.execute("DELETE FROM HR_BRANCH WHERE BNKCODE = :c AND UNIT_ID = :u", { c: String(bnkcode), u: coerce(compc) });
    const res = await conn.execute("DELETE FROM HR_BANK WHERE BNKCODE = :c AND UNIT_ID = :u", { c: String(bnkcode), u: coerce(compc) });
    await conn.commit();
    if (res.rowsAffected === 0) return { status: "error", message: "Only banks added for this company can be removed." };
    return { status: "success" };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const addBankBranch = async (bnkcode, brnname, compc = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const res = await conn.execute(
      "SELECT NVL(MAX(TO_NUMBER(BRNCODE)), 0) + 1 FROM HR_BRANCH WHERE BNKCODE = :b AND REGEXP_LIKE(BRNCODE, '^[0-9]+$')",
      { b: String(bnkcode) },
      { outFormat: OUT_FORMAT_ARRAY }
    );
    const code = String(res.rows[0][0]);
    const nm = String(brnname).trim();
    await insertProgressive(conn, [
      {
        sql: "INSERT INTO HR_BRANCH (BNKCODE, BRNCODE, BRNNAME, UNIT_ID) VALUES (:b, :c, :n, :u)",
        params: { b: String(bnkcode), c: code, n: nm, u: coerce(compc) },
      },
      {
        sql: "INSERT INTO HR_BRANCH (BNKCODE, BRNCODE, BRNNAME) VALUES (:b, :c, :n)",
        params: { b: String(bnkcode), c: code, n: nm },
      },
    ]);
    return { status: "success", bnkcode: String(bnkcode), brncode: code, brnname: nm };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const deleteBankBranch = async (bnkcode, brncode, compc = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const res = await conn.execute(
      "DELETE FROM HR_BRANCH WHERE BNKCODE = :b AND BRNCODE = :c AND UNIT_ID = :u",
      { b: String(bnkcode), c: String(brncode), u: coerce(compc) },
      { autoCommit: true }
    );
    if (res.rowsAffected === 0) return { status: "error", message: "Only branches added for this company can be removed." };
    return { status: "success" };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const addQualification = async (descr, compc = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const d = String(descr).trim();
    await insertProgressive(conn, [
      {
        sql: "INSERT INTO HR_EMP_QUALIFICATION (DESCR, Q_TYPE, UNIT_ID) VALUES (:d, 'OPT', :u)",
        params: { d, u: coerce(compc) },
      },
      {
        sql: "INSERT INTO HR_EMP_QUALIFICATION (DESCR, Q_TYPE) VALUES (:d, 'OPT')",
        params: { d },
      },
    ]);
    return { status: "success", descr: d };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const deleteQualification = async (descr, compc = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const res = await conn.execute(
      "DELETE FROM HR_EMP_QUALIFICATION WHERE TRIM(DESCR) = :d AND Q_TYPE = 'OPT' AND UNIT_ID = :u",
      { d: String(descr).trim(), u: coerce(compc) },
      { autoCommit: true }
    );
    if (res.rowsAffected === 0) return { status: "error", message: "Only options added for this company can be removed." };
    return { status: "success" };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

let _interviewTablesReady = false;

const ensureInterviewTables = async () => {
  if (_interviewTablesReady) return;
  let conn;
  try {
    conn = await getDirectConnection();
    try {
      await conn.execute(`
        CREATE TABLE INTERVIEW_TYPES (
            TYPE_ID   NUMBER PRIMARY KEY,
            DESCR     VARCHAR2(50) NOT NULL,
            COMPC     NUMBER,
            BRNCH     NUMBER,
            IS_ACTIVE VARCHAR2(1) DEFAULT 'Y' NOT NULL
        )`);
      logger.info("[INTERVIEW] Created table INTERVIEW_TYPES");
    } catch (e) {
      if (!e.message.includes("ORA-00955")) logger.error("[INTERVIEW] Could not create INTERVIEW_TYPES:", e.message);
    }
    try {
      await conn.execute("CREATE SEQUENCE INTERVIEW_TYPES_SEQ START WITH 1 NOCACHE");
      logger.info("[INTERVIEW] Created sequence INTERVIEW_TYPES_SEQ");
    } catch (e) {
      if (!e.message.includes("ORA-00955")) logger.error("[INTERVIEW] Could not create sequence INTERVIEW_TYPES_SEQ:", e.message);
    }
    
    // Seed the global (COMPC NULL) interview types once.
    try {
      const res = await conn.execute("SELECT COUNT(*) FROM INTERVIEW_TYPES WHERE COMPC IS NULL", {}, { outFormat: OUT_FORMAT_ARRAY });
      if (Number(res.rows[0][0]) === 0) {
        const defaultTypes = ["HR", "Technical", "Managerial", "Final"];
        for (const d of defaultTypes) {
          await conn.execute(`
              INSERT INTO INTERVIEW_TYPES (TYPE_ID, DESCR, COMPC, BRNCH)
              VALUES (INTERVIEW_TYPES_SEQ.NEXTVAL, :d, NULL, NULL)
          `, { d }, { autoCommit: true });
        }
        logger.info(`[INTERVIEW] Seeded ${defaultTypes.length} global interview types`);
      }
    } catch (e) {
      logger.error("[INTERVIEW] Could not seed types:", e.message);
    }
    _interviewTablesReady = true;
  } finally {
    if (conn) await conn.close();
  }
};

export const getInterviewTypes = async (compc = null, brnch = null) => {
  await ensureInterviewTables();
  let conn;
  try {
    conn = await getDirectConnection();
    let params = {};
    let conds = ["IS_ACTIVE = 'Y'"];
    const c = coerce(compc);
    if (c !== null && c !== undefined) {
      conds.push("(COMPC = :c OR COMPC IS NULL)");
      params.c = c;
    }
    const b = coerce(brnch);
    if (b !== null && b !== undefined) {
      conds.push("(BRNCH = :b OR BRNCH IS NULL)");
      params.b = b;
    }
    const res = await conn.execute(`
        SELECT TYPE_ID, DESCR, COMPC, BRNCH FROM INTERVIEW_TYPES
        WHERE ${conds.join(" AND ")}
        ORDER BY DESCR
    `, params, { outFormat: OUT_FORMAT_ARRAY });
    return (res.rows || []).map(r => ({
      type_id: Number(r[0]),
      descr: String(r[1] ?? "").trim(),
      compc: coerce(r[2]),
      brnch: coerce(r[3])
    }));
  } finally {
    if (conn) await conn.close();
  }
};

export const addInterviewType = async (descr, compc = null, brnch = null) => {
  await ensureInterviewTables();
  const d = String(descr || "").trim().substring(0, 50);
  if (!d) return { status: "error", message: "Description is required" };
  let conn;
  try {
    conn = await getDirectConnection();
    const c = coerce(compc);
    const resCount = await conn.execute(`
        SELECT COUNT(*) FROM INTERVIEW_TYPES
        WHERE UPPER(DESCR) = UPPER(:d) AND IS_ACTIVE = 'Y'
          AND (COMPC IS NULL OR COMPC = :c)
    `, { d, c: c ?? null }, { outFormat: OUT_FORMAT_ARRAY });
    if (Number(resCount.rows[0][0]) > 0) {
      return { status: "error", message: `'${d}' already exists` };
    }
    const res = await conn.execute(`
        INSERT INTO INTERVIEW_TYPES (TYPE_ID, DESCR, COMPC, BRNCH)
        VALUES (INTERVIEW_TYPES_SEQ.NEXTVAL, :d, :c, :b)
        RETURNING TYPE_ID INTO :out_id
    `, { 
        d, 
        c: c ?? null, 
        b: coerce(brnch) ?? null, 
        out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT } 
    }, { autoCommit: true });
    
    return { status: "success", type_id: res.outBinds.out_id[0], descr: d };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const removeInterviewType = async (type_id, compc = null) => {
  await ensureInterviewTables();
  let conn;
  try {
    conn = await getDirectConnection();
    const res = await conn.execute(`
        UPDATE INTERVIEW_TYPES SET IS_ACTIVE = 'N'
        WHERE TYPE_ID = :id AND COMPC = :c
    `, { id: coerce(type_id), c: coerce(compc) }, { autoCommit: true });
    if (res.rowsAffected === 0) {
      return { status: "error", message: "Only types added for this company can be removed." };
    }
    return { status: "success" };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

// ═══════════════════════════════════════════════════════════════════
// Reference-data EDITS
//
// These master tables could only be added to and deleted from, so fixing a
// typo meant deleting the row — which fails once employees reference it — and
// re-adding it under a new code. Each update is scoped by UNIT_ID exactly like
// the matching delete, so one company cannot rename another's entries; a row
// belonging to another company simply matches nothing.
// ═══════════════════════════════════════════════════════════════════

const scopedUpdate = async (sql, params, notMine) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const res = await conn.execute(sql, params, { autoCommit: true });
    if (res.rowsAffected === 0) return { status: "error", message: notMine };
    return { status: "success" };
  } catch (e) {
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const updateEmpStatus = async (empStatus, descr, compc = null) =>
  scopedUpdate(
    "UPDATE HR_EMP_STATUS SET EMP_STATUS_DESC = :d WHERE EMP_STATUS = :c AND UNIT_ID = :u",
    { d: String(descr).trim(), c: String(empStatus), u: coerce(compc) },
    "Only entries added for this company can be edited."
  );

export const updateQualification = async (oldDescr, descr, compc = null) =>
  scopedUpdate(
    "UPDATE HR_EMP_QUALIFICATION SET DESCR = :d WHERE TRIM(DESCR) = :o AND Q_TYPE = 'OPT' AND UNIT_ID = :u",
    { d: String(descr).trim(), o: String(oldDescr).trim(), u: coerce(compc) },
    "Only options added for this company can be edited."
  );

export const updateBank = async (bnkcode, bnkname, compc = null) =>
  scopedUpdate(
    "UPDATE HR_BANK SET BNKNAME = :n WHERE BNKCODE = :c AND UNIT_ID = :u",
    { n: String(bnkname).trim(), c: String(bnkcode), u: coerce(compc) },
    "Only banks added for this company can be edited."
  );

export const updateBankBranch = async (bnkcode, brncode, brnname, compc = null) =>
  scopedUpdate(
    "UPDATE HR_BRANCH SET BRNNAME = :n WHERE BNKCODE = :b AND BRNCODE = :c AND UNIT_ID = :u",
    { n: String(brnname).trim(), b: String(bnkcode), c: String(brncode), u: coerce(compc) },
    "Only branches added for this company can be edited."
  );

export const updateInterviewType = async (typeId, descr, compc = null) =>
  scopedUpdate(
    "UPDATE INTERVIEW_TYPES SET DESCR = :d WHERE TYPE_ID = :t AND TO_CHAR(COMPC) = TO_CHAR(:u)",
    { d: String(descr).trim().substring(0, 50), t: Number(typeId), u: coerce(compc) },
    "Only interview types added for this company can be edited."
  );

export const updateBloodGroup = async (pk, bloodGroup, compc = null) =>
  scopedUpdate(
    "UPDATE BLOOD_GROUP SET BLOOD_GROUP = :bg WHERE BLOOD_GROUP_PK = :pk AND TO_CHAR(COMPC) = TO_CHAR(:u)",
    { bg: String(bloodGroup).trim(), pk: Number(pk), u: coerce(compc) },
    "Only blood groups added for this company can be edited."
  );

/** Blood groups had no delete at all — add wired to nothing to remove it. */
export const deleteBloodGroup = async (pk, compc = null) =>
  scopedUpdate(
    "DELETE FROM BLOOD_GROUP WHERE BLOOD_GROUP_PK = :pk AND TO_CHAR(COMPC) = TO_CHAR(:u)",
    { pk: Number(pk), u: coerce(compc) },
    "Only blood groups added for this company can be removed."
  );

// ═══════════════════════════════════════════════════════════════════
// Leave types (LEAVE_TYPES) — master setup, per company and branch
//
// The table carries COMPC and BRNCH, but every row shipped with the system is
// company 1 / branch 2 and is treated as global: reads return the rows for the
// selected scope PLUS those unscoped ones, so no company loses the standard
// CL / ML / EL. Writes always stamp the caller's own company and branch, and
// edits and deletes only match rows carrying them — one company can neither
// rename another's types nor the shared originals.
//
// A word of warning about new types: ALL_LEAVE_BAL_V, which every balance in
// the app comes from, hardcodes `leave_type_pk IN (1,2,3)`. A type added here
// is therefore recorded and reportable but carries no tracked balance, and the
// apply screen still offers CL, ML, EL and OD only. Extending that means
// changing the view, which is a database change rather than an app one.
// ═══════════════════════════════════════════════════════════════════

/**
 * The leave types that shipped with the system, PK 1 to 13.
 *
 * They are stamped COMPC 1 / BRNCH 2 in the table but are not company 1's in
 * any meaningful sense: ALL_LEAVE_BAL_V joins them against every employee of
 * every company, so CL, ML, EL and OD behave the same everywhere. They are
 * therefore shown to all companies and edited by none — renaming CL or moving
 * its entitlement here would silently change it for all five companies.
 *
 * Identified by PK because the table carries no flag to identify them with;
 * everything this panel adds gets a higher one.
 */
const SYSTEM_LEAVE_TYPE_MAX_PK = 13;

/**
 * Leave types visible to a company/branch: the system set above, any row with
 * no company at all, and this company's own additions — narrowed by branch
 * when one is selected.
 */
export const getLeaveTypes = async (compc = null, brnch = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const c = coerce(compc);
    const b = coerce(brnch);

    const params = { sys: SYSTEM_LEAVE_TYPE_MAX_PK };
    let scope = "WHERE LEAVE_TYPE_PK <= :sys";
    if (c !== null && c !== undefined) {
      params.c = c;
      let own = "TO_CHAR(COMPC) = TO_CHAR(:c)";
      if (b !== null && b !== undefined) {
        params.b = b;
        // A row with no branch of its own belongs to the whole company.
        own += " AND (BRNCH IS NULL OR TO_CHAR(BRNCH) = TO_CHAR(:b))";
      }
      scope += ` OR COMPC IS NULL OR (${own})`;
    }

    const res = await conn.execute(
      `SELECT LEAVE_TYPE_PK, LEAVE_TYPE, LEAVE_DESC, ENTITLEMENT, ALLOWED, TYPE, COMPC, BRNCH
         FROM LEAVE_TYPES
         ${scope}
        ORDER BY LEAVE_TYPE_PK`,
      params,
      { outFormat: OUT_FORMAT_ARRAY },
    );

    return (res.rows || []).map((r) => {
      const pk = Number(r[0]);
      const rowCompc = coerce(r[6]);
      const shared = pk <= SYSTEM_LEAVE_TYPE_MAX_PK;
      return {
        leave_type_pk: pk,
        leave_type: String(r[1] ?? "").trim(),
        leave_desc: String(r[2] ?? "").trim(),
        entitlement: r[3] === null || r[3] === undefined ? null : Number(r[3]),
        allowed: r[4] === null || r[4] === undefined ? null : Number(r[4]),
        type: String(r[5] ?? "").trim(),
        compc: rowCompc,
        brnch: coerce(r[7]),
        /** True for the standard set every company shares. */
        shared,
        /** Only this company's own additions can be changed here. */
        editable: !shared && c !== null && c !== undefined && String(rowCompc ?? "") === String(c),
        /** What the apply screen can offer — ALL_LEAVE_BAL_V covers 1, 2 and 3. */
        applyable:
          [1, 2, 3].includes(pk) ||
          /OD|OUT\s*DOOR|ON\s*DUTY/i.test(`${r[1] ?? ""} ${r[2] ?? ""}`),
      };
    });
  } finally {
    if (conn) await conn.close();
  }
};

export const addLeaveType = async ({ leave_type, leave_desc, entitlement, allowed, compc = null, brnch = null }) => {
  const code = String(leave_type ?? "").trim().toUpperCase().substring(0, 20);
  const desc = String(leave_desc ?? "").trim().substring(0, 50);
  if (!code) return { status: "error", message: "A leave code is required" };
  if (!desc) return { status: "error", message: "A description is required" };

  const c = coerce(compc);
  if (c === null || c === undefined) return { status: "error", message: "No company is selected" };

  let conn;
  try {
    conn = await getDirectConnection();

    const dup = await conn.execute(
      `SELECT COUNT(*) FROM LEAVE_TYPES
        WHERE UPPER(TRIM(LEAVE_TYPE)) = :code
          AND (COMPC IS NULL OR TO_CHAR(COMPC) = TO_CHAR(:c))`,
      { code, c },
      { outFormat: OUT_FORMAT_ARRAY },
    );
    if (Number(dup.rows[0][0]) > 0) {
      return { status: "error", message: `Leave code '${code}' is already in use for this company` };
    }

    // LEAVE_TYPES has a plain numeric PK with no sequence or trigger behind it,
    // so the next value is read first — a subquery inside VALUES is not legal
    // here (ORA-01745). The PK is global rather than per company because the
    // column is the whole key.
    const next = await conn.execute(
      "SELECT NVL(MAX(LEAVE_TYPE_PK), 0) + 1 FROM LEAVE_TYPES",
      {},
      { outFormat: OUT_FORMAT_ARRAY },
    );
    const pk = Number(next.rows[0][0]);

    await conn.execute(
      `INSERT INTO LEAVE_TYPES (LEAVE_TYPE_PK, LEAVE_TYPE, LEAVE_DESC, ENTITLEMENT, ALLOWED, TYPE, COMPC, BRNCH)
       VALUES (:pk, :code, :descr, :ent, :alw, 'ALL', :c, :b)`,
      {
        pk,
        code,
        descr: desc,
        ent: entitlement === "" || entitlement === null || entitlement === undefined ? null : Number(entitlement),
        alw: allowed === "" || allowed === null || allowed === undefined ? null : Number(allowed),
        c,
        b: coerce(brnch) ?? null,
      },
      { autoCommit: true },
    );
    return { status: "success", leave_type_pk: pk, leave_type: code };
  } catch (e) {
    if (conn) await conn.rollback();
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }
};

export const updateLeaveType = async (pk, { leave_desc, entitlement, allowed }, compc = null) =>
  scopedUpdate(
    `UPDATE LEAVE_TYPES
        SET LEAVE_DESC  = :d,
            ENTITLEMENT = :ent,
            ALLOWED     = :alw
      WHERE LEAVE_TYPE_PK = :pk
        AND LEAVE_TYPE_PK > ${SYSTEM_LEAVE_TYPE_MAX_PK}
        AND TO_CHAR(COMPC) = TO_CHAR(:u)`,
    {
      d: String(leave_desc ?? "").trim().substring(0, 50),
      ent: entitlement === "" || entitlement === null || entitlement === undefined ? null : Number(entitlement),
      alw: allowed === "" || allowed === null || allowed === undefined ? null : Number(allowed),
      pk: Number(pk),
      u: coerce(compc),
    },
    "Only leave types added for this company can be edited — the standard ones are shared by every company.",
  );

/**
 * Remove a leave type.
 *
 * Blocked once anything references it — a type still attached to applications
 * or allocations cannot be deleted without orphaning those rows, and the error
 * says which is the case rather than surfacing a constraint violation.
 */
export const deleteLeaveType = async (pk, compc = null) => {
  const id = Number(pk);
  let conn;
  try {
    conn = await getDirectConnection();
    const used = await conn.execute(
      `SELECT (SELECT COUNT(*) FROM LEAVE_APPLICATION_APPLY WHERE LEAVE_TYPE_FK = :pk1)
            + (SELECT COUNT(*) FROM LEAVE_APPLICATION       WHERE LEAVE_TYPE_FK = :pk2)
            + (SELECT COUNT(*) FROM LEAVE_OP                WHERE LEAVE_TYPE_FK = :pk3)
         FROM DUAL`,
      { pk1: id, pk2: id, pk3: id },
      { outFormat: OUT_FORMAT_ARRAY },
    );
    if (Number(used.rows[0][0]) > 0) {
      return {
        status: "error",
        message: "This leave type is in use by applications or allocations and cannot be removed.",
      };
    }
  } catch (e) {
    return { status: "error", message: e.message };
  } finally {
    if (conn) await conn.close();
  }

  return scopedUpdate(
    `DELETE FROM LEAVE_TYPES
      WHERE LEAVE_TYPE_PK = :pk
        AND LEAVE_TYPE_PK > ${SYSTEM_LEAVE_TYPE_MAX_PK}
        AND TO_CHAR(COMPC) = TO_CHAR(:u)`,
    { pk: id, u: coerce(compc) },
    "Only leave types added for this company can be removed — the standard ones are shared by every company.",
  );
};
