import crypto from 'node:crypto';

import { getDirectConnection } from '../config/database.js';
import { logger } from '../utils/logger.js';

const OUT_ARRAY = 4001; // oracledb.OUT_FORMAT_ARRAY
const OUT_OBJECT = 4002;

// ---------------------------------------------------------------------------
// Super-admin panel (/admin)
//
// HR module access is granted by a SEC_USERNAME account plus rows in
// SEC_USERCMPN (companies) and SEC_USERBRCH (branches). Those were only
// editable straight in the database, which is how mismatches crept in — e.g. an
// admin holding company 1 but branches that belong to company 3, leaving their
// screens empty. This service is the managed way to maintain them.
//
// Who may use it is NOT decided by any flag inside the database: the account's
// USRID must appear in the SUPER_ADMIN_USRIDS environment variable. Nobody can
// grant themselves entry through the app, and revoking is a config change.
// ---------------------------------------------------------------------------

const norm = (v) => String(v ?? '').trim();

/** USRIDs allowed into the panel, from the environment. */
export const superAdminIds = () =>
  norm(process.env.SUPER_ADMIN_USRIDS)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

const isSuperAdminId = (usrid) => superAdminIds().includes(norm(usrid).toUpperCase());

// ── Session token ──────────────────────────────────────────────────
// A signed, expiring token rather than a server-side session: the API is
// stateless and restarts often. It carries only the USRID and an expiry, and is
// signed with a server secret so it cannot be forged or extended by the client.

const tokenSecret = () => {
  const s = norm(process.env.SUPER_ADMIN_SECRET);
  if (s) return s;
  // No secret configured: derive an ephemeral one so tokens still work within a
  // single run, but every restart invalidates them. Logged once as a nudge.
  if (!globalThis.__superAdminEphemeralSecret) {
    globalThis.__superAdminEphemeralSecret = crypto.randomBytes(32).toString('hex');
    logger.warn('[ADMIN] SUPER_ADMIN_SECRET is not set — admin sessions will end on restart');
  }
  return globalThis.__superAdminEphemeralSecret;
};

const SESSION_MINUTES = 60;

export const issueToken = (usrid) => {
  const payload = Buffer.from(
    JSON.stringify({ u: norm(usrid).toUpperCase(), exp: Date.now() + SESSION_MINUTES * 60_000 }),
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
};

/** The USRID a token belongs to, or null when it is invalid, expired or forged. */
export const verifyToken = (token) => {
  const [payload, sig] = norm(token).split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
  // Constant-time compare so a wrong signature can't be narrowed down by timing.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!u || !exp || Date.now() > exp) return null;
    // The allowlist is re-checked on every request, so removing someone from
    // SUPER_ADMIN_USRIDS takes effect immediately rather than at token expiry.
    return isSuperAdminId(u) ? u : null;
  } catch {
    return null;
  }
};

// ── Login ──────────────────────────────────────────────────────────

/**
 * Verify a super admin's credentials against their normal SEC_USERNAME account.
 *
 * The password is compared through DATACRYPT.DECRYPTDATA, exactly as the main
 * login does — this panel introduces no second password to keep in step.
 */
export const authenticateSuperAdmin = async (usrid, password) => {
  const id = norm(usrid);
  if (!id || !norm(password)) return { status: 'error', message: 'Username and password are required' };

  // Checked before touching the database so a non-admin learns nothing about
  // whether the account exists.
  if (!isSuperAdminId(id)) return { status: 'error', message: 'Invalid credentials' };

  let connection;
  try {
    connection = await getDirectConnection();
    const r = await connection.execute(
      `SELECT USRID, DESCR, ULEVL, STATS, PASWD FROM SEC_USERNAME
        WHERE UPPER(TRIM(USRID)) = UPPER(:id)
        FETCH FIRST 1 ROWS ONLY`,
      { id },
      { outFormat: OUT_OBJECT },
    );
    const row = r.rows?.[0];
    if (!row) return { status: 'error', message: 'Invalid credentials' };
    if (norm(row.STATS).toUpperCase() !== 'E') {
      return { status: 'error', message: 'This account is disabled' };
    }

    let stored = null;
    try {
      const dec = await connection.execute(
        `SELECT datacrypt.decryptdata(:p) AS "dec" FROM DUAL`,
        { p: row.PASWD },
        { outFormat: OUT_OBJECT },
      );
      stored = norm(dec.rows?.[0]?.dec);
    } catch (e) {
      logger.warn(`[ADMIN] password decrypt failed for ${id}: ${e.message ?? e}`);
      return { status: 'error', message: 'Unable to verify credentials' };
    }
    if (stored !== norm(password)) return { status: 'error', message: 'Invalid credentials' };

    return {
      status: 'success',
      token: issueToken(row.USRID),
      user: { usrid: norm(row.USRID), name: norm(row.DESCR), ulevl: norm(row.ULEVL) },
      expires_in_minutes: SESSION_MINUTES,
    };
  } finally {
    await connection?.close();
  }
};

// ── Reads ──────────────────────────────────────────────────────────

/** Every SEC_USERNAME account with the companies and branches it holds. */
export const listHrUsers = async () => {
  let connection;
  try {
    connection = await getDirectConnection();
    const r = await connection.execute(
      `SELECT u.USRID, u.DESCR, u.ULEVL, u.STATS, TO_CHAR(u.MOBILE) AS MOBILE, u.ECODE,
              (SELECT LISTAGG(sc.COMPC, ',') WITHIN GROUP (ORDER BY sc.COMPC)
                 FROM SEC_USERCMPN sc WHERE sc.USRID = u.USRID) AS COMPANIES,
              (SELECT LISTAGG(sb.BRNCH, ',') WITHIN GROUP (ORDER BY sb.BRNCH)
                 FROM SEC_USERBRCH sb WHERE sb.USRID = u.USRID) AS BRANCHES
         FROM SEC_USERNAME u
        ORDER BY u.USRID`,
      {},
      { outFormat: OUT_OBJECT },
    );
    const split = (v) => norm(v).split(',').map((x) => x.trim()).filter(Boolean);
    return (r.rows ?? []).map((row) => ({
      usrid: norm(row.USRID),
      name: norm(row.DESCR),
      ulevl: norm(row.ULEVL),
      enabled: norm(row.STATS).toUpperCase() === 'E',
      mobile: norm(row.MOBILE),
      ecode: norm(row.ECODE),
      companies: split(row.COMPANIES),
      branches: split(row.BRANCHES),
      is_super_admin: isSuperAdminId(row.USRID),
    }));
  } finally {
    await connection?.close();
  }
};

/** Companies and branches to pick from, with each branch's owning company. */
export const listScopeOptions = async () => {
  let connection;
  try {
    connection = await getDirectConnection();
    const [companies, branches] = await Promise.all([
      connection.execute(
        `SELECT TO_CHAR(COMPC), DESCR FROM COMPANY_INFO ORDER BY TO_NUMBER(COMPC)`,
        {}, { outFormat: OUT_ARRAY },
      ),
      connection.execute(
        `SELECT TO_CHAR(LCODE), DESCR, TO_CHAR(COMPC) FROM COM_LOCATION ORDER BY TO_NUMBER(LCODE)`,
        {}, { outFormat: OUT_ARRAY },
      ),
    ]);
    return {
      companies: (companies.rows ?? []).map(([code, name]) => ({ code: norm(code), name: norm(name) })),
      branches: (branches.rows ?? []).map(([code, name, compc]) => ({
        code: norm(code), name: norm(name), compc: norm(compc),
      })),
    };
  } finally {
    await connection?.close();
  }
};

// ── Writes ─────────────────────────────────────────────────────────

const userExists = async (connection, usrid) => {
  const r = await connection.execute(
    `SELECT COUNT(*) FROM SEC_USERNAME WHERE UPPER(TRIM(USRID)) = UPPER(:id)`,
    { id: norm(usrid) }, { outFormat: OUT_ARRAY },
  );
  return Number(r.rows?.[0]?.[0] ?? 0) > 0;
};

/**
 * Replace a user's company assignments.
 *
 * Delete-then-insert inside one transaction: the panel sends the full set it
 * wants, so reconciling row by row would only add ways for the two to drift.
 */
export const setUserCompanies = async (usrid, companies) => {
  let connection;
  try {
    connection = await getDirectConnection();
    if (!(await userExists(connection, usrid))) return { status: 'error', message: 'No such user' };

    await connection.execute(`DELETE FROM SEC_USERCMPN WHERE USRID = :id`, { id: norm(usrid) });
    for (const compc of [...new Set((companies ?? []).map(norm).filter(Boolean))]) {
      await connection.execute(
        `INSERT INTO SEC_USERCMPN (USRID, COMPC) VALUES (:id, :c)`,
        { id: norm(usrid), c: compc },
      );
    }
    await connection.commit();
    return { status: 'success' };
  } catch (e) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: 'error', message: e.message };
  } finally {
    await connection?.close();
  }
};

/** Replace a user's branch assignments (same reasoning as setUserCompanies). */
export const setUserBranches = async (usrid, branches) => {
  let connection;
  try {
    connection = await getDirectConnection();
    if (!(await userExists(connection, usrid))) return { status: 'error', message: 'No such user' };

    await connection.execute(`DELETE FROM SEC_USERBRCH WHERE USRID = :id`, { id: norm(usrid) });
    for (const brnch of [...new Set((branches ?? []).map(norm).filter(Boolean))]) {
      await connection.execute(
        `INSERT INTO SEC_USERBRCH (USRID, BRNCH) VALUES (:id, :b)`,
        { id: norm(usrid), b: brnch },
      );
    }
    await connection.commit();
    return { status: 'success' };
  } catch (e) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: 'error', message: e.message };
  } finally {
    await connection?.close();
  }
};

/** Enable or disable an account. STATS='E' is what the login accepts. */
export const setUserStatus = async (usrid, enabled) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const res = await connection.execute(
      `UPDATE SEC_USERNAME SET STATS = :s WHERE UPPER(TRIM(USRID)) = UPPER(:id)`,
      { s: enabled ? 'E' : 'D', id: norm(usrid) },
      { autoCommit: true },
    );
    if ((res.rowsAffected ?? 0) === 0) return { status: 'error', message: 'No such user' };
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: e.message };
  } finally {
    await connection?.close();
  }
};

/**
 * Set a user's password.
 *
 * The plaintext goes in as-is on purpose: SEC_USERNAME carries an UPDATE
 * trigger (SEC_USER_UPD) that runs datacrypt.encryptdata over any changed
 * PASWD. Encrypting here as well stored a doubly-encrypted value that the login
 * could never match.
 */
export const setUserPassword = async (usrid, password) => {
  const pw = norm(password);
  if (pw.length < 6) return { status: 'error', message: 'Password must be at least 6 characters' };
  let connection;
  try {
    connection = await getDirectConnection();
    const res = await connection.execute(
      `UPDATE SEC_USERNAME
          SET PASWD = :pw, PDATE = SYSDATE
        WHERE UPPER(TRIM(USRID)) = UPPER(:id)`,
      { pw, id: norm(usrid) },
      { autoCommit: true },
    );
    if ((res.rowsAffected ?? 0) === 0) return { status: 'error', message: 'No such user' };
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: e.message };
  } finally {
    await connection?.close();
  }
};

/**
 * Create a SEC_USERNAME account and its company/branch assignments.
 *
 * A row carries more NOT NULL columns than the panel asks about (COMPC, BRNCH,
 * LOCKL, EXPDT, VER_#). Those are filled to match the accounts already in the
 * table rather than invented, so a new user behaves like the existing ones.
 *
 * The password is encrypted here because SEC_USER_UPD only covers UPDATE —
 * an INSERT gets no trigger — and RAWTOHEX matches how the existing rows read.
 *
 * MOBILE matters more than it looks: requireHrAdmin recognises an HR admin by
 * matching the signed-in employee's mobile (or ECODE) against this table, so an
 * account with neither can sign in but reaches no HR screen.
 */
export const createHrUser = async ({
  usrid, name, password, ulevl = 'U', mobile = null, ecode = null,
  companies = [], branches = [],
}) => {
  const id = norm(usrid).toUpperCase();
  if (!id) return { status: 'error', message: 'A user id is required' };
  if (id.length > 2) return { status: 'error', message: 'User id can be at most 2 characters' };
  if (norm(password).length < 6) return { status: 'error', message: 'Password must be at least 6 characters' };

  const compList = [...new Set((companies ?? []).map(norm).filter(Boolean))];
  const brnchList = [...new Set((branches ?? []).map(norm).filter(Boolean))];

  let connection;
  try {
    connection = await getDirectConnection();
    if (await userExists(connection, id)) {
      return { status: 'error', message: `User ${id} already exists` };
    }

    await connection.execute(
      `INSERT INTO SEC_USERNAME
         (USRID, COMPC, BRNCH, DESCR, ULEVL, PASWD, PDATE, STATS, MOBILE, ECODE,
          LOCKL, EXPDT, "VER_#", DEPT_M)
       VALUES
         (:id, :compc, :brnch, :descr, :ulevl, RAWTOHEX(datacrypt.encryptdata(:pw)), SYSDATE, 'E', :mobile, :ecode,
          999, ADD_MONTHS(SYSDATE, 120), '-U', 3)`,
      {
        id,
        // The row's own COMPC/BRNCH are the account's home scope; the full
        // access lists live in SEC_USERCMPN / SEC_USERBRCH below.
        compc: compList[0] ?? '1',
        brnch: brnchList[0] ?? '1',
        descr: (norm(name) || id).slice(0, 40),
        ulevl: norm(ulevl).toUpperCase().slice(0, 1) || 'U',
        pw: norm(password),
        mobile: norm(mobile) ? Number(norm(mobile).replace(/\D/g, '')) : null,
        ecode: norm(ecode) || null,
      },
    );
    for (const compc of compList) {
      await connection.execute(`INSERT INTO SEC_USERCMPN (USRID, COMPC) VALUES (:id, :c)`, { id, c: compc });
    }
    for (const brnch of brnchList) {
      await connection.execute(`INSERT INTO SEC_USERBRCH (USRID, BRNCH) VALUES (:id, :b)`, { id, b: brnch });
    }
    await connection.commit();
    return { status: 'success', usrid: id };
  } catch (e) {
    try { await connection?.rollback(); } catch { /* ignore */ }
    return { status: 'error', message: e.message };
  } finally {
    await connection?.close();
  }
};
