/**
 * HRMS service — CRUD on HR_EMP_MASTER + HR dashboard / analytics / attendance
 * report queries.
 *
 * The SQL here is a faithful port of the FastAPI LMS-Backend
 * (repositories/hrms_repository.py). Table names, joins, WHERE clauses and the
 * progressive company/branch filter fallbacks are kept identical so both
 * backends return the same rows.
 */

import { getDirectConnection } from "../config/database.js";
import {
  executeWithEmpFilter,
  empFilterAttempts,
  rosterCardFilter,
  empDirectFilter,
} from "../utils/hrmsFilters.js";
import { cleanHHMM, rosterStatus } from "../utils/rosterStatus.js";

import { logger } from '../utils/logger.js';
const OUT_OBJECT = 4002; // oracledb.OUT_FORMAT_OBJECT
const OUT_ARRAY = 4001; // oracledb.OUT_FORMAT_ARRAY

// ------------------------------------------------------------------
// small helpers (mirror _str_or_none / _num_or_none / date fmt in Python)
// ------------------------------------------------------------------

const strOrNone = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : v);

const numOrNone = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const s = String(v).trim();
  if (/^[+-]?\d+$/.test(s)) return parseInt(s, 10);
  const f = parseFloat(s);
  return Number.isFinite(f) ? f : null;
};

// Lowercase every key of an OBJECT-format row (matches Python's
// [col[0].lower() for col in cursor.description]).
const lowerKeys = (row) => {
  const out = {};
  for (const k of Object.keys(row)) out[k.toLowerCase()] = row[k];
  return out;
};

// Rename the quoted Oracle columns "ATDTCARD#"/"MOBILE#" to atdtcard/mobile.
const renameCardCols = (rec) => {
  rec.atdtcard = rec["atdtcard#"] ?? null;
  delete rec["atdtcard#"];
  rec.mobile = rec["mobile#"] ?? null;
  delete rec["mobile#"];
  return rec;
};

// Format a JS Date (or ISO-ish string) to YYYY-MM-DD.
const fmtYmd = (v) => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
};

// Interpolate a validated YYYY-MM-DD into TRUNC(DATE '...') fragments used by
// the dashboard/analytics aggregate queries (mirrors the Python string build).
const truncDateExpr = (qdate) => {
  if (qdate && /^\d{4}-\d{2}-\d{2}$/.test(qdate)) {
    return { td: `TRUNC(DATE '${qdate}')`, yd: `TRUNC(DATE '${qdate}') - 1` };
  }
  return { td: "TRUNC(SYSDATE)", yd: "TRUNC(SYSDATE) - 1" };
};

// ==================================================================
// NEXT EMPCODE — auto-increment
// ==================================================================

export const getNextEmpcode = async () => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `SELECT MAX(TO_NUMBER(REGEXP_REPLACE(EMPCODE, '[^0-9]', '')))
       FROM HR_EMP_MASTER
       WHERE REGEXP_LIKE(EMPCODE, '^[0-9]+$')`,
      {},
      { outFormat: OUT_ARRAY }
    );
    const maxVal = result.rows?.[0]?.[0] ? parseInt(result.rows[0][0], 10) : 0;
    return String(maxVal + 1);
  } finally {
    await connection?.close();
  }
};

// ==================================================================
// CREATE EMPLOYEE
// ==================================================================

// Best-effort upsert of the profile Qualification + Detail into a Q_TYPE='PR'
// row of HR_EMP_QUALIFICATION. Non-fatal on any error (mirrors Python).
const saveQualificationDetail = async (connection, empcode, data) => {
  const qual = strOrNone(data.qfication);
  const detail = strOrNone(data.qual_detail);
  if (qual === null && detail === null) return;
  try {
    const r = await connection.execute(
      `SELECT OLD_EMPCODE, UNIT_ID FROM HR_EMP_MASTER WHERE EMPCODE = :e`,
      { e: empcode },
      { outFormat: OUT_ARRAY }
    );
    const oldEmp = r.rows?.[0]?.[0] ?? null;
    const unitId = r.rows?.[0]?.[1] ?? null;

    const upd = await connection.execute(
      `UPDATE HR_EMP_QUALIFICATION SET DESCR = :q, INTITUTE = :d
       WHERE Q_TYPE = 'PR'
         AND (EMPCODE = :e OR (:o IS NOT NULL AND OLD_EMPCODE = :o))`,
      { q: qual, d: detail, e: empcode, o: oldEmp }
    );
    if (upd.rowsAffected === 0) {
      await connection.execute(
        `INSERT INTO HR_EMP_QUALIFICATION (EMPCODE, OLD_EMPCODE, UNIT_ID, Q_TYPE, DESCR, INTITUTE)
         VALUES (:e, :o, :u, 'PR', :q, :d)`,
        { e: empcode, o: oldEmp, u: unitId, q: qual, d: detail }
      );
    }
    await connection.commit();
  } catch (err) {
    try { await connection.rollback(); } catch { /* ignore */ }
    logger.info(`[HRMS] qualification detail save skipped (non-fatal): ${String(err.message).slice(0, 90)}`);
  }
};

export const createEmployee = async (data) => {
  let connection;
  try {
    const empcode = await getNextEmpcode();
    connection = await getDirectConnection();
    await connection.execute(
      `INSERT INTO HR_EMP_MASTER (
          NAME, FHNAME, "ATDTCARD#",
          SEX, DTOFBRTH, NICNO,
          DTOFAPPT, DEPT_NO, DESG_CD,
          "MOBILE#", EMAIL, ADDRESS,
          UNIT_ID, STATUS, USER_PASWD,
          HR_ADMIN, RPT_OFFICER, MARSTAT,
          GRADE_CD, RELIGION,
          HOD1, HOD2, HOD3,
          BASIC, GROSS, SHIFT, W_HOUR, BLDGRP, LOCATION,
          EMP_STATUS, NTN, BNKCODE, BRNCODE, BNKACCT, QFICATION,
          DTOFCONFIRM
      ) VALUES (
          :name, :fhname, :atdtcard,
          :sex,
          CASE WHEN :dtofbrth IS NULL THEN NULL ELSE TO_DATE(:dtofbrth, 'YYYY-MM-DD') END,
          :nicno,
          CASE WHEN :dtofappt IS NULL THEN NULL ELSE TO_DATE(:dtofappt, 'YYYY-MM-DD') END,
          :dept_no, :desg_cd,
          :mobile, :email, :address,
          :unit_id, :status, :user_paswd,
          :hr_admin, :rpt_officer, :marstat,
          :grade_cd, :religion,
          :hod1, :hod2, :hod3,
          :basic, :gross, :shift, :w_hour, :bldgrp, :location,
          :emp_status, :ntn, :bnkcode, :brncode, :bnkacct, :qfication,
          CASE WHEN :dtofconfirm IS NULL THEN NULL ELSE TO_DATE(:dtofconfirm, 'YYYY-MM-DD') END
      )`,
      {
        name: data.name,
        fhname: strOrNone(data.fhname),
        atdtcard: strOrNone(data.atdtcard),
        sex: strOrNone(data.sex),
        dtofbrth: strOrNone(data.dtofbrth),
        nicno: strOrNone(data.nicno),
        dtofappt: strOrNone(data.dtofappt),
        dept_no: numOrNone(data.dept_no),
        desg_cd: numOrNone(data.desg_cd),
        mobile: strOrNone(data.mobile),
        email: strOrNone(data.email),
        address: strOrNone(data.address),
        unit_id: numOrNone(data.unit_id) || 1,
        status: data.status || "A",
        user_paswd: strOrNone(data.user_paswd),
        hr_admin: data.hr_admin || "N",
        rpt_officer: strOrNone(data.rpt_officer),
        marstat: strOrNone(data.marstat),
        grade_cd: strOrNone(data.grade_cd),
        religion: (strOrNone(data.religion) ?? "").slice(0, 4) || null,
        hod1: numOrNone(data.hod1),
        hod2: numOrNone(data.hod2),
        hod3: numOrNone(data.hod3),
        basic: numOrNone(data.basic),
        gross: numOrNone(data.gross),
        shift: strOrNone(data.shift),
        w_hour: numOrNone(data.w_hour),
        bldgrp: strOrNone(data.bldgrp),
        location: numOrNone(data.location),
        emp_status: strOrNone(data.emp_status),
        ntn: strOrNone(data.ntn),
        bnkcode: strOrNone(data.bnkcode),
        brncode: strOrNone(data.brncode),
        bnkacct: strOrNone(data.bnkacct),
        qfication: strOrNone(data.qfication),
        dtofconfirm: strOrNone(data.dtofconfirm),
      }
    );
    await connection.commit();
    await saveQualificationDetail(connection, empcode, data);
    const empcodeResult = await connection.execute(
      `SELECT EMPCODE FROM HR_EMP_MASTER WHERE NAME = :name`,
      { name: data.name }
    );
    const epcode = empcodeResult.rows?.[0]?.[0] ?? empcode;
    return { status: "success", empcode: epcode };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

// ==================================================================
// GET EMPLOYEE BY EMPCODE (extended read + base fallback)
// ==================================================================

export const getEmployeeByEmpcode = async (empcode) => {
  let connection;
  try {
    connection = await getDirectConnection();

    const extendedSql = `
      SELECT
          m.EMPCODE, m.NAME, m.FHNAME, m."ATDTCARD#",
          m.SEX,
          TO_CHAR(m.DTOFBRTH, 'YYYY-MM-DD') AS DTOFBRTH,
          m.NICNO,
          TO_CHAR(m.DTOFAPPT, 'YYYY-MM-DD') AS DTOFAPPT,
          m.DEPT_NO, m.DESG_CD,
          m."MOBILE#", m.EMAIL, m.ADDRESS,
          m.UNIT_ID, m.STATUS, m.USER_PASWD,
          m.HR_ADMIN, m.RPT_OFFICER, m.MARSTAT,
          m.GRADE_CD, m.RELIGION,
          m.HOD1, m.HOD2, m.HOD3,
          m.BASIC, m.GROSS, m.SHIFT, m.W_HOUR,
          m.TRACK_LOCATION, m.TRACK_LOCATION_HR,
          m.EMP_STATUS, m.NTN, m.BNKCODE, m.BRNCODE, m.BNKACCT,
          m.QFICATION,
          TO_CHAR(m.DTOFCONFIRM, 'YYYY-MM-DD') AS DTOFCONFIRM,
          (SELECT MAX(s.GROSS) FROM HR_EMP_MASTER_SAL s
             WHERE s.OLD_EMPCODE = m.OLD_EMPCODE AND s.UNIT_ID = m.UNIT_ID
               AND s.PERIOD# = (SELECT MAX(s2.PERIOD#) FROM HR_EMP_MASTER_SAL s2
                                 WHERE s2.OLD_EMPCODE = m.OLD_EMPCODE AND s2.UNIT_ID = m.UNIT_ID)
          ) AS SAL_GROSS,
          (SELECT MAX(s.BASIC) FROM HR_EMP_MASTER_SAL s
             WHERE s.OLD_EMPCODE = m.OLD_EMPCODE AND s.UNIT_ID = m.UNIT_ID
               AND s.PERIOD# = (SELECT MAX(s2.PERIOD#) FROM HR_EMP_MASTER_SAL s2
                                 WHERE s2.OLD_EMPCODE = m.OLD_EMPCODE AND s2.UNIT_ID = m.UNIT_ID)
          ) AS SAL_BASIC,
          (SELECT MAX(q.INTITUTE) FROM HR_EMP_QUALIFICATION q
             WHERE q.Q_TYPE = 'PR'
               AND (q.EMPCODE = m.EMPCODE OR q.OLD_EMPCODE = m.OLD_EMPCODE)
          ) AS QUAL_DETAIL
      FROM HR_EMP_MASTER m
      WHERE m.EMPCODE = :empcode`;

    const baseSql = `
      SELECT
          EMPCODE, NAME, FHNAME, "ATDTCARD#",
          SEX,
          TO_CHAR(DTOFBRTH, 'YYYY-MM-DD') AS DTOFBRTH,
          NICNO,
          TO_CHAR(DTOFAPPT, 'YYYY-MM-DD') AS DTOFAPPT,
          DEPT_NO, DESG_CD,
          "MOBILE#", EMAIL, ADDRESS,
          UNIT_ID, STATUS, USER_PASWD,
          HR_ADMIN, RPT_OFFICER, MARSTAT,
          GRADE_CD, RELIGION,
          HOD1, HOD2, HOD3,
          BASIC, GROSS, SHIFT, W_HOUR,
          TRACK_LOCATION, TRACK_LOCATION_HR
      FROM HR_EMP_MASTER
      WHERE EMPCODE = :empcode`;

    let result;
    try {
      result = await connection.execute(extendedSql, { empcode }, { outFormat: OUT_OBJECT });
    } catch (err) {
      if (String(err.message).includes("ORA-00904") || String(err.message).includes("ORA-00942")) {
        logger.info(`[HRMS] employee extended read fell back: ${String(err.message).slice(0, 90)}`);
        result = await connection.execute(baseSql, { empcode }, { outFormat: OUT_OBJECT });
      } else {
        throw err;
      }
    }

    const raw = result.rows?.[0];
    if (!raw) return null;
    return renameCardCols(lowerKeys(raw));
  } finally {
    await connection?.close();
  }
};

// ==================================================================
// EMPLOYEE ID CARD (resolved names for printing)
// ==================================================================

export const getEmployeeCard = async (empcode) => {
  let connection;
  try {
    connection = await getDirectConnection();
    try {
      const result = await connection.execute(
        `SELECT
            m.EMPCODE, m.NAME, m.FHNAME, m."ATDTCARD#", m.NICNO, m."MOBILE#",
            m.EMAIL, m.SEX, m.BLDGRP, m.STATUS,
            TO_CHAR(m.DTOFAPPT, 'YYYY-MM-DD') AS DTOFAPPT,
            (SELECT MIN(dg.DESG_DESC) FROM HR_DESG dg WHERE LTRIM(dg.DESG_CD,'0')=LTRIM(m.DESG_CD,'0') AND TO_CHAR(dg.COMPC)=TO_CHAR(m.UNIT_ID)) AS DESIGNATION,
            (SELECT MIN(d.DEPT_NAME) FROM HR_DEPT d
               WHERE LTRIM(d.DEPT_NO,'0')=LTRIM(m.DEPT_NO,'0') AND TO_CHAR(d.COMPC)=TO_CHAR(m.UNIT_ID)) AS DEPARTMENT,
            (SELECT u.UNIT_NAME FROM UNIT_MST u WHERE u.UNIT_ID = m.UNIT_ID) AS COMPANY_NAME,
            (SELECT MIN(l.DESCR) FROM COM_LOCATION l WHERE TRIM(l.LCODE) = TRIM(m.LOCATION)) AS BRANCH_NAME,
            TO_CHAR(m.UNIT_ID) AS COMPC
         FROM HR_EMP_MASTER m
         WHERE m.EMPCODE = :e`,
        { e: empcode },
        { outFormat: OUT_OBJECT }
      );
      const raw = result.rows?.[0];
      if (!raw) return null;
      const r = renameCardCols(lowerKeys(raw));
      for (const k of ["name", "designation", "department", "company_name", "branch_name", "nicno", "compc"]) {
        if (r[k]) r[k] = String(r[k]).trim();
      }
      r.card_no = r.empcode;
      return r;
    } catch (err) {
      if (String(err.message).includes("ORA-00904") || String(err.message).includes("ORA-00942")) {
        const base = await getEmployeeByEmpcode(empcode);
        if (base) base.card_no = base.empcode;
        return base;
      }
      throw err;
    }
  } finally {
    await connection?.close();
  }
};

// ==================================================================
// UPDATE EMPLOYEE
// ==================================================================

const UPDATE_FIELD_MAP = {
  name: "NAME", fhname: "FHNAME",
  sex: "SEX", nicno: "NICNO", dept_no: "DEPT_NO",
  desg_cd: "DESG_CD", mobile: '"MOBILE#"', email: "EMAIL",
  address: "ADDRESS", unit_id: "UNIT_ID", status: "STATUS",
  user_paswd: "USER_PASWD", hr_admin: "HR_ADMIN",
  rpt_officer: "RPT_OFFICER", marstat: "MARSTAT",
  grade_cd: "GRADE_CD", religion: "RELIGION",
  hod1: "HOD1", hod2: "HOD2", hod3: "HOD3",
  basic: "BASIC", gross: "GROSS", shift: "SHIFT",
  w_hour: "W_HOUR", bldgrp: "BLDGRP", location: "LOCATION",
  track_location: "TRACK_LOCATION", track_location_hr: "TRACK_LOCATION_HR",
  emp_status: "EMP_STATUS", ntn: "NTN", bnkcode: "BNKCODE",
  brncode: "BRNCODE", bnkacct: "BNKACCT", qfication: "QFICATION",
};
const UPDATE_DATE_FIELDS = { dtofbrth: "DTOFBRTH", dtofappt: "DTOFAPPT", dtofconfirm: "DTOFCONFIRM" };
const NUMERIC_STR_FIELDS = new Set(["dept_no", "desg_cd", "location"]);

export const updateEmployee = async (empcode, data) => {
  const setParts = [];
  const params = { empcode };

  for (const [key, col] of Object.entries(UPDATE_FIELD_MAP)) {
    if (!(key in data) || data[key] === null || data[key] === undefined) continue;
    let val = data[key];
    if (key === "religion") {
      val = (strOrNone(String(val)) ?? "").slice(0, 4) || null;
      if (val === null) continue;
    } else if (NUMERIC_STR_FIELDS.has(key)) {
      val = numOrNone(val);
      if (val === null) continue;
    }
    setParts.push(`${col} = :${key}`);
    params[key] = val;
  }

  for (const [key, col] of Object.entries(UPDATE_DATE_FIELDS)) {
    if (key in data && data[key] !== null && data[key] !== undefined) {
      const dateVal = strOrNone(data[key]);
      if (dateVal === null) continue;
      setParts.push(`${col} = TO_DATE(:${key}, 'YYYY-MM-DD')`);
      params[key] = dateVal;
    }
  }

  const hasQual =
    (data.qfication !== undefined && data.qfication !== null) ||
    (data.qual_detail !== undefined && data.qual_detail !== null);
  if (!setParts.length && !hasQual) {
    return { status: "error", message: "No fields to update" };
  }

  let connection;
  try {
    connection = await getDirectConnection();
    if (setParts.length) {
      const result = await connection.execute(
        `UPDATE HR_EMP_MASTER SET ${setParts.join(", ")} WHERE EMPCODE = :empcode`,
        params
      );
      await connection.commit();
      if (result.rowsAffected === 0) {
        return { status: "error", message: "Employee not found" };
      }
    }
    await saveQualificationDetail(connection, empcode, data);
    return { status: "success", message: "Employee updated successfully" };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

// ==================================================================
// SEARCH / LIST EMPLOYEES
// ==================================================================

const EMP_LIST_SELECT = `
  SELECT
      h.EMPCODE, h.NAME, h.FHNAME, h."ATDTCARD#",
      h.DEPT_NO, h.DESG_CD, h."MOBILE#", h.EMAIL,
      h.STATUS, h.HR_ADMIN, h.UNIT_ID,
      TO_CHAR(e.CARD_NO) AS CARD_NO,
      h.SEX, h.LOCATION,
      h.TRACK_LOCATION, h.TRACK_LOCATION_HR
  FROM HR_EMP_MASTER h
  LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE`;

export const searchEmployeesHrms = async (query, allowedCompanies = null, allowedBranches = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const params = { q: `%${query.toUpperCase()}%` };
    const { sql: filterSql } = empDirectFilter(allowedCompanies, allowedBranches, params);

    const result = await connection.execute(
      EMP_LIST_SELECT +
        `
        WHERE (UPPER(h.NAME) LIKE :q
           OR h.EMPCODE LIKE :q
           OR h."ATDTCARD#" LIKE :q
           OR h."MOBILE#" LIKE :q)` +
        filterSql +
        `
        ORDER BY h.NAME
        FETCH FIRST 50 ROWS ONLY`,
      params,
      { outFormat: OUT_OBJECT }
    );
    return (result.rows ?? []).map((r) => renameCardCols(lowerKeys(r)));
  } finally {
    await connection?.close();
  }
};

export const listEmployeesHrms = async (status = null, allowedCompanies = null, allowedBranches = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const params = {};
    const { parts, sql: filterSql } = empDirectFilter(allowedCompanies, allowedBranches, params);

    // Every branch is capped at 2000 rows, matching FastAPI's
    // list_employees_hrms (hrms_repository.py) — without it a company-wide
    // listing streams the entire HR_EMP_MASTER table to the browser.
    const CAP = ` FETCH FIRST 2000 ROWS ONLY`;

    let sql;
    if (status === "I") {
      sql = EMP_LIST_SELECT + ` WHERE h.STATUS IN ('I', 'D')${filterSql} ORDER BY h.NAME` + CAP;
    } else if (status === "A" || status === "L") {
      params.status = status;
      sql = EMP_LIST_SELECT + ` WHERE h.STATUS = :status${filterSql} ORDER BY h.NAME` + CAP;
    } else if (parts.length) {
      sql = EMP_LIST_SELECT + ` WHERE ${parts.join(" AND ")} ORDER BY h.NAME` + CAP;
    } else {
      sql = EMP_LIST_SELECT + ` ORDER BY h.NAME` + CAP;
    }

    const result = await connection.execute(sql, params, { outFormat: OUT_OBJECT });
    return (result.rows ?? []).map((r) => renameCardCols(lowerKeys(r)));
  } finally {
    await connection?.close();
  }
};

// ==================================================================
// HR DASHBOARD — today's attendance overview across all employees
// ==================================================================

export const getHrDashboardStats = async (qdate = null, compc = null, brnch = null) => {
  const { td, yd } = truncDateExpr(qdate);
  let connection;
  try {
    connection = await getDirectConnection();

    // Total active employees (progressive company/branch fallback)
    let totalEmployees = 0;
    try {
      const r = await executeWithEmpFilter(
        connection,
        "SELECT COUNT(*) FROM HR_EMP_MASTER h WHERE (h.STATUS = 'A' OR h.STATUS IS NULL){filter}",
        compc, brnch, { options: { outFormat: OUT_ARRAY } }
      );
      totalEmployees = r.rows?.[0]?.[0] || 0;
    } catch (e) { logger.info(`[HR_DASHBOARD] Total count failed: ${e.message}`); }

    let present = 0, absent = 0, late = 0, incomplete = 0, onLeave = 0;

    // Present: union DUTY_ROSTER + ATTENDANCE_RECORDS
    try {
      const p = {};
      const cf = rosterCardFilter(compc, brnch, p, "pc");
      const r = await connection.execute(`
        SELECT COUNT(DISTINCT card_no) FROM (
            SELECT TO_CHAR(CARD_NO) AS card_no FROM DUTY_ROSTER
            WHERE TRUNC(ROSTER_DATE) = ${td} AND IN_TIME IS NOT NULL${cf}
            UNION
            SELECT TO_CHAR(CARD_NO) AS card_no FROM ATTENDANCE_RECORDS
            WHERE TRUNC(ATTENDANCE_DATE) = ${td} AND ENTRY_TIME IS NOT NULL${cf}
        )`, p, { outFormat: OUT_ARRAY });
      present = parseInt(r.rows?.[0]?.[0] || 0, 10);
    } catch (e) { logger.info(`[HR_DASHBOARD] Present count query failed: ${e.message}`); }

    // Late / incomplete / on-leave from DUTY_ROSTER
    try {
      const p = {};
      const cf = rosterCardFilter(compc, brnch, p, "sc");
      const r = await connection.execute(`
        SELECT
            SUM(CASE WHEN IN_TIME IS NOT NULL AND OUT_TIME IS NULL THEN 1 ELSE 0 END),
            SUM(CASE WHEN NVL(LATE_HRS, 0) > 0 OR NVL(LATE_MNT, 0) > 0 THEN 1 ELSE 0 END),
            SUM(CASE WHEN UPPER(STATUS) LIKE '%LEAVE%' THEN 1 ELSE 0 END)
        FROM DUTY_ROSTER
        WHERE TRUNC(ROSTER_DATE) = ${td}${cf}`, p, { outFormat: OUT_ARRAY });
      const row = r.rows?.[0];
      if (row) {
        incomplete = parseInt(row[0] || 0, 10);
        late = parseInt(row[1] || 0, 10);
        onLeave = parseInt(row[2] || 0, 10);
      }
    } catch (e) {
      logger.info(`[HR_DASHBOARD] DUTY_ROSTER stats failed: ${e.message}`);
      try {
        const p = {};
        const cf = rosterCardFilter(compc, brnch, p, "ic");
        const r = await connection.execute(`
          SELECT SUM(CASE WHEN ENTRY_TIME IS NOT NULL AND EXIT_TIME IS NULL THEN 1 ELSE 0 END)
          FROM ATTENDANCE_RECORDS
          WHERE TRUNC(ATTENDANCE_DATE) = ${td}${cf}`, p, { outFormat: OUT_ARRAY });
        if (r.rows?.[0]) incomplete = parseInt(r.rows[0][0] || 0, 10);
      } catch { /* ignore */ }
    }

    absent = Math.max(totalEmployees - present - onLeave, 0);

    // Department-wise breakdown (progressive fallback)
    const deptBreakdown = [];
    try {
      const r = await executeWithEmpFilter(connection, `
        SELECT
            NVL(dep.DEPT_NAME, NVL(TO_CHAR(h.DEPT_NO), 'Unknown')) AS dept,
            COUNT(*) AS total,
            SUM(CASE WHEN d.IN_TIME IS NOT NULL OR ar.card_no IS NOT NULL THEN 1 ELSE 0 END) AS present
        FROM HR_EMP_MASTER h
        LEFT JOIN HR_DEPT dep
            ON TO_CHAR(dep.DEPT_NO) = TO_CHAR(h.DEPT_NO) AND TO_CHAR(dep.COMPC) = TO_CHAR(h.UNIT_ID)
        LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
        LEFT JOIN DUTY_ROSTER d
            ON TO_CHAR(d.CARD_NO) = TO_CHAR(e.CARD_NO)
            AND TRUNC(d.ROSTER_DATE) = ${td}
        LEFT JOIN (
            SELECT DISTINCT TO_CHAR(CARD_NO) AS card_no
            FROM ATTENDANCE_RECORDS
            WHERE TRUNC(ATTENDANCE_DATE) = ${td} AND ENTRY_TIME IS NOT NULL
        ) ar ON ar.card_no = TO_CHAR(e.CARD_NO)
        WHERE (h.STATUS = 'A' OR h.STATUS IS NULL){filter}
        GROUP BY NVL(dep.DEPT_NAME, NVL(TO_CHAR(h.DEPT_NO), 'Unknown'))
        ORDER BY COUNT(*) DESC
        FETCH FIRST 10 ROWS ONLY`, compc, brnch, { options: { outFormat: OUT_ARRAY } });
      for (const row of r.rows ?? []) {
        deptBreakdown.push({ department: row[0] || "Unknown", total: parseInt(row[1] || 0, 10), present: parseInt(row[2] || 0, 10) });
      }
    } catch (e) { logger.info(`[HR_DASHBOARD] Department breakdown failed: ${e.message}`); }

    // Recent hires (last 30 days)
    let recentHires = 0;
    try {
      const r = await executeWithEmpFilter(
        connection,
        "SELECT COUNT(*) FROM HR_EMP_MASTER h WHERE h.DTOFAPPT >= SYSDATE - 30{filter}",
        compc, brnch, { options: { outFormat: OUT_ARRAY } }
      );
      recentHires = parseInt(r.rows?.[0]?.[0] || 0, 10);
    } catch { /* ignore */ }

    // Yesterday's stats for delta indicators
    let yesterdayPresent = 0, yesterdayOnLeave = 0, yesterdayAbsent = 0;
    try {
      const p = {};
      const cf = rosterCardFilter(compc, brnch, p, "yd");
      const r = await connection.execute(`
        SELECT
            SUM(CASE WHEN IN_TIME IS NOT NULL THEN 1 ELSE 0 END),
            SUM(CASE WHEN UPPER(STATUS) LIKE '%LEAVE%' THEN 1 ELSE 0 END)
        FROM DUTY_ROSTER
        WHERE TRUNC(ROSTER_DATE) = ${yd}${cf}`, p, { outFormat: OUT_ARRAY });
      const row = r.rows?.[0];
      if (row) {
        yesterdayPresent = parseInt(row[0] || 0, 10);
        yesterdayOnLeave = parseInt(row[1] || 0, 10);
        yesterdayAbsent = Math.max(totalEmployees - yesterdayPresent - yesterdayOnLeave, 0);
      }
    } catch (e) { logger.info(`[HR_DASHBOARD] Yesterday stats failed: ${e.message}`); }

    // Upcoming birthdays (next 14 days)
    const upcomingBirthdays = [];
    try {
      const r = await executeWithEmpFilter(connection, `
        SELECT h.NAME,
            TO_CHAR(h.DTOFBRTH, 'DD Mon') AS bday,
            NVL(dep.DEPT_NAME, 'N/A') AS dept,
            MOD(TO_NUMBER(TO_CHAR(h.DTOFBRTH, 'DDD'))
                - TO_NUMBER(TO_CHAR(SYSDATE, 'DDD')) + 365, 365) AS days_until
        FROM HR_EMP_MASTER h
        LEFT JOIN HR_DEPT dep ON TO_CHAR(dep.DEPT_NO) = TO_CHAR(h.DEPT_NO) AND TO_CHAR(dep.COMPC) = TO_CHAR(h.UNIT_ID)
        WHERE (h.STATUS = 'A' OR h.STATUS IS NULL)
          AND h.DTOFBRTH IS NOT NULL
          AND MOD(TO_NUMBER(TO_CHAR(h.DTOFBRTH, 'DDD'))
              - TO_NUMBER(TO_CHAR(SYSDATE, 'DDD')) + 365, 365) <= 14{filter}
        ORDER BY days_until
        FETCH FIRST 8 ROWS ONLY`, compc, brnch, { options: { outFormat: OUT_ARRAY } });
      for (const row of r.rows ?? []) {
        upcomingBirthdays.push({ name: row[0] || "Unknown", date: row[1] || "", dept: row[2] || "N/A", days_until: parseInt(row[3] || 0, 10) });
      }
    } catch (e) { logger.info(`[HR_DASHBOARD] Birthdays failed: ${e.message}`); }

    // Upcoming work anniversaries (next 14 days)
    const upcomingAnniversaries = [];
    try {
      const r = await executeWithEmpFilter(connection, `
        SELECT h.NAME,
            TO_CHAR(h.DTOFAPPT, 'DD Mon') AS ann_date,
            TO_NUMBER(TO_CHAR(SYSDATE, 'YYYY'))
                - TO_NUMBER(TO_CHAR(h.DTOFAPPT, 'YYYY')) AS years,
            NVL(dep.DEPT_NAME, 'N/A') AS dept,
            MOD(TO_NUMBER(TO_CHAR(h.DTOFAPPT, 'DDD'))
                - TO_NUMBER(TO_CHAR(SYSDATE, 'DDD')) + 365, 365) AS days_until
        FROM HR_EMP_MASTER h
        LEFT JOIN HR_DEPT dep ON TO_CHAR(dep.DEPT_NO) = TO_CHAR(h.DEPT_NO) AND TO_CHAR(dep.COMPC) = TO_CHAR(h.UNIT_ID)
        WHERE (h.STATUS = 'A' OR h.STATUS IS NULL)
          AND h.DTOFAPPT IS NOT NULL
          AND MOD(TO_NUMBER(TO_CHAR(h.DTOFAPPT, 'DDD'))
              - TO_NUMBER(TO_CHAR(SYSDATE, 'DDD')) + 365, 365) <= 14
          AND TO_NUMBER(TO_CHAR(SYSDATE, 'YYYY'))
              > TO_NUMBER(TO_CHAR(h.DTOFAPPT, 'YYYY')){filter}
        ORDER BY days_until
        FETCH FIRST 8 ROWS ONLY`, compc, brnch, { options: { outFormat: OUT_ARRAY } });
      for (const row of r.rows ?? []) {
        upcomingAnniversaries.push({ name: row[0] || "Unknown", date: row[1] || "", years: parseInt(row[2] || 1, 10), dept: row[3] || "N/A", days_until: parseInt(row[4] || 0, 10) });
      }
    } catch (e) { logger.info(`[HR_DASHBOARD] Anniversaries failed: ${e.message}`); }

    // Upcoming leave requests (next 30 days)
    const upcomingLeaves = [];
    try {
      const r = await connection.execute(`
        SELECT h.NAME,
            la.LEAVE_DATE_FROM, la.LEAVE_DATE_TO,
            la.LEAVE_TYPE_FK,
            NVL(la.APPROVAL_STATUS, 'PENDING') AS status,
            la.LEAVE_DAYS,
            NVL(dep.DEPT_NAME, 'N/A') AS dept
        FROM LEAVE_APPLICATION la
        LEFT JOIN EMPLOYEE e ON TO_CHAR(e.CARD_NO) = TO_CHAR(la.EMP_FK)
        LEFT JOIN HR_EMP_MASTER h ON h.EMPCODE = e.EMPCODE
        LEFT JOIN HR_DEPT dep ON TO_CHAR(dep.DEPT_NO) = TO_CHAR(h.DEPT_NO) AND TO_CHAR(dep.COMPC) = TO_CHAR(h.UNIT_ID)
        WHERE la.LEAVE_DATE_FROM >= TRUNC(SYSDATE)
          AND la.LEAVE_DATE_FROM <= TRUNC(SYSDATE) + 30
        ORDER BY la.LEAVE_DATE_FROM
        FETCH FIRST 10 ROWS ONLY`, {}, { outFormat: OUT_ARRAY });
      for (const row of r.rows ?? []) {
        upcomingLeaves.push({
          name: row[0] || "Unknown",
          from_date: fmtYmd(row[1]),
          to_date: fmtYmd(row[2]),
          leave_type: parseInt(row[3] || 0, 10),
          status: row[4] || "PENDING",
          days: parseInt(row[5] || 1, 10),
          dept: row[6] || "N/A",
        });
      }
    } catch (e) { logger.info(`[HR_DASHBOARD] Upcoming leaves failed: ${e.message}`); }

    // Shift-wise attendance
    const shiftWise = [];
    try {
      const p = {};
      const cf = rosterCardFilter(compc, brnch, p, "sh");
      const r = await connection.execute(`
        SELECT NVL(ROSTER_SHIFT, 'Day') AS shift_name,
            SUM(CASE WHEN IN_TIME IS NOT NULL THEN 1 ELSE 0 END) AS present,
            COUNT(*) AS total
        FROM DUTY_ROSTER
        WHERE TRUNC(ROSTER_DATE) = ${td}${cf}
        GROUP BY NVL(ROSTER_SHIFT, 'Day')
        ORDER BY total DESC`, p, { outFormat: OUT_ARRAY });
      for (const row of r.rows ?? []) {
        const totalS = parseInt(row[2] || 1, 10);
        const presentS = parseInt(row[1] || 0, 10);
        shiftWise.push({ shift: row[0] || "Day", present: presentS, total: totalS, pct: Math.round((totalS > 0 ? (presentS / totalS) * 100 : 0) * 10) / 10 });
      }
    } catch (e) { logger.info(`[HR_DASHBOARD] Shift-wise failed: ${e.message}`); }

    // Top absence/leave reasons this year
    const topReasons = [];
    try {
      const r = await connection.execute(`
        SELECT NVL(lt.LEAVE_DESC, 'Type ' || TO_CHAR(la.LEAVE_TYPE_FK)) AS reason,
            COUNT(*) AS cnt
        FROM LEAVE_APPLICATION la
        LEFT JOIN LEAVE_TYPES lt ON lt.LEAVE_TYPE_PK = la.LEAVE_TYPE_FK
        WHERE la.LEAVE_DATE_FROM >= TRUNC(SYSDATE, 'YYYY')
        GROUP BY NVL(lt.LEAVE_DESC, 'Type ' || TO_CHAR(la.LEAVE_TYPE_FK))
        ORDER BY cnt DESC
        FETCH FIRST 5 ROWS ONLY`, {}, { outFormat: OUT_ARRAY });
      for (const row of r.rows ?? []) topReasons.push({ reason: row[0] || "Other", count: parseInt(row[1] || 0, 10) });
    } catch (e) { logger.info(`[HR_DASHBOARD] Top reasons failed: ${e.message}`); }

    // Inactive count for turnover computation
    let inactiveCount = 0;
    try {
      const r = await connection.execute(`SELECT COUNT(*) FROM HR_EMP_MASTER WHERE STATUS IN ('I', 'D')`, {}, { outFormat: OUT_ARRAY });
      inactiveCount = parseInt(r.rows?.[0]?.[0] || 0, 10);
    } catch { /* ignore */ }

    const totalEver = totalEmployees + inactiveCount;
    const turnoverYtd = Math.round((totalEver > 0 ? (inactiveCount / totalEver) * 100 : 0) * 10) / 10;

    return {
      total_employees: totalEmployees,
      present_today: present,
      absent_today: absent,
      late_today: late,
      incomplete_today: incomplete,
      on_leave_today: onLeave,
      recent_hires: recentHires,
      department_breakdown: deptBreakdown,
      yesterday_present: yesterdayPresent,
      yesterday_absent: yesterdayAbsent,
      yesterday_on_leave: yesterdayOnLeave,
      upcoming_birthdays: upcomingBirthdays,
      upcoming_anniversaries: upcomingAnniversaries,
      upcoming_leaves: upcomingLeaves,
      shift_wise: shiftWise,
      top_reasons: topReasons,
      turnover_ytd: turnoverYtd,
    };
  } finally {
    await connection?.close();
  }
};

// ==================================================================
// HR ANALYTICS — chart data for the enhanced dashboard
// ==================================================================

export const getHrAnalytics = async (qdate = null, compc = null, brnch = null) => {
  const { td } = truncDateExpr(qdate);
  let connection;
  try {
    connection = await getDirectConnection();

    // Card-level filter binds (only these go to DUTY_ROSTER / ATTENDANCE queries)
    const cardParams = {};
    const cf = rosterCardFilter(compc, brnch, cardParams, "ac");

    // Direct HR_EMP_MASTER filter for the active-employee count (separate binds).
    const first = empFilterAttempts(compc, brnch, "")[0];
    // alias="" yields "TO_NUMBER(.UNIT_ID)"; strip every stray leading dot.
    // replaceAll, not replace: Python's str.replace is global, so the FastAPI
    // original fixed both fragments. JS's replace(string) only fixes the first,
    // which left "TO_NUMBER(.LOCATION)" and failed with ORA-00936 whenever both
    // a company and a branch filter were active.
    const empFilter = first.frag.replaceAll("TO_NUMBER(.", "TO_NUMBER(");
    const empParams = first.params;

    let lateLogins = 0, earlyLogins = 0, overtimeHours = 0, avgWorkHrs = 0, unapprovedLeaves = 0, attendancePct = 0;

    try {
      const r = await connection.execute(`
        SELECT
            SUM(CASE WHEN NVL(LATE_HRS,0) > 0 OR NVL(LATE_MNT,0) > 0 THEN 1 ELSE 0 END),
            SUM(CASE WHEN IN_TIME IS NOT NULL AND NVL(LATE_HRS,0) = 0 AND NVL(LATE_MNT,0) = 0 THEN 1 ELSE 0 END),
            NVL(SUM(NVL(OT_HRS,0) + NVL(OT_MNT,0)/60.0), 0),
            NVL(AVG(CASE WHEN IN_TIME IS NOT NULL AND OUT_TIME IS NOT NULL
                THEN NVL(W_HRS,0) + NVL(W_MNT,0)/60.0 END), 0)
        FROM DUTY_ROSTER
        WHERE TRUNC(ROSTER_DATE) = ${td}${cf}`, cardParams, { outFormat: OUT_ARRAY });
      const row = r.rows?.[0];
      if (row) {
        lateLogins = parseInt(row[0] || 0, 10);
        earlyLogins = parseInt(row[1] || 0, 10);
        overtimeHours = Math.round(parseFloat(row[2] || 0) * 10) / 10;
        avgWorkHrs = Math.round(parseFloat(row[3] || 0) * 10) / 10;
      }
    } catch (e) { logger.info(`[HR_ANALYTICS] KPI query failed: ${e.message}`); }

    try {
      const r = await connection.execute(`
        SELECT COUNT(*) FROM LEAVE_APPLICATION
        WHERE STATUS IS NULL OR UPPER(STATUS) IN ('PENDING', 'P', '0')`, {}, { outFormat: OUT_ARRAY });
      unapprovedLeaves = parseInt(r.rows?.[0]?.[0] || 0, 10);
    } catch { /* ignore */ }

    try {
      const rt = await connection.execute(
        `SELECT COUNT(*) FROM HR_EMP_MASTER WHERE (STATUS = 'A' OR STATUS IS NULL)${empFilter}`,
        empParams, { outFormat: OUT_ARRAY }
      );
      const totalActive = parseInt(rt.rows?.[0]?.[0] || 0, 10);
      const rp = await connection.execute(`
        SELECT COUNT(DISTINCT card_no) FROM (
            SELECT TO_CHAR(CARD_NO) AS card_no FROM DUTY_ROSTER
            WHERE TRUNC(ROSTER_DATE) = ${td} AND IN_TIME IS NOT NULL${cf}
            UNION
            SELECT TO_CHAR(CARD_NO) AS card_no FROM ATTENDANCE_RECORDS
            WHERE TRUNC(ATTENDANCE_DATE) = ${td} AND ENTRY_TIME IS NOT NULL${cf}
        )`, cardParams, { outFormat: OUT_ARRAY });
      const present = parseInt(rp.rows?.[0]?.[0] || 0, 10);
      attendancePct = Math.round((totalActive > 0 ? (present / totalActive) * 100 : 0) * 10) / 10;
    } catch (e) { logger.info(`[HR_ANALYTICS] attendance_pct query failed: ${e.message}`); }

    // Daily attendance status — last 30 days
    const daily = [];
    try {
      const r = await connection.execute(`
        SELECT
            TO_CHAR(d, 'DD Mon') AS day_label,
            COUNT(DISTINCT CASE WHEN status_flag = 1 THEN card_no END) AS on_time,
            COUNT(DISTINCT CASE WHEN status_flag = 2 THEN card_no END) AS late,
            COUNT(DISTINCT CASE WHEN status_flag = 3 THEN card_no END) AS absent
        FROM (
            SELECT TRUNC(ROSTER_DATE) AS d, TO_CHAR(CARD_NO) AS card_no,
                CASE
                    WHEN IN_TIME IS NOT NULL AND NVL(LATE_HRS,0)=0 AND NVL(LATE_MNT,0)=0 THEN 1
                    WHEN IN_TIME IS NOT NULL AND (NVL(LATE_HRS,0)>0 OR NVL(LATE_MNT,0)>0) THEN 2
                    WHEN IN_TIME IS NULL AND UPPER(NVL(STATUS,'')) NOT LIKE '%LEAVE%' THEN 3
                    ELSE NULL
                END AS status_flag
            FROM DUTY_ROSTER
            WHERE TRUNC(ROSTER_DATE) BETWEEN ${td} - 29 AND ${td}${cf}
            UNION ALL
            SELECT TRUNC(ar.ATTENDANCE_DATE) AS d, TO_CHAR(ar.CARD_NO) AS card_no, 1 AS status_flag
            FROM ATTENDANCE_RECORDS ar
            WHERE TRUNC(ar.ATTENDANCE_DATE) BETWEEN ${td} - 29 AND ${td}
              AND ar.ENTRY_TIME IS NOT NULL${cf}
              AND NOT EXISTS (
                SELECT 1 FROM DUTY_ROSTER dr
                WHERE TO_CHAR(dr.CARD_NO) = TO_CHAR(ar.CARD_NO)
                  AND TRUNC(dr.ROSTER_DATE) = TRUNC(ar.ATTENDANCE_DATE)
              )
        )
        WHERE status_flag IS NOT NULL
        GROUP BY TO_CHAR(d, 'DD Mon'), d
        ORDER BY d`, cardParams, { outFormat: OUT_ARRAY });
      for (const row of r.rows ?? []) {
        daily.push({ day: row[0], on_time: parseInt(row[1] || 0, 10), late: parseInt(row[2] || 0, 10), absent: parseInt(row[3] || 0, 10) });
      }
    } catch (e) { logger.info(`[HR_ANALYTICS] Daily query failed: ${e.message}`); }

    // Monthly attendance statistics — last 6 months
    const monthly = [];
    try {
      const r = await connection.execute(`
        SELECT
            TO_CHAR(TRUNC(d, 'MM'), 'Mon YY') AS month_label,
            SUM(on_time_cnt) AS on_time,
            SUM(overtime_cnt) AS overtime,
            SUM(on_leave_cnt) AS on_leave,
            SUM(late_cnt) AS late_clockin,
            SUM(absent_cnt) AS absent,
            SUM(total_cnt) AS total_rows,
            TRUNC(d, 'MM') AS month_key
        FROM (
            SELECT TRUNC(ROSTER_DATE) AS d,
                CASE WHEN IN_TIME IS NOT NULL AND NVL(LATE_HRS,0)=0 AND NVL(LATE_MNT,0)=0 THEN 1 ELSE 0 END AS on_time_cnt,
                CASE WHEN NVL(OT_HRS,0)>0 OR NVL(OT_MNT,0)>0 THEN 1 ELSE 0 END AS overtime_cnt,
                CASE WHEN UPPER(NVL(STATUS,'')) LIKE '%LEAVE%' THEN 1 ELSE 0 END AS on_leave_cnt,
                CASE WHEN IN_TIME IS NOT NULL AND (NVL(LATE_HRS,0)>0 OR NVL(LATE_MNT,0)>0) THEN 1 ELSE 0 END AS late_cnt,
                CASE WHEN IN_TIME IS NULL AND UPPER(NVL(STATUS,'')) NOT LIKE '%LEAVE%' THEN 1 ELSE 0 END AS absent_cnt,
                1 AS total_cnt
            FROM DUTY_ROSTER
            WHERE TRUNC(ROSTER_DATE) BETWEEN ADD_MONTHS(TRUNC(${td}, 'MM'), -5) AND ${td}${cf}
            UNION ALL
            SELECT TRUNC(ar.ATTENDANCE_DATE) AS d, 1, 0, 0, 0, 0, 1
            FROM ATTENDANCE_RECORDS ar
            WHERE TRUNC(ar.ATTENDANCE_DATE) BETWEEN ADD_MONTHS(TRUNC(${td}, 'MM'), -5) AND ${td}
              AND ar.ENTRY_TIME IS NOT NULL${cf}
              AND NOT EXISTS (
                SELECT 1 FROM DUTY_ROSTER dr
                WHERE TO_CHAR(dr.CARD_NO) = TO_CHAR(ar.CARD_NO)
                  AND TRUNC(dr.ROSTER_DATE) = TRUNC(ar.ATTENDANCE_DATE)
              )
        )
        GROUP BY TO_CHAR(TRUNC(d, 'MM'), 'Mon YY'), TRUNC(d, 'MM')
        ORDER BY TRUNC(d, 'MM')`, cardParams, { outFormat: OUT_ARRAY });
      for (const row of r.rows ?? []) {
        const total = parseInt(row[6] || 1, 10);
        const presentCnt = parseInt(row[1] || 0, 10) + parseInt(row[4] || 0, 10) + parseInt(row[3] || 0, 10);
        const absentCnt = parseInt(row[5] || 0, 10);
        monthly.push({
          month: row[0],
          available: parseInt(row[1] || 0, 10),
          overtime: parseInt(row[2] || 0, 10),
          on_leave: parseInt(row[3] || 0, 10),
          late_clockin: parseInt(row[4] || 0, 10),
          absent: absentCnt,
          attendance_pct: Math.round((total > 0 ? (presentCnt / total) * 100 : 0) * 10) / 10,
          absenteeism_rate: Math.round((total > 0 ? (absentCnt / total) * 100 : 2) * 10) / 10,
        });
      }
    } catch (e) { logger.info(`[HR_ANALYTICS] Monthly query failed: ${e.message}`); }

    return {
      kpis: {
        late_logins: lateLogins,
        early_logins: earlyLogins,
        overtime_hours: overtimeHours,
        unapproved_leaves: unapprovedLeaves,
        avg_work_hrs: avgWorkHrs,
        attendance_pct: attendancePct,
      },
      daily_attendance: daily,
      monthly_attendance: monthly,
    };
  } finally {
    await connection?.close();
  }
};

// ==================================================================
// BULK ATTENDANCE SUMMARY — per-employee aggregated stats for HR
// Mirrors get_bulk_attendance_summary in the FastAPI LMS-Backend
// (repositories/hrms_repository.py): aggregates the ERP duty-roster view
// (TMS_DUTY_ROSTER_V) per employee. LEFT JOIN keeps every active employee even
// with no roster rows. Present = any punch on the day; Absent = flagged absent
// with no punch; Late / Half-Day are counted straight from the ERP flags.
// ==================================================================

export const getBulkAttendanceSummary = async (fromDate, toDate, allowedCompanies = null, allowedBranches = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const params = { from_d: fromDate, to_d: toDate };
    const { sql: filterSql } = empDirectFilter(allowedCompanies, allowedBranches, params);

    try {
      const r = await connection.execute(`
        SELECT
            h.EMPCODE,
            h.NAME,
            h."ATDTCARD#"                                     AS atdtcard,
            TO_CHAR(e.CARD_NO)                                AS card_no,
            NVL(dep.DEPT_NAME, TO_CHAR(h.DEPT_NO))           AS dept_name,
            h.UNIT_ID,
            h.LOCATION,
            h.STATUS                                          AS emp_status,
            COUNT(v.ROSTER_DATE)                              AS total_days,
            SUM(CASE WHEN (v.IN_TIME  IS NOT NULL AND TRIM(v.IN_TIME)  <> ':')
                       OR (v.OUT_TIME IS NOT NULL AND TRIM(v.OUT_TIME) <> ':')
                     THEN 1 ELSE 0 END)                        AS present_days,
            SUM(CASE WHEN NVL(v.ABSENT, 0) = 1
                      AND (v.IN_TIME  IS NULL OR TRIM(v.IN_TIME)  = ':')
                      AND (v.OUT_TIME IS NULL OR TRIM(v.OUT_TIME) = ':')
                     THEN 1 ELSE 0 END)                        AS absent_days,
            SUM(CASE WHEN UPPER(NVL(v.MORNING_LATE, ' ')) = 'Y'
                       OR UPPER(NVL(v.EARLY_OUT_LATE, ' ')) = 'Y'
                     THEN 1 ELSE 0 END)                        AS late_days,
            SUM(CASE WHEN NVL(v.MORNING_HALF_DAY, 0) > 0
                       OR NVL(v.EAR_OUT_HALF_DAY, 0) > 0
                     THEN 1 ELSE 0 END)                        AS half_days,
            0                                                  AS working_minutes
        FROM HR_EMP_MASTER h
        LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
        LEFT JOIN TMS_DUTY_ROSTER_V v
            ON  TO_CHAR(v.CARD_NO) = TO_CHAR(e.CARD_NO)
            AND TRUNC(v.ROSTER_DATE) BETWEEN
                TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
        LEFT JOIN HR_DEPT dep
            ON TO_CHAR(dep.DEPT_NO) = TO_CHAR(h.DEPT_NO) AND TO_CHAR(dep.COMPC) = TO_CHAR(h.UNIT_ID)
        WHERE h.STATUS = 'A'${filterSql}
        GROUP BY
            h.EMPCODE, h.NAME, h."ATDTCARD#", TO_CHAR(e.CARD_NO),
            dep.DEPT_NAME, h.DEPT_NO, h.UNIT_ID, h.LOCATION, h.STATUS
        ORDER BY h.NAME
        FETCH FIRST 2000 ROWS ONLY`, params, { outFormat: OUT_OBJECT });
      const result = (r.rows ?? []).map(lowerKeys);
      for (const rec of result) {
        if (rec.card_no === null || rec.card_no === undefined) rec.card_no = rec.atdtcard;
      }
      return result;
    } catch (err) {
      const msg = String(err.message);
      logger.info(`[BULK_ATT] TMS_DUTY_ROSTER_V attempt failed: ${msg}`);
      if (!msg.includes("ORA-00942") && !msg.includes("ORA-01427") && !msg.includes("ORA-00904")) throw err;
    }

    // Fallback: employee list only, zero attendance counts
    const r = await connection.execute(`
      SELECT
          h.EMPCODE,
          h.NAME,
          h."ATDTCARD#"                                 AS atdtcard,
          h."ATDTCARD#"                                 AS card_no,
          NVL(dep.DEPT_NAME, TO_CHAR(h.DEPT_NO))       AS dept_name,
          h.UNIT_ID,
          h.LOCATION,
          h.STATUS                                      AS emp_status,
          0 AS total_days,
          0 AS present_days,
          0 AS absent_days,
          0 AS late_days,
          0 AS half_days,
          0 AS working_minutes
      FROM HR_EMP_MASTER h
      LEFT JOIN HR_DEPT dep
          ON TO_CHAR(dep.DEPT_NO) = TO_CHAR(h.DEPT_NO) AND TO_CHAR(dep.COMPC) = TO_CHAR(h.UNIT_ID)
      WHERE h.STATUS = 'A'${filterSql}
      ORDER BY h.NAME
      FETCH FIRST 2000 ROWS ONLY`, params, { outFormat: OUT_OBJECT });
    return (r.rows ?? []).map(lowerKeys);
  } finally {
    await connection?.close();
  }
};

// ==================================================================
// BULK ATTENDANCE DETAILS — raw per-day rows (Details tab / CSV)
// ==================================================================

export const getBulkAttendanceDetails = async (fromDate, toDate, allowedCompanies = null, allowedBranches = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const params = { from_d: fromDate, to_d: toDate };
    const { sql: filterSql } = empDirectFilter(allowedCompanies, allowedBranches, params);

    // Source: TMS_DUTY_ROSTER_V — the ERP duty-roster view, one row per
    // employee per rostered day carrying the late / half-day / absent flags
    // the app cannot derive itself. Mirrors FastAPI's get_bulk_attendance_details
    // (repositories/hrms_repository.py) so both backends return identical rows.
    const r = await connection.execute(`
      SELECT
          NVL(h."ATDTCARD#", TO_CHAR(v.CARD_NO))  AS atdtcard,
          TO_CHAR(v.CARD_NO)                       AS card_no,
          h.NAME                                   AS name,
          TRIM(h.LOCATION)                         AS branch_code,
          -- COM_LOCATION.LCODE is globally unique, so no COMPC scoping needed
          -- here (unlike HR_DEPT below, whose codes repeat per company).
          (SELECT MIN(l.DESCR) FROM COM_LOCATION l
             WHERE TRIM(l.LCODE) = TRIM(h.LOCATION))         AS branch_name,
          (SELECT MIN(d.DEPT_NAME) FROM HR_DEPT d
             WHERE LTRIM(d.DEPT_NO,'0') = LTRIM(h.DEPT_NO,'0')
               AND TO_CHAR(d.COMPC) = TO_CHAR(h.UNIT_ID))    AS dept_name,
          v.ROSTER_DATE                            AS roster_date,
          v.DAY_NAME                               AS day_name,
          v.SHIFT_START_TIME                       AS duty_in,
          v.IN_TIME                                AS in_time,
          v.OUT_TIME                               AS out_time,
          v.ABSENT                                 AS absent,
          v.MORNING_LATE                           AS morning_late,
          v.EARLY_OUT_LATE                         AS early_out_late,
          v.MORNING_HALF_DAY                       AS morning_half_day,
          v.EAR_OUT_HALF_DAY                       AS ear_out_half_day
      FROM TMS_DUTY_ROSTER_V v
      JOIN EMPLOYEE e      ON TO_CHAR(e.CARD_NO) = TO_CHAR(v.CARD_NO)
      JOIN HR_EMP_MASTER h ON h.EMPCODE = e.EMPCODE
      WHERE h.STATUS = 'A'
        AND TRUNC(v.ROSTER_DATE) BETWEEN
            TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
        ${filterSql}
      ORDER BY branch_name NULLS LAST, h.NAME, v.ROSTER_DATE
      FETCH FIRST 30000 ROWS ONLY`,
      params, { outFormat: OUT_OBJECT });

    return (r.rows ?? []).map((raw) => {
      const rec = lowerKeys(raw);
      const inTime = cleanHHMM(rec.in_time);
      const outTime = cleanHHMM(rec.out_time);
      const half = (rec.morning_half_day || 0) + (rec.ear_out_half_day || 0);
      const status = rosterStatus(inTime, outTime, rec.absent, rec.morning_late, rec.early_out_late, half);
      rec.roster_date = fmtYmd(rec.roster_date) || null;
      rec.in_time = inTime;
      rec.out_time = outTime;
      rec.duty_in = cleanHHMM(rec.duty_in);
      rec.duty_out = null;
      rec.status = status;
      rec.is_late = status === "Late";
      rec.is_absent = status === "Absent";
      rec.is_half_day = status === "Half Day";
      delete rec.absent;
      delete rec.morning_late;
      delete rec.early_out_late;
      delete rec.morning_half_day;
      delete rec.ear_out_half_day;
      return rec;
    });
  } finally {
    await connection?.close();
  }
};

// ==================================================================
// MONTHLY DUTY ROSTER — read-only view of the ERP-owned DUTY_ROSTER
// ==================================================================

export const getEmployeeRoster = async (cardNo, month = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const card = String(cardNo);
    const cint = card.includes(".") ? card.split(".")[0] : card;

    // Available months (newest first)
    const mRes = await connection.execute(`
      SELECT ROSTER_MONTH
      FROM DUTY_ROSTER
      WHERE TO_CHAR(CARD_NO) = :c OR TO_CHAR(CARD_NO) = :ci
      GROUP BY ROSTER_MONTH
      ORDER BY MAX(ROSTER_DATE) DESC`, { c: card, ci: cint }, { outFormat: OUT_ARRAY });
    const months = (mRes.rows ?? []).map((r) => (r[0] || "").trim()).filter(Boolean);

    const selected = month && months.includes(month) ? month : (months[0] ?? null);

    const rows = [];
    if (selected) {
      const dRes = await connection.execute(`
        SELECT
            DUTY_ROSTER_PK                     AS pk,
            TO_CHAR(ROSTER_DATE, 'DD-MON-YY')  AS roster_date,
            ROSTER_SHIFT                       AS shift,
            DAY_NAME                           AS day_name,
            IN_TIME                            AS time_in,
            OUT_TIME                           AS time_out,
            LATE_FLAG                          AS fh_late,
            HALF_DAY_LATE                      AS fh_half_day,
            LATE_FLAG_OUT                      AS sh_late,
            HALF_DAY_EARLY_GOING               AS sh_half_day,
            ABS_EARLY_OUT                      AS early_out,
            ROSTER_REMARKS                     AS remarks,
            UPDATED                            AS updated_by
        FROM DUTY_ROSTER
        WHERE (TO_CHAR(CARD_NO) = :c OR TO_CHAR(CARD_NO) = :ci)
          AND ROSTER_MONTH = :m
        ORDER BY ROSTER_DATE`, { c: card, ci: cint, m: selected }, { outFormat: OUT_OBJECT });
      for (const raw of dRes.rows ?? []) {
        const rec = lowerKeys(raw);
        for (const k of Object.keys(rec)) {
          if (typeof rec[k] === "string") rec[k] = rec[k].trim();
        }
        rows.push(rec);
      }
    }

    return { months, month: selected, rows };
  } finally {
    await connection?.close();
  }
};

/**
 * Edit one DUTY_ROSTER row by PK: shift code and/or remarks, stamping who
 * updated it (UPDATED). Updates ONLY by primary key — never inserts.
 */
export const updateRosterEntry = async (pk, shift = null, remarks = null, updated_by = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const sets = [];
    const binds = { pk: Number(pk) };
    
    if (shift !== null) {
      const s = String(shift || "").trim().toUpperCase().substring(0, 1);
      sets.push("ROSTER_SHIFT = :shift");
      binds.shift = s || null;
    }
    
    if (remarks !== null) {
      const r = String(remarks || "").trim().substring(0, 200);
      sets.push("ROSTER_REMARKS = :remarks");
      binds.remarks = r || null;
    }
    
    // Always stamp the auditor
    sets.push("UPDATED = :updated");
    binds.updated = String(updated_by || "").substring(0, 50) || null;
    
    const sql = `UPDATE DUTY_ROSTER SET ${sets.join(", ")} WHERE DUTY_ROSTER_PK = :pk`;
    const res = await connection.execute(sql, binds, { autoCommit: false });
    
    if (res.rowsAffected === 0) {
      await connection.rollback();
      return { status: "error", message: "Roster row not found" };
    }
    
    await connection.commit();
    return { status: "success", updated_by: binds.updated };
  } catch (e) {
    if (connection) await connection.rollback();
    return { status: "error", message: e.message };
  } finally {
    await connection?.close();
  }
};
