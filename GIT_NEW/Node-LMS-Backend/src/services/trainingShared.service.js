/**
 * Helpers shared by the Training Management services (tables: scripts/training_ddl.sql,
 * plan: docs/Training_Management_Plan.md).
 *
 * Identity: an employee is their EMPCODE, which is also EMPLOYEE.EMP_PK and the
 * CARD_NO they sign in with. Company is HR_EMP_MASTER.UNIT_ID (= EMPLOYEE.COMPC).
 */

import { getDirectConnection } from "../config/database.js";
import { logger } from "../utils/logger.js";

export const OUT_ARRAY = 4001;  // oracledb.OUT_FORMAT_ARRAY
export const OUT_OBJECT = 4002; // oracledb.OUT_FORMAT_OBJECT

export const s = (v) => (v === null || v === undefined ? "" : String(v).trim());
export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const numOrNull = (v) => (v === null || v === undefined || v === "" ? null : num(v));
export const r2 = (v) => Math.round(num(v) * 100) / 100;

/** A DATE column → 'YYYY-MM-DD' in server local time (how every other module formats dates). */
export const ymd = (v) => {
  if (!v) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const t = String(v);
  return t.length >= 10 ? t.slice(0, 10) : t;
};

/** A DATE column → 'YYYY-MM-DD HH:MM'. */
export const ymdhm = (v) => {
  if (!(v instanceof Date)) return v ? String(v) : null;
  return `${ymd(v)} ${String(v.getHours()).padStart(2, "0")}:${String(v.getMinutes()).padStart(2, "0")}`;
};

/** Starting year of the July–June fiscal year a date falls in (2026-09-29 → 2026, 2027-03-01 → 2026). */
export const fyOf = (dateLike) => {
  const d = dateLike ? new Date(dateLike) : new Date();
  return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
};
export const fyLabel = (fy) => `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;

// Mobiles are stored inconsistently (leading zero, +92, spaces, NUMBER columns
// that drop the zero) — compare on the last 10 digits, as leave approvals do.
export const mobileKey = (v) => {
  const digits = s(v).replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};
// SQL twin of mobileKey for a column expression.
export const mobileKeySql = (col) => `SUBSTR(REGEXP_REPLACE(NVL(TO_CHAR(${col}), 'x'), '[^0-9]', ''), -10)`;

/** Business-rule failure; controllers turn it into a 4xx {detail}. */
export class TrainingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Next value of one of the HR_TRAINING_*_SEQ sequences. */
export const nextId = async (connection, seq) => {
  const r = await connection.execute(`SELECT ${seq}.NEXTVAL FROM DUAL`, {}, { outFormat: OUT_ARRAY });
  return Number(r.rows[0][0]);
};

/** Audit trail row (PDF §30). Never fails the caller's action. */
export const writeLog = async (connection, { compc, entity, entityId, action, details, actor }) => {
  try {
    await connection.execute(
      `INSERT INTO HR_TRAINING_LOG (LOG_ID, COMPC, ENTITY, ENTITY_ID, ACTION, DETAILS, ACTOR)
       VALUES (HR_TRAINING_LOG_SEQ.NEXTVAL, :compc, :entity, :id, :action, :details, :actor)`,
      {
        compc: compc ?? null,
        entity,
        id: entityId,
        action,
        details: details ? JSON.stringify(details).slice(0, 2000) : null,
        actor: actor ? s(actor).slice(0, 30) : null,
      },
    );
  } catch (e) {
    logger.warn(`[TRAINING] audit log failed for ${entity} ${entityId} ${action}: ${e.message}`);
  }
};

// Department / designation names for an HR_EMP_MASTER row aliased `m`.
export const EMP_DEPT_SQL = `(SELECT MAX(d.DEPT_NAME) FROM HR_DEPT d
                               WHERE TO_CHAR(d.DEPT_NO) = m.DEPT_NO AND d.COMPC = m.UNIT_ID)`;
export const EMP_DESG_SQL = `(SELECT MAX(g.DESG_DESC) FROM HR_DESG g
                               WHERE TO_CHAR(g.DESG_CD) = m.DESG_CD AND g.COMPC = m.UNIT_ID)`;

/**
 * One employee with everything the training flow needs: company, branch,
 * department and the HOD mobiles copied onto a request.
 */
export const loadEmployee = async (connection, empcode) => {
  const r = await connection.execute(
    `SELECT m.EMPCODE, m.NAME, m.UNIT_ID, m.LOCATION, m.DEPT_NO,
            ${EMP_DEPT_SQL}, ${EMP_DESG_SQL},
            TO_CHAR(m."MOBILE#"), m.STATUS,
            (SELECT MAX(TO_CHAR(e.HOD1)) FROM EMPLOYEE e WHERE e.EMPCODE = m.EMPCODE),
            (SELECT MAX(TO_CHAR(e.HOD2)) FROM EMPLOYEE e WHERE e.EMPCODE = m.EMPCODE),
            m.EMAIL
       FROM HR_EMP_MASTER m
      WHERE m.EMPCODE = :e`,
    { e: s(empcode) },
    { outFormat: OUT_ARRAY },
  );
  const x = r.rows?.[0];
  if (!x) return null;
  return {
    empcode: s(x[0]), name: s(x[1]), compc: numOrNull(x[2]), brnch: numOrNull(x[3]),
    dept_no: s(x[4]), dept_name: s(x[5]), desg_desc: s(x[6]), mobile: s(x[7]),
    status: s(x[8]), hod1_mno: s(x[9]), hod2_mno: s(x[10]), email: s(x[11]),
  };
};

/**
 * The EMPCODE behind a signed-in card. Normally identical ('100511.1'), but
 * EMPLOYEE.CARD_NO is a NUMBER, so a card can arrive formatted differently
 * ('100510.10' vs 100510.1) — resolve it rather than trusting the string.
 */
export const resolveEmpcode = async (cardNo) => {
  const card = s(cardNo);
  const connection = await getDirectConnection();
  try {
    const r = await connection.execute(
      `SELECT h.EMPCODE FROM HR_EMP_MASTER h
         LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
        WHERE h.EMPCODE = :c OR TO_CHAR(e.CARD_NO) = :c
        ORDER BY CASE WHEN h.EMPCODE = :c THEN 0 ELSE 1 END
        FETCH FIRST 1 ROWS ONLY`,
      { c: card },
      { outFormat: OUT_ARRAY },
    );
    if (!r.rows?.length) throw new TrainingError("Employee not found", 404);
    return s(r.rows[0][0]);
  } finally {
    await connection.close();
  }
};

/** Display name for an admin card, used when stamping HR decisions. */
export const nameOf = async (connection, empcode) => {
  const r = await connection.execute(
    `SELECT MAX(NAME) FROM HR_EMP_MASTER WHERE EMPCODE = :e`,
    { e: s(empcode) },
    { outFormat: OUT_ARRAY },
  );
  return s(r.rows?.[0]?.[0]) || s(empcode);
};

/**
 * Convert an Oracle constraint violation into a readable TrainingError; rethrow
 * anything else. `messages` maps a constraint/index name fragment to the text.
 */
export const mapOraError = (err, messages = {}) => {
  if (err?.errorNum === 1) {
    for (const [frag, msg] of Object.entries(messages)) {
      if (String(err.message).includes(frag)) throw new TrainingError(msg, 409);
    }
    throw new TrainingError("A record with the same key already exists", 409);
  }
  if (err?.errorNum === 2292) throw new TrainingError("This record is in use and cannot be deleted — deactivate it instead", 409);
  if (err?.errorNum === 942) {
    // 4xx on purpose: the global handler masks 5xx messages, and HR needs to see this one.
    throw new TrainingError("Training tables are not installed yet. Run: node scripts/run_training_ddl.mjs", 400);
  }
  throw err;
};

/**
 * Run `fn(connection)` in one transaction: commit on success, roll back on any
 * throw, map constraint errors, always release the connection.
 */
export const withTx = async (fn, oraMessages) => {
  const connection = await getDirectConnection();
  try {
    const out = await fn(connection);
    await connection.commit();
    return out;
  } catch (err) {
    try { await connection.rollback(); } catch { /* connection already broken */ }
    if (err instanceof TrainingError) throw err;
    return mapOraError(err, oraMessages);
  } finally {
    await connection.close();
  }
};
