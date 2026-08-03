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
    let sql = "SELECT BNKCODE, BNKNAME FROM HR_BANK WHERE BNKCODE IS NOT NULL";
    const params = {};
    if (c !== null && c !== undefined) {
      sql += " AND (UNIT_ID = :u OR UNIT_ID IS NULL)";
      params.u = c;
    }
    sql += " ORDER BY LPAD(BNKCODE, 5)";
    const res = await conn.execute(sql, params, { outFormat: OUT_FORMAT_ARRAY });
    const rows = res.rows || [];
    return rows.map((r) => ({ bnkcode: String(r[0] ?? "").trim(), bnkname: String(r[1] ?? "").trim() }));
  } finally {
    if (conn) await conn.close();
  }
};

export const getBankBranches = async (bnkcode = null, compc = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    const c = coerce(compc);
    const conds = ["BRNCODE IS NOT NULL"];
    const params = {};
    if (bnkcode) {
      conds.push("BNKCODE = :b");
      params.b = String(bnkcode).trim();
    }
    if (c !== null && c !== undefined) {
      conds.push("(UNIT_ID = :u OR UNIT_ID IS NULL)");
      params.u = c;
    }
    const sql = `SELECT BRNCODE, BRNNAME FROM HR_BRANCH WHERE ${conds.join(" AND ")} ORDER BY BRNNAME`;
    const res = await conn.execute(sql, params, { outFormat: OUT_FORMAT_ARRAY });
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

export const getShiftLov = async () => {
  let conn;
  try {
    conn = await getDirectConnection();
    const res = await conn.execute(
      "SELECT SHIFT, DESCR FROM HR_SHIFT WHERE NVL(STATS, 'Y') = 'Y' ORDER BY SHIFT",
      {},
      { outFormat: OUT_FORMAT_ARRAY }
    );
    const rows = res.rows || [];
    return rows.map((r) => ({ shift: String(r[0] ?? "").trim(), descr: String(r[1] ?? "").trim() }));
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

export const getReportingOfficers = async (compc = null, brnch = null) => {
  let conn;
  try {
    conn = await getDirectConnection();
    
    const ints = (v) => {
      if (v === null || v === undefined || v === "") return [];
      const vals = Array.isArray(v) ? v : [v];
      return vals.map((x) => parseInt(String(x).trim(), 10)).filter((x) => !isNaN(x));
    };

    const base = "(STATUS = 'A' OR STATUS IS NULL) AND NAME IS NOT NULL";
    const compNums = ints(compc);
    const brnNums = ints(brnch);

    const attempts = [];
    if (compNums.length && brnNums.length) {
      const p = {};
      const cph = compNums.map((_, i) => `:c${i}`).join(", ");
      const bph = brnNums.map((_, i) => `:b${i}`).join(", ");
      compNums.forEach((n, i) => { p[`c${i}`] = n; });
      brnNums.forEach((n, i) => { p[`b${i}`] = n; });
      attempts.push({
        where: `${base} AND TO_NUMBER(UNIT_ID) IN (${cph}) AND TO_NUMBER(LOCATION) IN (${bph})`,
        params: p,
      });
    }
    if (compNums.length) {
      const p = {};
      const cph = compNums.map((_, i) => `:c${i}`).join(", ");
      compNums.forEach((n, i) => { p[`c${i}`] = n; });
      attempts.push({
        where: `${base} AND TO_NUMBER(UNIT_ID) IN (${cph})`,
        params: p,
      });
    }
    attempts.push({ where: base, params: {} });

    let lastErr = null;
    for (const { where, params } of attempts) {
      try {
        const sql = `SELECT EMPCODE, NAME FROM HR_EMP_MASTER WHERE ${where} ORDER BY NAME`;
        const res = await conn.execute(sql, params, { outFormat: OUT_FORMAT_ARRAY });
        return (res.rows || []).map((r) => ({ empcode: r[0], name: String(r[1] ?? "").trim() }));
      } catch (e) {
        lastErr = e;
        continue;
      }
    }
    logger.info(`[REPORTING_OFFICERS] all attempts failed: ${lastErr?.message}`);
    return [];
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
    const res = await conn.execute(
      "SELECT NVL(MAX(DESG_CD), 0) + 1 FROM HR_DESG WHERE GRADE_CD = :g",
      { g: gradeCd },
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
