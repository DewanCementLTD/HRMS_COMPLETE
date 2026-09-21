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
  leaveCardFilter,
  empDirectFilter,
} from "../utils/hrmsFilters.js";
import { cleanHHMM, deriveRosterDay } from "../utils/rosterStatus.js";
import { requestDutyRosterBuild } from "./dutyRosterGen.service.js";

import { logger } from '../utils/logger.js';
import {
  EMPLOYEE_STATUS,
  LEFT_CODES,
  normalizeStatus,
  parseStatusInput,
} from "../utils/employeeStatus.js";
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

  // Employment status leaves this API as one of the two values the system has:
  // 'A' or 'L'. The legacy 'D' and 'I' codes are still written by the ERP's own
  // forms, and handing one to the employee screen used to break saving outright
  // — the dropdown has no option for 'D', so the browser displayed the first
  // option ("Active") while the form still held 'D', and saving wrote whatever
  // the form held. Normalising here fixes every consumer at once, the payroll
  // screens included, instead of each one having to know about retired codes.
  // Only touched when the row actually carries a status.
  if ("status" in rec) rec.status = normalizeStatus(rec.status);
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

/**
 * Does HR_EMP_MASTER carry INIT_PASWD yet?
 *
 * EMPLOYEE is an updatable VIEW over HR_EMP_MASTER, so an employee changing
 * their own password writes the very column the HRMS form shows as "Initial
 * Password". INIT_PASWD (added by sql/2026-08-28_initial_password.sql) keeps the
 * initial value apart from the live one. Until that script is run everything
 * falls back to USER_PASWD and behaves exactly as before.
 */
let initPaswdColumn = null;
const hasInitPaswd = async (connection) => {
  if (initPaswdColumn !== null) return initPaswdColumn;
  try {
    const r = await connection.execute(
      `SELECT COUNT(*) FROM USER_TAB_COLS
        WHERE TABLE_NAME = 'HR_EMP_MASTER' AND COLUMN_NAME = 'INIT_PASWD'`,
      {},
      { outFormat: OUT_ARRAY },
    );
    initPaswdColumn = Number(r.rows?.[0]?.[0] ?? 0) > 0;
  } catch {
    initPaswdColumn = false;
  }
  return initPaswdColumn;
};

/**
 * Refuse a new employee whose mobile or NIC already belongs to someone else.
 *
 * Only enforced on create: the existing data already carries 77 shared mobiles
 * and 15 shared NICs (many of them card numbers parked in MOBILE#), so applying
 * this to updates would lock HR out of editing those records entirely.
 *
 * Both are compared on digits alone — a NIC is stored with and without dashes,
 * and a mobile with and without its leading zero or +92.
 */
const findDuplicateIdentity = async (connection, data) => {
  const digits = (v) => String(v ?? '').replace(/\D/g, '');
  const mobile = digits(data.mobile);
  const nic = digits(data.nicno);
  const mobileKey = mobile.length > 10 ? mobile.slice(-10) : mobile;

  if (mobileKey.length >= 10) {
    const r = await connection.execute(
      `SELECT EMPCODE, NAME FROM HR_EMP_MASTER
        WHERE SUBSTR(REGEXP_REPLACE(NVL(TO_CHAR("MOBILE#"), 'x'), '[^0-9]', ''), -10) = :k
        FETCH FIRST 1 ROWS ONLY`,
      { k: mobileKey },
      { outFormat: OUT_OBJECT },
    );
    const row = r.rows?.[0];
    if (row) {
      return `Mobile number ${data.mobile} is already used by ${String(row.NAME ?? '').trim()} (${row.EMPCODE}).`;
    }
  }

  if (nic.length >= 13) {
    const r = await connection.execute(
      `SELECT EMPCODE, NAME FROM HR_EMP_MASTER
        WHERE REGEXP_REPLACE(NVL(NICNO, 'x'), '[^0-9]', '') = :k
        FETCH FIRST 1 ROWS ONLY`,
      { k: nic },
      { outFormat: OUT_OBJECT },
    );
    const row = r.rows?.[0];
    if (row) {
      return `NIC ${data.nicno} is already used by ${String(row.NAME ?? '').trim()} (${row.EMPCODE}).`;
    }
  }
  return null;
};

export const createEmployee = async (data) => {
  let connection;
  try {
    // Validated before anything is written, so an unrecognised code is an
    // error rather than being quietly defaulted to Active.
    if (data.status !== null && data.status !== undefined && String(data.status).trim() !== "") {
      if (parseStatusInput(data.status) === undefined) {
        return {
          status: "error",
          message: `Employment status must be Active or Left (got "${data.status}")`,
        };
      }
    }

    const empcode = await getNextEmpcode();
    connection = await getDirectConnection();

    const duplicate = await findDuplicateIdentity(connection, data);
    if (duplicate) return { status: "error", message: duplicate };

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
        status: parseStatusInput(data.status) ?? EMPLOYEE_STATUS.ACTIVE,
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

    // Record the password HR issued as the INITIAL one, so a later reset has
    // something to restore even after the employee changes theirs.
    if (strOrNone(data.user_paswd) && (await hasInitPaswd(connection))) {
      await connection.execute(
        `UPDATE HR_EMP_MASTER SET INIT_PASWD = :pw WHERE EMPCODE = :empcode`,
        { pw: String(data.user_paswd).trim(), empcode },
        { autoCommit: true },
      );
    }

    await saveQualificationDetail(connection, empcode, data);
    const empcodeResult = await connection.execute(
      `SELECT EMPCODE FROM HR_EMP_MASTER WHERE NAME = :name`,
      { name: data.name }
    );
    const epcode = empcodeResult.rows?.[0]?.[0] ?? empcode;

    // A new employee has no DUTY_ROSTER rows, so attendance and every report
    // over TMS_DUTY_ROSTER_V would show nothing for them. CREATE_DUTY_ROSTER_PRO
    // fills in the missing days; it only ever adds days that do not exist yet,
    // so nobody's existing roster is touched. Deliberately not awaited — the
    // procedure takes minutes and the employee is already committed.
    requestDutyRosterBuild(`employee ${epcode} created`);

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
          m.BLDGRP, m.LOCATION,
          TO_CHAR(m.TRANSFER_DATE, 'YYYY-MM-DD') AS TRANSFER_DATE,
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
          BLDGRP, LOCATION,
          TO_CHAR(TRANSFER_DATE, 'YYYY-MM-DD') AS TRANSFER_DATE,
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
    const emp = renameCardCols(lowerKeys(raw));
    for (const [k, v] of Object.entries(emp)) {
      if (typeof v === "string") emp[k] = v.trim();
    }

    // The form's "Initial Password" must show what HR set, never what the
    // employee later changed their login to. USER_PASWD is the live password
    // (EMPLOYEE is a view over it), so swap in INIT_PASWD where available.
    if (await hasInitPaswd(connection)) {
      try {
        const ip = await connection.execute(
          `SELECT INIT_PASWD FROM HR_EMP_MASTER WHERE EMPCODE = :empcode`,
          { empcode },
          { outFormat: OUT_ARRAY },
        );
        const init = ip.rows?.[0]?.[0];
        emp.user_paswd = init === null || init === undefined ? "" : String(init).trim();
      } catch (err) {
        logger.info(`[HRMS] INIT_PASWD read skipped: ${String(err.message).slice(0, 90)}`);
      }
    }
    return emp;
  } finally {
    await connection?.close();
  }
};

// ==================================================================
// COMPANY BRANDING (ID-card footer + QR, per UNIT_ID)
// ==================================================================

// Used when HR_COMPANY_BRANDING has no row for the company (or the table hasn't
// been created yet) — i.e. the vendor branding the cards carried before this
// became configurable.
const DEFAULT_BRANDING = {
  brand_name: "Sysnovix",
  tagline: "ERP & IT Solutions",
  website: "sysnovix.com",
  qr_url: "https://sysnovix.com",
  phone: "+92 370 3677800",
  email: "info@sysnovix.com",
  show_on_card: "Y",
};

const BRANDING_TTL_MS = 5 * 60 * 1000;
const brandingCache = new Map();   // unit_id -> { at, value }

/**
 * ID-card branding for one company (HR_EMP_MASTER.UNIT_ID).
 *
 * Printing a batch of cards asks for this once per employee, so results are
 * cached briefly per company. Any lookup problem (missing table, missing row)
 * falls back to DEFAULT_BRANDING rather than failing the card.
 */
export const getCompanyBranding = async (unitId) => {
  const key = String(unitId ?? "").trim();
  const hit = brandingCache.get(key);
  if (hit && Date.now() - hit.at < BRANDING_TTL_MS) return hit.value;

  let branding = { ...DEFAULT_BRANDING };
  const uid = Number.parseInt(key, 10);
  if (Number.isFinite(uid)) {
    let connection;
    try {
      connection = await getDirectConnection();
      const result = await connection.execute(
        `SELECT BRAND_NAME, TAGLINE, WEBSITE, QR_URL, PHONE, EMAIL,
                NVL(SHOW_ON_CARD, 'Y') AS SHOW_ON_CARD
           FROM HR_COMPANY_BRANDING WHERE UNIT_ID = :u`,
        { u: uid },
        { outFormat: OUT_OBJECT }
      );
      const row = result.rows?.[0];
      if (row) {
        branding = lowerKeys(row);
        for (const [k, v] of Object.entries(branding)) {
          if (typeof v === "string") branding[k] = v.trim();
        }
        // The QR encodes QR_URL, falling back to the website so a row only needs
        // the one column filled in.
        if (!branding.qr_url) {
          const site = branding.website || "";
          branding.qr_url = site ? (site.startsWith("http") ? site : `https://${site}`) : null;
        }
      }
    } catch (err) {
      logger.warn(`[HRMS] company branding lookup fell back to default: ${String(err.message).slice(0, 90)}`);
    } finally {
      await connection?.close();
    }
  }

  brandingCache.set(key, { at: Date.now(), value: branding });
  return branding;
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
      // Footer/QR details are per company, so the card carries them.
      r.branding = await getCompanyBranding(r.compc);
      return r;
    } catch (err) {
      if (String(err.message).includes("ORA-00904") || String(err.message).includes("ORA-00942")) {
        const base = await getEmployeeByEmpcode(empcode);
        if (base) {
          base.card_no = base.empcode;
          base.branding = await getCompanyBranding(base.unit_id);
        }
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
  hr_admin: "HR_ADMIN",
  rpt_officer: "RPT_OFFICER", marstat: "MARSTAT",
  grade_cd: "GRADE_CD", religion: "RELIGION",
  hod1: "HOD1", hod2: "HOD2", hod3: "HOD3",
  basic: "BASIC", gross: "GROSS", shift: "SHIFT",
  w_hour: "W_HOUR", bldgrp: "BLDGRP", location: "LOCATION",
  track_location: "TRACK_LOCATION", track_location_hr: "TRACK_LOCATION_HR",
  emp_status: "EMP_STATUS", ntn: "NTN", bnkcode: "BNKCODE",
  brncode: "BRNCODE", bnkacct: "BNKACCT", qfication: "QFICATION",
};
// TRANSFER_DATE is a DATE column like the rest, so it is written through
// TO_DATE and read back as a 'YYYY-MM-DD' string for the date input.
const UPDATE_DATE_FIELDS = {
  dtofbrth: "DTOFBRTH", dtofappt: "DTOFAPPT", dtofconfirm: "DTOFCONFIRM",
  transfer_date: "TRANSFER_DATE",
  // Resignation dates are editable because the ERP treats them as the real
  // signal of a departure: RESIGN_CASE, which HR_SALARY_PROCES_PRO calls on
  // every salary run, sets STATUS on anyone who has DTOFRESIGN filled in. Until
  // these were writable, a date left here by mistake could not be removed
  // through the app at all, and the employee was flipped back to "left" at the
  // next payroll run no matter how often HR set them Active.
  dtofresign: "DTOFRESIGN", resg_dt: "RESG_DT",
};
const NUMERIC_STR_FIELDS = new Set(["dept_no", "desg_cd", "location", "hod1", "hod2", "hod3"]);

/** Date fields where an explicit blank means "remove this", not "leave it". */
const CLEARABLE_DATE_FIELDS = new Set(["dtofresign", "resg_dt", "transfer_date"]);

/**
 * Mirror HOD1/HOD2 onto the EMPLOYEE row.
 *
 * The HRMS form edits HR_EMP_MASTER, but leave applications read the applicant's
 * approvers from EMPLOYEE.HOD1/HOD2 (stamped into HOD1_MNO/HOD2_MNO at apply
 * time). The two tables hold the same mobile numbers today; without this they
 * would drift the moment HR changes a HOD, and the new approver would never see
 * the leave. Non-fatal: a failure here must not fail the employee update.
 */
const syncEmployeeHods = async (connection, empcode, data) => {
  const cols = [];
  const binds = { empcode };
  for (const key of ["hod1", "hod2", "hod3"]) {
    if (!(key in data)) continue;
    const val = data[key] === null || data[key] === undefined || String(data[key]).trim() === ""
      ? null
      : numOrNone(data[key]);
    cols.push(`${key.toUpperCase()} = :${key}`);
    binds[key] = val;
  }
  if (!cols.length) return;
  try {
    await connection.execute(
      `UPDATE EMPLOYEE SET ${cols.join(", ")} WHERE EMPCODE = :empcode`,
      binds,
      { autoCommit: true },
    );
  } catch (err) {
    logger.info(`[HRMS] EMPLOYEE HOD sync skipped (non-fatal): ${String(err.message).slice(0, 90)}`);
  }
};

export const updateEmployee = async (empcode, data) => {
  const setParts = [];
  const params = { empcode };

  // Employment status is the one field with only two legal values. Fold the
  // retired 'I'/'D' codes and refuse anything else outright — a bad status is
  // what decides whether a person can log in and mark attendance, so it must
  // never be written on a guess.
  if ("status" in data && data.status !== null && data.status !== undefined) {
    const parsed = parseStatusInput(data.status);
    if (parsed === undefined) {
      return {
        status: "error",
        message: `Employment status must be Active or Left (got "${data.status}")`,
      };
    }
    if (parsed !== null) data = { ...data, status: parsed };

    // Active and "has a resignation date" contradict each other, and the ERP
    // settles that argument on its own terms: RESIGN_CASE — called by
    // HR_SALARY_PROCES_PRO on every salary run — sets STATUS on anyone who is
    // Active with DTOFRESIGN filled in. So marking somebody Active while a
    // resignation date sits on their record produced a save that looked
    // successful, held until the next payroll run, and then silently reverted.
    //
    // Making them Active IS the statement that they did not leave, so the dates
    // go with it, unless this same request is explicitly setting one.
    if (data.status === EMPLOYEE_STATUS.ACTIVE) {
      if (!("dtofresign" in data)) data = { ...data, dtofresign: null };
      if (!("resg_dt" in data)) data = { ...data, resg_dt: null };
    }
  }

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

  // A null HOD is an instruction to clear it — the loop above skips nulls, which
  // is right for every other field but would make removing an approver a no-op.
  for (const key of ["hod1", "hod2", "hod3"]) {
    if (key in data && data[key] === null) {
      setParts.push(`${key.toUpperCase()} = NULL`);
    }
  }

  // "Initial Password" edits INIT_PASWD, not the live USER_PASWD: changing it
  // records what a reset should restore, without silently signing the employee
  // out of the password they are currently using. Before the INIT_PASWD
  // migration there is only one column, so it keeps the old behaviour.
  const wantsInitPassword = data.user_paswd !== undefined && data.user_paswd !== null
    && String(data.user_paswd).trim() !== "";

  for (const [key, col] of Object.entries(UPDATE_DATE_FIELDS)) {
    if (!(key in data)) continue;
    const dateVal = data[key] === null || data[key] === undefined ? null : strOrNone(data[key]);
    if (dateVal === null) {
      // An explicit null or blank on a resignation date means "this person did
      // not resign" — clearing it is the only way to undo a date entered by
      // mistake, and leaving it would have the salary run keep marking them as
      // departed. Every other date keeps the old behaviour of ignoring blanks,
      // so a form that posts an empty birth date cannot wipe one.
      if (CLEARABLE_DATE_FIELDS.has(key) && key in data) {
        setParts.push(`${col} = NULL`);
      }
      continue;
    }
    setParts.push(`${col} = TO_DATE(:${key}, 'YYYY-MM-DD')`);
    params[key] = dateVal;
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

    if (wantsInitPassword) {
      const col = (await hasInitPaswd(connection)) ? "INIT_PASWD" : "USER_PASWD";
      setParts.push(`${col} = :user_paswd`);
      params.user_paswd = String(data.user_paswd).trim();
    }

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
    await syncEmployeeHods(connection, empcode, data);
    await saveQualificationDetail(connection, empcode, data);
    return { status: "success", message: "Employee updated successfully" };
  } catch (err) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: err.message };
  } finally {
    await connection?.close();
  }
};

/**
 * Reset an employee's login password back to the initial one HR set.
 *
 * Two different columns are in play, and keeping them apart is the point:
 *   HR_EMP_MASTER.USER_PASWD — the INITIAL password HR sets on the employee
 *                              form. Nothing else writes it, so it survives
 *                              whatever the employee later chooses.
 *   EMPLOYEE.USER_PASWD      — the LIVE login password. /auth/change-password
 *                              writes only this one.
 *
 * A reset copies the initial value over the live one, so it takes effect no
 * matter what the employee had changed it to. Passing `password` overrides the
 * stored initial and updates both columns, which is how HR issues a fresh one.
 */
export const resetEmployeePassword = async (empcode, password) => {
  let connection;
  try {
    connection = await getDirectConnection();

    const useInit = await hasInitPaswd(connection);
    const initCol = useInit ? "NVL(h.INIT_PASWD, h.USER_PASWD)" : "h.USER_PASWD";
    const r = await connection.execute(
      `SELECT ${initCol}, h.NAME, TO_CHAR(e.CARD_NO)
         FROM HR_EMP_MASTER h
         LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
        WHERE h.EMPCODE = :empcode
        FETCH FIRST 1 ROWS ONLY`,
      { empcode },
      { outFormat: OUT_ARRAY },
    );
    const row = r.rows?.[0];
    if (!row) return { status: "error", message: "Employee not found" };

    const [storedInitial, name, cardNo] = row;
    const newPassword = String(password ?? "").trim() || String(storedInitial ?? "").trim();
    if (!newPassword) {
      return {
        status: "error",
        message: "This employee has no initial password on file — type one to set it.",
      };
    }

    // When HR supplies a new password it becomes the initial one too, so a later
    // reset returns to the same value.
    if (useInit && String(password ?? "").trim()) {
      await connection.execute(
        `UPDATE HR_EMP_MASTER SET INIT_PASWD = :pw WHERE EMPCODE = :empcode`,
        { pw: newPassword, empcode },
      );
    }

    // The live password. EMPLOYEE is a view over this table, so writing
    // USER_PASWD here is what actually changes the employee's login.
    const upd = await connection.execute(
      `UPDATE HR_EMP_MASTER SET USER_PASWD = :pw WHERE EMPCODE = :empcode`,
      { pw: newPassword, empcode },
    );
    await connection.commit();

    if ((upd.rowsAffected ?? 0) === 0) {
      return { status: "error", message: "Employee not found" };
    }

    return {
      status: "success",
      message: `Password reset for ${String(name ?? "").trim() || empcode}${cardNo ? ` (${cardNo})` : ""}.`,
    };
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
    // Two statuses only. "Left" also covers the retired 'I' and 'D' codes, so
    // nobody vanishes from the listing if a row has not been migrated yet.
    if (status === "L" || status === "I") {
      const ph = LEFT_CODES.map((_, i) => `:st${i}`).join(", ");
      LEFT_CODES.forEach((code, i) => { params[`st${i}`] = code; });
      sql = EMP_LIST_SELECT + ` WHERE h.STATUS IN (${ph})${filterSql} ORDER BY h.NAME` + CAP;
    } else if (status === "A") {
      // A missing status has always been read as active by the dashboards.
      sql = EMP_LIST_SELECT + ` WHERE (h.STATUS = 'A' OR h.STATUS IS NULL)${filterSql} ORDER BY h.NAME` + CAP;
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

    // Upcoming leave requests (next 30 days) — union of the legacy
    // LEAVE_APPLICATION (bulk-imported) and LEAVE_APPLICATION_APPLY (online
    // self-service submissions) tables, restricted to the selected company/branch.
    const upcomingLeaves = [];
    try {
      const upParams = {};
      const upFilter = leaveCardFilter(compc, brnch, upParams, "la.EMP_FK", "ul");
      const r = await connection.execute(`
        SELECT h.NAME,
            la.LEAVE_DATE_FROM, la.LEAVE_DATE_TO,
            la.LEAVE_TYPE_FK,
            NVL(la.APPROVAL_STATUS, 'PENDING') AS status,
            la.LEAVE_DAYS,
            NVL(dep.DEPT_NAME, 'N/A') AS dept
        FROM (
            SELECT LEAVE_DATE_FROM, LEAVE_DATE_TO, LEAVE_TYPE_FK, APPROVAL_STATUS, LEAVE_DAYS, EMP_FK
            FROM LEAVE_APPLICATION
            UNION ALL
            SELECT LEAVE_DATE_FROM, LEAVE_DATE_TO, LEAVE_TYPE_FK, APPROVAL_STATUS, LEAVE_DAYS, EMP_FK
            FROM LEAVE_APPLICATION_APPLY
        ) la
        LEFT JOIN EMPLOYEE e ON TO_CHAR(e.CARD_NO) = TO_CHAR(la.EMP_FK)
        LEFT JOIN HR_EMP_MASTER h ON h.EMPCODE = e.EMPCODE
        LEFT JOIN HR_DEPT dep ON TO_CHAR(dep.DEPT_NO) = TO_CHAR(h.DEPT_NO) AND TO_CHAR(dep.COMPC) = TO_CHAR(h.UNIT_ID)
        WHERE la.LEAVE_DATE_FROM >= TRUNC(SYSDATE)
          AND la.LEAVE_DATE_FROM <= TRUNC(SYSDATE) + 30${upFilter}
        ORDER BY la.LEAVE_DATE_FROM
        FETCH FIRST 10 ROWS ONLY`, upParams, { outFormat: OUT_ARRAY });
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

    // Top absence/leave reasons this year — same union + company/branch scoping
    const topReasons = [];
    try {
      const trParams = {};
      const trFilter = leaveCardFilter(compc, brnch, trParams, "la.EMP_FK", "tr");
      const r = await connection.execute(`
        SELECT NVL(lt.LEAVE_DESC, 'Type ' || TO_CHAR(la.LEAVE_TYPE_FK)) AS reason,
            COUNT(*) AS cnt
        FROM (
            SELECT LEAVE_DATE_FROM, LEAVE_TYPE_FK, EMP_FK FROM LEAVE_APPLICATION
            UNION ALL
            SELECT LEAVE_DATE_FROM, LEAVE_TYPE_FK, EMP_FK FROM LEAVE_APPLICATION_APPLY
        ) la
        LEFT JOIN LEAVE_TYPES lt ON lt.LEAVE_TYPE_PK = la.LEAVE_TYPE_FK
        WHERE la.LEAVE_DATE_FROM >= TRUNC(SYSDATE, 'YYYY')${trFilter}
        GROUP BY NVL(lt.LEAVE_DESC, 'Type ' || TO_CHAR(la.LEAVE_TYPE_FK))
        ORDER BY cnt DESC
        FETCH FIRST 5 ROWS ONLY`, trParams, { outFormat: OUT_ARRAY });
      for (const row of r.rows ?? []) topReasons.push({ reason: row[0] || "Other", count: parseInt(row[1] || 0, 10) });
    } catch (e) { logger.info(`[HR_DASHBOARD] Top reasons failed: ${e.message}`); }

    // Inactive count for turnover computation — scoped like totalEmployees so
    // the ratio isn't skewed by mixing a company-filtered numerator with an
    // org-wide denominator.
    let inactiveCount = 0;
    try {
      const r = await executeWithEmpFilter(
        connection,
        "SELECT COUNT(*) FROM HR_EMP_MASTER h WHERE h.STATUS IN ('I', 'D'){filter}",
        compc, brnch, { options: { outFormat: OUT_ARRAY } }
      );
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
      // NOTE: this table has no STATUS column — the approval column is
      // APPROVAL_STATUS. Querying STATUS threw ORA-00904 on every call and was
      // silently swallowed, so this KPI was permanently stuck at 0.
      const unapprParams = {};
      const unapprFilter = leaveCardFilter(compc, brnch, unapprParams, "la.EMP_FK", "ua");
      const r = await connection.execute(`
        SELECT COUNT(*) FROM (
            SELECT EMP_FK, APPROVAL_STATUS FROM LEAVE_APPLICATION
            UNION ALL
            SELECT EMP_FK, APPROVAL_STATUS FROM LEAVE_APPLICATION_APPLY
        ) la
        WHERE (la.APPROVAL_STATUS IS NULL OR UPPER(la.APPROVAL_STATUS) IN ('PENDING', 'WAITING', 'P', '0'))${unapprFilter}`,
        unapprParams, { outFormat: OUT_ARRAY });
      unapprovedLeaves = parseInt(r.rows?.[0]?.[0] || 0, 10);
    } catch (e) { logger.info(`[HR_ANALYTICS] Unapproved leaves query failed: ${e.message}`); }

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

/**
 * Punches the employee made in the app that the ERP duty roster never took.
 *
 * These days read as ABSENT everywhere in HRMS while the punch sits in
 * ATTENDANCE_RECORDS, which is why the gap went unnoticed for a month: no
 * screen compared the two. `erp_filed_as_out` is the tell for the known cause —
 * a check-in after the branch's SHIFT_HEAD.CHANGE_ST hour was filed as a
 * check-out — and the cut-off is returned alongside so HR can see the rule that
 * caught them.
 */
export const getUnpostedPunches = async (fromDate, toDate, allowedCompanies = null, allowedBranches = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const params = { from_d: fromDate, to_d: toDate };
    const { sql: filterSql } = empDirectFilter(allowedCompanies, allowedBranches, params);

    const r = await connection.execute(`
      SELECT h.NAME                                   AS name,
             ar.EMPCODE                               AS empcode,
             NVL(h."ATDTCARD#", TO_CHAR(ar.CARD_NO))  AS atdtcard,
             (SELECT MIN(l.DESCR) FROM COM_LOCATION l
               WHERE TRIM(l.LCODE) = TRIM(h.LOCATION))            AS branch_name,
             (SELECT MIN(d.DEPT_NAME) FROM HR_DEPT d
               WHERE LTRIM(d.DEPT_NO,'0') = LTRIM(h.DEPT_NO,'0')
                 AND TO_CHAR(d.COMPC) = TO_CHAR(h.UNIT_ID))       AS dept_name,
             ar.ATTENDANCE_DATE                       AS punch_date,
             ar.ENTRY_TIME                            AS app_check_in,
             ar.EXIT_TIME                             AS app_check_out,
             dr.OUT_TIME                              AS erp_filed_as_out,
             (SELECT MIN(TRIM(sh.CHANGE_ST)) FROM SHIFT_HEAD sh
               WHERE sh.COMPC = TO_NUMBER(h.UNIT_ID)
                 AND sh.BRNCH = TO_NUMBER(REGEXP_SUBSTR(h.LOCATION, '^[0-9]+'))
                 AND TRIM(sh.SHIFT) = TRIM(dr.ROSTER_SHIFT))      AS branch_cutoff
        FROM ATTENDANCE_RECORDS ar
        JOIN HR_EMP_MASTER h ON h.EMPCODE = ar.EMPCODE
        JOIN DUTY_ROSTER   dr ON TO_CHAR(dr.CARD_NO) = TO_CHAR(ar.CARD_NO)
                             AND TRUNC(dr.ROSTER_DATE) = TRUNC(ar.ATTENDANCE_DATE)
       WHERE ar.ENTRY_TIME IS NOT NULL
         AND dr.IN_TIME IS NULL
         AND h.STATUS = 'A'
         AND TRUNC(ar.ATTENDANCE_DATE) BETWEEN
             TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
         ${filterSql}
       ORDER BY ar.ATTENDANCE_DATE DESC, branch_name NULLS LAST, h.NAME
       FETCH FIRST 5000 ROWS ONLY`,
      params, { outFormat: OUT_OBJECT });

    return (r.rows ?? []).map((raw) => {
      const rec = lowerKeys(raw);
      rec.punch_date = fmtYmd(rec.punch_date) || null;
      // The punch is in HRMS, just not on the roster — say which, so nobody
      // reads this list as "the employee did not mark attendance".
      rec.reason = rec.erp_filed_as_out
        ? `App check-in at ${rec.app_check_in} was filed by the ERP as a check-out` +
          `${rec.branch_cutoff ? ` (branch cut-off ${rec.branch_cutoff})` : ''}`
        : 'App check-in never reached the duty roster';
      return rec;
    });
  } finally {
    await connection?.close();
  }
};

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
          v.ROSTER_SHIFT                           AS roster_shift,
          v.HOLIDAY_FK                             AS holiday_fk,
          v.MORNING_LATE                           AS morning_late,
          v.EARLY_OUT_LATE                         AS early_out_late,
          v.MORNING_HALF_DAY                       AS morning_half_day,
          v.EAR_OUT_HALF_DAY                       AS ear_out_half_day,
          v.ROSTER_REMARKS                         AS roster_remarks,
          v.LEAVE_REMARKS                          AS leave_remarks,
          v.LEAVE_TYPE_FK                          AS leave_type_fk,
          (SELECT MIN(t.LEAVE_TYPE) FROM LEAVE_TYPES t
             WHERE t.LEAVE_TYPE_PK = v.LEAVE_TYPE_FK)        AS leave_type,
          (SELECT MIN(t.LEAVE_DESC) FROM LEAVE_TYPES t
             WHERE t.LEAVE_TYPE_PK = v.LEAVE_TYPE_FK)        AS leave_desc
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
      // One shared derivation for every attendance surface — see
      // utils/rosterStatus.js for the precedence and why rest/holiday/leave
      // sit above the "no IN_TIME means absent" rule.
      const d = deriveRosterDay(rec);

      rec.roster_date = fmtYmd(rec.roster_date) || null;
      rec.in_time = d.in_time;
      rec.out_time = d.out_time;
      rec.duty_in = cleanHHMM(rec.duty_in);
      rec.duty_out = null;

      rec.status = d.status;
      rec.status_flags = d.flags;
      rec.is_late = d.is_late;
      rec.is_absent = d.is_absent;
      rec.is_half_day = d.is_half_day;
      rec.is_morning_late = d.is_morning_late;
      rec.is_morning_half_day = d.is_morning_half_day;
      rec.is_leave = d.is_leave;
      rec.is_holiday = d.is_holiday;
      rec.is_rest = d.is_rest;
      rec.leave_type = d.leave_type;
      rec.leave_desc = d.leave_desc;
      rec.roster_remarks = d.roster_remarks;
      rec.leave_remarks = d.leave_remarks;
      rec.remarks = d.remarks;

      delete rec.absent;
      delete rec.holiday_fk;
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
      // Read the ERP view (the same source the attendance screens use) so the
      // roster shows its ABSENT flag and leave stamp, and join the table for
      // DUTY_ROSTER_PK — the view has no PK and editing is by PK.
      const dRes = await connection.execute(`
        SELECT
            d.DUTY_ROSTER_PK                     AS pk,
            TO_CHAR(d.ROSTER_DATE, 'DD-MON-YY')  AS roster_date,
            d.ROSTER_SHIFT                       AS shift,
            d.DAY_NAME                           AS day_name,
            v.IN_TIME                            AS time_in,
            v.OUT_TIME                           AS time_out,
            d.LATE_FLAG                          AS fh_late,
            d.HALF_DAY_LATE                      AS fh_half_day,
            d.LATE_FLAG_OUT                      AS sh_late,
            d.HALF_DAY_EARLY_GOING               AS sh_half_day,
            d.ABS_EARLY_OUT                      AS early_out,
            v.ROSTER_REMARKS                     AS roster_remarks,
            v.ABSENT                             AS absent,
            v.LEAVE_TYPE_FK                      AS leave_type_fk,
            v.LEAVE_APPLICATION_FK               AS leave_application_fk,
            v.LEAVE_REMARKS                      AS leave_remarks,
            v.LEAVE_DAYS                         AS leave_days,
            (SELECT MIN(t.LEAVE_TYPE) FROM LEAVE_TYPES t
              WHERE t.LEAVE_TYPE_PK = v.LEAVE_TYPE_FK) AS leave_type,
            (SELECT MIN(t.LEAVE_DESC) FROM LEAVE_TYPES t
              WHERE t.LEAVE_TYPE_PK = v.LEAVE_TYPE_FK) AS leave_desc,
            d.UPDATED                            AS updated_by
        FROM DUTY_ROSTER d
        LEFT JOIN TMS_DUTY_ROSTER_V v
               ON TO_CHAR(v.CARD_NO) = TO_CHAR(d.CARD_NO)
              AND v.ROSTER_DATE = d.ROSTER_DATE
        WHERE (TO_CHAR(d.CARD_NO) = :c OR TO_CHAR(d.CARD_NO) = :ci)
          AND d.ROSTER_MONTH = :m
        ORDER BY d.ROSTER_DATE`, { c: card, ci: cint, m: selected }, { outFormat: OUT_OBJECT });
      for (const raw of dRes.rows ?? []) {
        const rec = lowerKeys(raw);
        for (const k of Object.keys(rec)) {
          if (typeof rec[k] === "string") rec[k] = rec[k].trim();
        }

        // `remarks` is what the roster prints. An approved leave shows its type
        // and the employee's own reason; an absent day says so even when the
        // view left ROSTER_REMARKS empty; otherwise the roster's own remark.
        const onLeave = rec.leave_type_fk !== null && rec.leave_type_fk !== undefined;
        rec.is_leave = onLeave;
        rec.is_absent = !onLeave && Number(rec.absent ?? 0) === 1;
        rec.remarks = onLeave
          ? [rec.leave_desc || rec.leave_type, rec.leave_remarks, rec.roster_remarks]
              .filter(Boolean).join(" — ")
          : rec.is_absent
            ? (rec.roster_remarks || "Absent")
            : (rec.roster_remarks || null);
        rows.push(rec);
      }
    }

    // The company and branch the roster itself is filed under. The shift list
    // is configured per company AND branch in SHIFT_HEAD, so the picker needs
    // the employee's own scope — the admin's currently selected branch is a
    // different thing and is often not set at all.
    let scope = { compc: null, brnch: null };
    try {
      const sRes = await connection.execute(
        `SELECT TO_CHAR(MAX(COMPC)), TO_CHAR(MAX(BRNCH))
           FROM DUTY_ROSTER
          WHERE TO_CHAR(CARD_NO) = :c OR TO_CHAR(CARD_NO) = :ci`,
        { c: card, ci: cint },
        { outFormat: OUT_ARRAY },
      );
      const row = sRes.rows?.[0];
      if (row) scope = { compc: row[0] ?? null, brnch: row[1] ?? null };
    } catch (e) {
      logger.info(`[ROSTER] scope lookup failed for ${card}: ${e.message ?? e}`);
    }

    return { months, month: selected, rows, ...scope };
  } finally {
    await connection?.close();
  }
};

/**
 * Edit one DUTY_ROSTER row by PK: shift code and/or remarks, stamping who
 * updated it (UPDATED). Updates ONLY by primary key — never inserts.
 */
/**
 * Change the shift on every roster day in a date range for one employee.
 *
 * The roster is edited one day at a time, which is impractical for a change
 * that runs for weeks. Scoped to the employee's own rows and, when given, to a
 * branch, so a bulk change can never reach beyond the roster on screen.
 *
 * Days already marked as approved leave are left alone: their shift is part of
 * the leave record stamped at approval time.
 */
/**
 * The rostered days between two dates, for the dialog that asks HR which of
 * them the new shift should apply to.
 *
 * Only real DUTY_ROSTER rows are listed: a date with no roster row cannot be
 * given a shift, and showing it as a choosable day would promise something the
 * update could not keep. Days already carrying approved leave come back marked
 * rather than hidden, so it is visible why they cannot be selected.
 */
export const getRosterDaysInRange = async (cardNo, fromDate, toDate, brnch = null) => {
  if (!fromDate || !toDate) return { status: "error", message: "Both dates are required" };
  if (String(fromDate) > String(toDate)) {
    return { status: "error", message: "The 'from' date must not be after the 'to' date" };
  }

  let connection;
  try {
    connection = await getDirectConnection();
    const card = String(cardNo);
    const cint = card.includes(".") ? card.split(".")[0] : card;
    const binds = { c: card, ci: cint, from_d: fromDate, to_d: toDate };
    let branchCond = "";
    if (brnch !== null && brnch !== undefined && String(brnch).trim() !== "") {
      branchCond = "AND TO_CHAR(BRNCH) = TO_CHAR(:brnch)";
      binds.brnch = String(brnch).trim();
    }

    const res = await connection.execute(
      `SELECT TO_CHAR(ROSTER_DATE, 'YYYY-MM-DD'),
              TO_CHAR(ROSTER_DATE, 'Dy'),
              ROSTER_SHIFT,
              LEAVE_TYPE_FK,
              HOLIDAY_FK
         FROM DUTY_ROSTER
        WHERE (TO_CHAR(CARD_NO) = :c OR TO_CHAR(CARD_NO) = :ci)
          AND ROSTER_DATE BETWEEN TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
          ${branchCond}
        ORDER BY ROSTER_DATE`,
      binds,
      { outFormat: 4001 },
    );

    const items = (res.rows ?? []).map(([date, day, shift, leaveFk, holidayFk]) => {
      const currentShift = String(shift ?? "").trim().toUpperCase();
      const onLeave = leaveFk !== null && leaveFk !== undefined;
      return {
        date,
        day: String(day ?? "").trim(),
        shift: currentShift,
        on_leave: onLeave,
        is_holiday: holidayFk !== null && holidayFk !== undefined,
        // 'R' is REST in SHIFT_HEAD — a rostered off day.
        is_rest: currentShift === "R",
        /** Approved leave is left alone, matching what the update itself does. */
        selectable: !onLeave,
      };
    });

    return { status: "success", items };
  } catch (e) {
    return { status: "error", message: e.message };
  } finally {
    await connection?.close();
  }
};

/**
 * Apply one shift to an employee's roster.
 *
 * `dates` is the set HR actually ticked in the dialog; when it is empty the
 * whole [from, to] range is used, which is what the endpoint did before the
 * day picker existed.
 */
export const bulkUpdateRosterShift = async (
  cardNo, fromDate, toDate, shift, updatedBy = null, brnch = null, dates = null,
) => {
  const s = String(shift || "").trim().toUpperCase().substring(0, 1);
  if (!s) return { status: "error", message: "Pick a shift to apply" };
  if (!fromDate || !toDate) return { status: "error", message: "Both dates are required" };
  if (String(fromDate) > String(toDate)) {
    return { status: "error", message: "The 'from' date must not be after the 'to' date" };
  }

  const picked = [...new Set((dates ?? []).map((d) => String(d).trim()).filter(Boolean))];
  const outOfRange = picked.filter((d) => d < String(fromDate) || d > String(toDate));
  if (outOfRange.length) {
    return { status: "error", message: `Those days fall outside the range: ${outOfRange.join(", ")}` };
  }

  let connection;
  try {
    connection = await getDirectConnection();
    const card = String(cardNo);
    const cint = card.includes(".") ? card.split(".")[0] : card;
    const binds = {
      shift: s,
      updated: String(updatedBy || "").substring(0, 50) || null,
      c: card,
      ci: cint,
      from_d: fromDate,
      to_d: toDate,
    };
    let branchCond = "";
    if (brnch !== null && brnch !== undefined && String(brnch).trim() !== "") {
      branchCond = "AND TO_CHAR(BRNCH) = TO_CHAR(:brnch)";
      binds.brnch = String(brnch).trim();
    }

    // Bound each picked day by name rather than building an IN list out of the
    // values themselves, so the dates stay data and never become SQL.
    let dayCond = "";
    if (picked.length) {
      const names = picked.map((d, i) => {
        binds[`d${i}`] = d;
        return `:d${i}`;
      });
      dayCond = `AND TO_CHAR(ROSTER_DATE, 'YYYY-MM-DD') IN (${names.join(", ")})`;
    }

    const res = await connection.execute(
      `UPDATE DUTY_ROSTER
          SET ROSTER_SHIFT = :shift, UPDATED = :updated
        WHERE (TO_CHAR(CARD_NO) = :c OR TO_CHAR(CARD_NO) = :ci)
          AND ROSTER_DATE BETWEEN TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
          AND LEAVE_TYPE_FK IS NULL
          ${dayCond}
          ${branchCond}`,
      binds,
      { autoCommit: true },
    );

    const updated = res.rowsAffected ?? 0;
    if (updated === 0) {
      return {
        status: "error",
        message: picked.length
          ? "None of the selected days could be changed — they may all be on approved leave."
          : "No roster days matched — check the dates, or those days may all be on approved leave.",
      };
    }
    return { status: "success", updated, shift: s };
  } catch (e) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: "error", message: e.message };
  } finally {
    await connection?.close();
  }
};

export const updateRosterEntry = async (pk, shift = null, remarks = null, updated_by = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const sets = [];
    const binds = { pk: Number(pk) };
    
    // A rostered day always has a shift — 'R' is how a day off is expressed, not
    // an empty shift. Blanking the column would leave a row that the attendance
    // status derivation, the leave off-day check and the weekly-off calculation
    // all read as "no roster", so an empty value is left alone rather than
    // written through. Passing null (the default) already means "don't touch".
    if (shift !== null) {
      const s = String(shift || "").trim().toUpperCase().substring(0, 1);
      if (s) {
        sets.push("ROSTER_SHIFT = :shift");
        binds.shift = s;
      }
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
