import { getDirectConnection } from '../config/database.js';

import { logger } from '../utils/logger.js';
const OBJ = { outFormat: 4002 };

// ---------------------------------------------------------------------------
// Password helpers
// ---------------------------------------------------------------------------

// Decode SEC_USERNAME.PASWD without calling datacrypt.decryptdata.
// Passwords are stored as RAWTOHEX(plaintext) + RAWTOHEX(chr(0)) + binary_suffix.
// Hex-decode the leading valid-hex chars up to the first null byte.
// Mirrors `_decode_sec_paswd` in the FastAPI LMS-Backend (repositories/user_repository.py).
const decodeSecPaswd = (rawPaswd) => {
  if (!rawPaswd) return null;
  const s = String(rawPaswd);
  let hexPart = '';
  for (const c of s) {
    if (/^[0-9a-fA-F]$/.test(c)) hexPart += c;
    else break;
  }
  if (!hexPart || hexPart.length % 2 !== 0) return null;
  try {
    const buf = Buffer.from(hexPart, 'hex');
    const nullIdx = buf.indexOf(0);
    return (nullIdx >= 0 ? buf.subarray(0, nullIdx) : buf).toString('latin1');
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Employee flags overlay — mirrors `get_employee_flags` in the FastAPI
// LMS-Backend (core/dependencies.py). face_registered is intentionally always
// "N" here (matches FastAPI's hardcoded value on every fallback path).
// ---------------------------------------------------------------------------

const getEmployeeFlags = async (card_no) => {
  const DEFAULT_FLAGS = { emp_name: '', face_registered: 'N', hr_admin: 'N', empcode: '' };
  let connection;
  try {
    connection = await getDirectConnection();

    // Attempt 1: EMPLOYEE + HR_EMP_MASTER via EMP_NO join
    try {
      const r = await connection.execute(
        `SELECT e.EMP_NAME AS "emp_name", NVL(h.HR_ADMIN, 'N') AS "hr_admin", h.EMPCODE AS "empcode"
         FROM EMPLOYEE e
         LEFT JOIN HR_EMP_MASTER h ON h.EMPCODE = e.EMPCODE
         WHERE TO_CHAR(e.CARD_NO) = :card`,
        { card: card_no },
        OBJ
      );
      const row = r.rows?.[0];
      if (row) {
        return {
          emp_name: row.emp_name || '',
          face_registered: 'N',
          hr_admin: row.hr_admin || 'N',
          empcode: row.empcode || '',
        };
      }
    } catch (e1) {
      const msg = String(e1.message ?? e1);
      logger.info(`[get_employee_flags] Attempt 1 failed: ${msg}`);
      if (!msg.includes('ORA-00904') && !msg.includes('ORA-00942')) throw e1;
    }

    // Attempt 3: HR_EMP_MASTER only (via ATDTCARD# or EMPCODE)
    try {
      const r = await connection.execute(
        `SELECT NAME AS "name", EMPCODE AS "empcode" FROM HR_EMP_MASTER WHERE "ATDTCARD#" = :card OR EMPCODE = :card`,
        { card: card_no },
        OBJ
      );
      const row = r.rows?.[0];
      if (row) {
        return { emp_name: row.name || '', face_registered: 'N', hr_admin: 'N', empcode: row.empcode || '' };
      }
    } catch (e3) {
      logger.info(`[get_employee_flags] Attempt 3 (HR_EMP_MASTER direct) failed: ${e3.message ?? e3}`);
    }

    // Attempt 4: EMPLOYEE only
    try {
      const r = await connection.execute(
        `SELECT EMP_NAME AS "emp_name" FROM EMPLOYEE WHERE TO_CHAR(CARD_NO) = :card`,
        { card: card_no },
        OBJ
      );
      const row = r.rows?.[0];
      if (!row) return { ...DEFAULT_FLAGS };
      return { emp_name: row.emp_name || '', face_registered: 'N', hr_admin: 'N', empcode: '' };
    } catch (e4) {
      logger.info(`[get_employee_flags] Attempt 4 (EMPLOYEE only) failed: ${e4.message ?? e4}`);
      return { ...DEFAULT_FLAGS };
    }
  } finally {
    await connection?.close();
  }
};

// ---------------------------------------------------------------------------
// Two-step DB authentication — mirrors `authenticate_user` in the FastAPI
// LMS-Backend (repositories/user_repository.py):
//   1. SEC_USERNAME (ERP HR admins, datacrypt-encrypted password, mobile
//      variants with/without leading zero, or ECODE)
//   2. HR_EMP_MASTER (plain-text password, mobile variants / ATDTCARD# / EMPCODE)
//   3. bare EMPLOYEE fallback
// ---------------------------------------------------------------------------

const authenticateStep = async (username, password) => {
  let connection;
  try {
    connection = await getDirectConnection();

    const m = String(username).trim();
    const mWith0 = m.startsWith('0') ? m : `0${m}`;
    const mNo0 = m.startsWith('0') ? m.substring(1) : m;

    // STEP 1: SEC_USERNAME (ERP HR admin)
    let secRow = null;
    try {
      const r1 = await connection.execute(
        `SELECT USRID AS "usrid", DESCR AS "descr", PASWD AS "paswd", MOBILE AS "mobile", ECODE AS "ecode", ULEVL AS "ulevl"
         FROM SEC_USERNAME
         WHERE TO_CHAR(MOBILE) IN (:m1, :m2, :m3) AND STATS = 'E'`,
        { m1: m, m2: mWith0, m3: mNo0 },
        OBJ
      );
      secRow = r1.rows?.[0] ?? null;
      if (!secRow) {
        const r2 = await connection.execute(
          `SELECT USRID AS "usrid", DESCR AS "descr", PASWD AS "paswd", MOBILE AS "mobile", ECODE AS "ecode", ULEVL AS "ulevl"
           FROM SEC_USERNAME WHERE ECODE = :ec AND STATS = 'E'`,
          { ec: m },
          OBJ
        );
        secRow = r2.rows?.[0] ?? null;
      }
    } catch (e) {
      logger.info(`[AUTH] SEC_USERNAME query failed: ${e.message ?? e}`);
    }

    let secAuthenticated = false;
    if (secRow) {
      let storedPaswd = null;
      try {
        const dec = await connection.execute(
          `SELECT datacrypt.decryptdata(:p) AS "dec" FROM DUAL`,
          { p: secRow.paswd },
          OBJ
        );
        const decVal = dec.rows?.[0]?.dec;
        storedPaswd = decVal ? String(decVal).trim() : null;
      } catch (e) {
        logger.info(`[AUTH] datacrypt.decryptdata failed for USRID=${secRow.usrid}: ${e.message ?? e}`);
        storedPaswd = decodeSecPaswd(String(secRow.paswd ?? ''));
      }

      if ((storedPaswd ?? '').trim() === (password ?? '').trim()) {
        secAuthenticated = true;
      } else {
        logger.info(`[AUTH] SEC_USERNAME found but password mismatch for ${username}, trying HR_EMP_MASTER`);
      }
    }

    if (secAuthenticated) {
      const usridNumeric = secRow.usrid;
      const empName = String(secRow.descr ?? '').trim();
      let empcode = String(secRow.ecode ?? '').trim();
      let card_no = null;
      let hasEmployeeFeatures = false;

      if (empcode) {
        const r = await connection.execute(
          `SELECT TO_CHAR(e.CARD_NO) AS "card_no", h.NAME AS "name", h.EMPCODE AS "empcode"
           FROM HR_EMP_MASTER h
           LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
           WHERE h.EMPCODE = :ec`,
          { ec: empcode },
          OBJ
        );
        const row = r.rows?.[0];
        if (row) {
          card_no = row.card_no ? String(row.card_no) : null;
          hasEmployeeFeatures = true;
        }
      }

      if (!hasEmployeeFeatures && secRow.mobile) {
        const mv = String(secRow.mobile).trim();
        const mvW = mv.startsWith('0') ? mv : `0${mv}`;
        const mvNo0 = mv.startsWith('0') ? mv.substring(1) : mv;
        const r = await connection.execute(
          `SELECT TO_CHAR(e.CARD_NO) AS "card_no", h.NAME AS "name", h.EMPCODE AS "empcode"
           FROM HR_EMP_MASTER h
           LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
           WHERE h."MOBILE#" IN (:mv1, :mv2, :mv3)`,
          { mv1: mv, mv2: mvW, mv3: mvNo0 },
          OBJ
        );
        const row = r.rows?.[0];
        if (row) {
          card_no = row.card_no ? String(row.card_no) : null;
          hasEmployeeFeatures = true;
          if (!empcode) empcode = String(row.empcode ?? '').trim();
        }
      }

      let companies = [];
      let companyList = [];
      let branches = [];
      let branchList = [];

      try {
        const r = await connection.execute(
          `SELECT sc.COMPC AS "compc", NVL(ci.DESCR, TO_CHAR(sc.COMPC)) AS "name"
           FROM SEC_USERCMPN sc
           LEFT JOIN COMPANY_INFO ci ON ci.COMPC = sc.COMPC
           WHERE sc.USRID = :usrid
           ORDER BY sc.COMPC`,
          { usrid: usridNumeric },
          OBJ
        );
        const rows = r.rows ?? [];
        companies = rows.map((row) => String(row.compc));
        companyList = rows.map((row) => ({ code: String(row.compc), name: String(row.name ?? row.compc) }));
      } catch (e) {
        logger.info(`[AUTH] SEC_USERCMPN query failed for USRID=${usridNumeric}: ${e.message ?? e}`);
      }

      try {
        const r = await connection.execute(
          `SELECT sb.BRNCH AS "brnch", NVL(cl.DESCR, TO_CHAR(sb.BRNCH)) AS "name", cl.COMPC AS "compc"
           FROM SEC_USERBRCH sb
           LEFT JOIN COM_LOCATION cl ON TO_CHAR(cl.LCODE) = TO_CHAR(sb.BRNCH)
           WHERE sb.USRID = :usrid
           ORDER BY sb.BRNCH`,
          { usrid: usridNumeric },
          OBJ
        );
        const rows = r.rows ?? [];
        branches = rows.map((row) => String(row.brnch));
        branchList = rows.map((row) => ({
          code: String(row.brnch),
          name: String(row.name ?? row.brnch),
          compc: row.compc !== null && row.compc !== undefined ? String(row.compc).trim() : null,
        }));
      } catch (e) {
        logger.info(`[AUTH] SEC_USERBRCH query failed for USRID=${usridNumeric}: ${e.message ?? e}`);
      }

      return {
        card_no: card_no || username,
        user_paswd: null,
        emp_name: empName,
        hr_admin: 'Y',
        face_registered: 'N',
        empcode,
        allowed_companies: companies,
        allowed_branches: branches,
        company_list: companyList,
        branch_list: branchList,
        can_edit_salary: String(secRow.ulevl ?? '').trim().toUpperCase() === 'M',
        has_self_service: hasEmployeeFeatures,
        has_employee_features: hasEmployeeFeatures,
      };
    }

    // STEP 2: HR_EMP_MASTER (normal employee)
    const l = String(username).trim();
    const lW0 = l.startsWith('0') ? l : `0${l}`;
    const lNo0 = l.startsWith('0') ? l.substring(1) : l;

    try {
      const r = await connection.execute(
        `SELECT TO_CHAR(e.CARD_NO) AS "card_no", e.USER_PASWD AS "user_paswd", h.NAME AS "name",
                h.EMPCODE AS "empcode", h."ATDTCARD#" AS "atdtcard"
         FROM HR_EMP_MASTER h
         LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
         WHERE h."MOBILE#" IN (:l1, :l2, :l3)
            OR h."ATDTCARD#" = :l4 OR h.EMPCODE = :l5`,
        { l1: l, l2: lW0, l3: lNo0, l4: l, l5: l },
        OBJ
      );
      const row = r.rows?.[0];
      if (row) {
        const card_no = row.card_no ? String(row.card_no) : (row.atdtcard ? String(row.atdtcard) : null);
        const storedPaswd = String(row.user_paswd ?? '').trim();
        if (storedPaswd && storedPaswd !== String(password ?? '').trim()) {
          return null;
        }
        return {
          card_no,
          user_paswd: row.user_paswd,
          emp_name: String(row.name ?? '').trim(),
          hr_admin: 'N',
          face_registered: 'N',
          empcode: String(row.empcode ?? '').trim(),
          allowed_companies: [],
          allowed_branches: [],
          company_list: [],
          branch_list: [],
          has_self_service: true,
          has_employee_features: true,
        };
      }
    } catch (e) {
      logger.info(`[AUTH] HR_EMP_MASTER query failed: ${e.message ?? e}`);
    }

    // Fallback: EMPLOYEE table
    try {
      const r = await connection.execute(
        `SELECT TO_CHAR(CARD_NO) AS "card_no", USER_PASWD AS "user_paswd" FROM EMPLOYEE
         WHERE TO_CHAR(CARD_NO) = :e1
            OR TO_CHAR(MOBILE_NO) = :e1
            OR EMP_NO = :e1`,
        { e1: l },
        OBJ
      );
      const row = r.rows?.[0];
      if (row) {
        const storedPaswd = String(row.user_paswd ?? '').trim();
        if (storedPaswd && storedPaswd !== String(password ?? '').trim()) {
          return null;
        }
        return {
          card_no: row.card_no ? String(row.card_no) : l,
          user_paswd: row.user_paswd,
          emp_name: '',
          hr_admin: 'N',
          face_registered: 'N',
          empcode: '',
          allowed_companies: [],
          allowed_branches: [],
          company_list: [],
          branch_list: [],
          has_self_service: true,
          has_employee_features: true,
        };
      }
    } catch (e) {
      logger.info(`[AUTH] EMPLOYEE fallback failed: ${e.message ?? e}`);
    }

    return null;
  } finally {
    await connection?.close();
  }
};

// Mirrors `login_user` in the FastAPI LMS-Backend (services/auth_service.py):
// two-step DB auth, then overlay face_registered/emp_name/empcode via
// get_employee_flags, then shape the response like FastAPI's LoginResponse.
export const authenticateUser = async (username, password) => {
  const user = await authenticateStep(username, password);
  if (!user) return null;
  if (user.card_no) {
    try {
      const flags = await getEmployeeFlags(user.card_no);
      user.face_registered = flags.face_registered ?? 'N';
      if (!user.emp_name) user.emp_name = flags.emp_name || '';
      if (!user.empcode) user.empcode = flags.empcode || '';
    } catch (e) {
      logger.info(`[LOGIN] get_employee_flags failed (non-fatal): ${e.message ?? e}`);
    }
  }

  return {
    status: 'SUCCESS',
    card_no: user.card_no,
    emp_name: user.emp_name || '',
    face_registered: (user.face_registered ?? 'N') === 'Y',
    hr_admin: (user.hr_admin ?? 'N') === 'Y',
    has_self_service: user.has_self_service ?? true,
    has_employee_features: user.has_employee_features ?? true,
    allowed_companies: user.allowed_companies ?? [],
    allowed_branches: user.allowed_branches ?? [],
    company_list: user.company_list ?? [],
    branch_list: user.branch_list ?? [],
    can_edit_salary: user.can_edit_salary ?? false,
  };
};

const getEmergencyContact = async (connection, card_no) => {
  try {
    const card = String(card_no);
    const prefix = card.includes('.') ? card.split('.')[0] : card;
    const r = await connection.execute(
      `SELECT NAME AS "name", RELATIONSHIP AS "relationship", PHONE AS "phone"
       FROM LMS_EMERGENCY_CONTACT
       WHERE CARD_NO = :card OR CARD_NO = :prefix
       ORDER BY UPDATED_AT DESC`,
      { card, prefix },
      { outFormat: 4002 }
    );
    const row = r.rows?.[0];
    if (row && (row.name || row.phone)) {
      return {
        name: row.name || '',
        relationship: row.relationship || '',
        phone: row.phone || '',
      };
    }
  } catch (e) {
    logger.info(`[PROFILE] emergency contact lookup failed for ${card_no}: ${e.message ?? e}`);
  }
  return null;
};

export const getProfile = async (card_no) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const sql = `
      SELECT
        TO_CHAR(e.CARD_NO)                         AS "card_no",
        h.NAME                                     AS "emp_name",
        -- h.USER_PASWD                               AS "password",
        d.DEPT_NAME                                AS "department",
        dg.DESG_DESC                               AS "designation",
        h.EMAIL                                    AS "email_address",
        h."MOBILE#"                                AS "mobile_no",
        TO_CHAR(h.DTOFBRTH, 'YYYY-MM-DD')          AS "date_of_birth",
        TO_CHAR(h.DTOFAPPT, 'YYYY-MM-DD')          AS "date_of_join",
        h.FHNAME                                   AS "father_name",
        h.NICNO                                    AS "nic_no"
      FROM HR_EMP_MASTER h
      LEFT JOIN EMPLOYEE    e  ON e.EMPCODE   = h.EMPCODE
      LEFT JOIN HR_DEPT     d  ON LTRIM(d.DEPT_NO,'0') = LTRIM(h.DEPT_NO,'0')  AND TO_CHAR(d.COMPC) = TO_CHAR(h.UNIT_ID)
      LEFT JOIN HR_DESG     dg ON LTRIM(dg.DESG_CD,'0') = LTRIM(h.DESG_CD,'0')  AND TO_CHAR(dg.COMPC) = TO_CHAR(h.UNIT_ID)
      WHERE TO_CHAR(e.CARD_NO) = :card_no
         OR h."ATDTCARD#"      = :card_no
         OR h.EMPCODE          = :card_no
      FETCH FIRST 1 ROWS ONLY
    `;
    const result = await connection.execute(sql, { card_no }, { outFormat: 4002 });
    const profileData = result.rows?.[0] ?? null;
    if (profileData) {
      const resolvedCard = profileData.card_no || card_no;
      profileData.emergency_contact = await getEmergencyContact(connection, resolvedCard);
      delete profileData.card_no;
    }
    return profileData;
  } finally {
    await connection?.close();
  }
};

// Mirrors `lookup_by_phone` in the FastAPI LMS-Backend (repositories/user_repository.py):
// matches mobile (with/without leading zero) / ATDTCARD# / EMPCODE against
// HR_EMP_MASTER, falling back to a bare EMPLOYEE lookup.
export const lookupByPhone = async (phone) => {
  let connection;
  try {
    connection = await getDirectConnection();

    try {
      const r = await connection.execute(
        `SELECT TO_CHAR(e.CARD_NO) AS "card_no", h.NAME AS "name", h.EMPCODE AS "empcode", h."ATDTCARD#" AS "atdtcard"
         FROM HR_EMP_MASTER h
         LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
         WHERE h."MOBILE#" = :login
            OR h."MOBILE#" = '0' || :login
            OR h."ATDTCARD#" = :login
            OR h.EMPCODE = :login`,
        { login: phone },
        OBJ
      );
      const row = r.rows?.[0];
      if (row) {
        const card_no = row.card_no ? String(row.card_no) : (row.atdtcard ? String(row.atdtcard) : null);
        if (card_no) {
          return { card_no, emp_name: row.name || '', empcode: row.empcode || '' };
        }
      }
    } catch (e) {
      logger.info(`[LOOKUP] HR_EMP_MASTER query failed: ${e.message ?? e}`);
    }

    // Fallback to EMPLOYEE
    const r2 = await connection.execute(
      `SELECT TO_CHAR(CARD_NO) AS "card_no", EMP_NAME AS "emp_name", EMP_NO AS "emp_no"
       FROM EMPLOYEE
       WHERE TO_CHAR(MOBILE_NO) = :login
          OR TO_CHAR(MOBILE_NO) = '0' || :login
          OR TO_CHAR(CARD_NO) = :login
          OR EMP_NO = :login`,
      { login: phone },
      OBJ
    );
    const row2 = r2.rows?.[0];
    if (row2) {
      return {
        card_no: row2.card_no !== null && row2.card_no !== undefined ? String(row2.card_no) : null,
        emp_name: row2.emp_name || '',
        empcode: row2.emp_no || '',
      };
    }

    return null;
  } finally {
    await connection?.close();
  }
};

// Mirrors `get_user_by_login` in the FastAPI LMS-Backend (repositories/user_repository.py).
// Used only to resolve the currently-stored password for the old-password check.
const getUserByLogin = async (login) => {
  let connection;
  try {
    connection = await getDirectConnection();

    try {
      const r = await connection.execute(
        `SELECT TO_CHAR(e.CARD_NO) AS "card_no", e.USER_PASWD AS "user_paswd", h.NAME AS "name",
                NVL(h.HR_ADMIN, 'N') AS "hr_admin", h.EMPCODE AS "empcode", h."ATDTCARD#" AS "atdtcard"
         FROM HR_EMP_MASTER h
         LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
         WHERE h."MOBILE#" = :login
            OR h."MOBILE#" = '0' || :login
            OR h."ATDTCARD#" = :login
            OR h.EMPCODE = :login`,
        { login },
        OBJ
      );
      const row = r.rows?.[0];
      if (row) {
        const card_no = row.card_no ? String(row.card_no) : (row.atdtcard ? String(row.atdtcard) : null);
        return {
          card_no,
          user_paswd: row.user_paswd,
          emp_name: row.name || '',
          hr_admin: String(row.hr_admin || 'N').trim().toUpperCase(),
          empcode: row.empcode || '',
        };
      }
    } catch (e) {
      logger.info(`[LOGIN] HR_EMP_MASTER query failed: ${e.message ?? e}`);
    }

    // Fallback to EMPLOYEE table
    const r2 = await connection.execute(
      `SELECT card_no AS "card_no", USER_PASWD AS "user_paswd"
       FROM EMPLOYEE
       WHERE TO_CHAR(MOBILE_NO) = :login
          OR TO_CHAR(MOBILE_NO) = '0' || :login
          OR TO_CHAR(CARD_NO) = :login
          OR EMP_NO = :login`,
      { login },
      OBJ
    );
    const row2 = r2.rows?.[0];
    if (row2) {
      return {
        card_no: row2.card_no !== null && row2.card_no !== undefined ? String(row2.card_no) : null,
        user_paswd: row2.user_paswd,
      };
    }

    return null;
  } finally {
    await connection?.close();
  }
};

// Mirrors `update_password` in the FastAPI LMS-Backend (repositories/user_repository.py).
// Note: writes EMPLOYEE.CARD_NO with the raw identifier passed in (which may be a
// mobile / ATDTCARD# / EMPCODE, not necessarily the resolved CARD_NO) — this
// mirrors FastAPI's existing behavior exactly, quirk included.
const updatePasswordRow = async (card_no, newPassword) => {
  let connection;
  try {
    connection = await getDirectConnection();
    await connection.execute(
      `UPDATE EMPLOYEE SET USER_PASWD = :hash WHERE card_no = :card`,
      { hash: newPassword, card: card_no },
      { autoCommit: true }
    );
    return { status: 'success', message: 'Password updated' };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    await connection?.close();
  }
};

// Mirrors `change_password` in the FastAPI LMS-Backend (services/auth_service.py):
// resolve the account via get_user_by_login, compare the old password against
// EMPLOYEE.USER_PASWD (plain text), then update EMPLOYEE.USER_PASWD.
export const changePassword = async (card_no, old_password, new_password) => {
  const user = await getUserByLogin(card_no);
  if (!user) return { success: false };

  const stored = String(user.user_paswd ?? '').trim();
  if (stored && String(old_password ?? '').trim() !== stored) {
    return { success: false };
  }

  const result = await updatePasswordRow(card_no, new_password);
  return { success: result.status === 'success' };
};

export const saveEmergencyContact = async (card_no, name, relationship, phone) => {
  let connection;
  try {
    connection = await getDirectConnection();
    await connection.execute(
      `
      MERGE INTO LMS_EMERGENCY_CONTACT t
      USING (SELECT :card AS CARD_NO FROM DUAL) s
      ON (t.CARD_NO = s.CARD_NO)
      WHEN MATCHED THEN UPDATE SET
          t.NAME = :name, t.RELATIONSHIP = :rel, t.PHONE = :phone,
          t.UPDATED_AT = SYSDATE
      WHEN NOT MATCHED THEN INSERT (CARD_NO, NAME, RELATIONSHIP, PHONE, UPDATED_AT)
          VALUES (:card, :name, :rel, :phone, SYSDATE)
      `,
      {
        card: String(card_no).slice(0, 30),
        name: String(name || '').slice(0, 200),
        rel: String(relationship || '').slice(0, 100),
        phone: String(phone || '').slice(0, 50),
      },
      { autoCommit: true }
    );
    return { status: 'success', message: 'Emergency contact saved' };
  } catch (err) {
    logger.error({ err }, `[PROFILE] emergency contact save failed for ${card_no}`);
    return { status: 'error', message: err.message };
  } finally {
    await connection?.close();
  }
};

