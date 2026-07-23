import { getDirectConnection } from '../config/database.js';

import { logger } from '../utils/logger.js';
const OUT_ARRAY = 4001; // oracledb.OUT_FORMAT_ARRAY

// ---------------------------------------------------------------------------
// Leave-type helpers — faithful ports of the FastAPI LMS-Backend
// (repositories/user_repository.py): _is_od_type, _leave_types_meta, _type_matches.
// The LEAVE_TYPES schema varies between installs, so columns are detected by name
// at runtime exactly like the Python side.
// ---------------------------------------------------------------------------

// Mirrors _is_od_type: true when a leave description/code denotes "On Duty".
const isOdType = (desc) => {
  const d = String(desc ?? '').toUpperCase().trim();
  return (
    d === 'OD' ||
    d.startsWith('OD ') ||
    d.endsWith(' OD') ||
    d.includes('- OD') ||
    d.includes('ON DUTY') ||
    d.includes('OFFICIAL DUTY') ||
    d.includes('OUT DOOR') ||
    d.includes('OUTDOOR')
  );
};

// Mirrors _leave_types_meta: read LEAVE_TYPES with dynamically-detected columns.
// Returns [{ pk, code, desc, entitlement, is_od }]. Uses the same open connection.
const leaveTypesMeta = async (connection) => {
  let cols;
  let rows;
  try {
    const r = await connection.execute('SELECT * FROM LEAVE_TYPES', {}, { outFormat: OUT_ARRAY });
    cols = (r.metaData ?? []).map((m) => String(m.name).toUpperCase());
    rows = r.rows ?? [];
  } catch (e) {
    logger.info(`[LEAVE_TYPES] read failed: ${e.message ?? e}`);
    return [];
  }

  // Return the first column index whose name satisfies any predicate, in order.
  const find = (...preds) => {
    for (const p of preds) {
      for (let i = 0; i < cols.length; i++) {
        if (p(cols[i])) return i;
      }
    }
    return null;
  };

  const pkI = find((c) => c === 'LEAVE_TYPE_PK', (c) => c.endsWith('_PK'));
  const descI = find((c) => c.includes('DESC'));
  const codeI = find(
    (c) => ['LEAVE_CD', 'LEAVE_CODE', 'TYPE_CD', 'LEAVE_TYPE_CD', 'CODE', 'SHORT_CD'].includes(c),
    (c) => (c.endsWith('CD') || c.includes('CODE')) && !c.endsWith('_PK'),
  );
  const entI = find(
    (c) => c.includes('ENTITLE'),
    (c) => c.includes('ALLOW') && c.includes('DAY'),
    (c) => ['NO_OF_DAYS', 'DAYS', 'MAX_DAYS', 'TOTAL_DAYS', 'LEAVE_DAYS'].includes(c),
  );

  return rows.map((r) => {
    const pk = pkI !== null ? r[pkI] : null;
    const desc = descI !== null ? String(r[descI] ?? '').trim() : '';
    const code = codeI !== null && r[codeI] !== null && r[codeI] !== undefined ? String(r[codeI]).trim() : null;
    const entitlement = entI !== null ? r[entI] : null;
    return { pk, code, desc, entitlement, is_od: isOdType(desc) || isOdType(code ?? '') };
  });
};

// Mirrors _type_matches: true if a LEAVE_TYPES meta row matches a value that may
// be the code ('ML'), the numeric PK, or the description.
const typeMatches = (t, value) => {
  const v = String(value ?? '').trim().toUpperCase();
  if (!v) return false;
  if (t.code && t.code.toUpperCase() === v) return true;
  if (t.pk !== null && t.pk !== undefined && String(t.pk).trim().toUpperCase() === v) return true;
  if (t.desc && t.desc.toUpperCase() === v) return true;
  return false;
};

export const getLeaveBalancesData = async (card_no) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const sql = `
        SELECT 
          leave_type AS "leave_type", 
          leave_desc AS "leave_desc", 
          balance AS "balance"
        FROM ALL_LEAVE_BAL_V
        WHERE card_no = :card_no
    `;
    const result = await connection.execute(sql, { card_no }, { outFormat: 4002 });
    return result.rows ?? [];
  } finally {
    await connection?.close();
  }
};

// Mirrors `get_leave_types` in the FastAPI LMS-Backend (repositories/user_repository.py):
// the full LEAVE_TYPES LOV merged with balances from ALL_LEAVE_BAL_V. OD types get
// is_od=true (no balance restriction); types missing from the view fall back to
// their LEAVE_TYPES entitlement. If LEAVE_TYPES can't be read, uses the view rows.
export const getLeaveTypesData = async (card_no) => {
  let connection;
  try {
    connection = await getDirectConnection();

    // Balances: rows of [leave_type, leave_desc, balance]
    let balances = [];
    try {
      const r = await connection.execute(
        `SELECT leave_type, leave_desc, balance
         FROM ALL_LEAVE_BAL_V WHERE card_no = :card`,
        { card: card_no },
        { outFormat: OUT_ARRAY },
      );
      balances = r.rows ?? [];
    } catch (e) {
      logger.info(`[LEAVE_TYPES] ALL_LEAVE_BAL_V query failed: ${e.message ?? e}`);
    }

    // Only the LEAVE_TYPES LOV is offered for applying — extra ALL_LEAVE_BAL_V
    // rows (ABSENT, SPECIAL LEAVE, ...) are informational and must not appear here.
    const types = await leaveTypesMeta(connection);
    const result = [];

    for (const t of types) {
      let bal = null;
      for (const b of balances) {
        // b[0] = leave_type, b[1] = leave_desc, b[2] = balance
        if (
          typeMatches(t, b[0]) ||
          (t.desc && String(b[1] ?? '').trim().toUpperCase() === t.desc.toUpperCase())
        ) {
          bal = b[2];
          break;
        }
      }
      if (bal === null && t.entitlement !== null && t.entitlement !== undefined) {
        bal = t.entitlement;
      }
      result.push({
        leave_type: t.code || t.pk, // '||' mirrors Python's `t["code"] or t["pk"]`
        leave_desc: t.desc,
        balance: bal,
        is_od: t.is_od,
      });
    }

    // Fallback: if LEAVE_TYPES couldn't be read at all, use the view rows.
    if (!result.length) {
      for (const b of balances) {
        result.push({
          leave_type: b[0],
          leave_desc: b[1],
          balance: b[2],
          is_od: isOdType(String(b[1] ?? '')) || isOdType(String(b[0] ?? '')),
        });
      }
    }

    return result;
  } finally {
    await connection?.close();
  }
};

// Mirrors `get_leave_status` in the FastAPI LMS-Backend (repositories/user_repository.py):
// LEAVE_APPLICATION.EMP_FK holds the card_no directly (no EMPLOYEE join).
export const getLeaveStatusData = async (card_no) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const sql = `
      SELECT
        ENTRY_DATE      AS "entry_date",
        LEAVE_TYPE_FK   AS "leave_type",
        LEAVE_DAYS      AS "leave_days",
        REASON           AS "reason",
        LEAVE_DATE_FROM AS "from_date",
        LEAVE_DATE_TO   AS "to_date",
        APPROVAL_STATUS AS "status"
      FROM LEAVE_APPLICATION
      WHERE EMP_FK = :card
      ORDER BY ENTRY_DATE DESC
    `;
    const result = await connection.execute(sql, { card: card_no }, { outFormat: 4002 });
    const rows = result.rows ?? [];
    for (const row of rows) {
      for (const key of ['from_date', 'to_date', 'entry_date']) {
        const v = row[key];
        if (v instanceof Date) {
          const y = v.getFullYear();
          const m = String(v.getMonth() + 1).padStart(2, '0');
          const d = String(v.getDate()).padStart(2, '0');
          row[key] = `${y}-${m}-${d}`;
        }
      }
    }
    return rows;
  } finally {
    await connection?.close();
  }
};

// Parses a 'YYYY-MM-DD' string to a UTC-midnight timestamp (avoids local-timezone
// drift when diffing two calendar dates).
const parseYmd = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

// Mirrors `apply_leave` in the FastAPI LMS-Backend (repositories/user_repository.py):
// EMP_FK is the card_no directly, and the leave balance is validated against
// ALL_LEAVE_BAL_V before the insert.
export const applyLeaveData = async (card_no, body) => {
  const { leave_type_id, from_date, to_date, reason, compc, brnch, emp_name } = body;
  const leaveTypeId = leave_type_id ?? 0;
  const leave_days = Math.round((parseYmd(to_date) - parseYmd(from_date)) / 86400000) + 1;

  let connection;
  try {
    connection = await getDirectConnection();

    // Validate leave balance before inserting
    try {
      const balRow = (
        await connection.execute(
          `SELECT balance AS "balance" FROM ALL_LEAVE_BAL_V WHERE card_no = :card AND leave_type = :lt`,
          { card: card_no, lt: leaveTypeId },
          { outFormat: 4002 }
        )
      ).rows?.[0];
      const currentBalance = balRow?.balance != null ? Number(balRow.balance) : 0;
      if (currentBalance <= 0) {
        return { status: 'error', message: 'No remaining balance for this leave type.' };
      }
      if (leave_days > currentBalance) {
        return {
          status: 'error',
          message: `Insufficient balance. Available: ${currentBalance}, Requested: ${leave_days}`,
        };
      }
    } catch (e) {
      logger.info(`[LEAVE] Balance check warning: ${e.message ?? e}`);
      // Continue if view doesn't exist — let insert proceed
    }

    try {
      await connection.execute(
        `INSERT INTO LEAVE_APPLICATION (
           LEAVE_DATE_FROM, LEAVE_DATE_TO, LEAVE_DAYS, EMP_FK, HRS,
           LEAVE_TYPE_FK, REASON, APPROVAL_STATUS, ENTRY_DATE, ENTRY_BY,
           COMPC, BRNCH
         ) VALUES (
           TO_DATE(:from_date, 'YYYY-MM-DD'), TO_DATE(:to_date, 'YYYY-MM-DD'),
           :leave_days, :emp_fk, 0, :leave_type_id, :reason, 'PENDING', SYSDATE,
           :emp_name, :compc, :brnch
         )`,
        {
          from_date,
          to_date,
          leave_days,
          emp_fk: card_no,
          leave_type_id: leaveTypeId,
          reason,
          emp_name: emp_name ?? null,
          compc: compc ?? null,
          brnch: brnch ?? null,
        },
        { autoCommit: true }
      );
      return { status: 'success' };
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  } finally {
    await connection?.close();
  }
};
