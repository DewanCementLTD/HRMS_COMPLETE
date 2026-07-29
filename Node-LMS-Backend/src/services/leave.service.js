import { getDirectConnection } from '../config/database.js';

import { logger } from '../utils/logger.js';
const OUT_ARRAY = 4001; // oracledb.OUT_FORMAT_ARRAY

// ---------------------------------------------------------------------------
// Leave module — faithful port of the FastAPI LMS-Backend
// (repositories/user_repository.py) as fixed on 2026-07-29. See
// LMS-Backend/repositories/user_repository.py for the canonical version; this
// file mirrors it 1:1, including the real (introspected) Oracle schema:
//   LEAVE_TYPES:            LEAVE_TYPE_PK, LEAVE_TYPE (code), LEAVE_DESC,
//                            ENTITLEMENT, ALLOWED — a single global row set,
//                            NOT company-partitioned despite having COMPC/BRNCH
//                            columns. PK duplicates exist (e.g. 'CL' twice).
//   ALL_LEAVE_BAL_V:         CARD_NO (NUMBER) matches EMPLOYEE.CARD_NO directly.
//   EMPLOYEE:                identity source (EMP_PK, CARD_NO, EMP_NAME, COMPC,
//                            BRNCH, HOD1/2/3) — prefer this over any
//                            HR_EMP_MASTER.EMPCODE join, which collides across
//                            units.
//   LEAVE_APPLICATION_APPLY: the correct insert target for online/self-service
//                            applications (distinct from the legacy bulk-import
//                            LEAVE_APPLICATION table). Has a DB trigger
//                            (INSERT_LEAVE_PK) that auto-generates
//                            LEAVE_APPLICATION_PK via NVL(MAX(...),0)+1 on every
//                            insert — never supply that column, just retry on
//                            ORA-00001 (PK race).
// ---------------------------------------------------------------------------

// Mirrors _is_od_type: true when a leave code/description denotes "On Duty".
const isOdType = (text) => {
  const d = String(text ?? '').toUpperCase();
  return (
    d === 'OD' ||
    /\bOD\b/.test(d) ||
    /-\s*OD\b/.test(d) ||
    /\bON\s*DUTY\b/.test(d) ||
    /\bOFFICIAL\s*DUTY\b/.test(d) ||
    /\bOUT\s*DOOR\b/.test(d) ||
    /\bOUTDOOR\b/.test(d)
  );
};

// Numeric prefix of a possibly dotted/company-qualified card string.
const cardIntStr = (cardNo) => {
  const s = String(cardNo ?? '').trim();
  return s.includes('.') ? s.split('.')[0] : s;
};

// Format a JS Date (or ISO-ish string) to YYYY-MM-DD.
const fmtYmd = (v) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
};

// Parses a 'YYYY-MM-DD' string to a UTC-midnight timestamp (avoids
// local-timezone drift when diffing two calendar dates).
const parseYmd = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

// Mirrors _load_leave_types_meta: LEAVE_TYPES is the LOV source of truth for
// "apply leave". Explicit columns (not dynamic detection) — the real schema is
// known and fixed. Returns [{ pk, code, desc, entitlement, is_od }].
const leaveTypesMeta = async (connection) => {
  let rows;
  try {
    const r = await connection.execute(
      `SELECT LEAVE_TYPE_PK, LEAVE_TYPE, LEAVE_DESC, ENTITLEMENT, ALLOWED
       FROM LEAVE_TYPES
       ORDER BY LEAVE_TYPE_PK`,
      {},
      { outFormat: OUT_ARRAY },
    );
    rows = r.rows ?? [];
  } catch (e) {
    logger.info(`[LEAVE_TYPES] read failed: ${e.message ?? e}`);
    return [];
  }

  return rows.map(([pk, code, desc, entitlement, allowed]) => {
    const c = code !== null && code !== undefined ? String(code).trim() : '';
    const d = desc !== null && desc !== undefined ? String(desc).trim() : '';
    const fallbackDays = entitlement !== null && entitlement !== undefined ? entitlement : allowed;
    return {
      pk,
      code: c,
      desc: d,
      entitlement: fallbackDays !== null && fallbackDays !== undefined ? Number(fallbackDays) : 0,
      is_od: isOdType(c) || isOdType(d),
    };
  });
};

// Mirrors _match_leave_type: resolve a client-supplied leave type identifier
// (code, PK, or description — never int()-cast) against LEAVE_TYPES metadata.
const matchLeaveType = (types, raw) => {
  if (raw === null || raw === undefined) return null;
  const key = String(raw).trim().toUpperCase();
  if (!key) return null;
  for (const t of types) {
    if ((t.code && t.code.toUpperCase() === key) || (t.desc && t.desc.toUpperCase() === key)) return t;
  }
  for (const t of types) {
    if (String(t.pk) === key) return t;
  }
  return null;
};

// Mirrors _resolve_leave_employee: identity for leave purposes from EMPLOYEE
// (unique per person via CARD_NO) — never via HR_EMP_MASTER.EMPCODE, which
// collides across units. Falls back to the numeric prefix of a dotted card.
const resolveLeaveEmployee = async (connection, cardNo) => {
  let row;
  try {
    const r = await connection.execute(
      `SELECT TO_CHAR(CARD_NO), EMP_PK, EMP_NAME, COMPC, BRNCH, HOD1, HOD2, HOD3
       FROM EMPLOYEE
       WHERE TO_CHAR(CARD_NO) = :card
       FETCH FIRST 1 ROWS ONLY`,
      { card: cardNo },
      { outFormat: OUT_ARRAY },
    );
    row = r.rows?.[0];
  } catch (e) {
    logger.info(`[LEAVE] Employee lookup by card_no failed for ${cardNo}: ${e.message ?? e}`);
  }

  if (!row) {
    const cardInt = cardIntStr(cardNo);
    if (cardInt && /^-?\d+$/.test(cardInt)) {
      try {
        const r = await connection.execute(
          `SELECT TO_CHAR(CARD_NO), EMP_PK, EMP_NAME, COMPC, BRNCH, HOD1, HOD2, HOD3
           FROM EMPLOYEE
           WHERE CARD_NO = TO_NUMBER(:cardInt)
           FETCH FIRST 1 ROWS ONLY`,
          { cardInt },
          { outFormat: OUT_ARRAY },
        );
        row = r.rows?.[0];
      } catch (e) {
        logger.info(`[LEAVE] Employee lookup by numeric prefix failed for ${cardNo}: ${e.message ?? e}`);
      }
    }
  }

  if (!row) return null;

  const [card_no, emp_pk, emp_name, compc, brnch, hod1, hod2, hod3] = row;
  return {
    card_no,
    emp_pk: emp_pk !== null && emp_pk !== undefined ? Number(emp_pk) : null,
    emp_name: (emp_name ?? '').trim(),
    compc,
    brnch,
    hod1,
    hod2,
    hod3,
  };
};

// Mirrors _fetch_balance_rows: raw ALL_LEAVE_BAL_V rows for an employee,
// resolved via numeric card.
const fetchBalanceRows = async (connection, resolvedCardNo) => {
  try {
    const r = await connection.execute(
      `SELECT LEAVE_TYPE_PK, LEAVE_TYPE, LEAVE_DESC, BALANCE
       FROM ALL_LEAVE_BAL_V
       WHERE CARD_NO = TO_NUMBER(:card)`,
      { card: resolvedCardNo },
      { outFormat: OUT_ARRAY },
    );
    return r.rows ?? [];
  } catch (e) {
    logger.info(`[LEAVE] ALL_LEAVE_BAL_V lookup failed for card=${resolvedCardNo}: ${e.message ?? e}`);
    return [];
  }
};

// Mirrors _match_balance_row: match by either code OR description against a
// candidate set — the client's identifier sometimes only lines up via
// description, not code.
const matchBalanceRow = (balRows, candidates) => {
  for (const [pk, code, desc, bal] of balRows) {
    const rowCandidates = new Set([
      String(pk),
      String(code ?? '').trim().toUpperCase(),
      String(desc ?? '').trim().toUpperCase(),
    ]);
    for (const c of candidates) {
      if (rowCandidates.has(c)) return bal !== null && bal !== undefined ? Number(bal) : 0;
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// GET LEAVE TYPES (apply-leave dropdown / LOV)
// ---------------------------------------------------------------------------
export const getLeaveTypesData = async (card_no) => {
  let connection;
  try {
    connection = await getDirectConnection();

    const types = await leaveTypesMeta(connection);
    const emp = await resolveLeaveEmployee(connection, card_no);
    const balRows = emp ? await fetchBalanceRows(connection, emp.card_no) : [];

    return types.map((t) => {
      const candidates = new Set([t.code.toUpperCase(), t.desc.toUpperCase(), String(t.pk)].filter(Boolean));
      let balance = matchBalanceRow(balRows, candidates);
      if (balance === null) balance = t.entitlement;

      return {
        leave_type: t.code || String(t.pk),
        leave_type_pk: t.pk,
        leave_desc: t.desc,
        balance: t.is_od ? 999 : balance,
        is_od: t.is_od,
      };
    });
  } finally {
    await connection?.close();
  }
};

// ---------------------------------------------------------------------------
// GET LEAVE BALANCES (dashboard / status display feed)
// ---------------------------------------------------------------------------
export const getLeaveBalancesData = async (card_no) => {
  let connection;
  try {
    connection = await getDirectConnection();

    const emp = await resolveLeaveEmployee(connection, card_no);
    const resolvedCard = emp ? emp.card_no : cardIntStr(card_no);
    const rows = await fetchBalanceRows(connection, resolvedCard);

    return rows.map(([pk, code, desc, bal]) => {
      const c = String(code ?? '').trim();
      const d = String(desc ?? '').trim();
      return {
        leave_type: c || String(pk),
        leave_type_pk: pk,
        leave_desc: d,
        balance: bal !== null && bal !== undefined ? Number(bal) : 0,
        is_od: isOdType(c) || isOdType(d),
      };
    });
  } finally {
    await connection?.close();
  }
};

// ---------------------------------------------------------------------------
// APPLY LEAVE (POST)
// ---------------------------------------------------------------------------
export const applyLeaveData = async (card_no, body) => {
  const {
    type: leaveTypeRaw,
    leave_type_id,
    from_date,
    to_date: toDateIn,
    reason,
    compc,
    brnch,
    emp_name,
    half_day,
    half_day_session,
    from_time,
    to_time,
  } = body;

  let connection;
  try {
    connection = await getDirectConnection();

    // ---- Half-day handling ----
    let toDate = toDateIn;
    let leaveDays;
    let hrs;
    let finalReason = reason;
    if (half_day) {
      toDate = from_date;
      leaveDays = 0.5;
      hrs = 4;
      if (from_time && to_time) {
        finalReason = `${reason} [Half Day: ${from_time}-${to_time}]`;
      } else if (String(half_day_session ?? '').trim().toLowerCase() === 'second') {
        finalReason = `${reason} [Second Half: 13:00-18:00]`;
      } else {
        finalReason = `${reason} [First Half: 09:30-13:00]`;
      }
    } else {
      leaveDays = Math.round((parseYmd(toDateIn) - parseYmd(from_date)) / 86400000) + 1;
      hrs = 0;
    }

    // ---- Resolve leave type: string-first rule — never int()-cast `type` ----
    const effectiveType =
      String(leaveTypeRaw ?? '').trim() ||
      (leave_type_id !== null && leave_type_id !== undefined ? String(leave_type_id) : '');
    if (!effectiveType) {
      return { status: 'error', message: 'Leave type is required' };
    }

    const types = await leaveTypesMeta(connection);
    const resolvedType = matchLeaveType(types, effectiveType);
    if (!resolvedType) {
      return { status: 'error', message: `Unknown leave type: ${effectiveType}` };
    }

    const leaveTypeFk = Number.isFinite(Number(resolvedType.pk)) ? parseInt(resolvedType.pk, 10) : null;
    if (leaveTypeFk === null) {
      return { status: 'error', message: `Unknown leave type: ${effectiveType}` };
    }

    const isOd = resolvedType.is_od;

    // ---- Resolve employee (never guess if this fails) ----
    const emp = await resolveLeaveEmployee(connection, card_no);
    if (!emp || emp.emp_pk === null || emp.emp_pk === undefined) {
      return { status: 'error', message: `Employee not found for card ${card_no}` };
    }

    const empFk = emp.emp_pk;
    const resolvedName = emp_name || emp.emp_name || '';
    const resolvedCompc = compc !== null && compc !== undefined ? compc : emp.compc;
    const resolvedBrnch = brnch !== null && brnch !== undefined ? brnch : emp.brnch;

    // ---- Balance validation (skipped entirely for OD types) ----
    let previousBalance = null;
    if (!isOd) {
      const balRows = await fetchBalanceRows(connection, emp.card_no);
      const candidates = new Set(
        [
          String(effectiveType).trim().toUpperCase(),
          resolvedType.code.toUpperCase(),
          resolvedType.desc.toUpperCase(),
          String(resolvedType.pk),
        ].filter(Boolean),
      );

      let currentBalance = matchBalanceRow(balRows, candidates);
      if (currentBalance === null) {
        logger.info(`[LEAVE] No balance row matched for card=${card_no}, type=${effectiveType}; treating as 0`);
        currentBalance = 0;
      }
      previousBalance = currentBalance;

      if (currentBalance <= 0) {
        return { status: 'error', message: 'No remaining balance for this leave type.' };
      }
      if (leaveDays > currentBalance) {
        return {
          status: 'error',
          message: `Insufficient balance. Available: ${currentBalance}, Requested: ${leaveDays}`,
        };
      }
    }

    // ---- Insert into LEAVE_APPLICATION_APPLY ----
    // LEAVE_APPLICATION_PK is generated by the DB trigger INSERT_LEAVE_PK on
    // every insert, which races under concurrent submissions (ORA-00001 on
    // PK_LEAVE) — retry a few times on that specific error.
    const year = parseInt(String(from_date).split('-')[0], 10);
    const insertSql = `
      INSERT INTO LEAVE_APPLICATION_APPLY (
        EMP_FK, LEAVE_TYPE_FK, LEAVE_DATE_FROM, LEAVE_DATE_TO,
        LEAVE_DAYS, HRS, REASON, APPROVAL_STATUS,
        ENTRY_DATE, ENTRY_BY, PREVIOUS_BALANCE, YEAR,
        COMPC, BRNCH, TR_TYPE, HOD1_MNO, HOD2_MNO, HOD3_MNO
      ) VALUES (
        :emp_fk, :leave_type_fk, TO_DATE(:from_date, 'YYYY-MM-DD'), TO_DATE(:to_date, 'YYYY-MM-DD'),
        :leave_days, :hrs, :reason, 'Waiting',
        TO_CHAR(SYSDATE, 'DD-MON-RR HH24:MI', 'NLS_DATE_LANGUAGE=AMERICAN'), :entry_by,
        :previous_balance, :year, :compc, :brnch, 'Online',
        :hod1, :hod2, :hod3
      )`;
    const binds = {
      emp_fk: empFk,
      leave_type_fk: leaveTypeFk,
      from_date,
      to_date: toDate,
      leave_days: leaveDays,
      hrs,
      reason: finalReason,
      entry_by: resolvedName,
      previous_balance: previousBalance,
      year,
      compc: resolvedCompc ?? null,
      brnch: resolvedBrnch ?? null,
      hod1: emp.hod1 !== null && emp.hod1 !== undefined ? String(emp.hod1) : null,
      hod2: emp.hod2 !== null && emp.hod2 !== undefined ? String(emp.hod2) : null,
      hod3: emp.hod3 !== null && emp.hod3 !== undefined ? String(emp.hod3) : null,
    };

    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await connection.execute(insertSql, binds, { autoCommit: true });
        return { status: 'success' };
      } catch (err) {
        lastError = err;
        if (String(err.message).includes('ORA-00001') && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
          continue;
        }
        break;
      }
    }
    return { status: 'error', message: lastError?.message };
  } finally {
    await connection?.close();
  }
};

// ---------------------------------------------------------------------------
// GET LEAVE STATUS (application history)
// ---------------------------------------------------------------------------
export const getLeaveStatusData = async (card_no) => {
  let connection;
  try {
    connection = await getDirectConnection();

    const types = await leaveTypesMeta(connection);
    const typesByPk = new Map(types.map((t) => [String(t.pk), t]));

    const emp = await resolveLeaveEmployee(connection, card_no);

    // Match broadly: EMP_FK has been populated inconsistently across entry
    // paths, so try the raw card, its numeric base, the resolved EMPCODE, and
    // the resolved EMP_PK — use whichever the column actually holds.
    const candidates = new Set();
    const cardInt = cardIntStr(card_no);
    if (cardInt && /^-?\d+$/.test(cardInt)) candidates.add(cardInt);
    if (card_no && String(card_no).trim()) candidates.add(String(card_no).trim());
    if (emp) {
      if (emp.card_no) candidates.add(String(emp.card_no));
      if (emp.emp_pk !== null && emp.emp_pk !== undefined) candidates.add(String(emp.emp_pk));
    }

    try {
      const r = await connection.execute(
        `SELECT EMPCODE FROM HR_EMP_MASTER WHERE "ATDTCARD#" = :c OR EMPCODE = :c FETCH FIRST 1 ROWS ONLY`,
        { c: card_no },
        { outFormat: OUT_ARRAY },
      );
      const empcode = r.rows?.[0]?.[0];
      if (empcode) candidates.add(String(empcode).trim());
    } catch (e) {
      logger.info(`[LEAVE] HR_EMP_MASTER EMPCODE lookup failed for status, card=${card_no}: ${e.message ?? e}`);
    }

    const numericCandidates = [...candidates].map(Number).filter((n) => Number.isFinite(n));
    if (!numericCandidates.length) return [];

    const placeholders = numericCandidates.map((_, i) => `:c${i}`).join(', ');
    const params = {};
    numericCandidates.forEach((v, i) => { params[`c${i}`] = v; });

    // ENTRY_DATE is a VARCHAR column here, so don't ORDER BY it — sort by the
    // real date column instead (newest first).
    const r = await connection.execute(
      `SELECT
         LEAVE_APPLICATION_PK, ENTRY_DATE, LEAVE_TYPE_FK,
         LEAVE_DATE_FROM, LEAVE_DATE_TO, LEAVE_DAYS,
         REASON, APPROVAL_STATUS
       FROM LEAVE_APPLICATION_APPLY
       WHERE EMP_FK IN (${placeholders})
       ORDER BY LEAVE_DATE_FROM DESC, LEAVE_APPLICATION_PK DESC`,
      params,
      { outFormat: OUT_ARRAY },
    );

    return (r.rows ?? []).map(([pk, entryDate, leaveTypeFk, dFrom, dTo, days, reason, status]) => {
      const t = leaveTypeFk !== null && leaveTypeFk !== undefined ? typesByPk.get(String(leaveTypeFk)) : null;
      const leaveCode = (t && t.code) || (leaveTypeFk !== null && leaveTypeFk !== undefined ? String(leaveTypeFk) : '');
      return {
        leave_application_pk: pk,
        entry_date: entryDate,
        leave_type: String(leaveCode),
        leave_desc: t ? t.desc : null,
        from_date: fmtYmd(dFrom),
        to_date: fmtYmd(dTo),
        leave_days: days !== null && days !== undefined ? Number(days) : null,
        reason,
        status,
      };
    });
  } finally {
    await connection?.close();
  }
};
