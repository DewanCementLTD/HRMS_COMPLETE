import { getDirectConnection } from '../config/database.js';

import { logger } from '../utils/logger.js';
import { getHalfDayWindow, hhmmToMinutes } from './workSchedule.service.js';
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

/**
 * The only leave types an employee may apply for.
 *
 * ALL_LEAVE_BAL_V reports a balance for CL (1), ML (2) and EL (3) only, so those
 * are the applyable ones, plus On-Duty which carries no balance at all. Note the
 * "CL" code is NOT unique: type 9 is "CL / ML (Contract Staff)", a different
 * type with no balance behind it — offering it let people file leave that could
 * never be checked or deducted, so it is excluded here by PK, never by code.
 */
const APPLYABLE_LEAVE_TYPE_PKS = [1, 2, 3];

const isApplyableType = (t) =>
  t.is_od || APPLYABLE_LEAVE_TYPE_PKS.includes(Number(t.pk));

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
    // Days on requests awaiting approval are already committed, so the figure
    // the apply screen shows is what can still be applied for.
    const pendingByType = emp ? await fetchPendingDaysByType(connection, emp.card_no) : new Map();

    return types.filter(isApplyableType).map((t) => {
      const candidates = new Set([t.code.toUpperCase(), t.desc.toUpperCase(), String(t.pk)].filter(Boolean));
      let balance = matchBalanceRow(balRows, candidates);
      if (balance === null) balance = t.entitlement;
      const pending = pendingByType.get(String(t.pk)) ?? 0;

      return {
        leave_type: t.code || String(t.pk),
        leave_type_pk: t.pk,
        leave_desc: t.desc,
        balance: t.is_od ? 999 : balance - pending,
        /** Entitlement left before pending requests are taken off. */
        total_balance: t.is_od ? 999 : balance,
        pending_days: t.is_od ? 0 : pending,
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
    // The same reservation the apply screen applies (see getLeaveTypesData):
    // ALL_LEAVE_BAL_V only knows about fully approved leave, so without this the
    // dashboard kept showing the old figure until both HODs had signed off, and
    // an employee could not see that they had already spent the days.
    const pendingByType = emp ? await fetchPendingDaysByType(connection, emp.card_no) : new Map();

    return rows.map(([pk, code, desc, bal]) => {
      const c = String(code ?? '').trim();
      const d = String(desc ?? '').trim();
      const isOd = isOdType(c) || isOdType(d);
      const total = bal !== null && bal !== undefined ? Number(bal) : 0;
      const pending = isOd ? 0 : (pendingByType.get(String(pk)) ?? 0);
      return {
        leave_type: c || String(pk),
        leave_type_pk: pk,
        leave_desc: d,
        /** What is still available: approved leave already gone, pending held back. */
        balance: total - pending,
        /** Entitlement left before pending requests are held back. */
        total_balance: total,
        pending_days: pending,
        is_od: isOd,
      };
    });
  } finally {
    await connection?.close();
  }
};

// ---------------------------------------------------------------------------
// Apply-time guards
// ---------------------------------------------------------------------------
/**
 * Days already spoken for by applications that are neither approved nor
 * rejected, per leave type.
 *
 * ALL_LEAVE_BAL_V only subtracts leave that reached LEAVE_APPLICATION, i.e.
 * fully approved leave. Without counting the pending ones an employee with 10
 * CL could file 5 + 1 + 5 days — each request passing the check on its own —
 * and end up 11 days approved. Treating a pending request as reserved closes
 * that: the days come back automatically the moment a request is rejected,
 * because it stops being counted here.
 */
const fetchPendingDaysByType = async (connection, empFk) => {
  const byType = new Map();
  try {
    const r = await connection.execute(
      `SELECT LEAVE_TYPE_FK, SUM(NVL(LEAVE_DAYS, 0))
         FROM LEAVE_APPLICATION_APPLY
        WHERE TO_CHAR(EMP_FK) = TO_CHAR(:emp)
          AND UPPER(NVL(APPROVAL_STATUS, ' ')) NOT IN ('REJECTED', 'APPROVED')
        GROUP BY LEAVE_TYPE_FK`,
      { emp: String(empFk) },
      { outFormat: OUT_ARRAY },
    );
    for (const [typeFk, days] of r.rows ?? []) {
      if (typeFk === null || typeFk === undefined) continue;
      byType.set(String(typeFk), Number(days) || 0);
    }
  } catch (e) {
    logger.info(`[LEAVE] pending-days lookup failed for ${empFk}: ${e.message ?? e}`);
  }
  return byType;
};



/**
 * Dates in [from, to] the employee is NOT rostered to work.
 *
 * DUTY_ROSTER.ROSTER_SHIFT = 'R' is REST in SHIFT_HEAD (Sundays here), and
 * HOLIDAY_FK marks a public holiday. Leave is not taken on those days, so they
 * are dropped from the request rather than consuming balance.
 */
const findOffDays = async (connection, cardNo, fromDate, toDate) => {
  try {
    const r = await connection.execute(
      `SELECT TO_CHAR(ROSTER_DATE, 'YYYY-MM-DD')
         FROM DUTY_ROSTER
        WHERE (TO_CHAR(CARD_NO) = :card OR TO_CHAR(CARD_NO) = :cardInt)
          AND ROSTER_DATE BETWEEN TO_DATE(:fromDate, 'YYYY-MM-DD') AND TO_DATE(:toDate, 'YYYY-MM-DD')
          AND (UPPER(TRIM(ROSTER_SHIFT)) = 'R' OR HOLIDAY_FK IS NOT NULL)
        ORDER BY ROSTER_DATE`,
      { card: String(cardNo), cardInt: cardIntStr(cardNo), fromDate, toDate },
      { outFormat: OUT_ARRAY },
    );
    return (r.rows ?? []).map(([d]) => d);
  } catch (e) {
    logger.info(`[LEAVE] off-day lookup failed for ${cardNo}: ${e.message ?? e}`);
    return [];
  }
};

/**
 * An existing application that already covers part of [from, to].
 *
 * Rejected requests don't block a fresh one; anything else (waiting or
 * approved) does, so the same day can't be claimed twice.
 */
const findOverlappingApplication = async (connection, empFk, fromDate, toDate) => {
  try {
    const r = await connection.execute(
      `SELECT LEAVE_APPLICATION_PK, APPROVAL_STATUS,
              TO_CHAR(LEAVE_DATE_FROM, 'YYYY-MM-DD'), TO_CHAR(LEAVE_DATE_TO, 'YYYY-MM-DD')
         FROM LEAVE_APPLICATION_APPLY
        WHERE TO_CHAR(EMP_FK) = TO_CHAR(:emp)
          AND UPPER(NVL(APPROVAL_STATUS, ' ')) <> 'REJECTED'
          AND LEAVE_DATE_FROM <= TO_DATE(:toDate, 'YYYY-MM-DD')
          AND NVL(LEAVE_DATE_TO, LEAVE_DATE_FROM) >= TO_DATE(:fromDate, 'YYYY-MM-DD')
        ORDER BY LEAVE_DATE_FROM
        FETCH FIRST 1 ROWS ONLY`,
      { emp: String(empFk), fromDate, toDate },
      { outFormat: OUT_ARRAY },
    );
    const row = r.rows?.[0];
    if (!row) return null;
    return { pk: row[0], status: String(row[1] ?? '').trim(), from: row[2], to: row[3] };
  } catch (e) {
    logger.info(`[LEAVE] overlap lookup failed for ${empFk}: ${e.message ?? e}`);
    return null;
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
  } = body;

  let connection;
  try {
    connection = await getDirectConnection();

    // ---- Half-day handling ----
    // A half day is one session of one day. The app enforces a single-date
    // picker, so a range here means the two disagree — reject it rather than
    // silently charging half a day for what was asked as a range.
    let toDate = toDateIn;
    let leaveDays;
    let hrs;
    let finalReason = String(reason ?? '').trim();
    let halfDayWindow = null;
    let offDaysExcluded = 0;
    if (half_day) {
      if (toDateIn && String(toDateIn) !== String(from_date)) {
        return {
          status: 'error',
          message: 'A half day covers a single date — from_date and to_date must be the same.',
        };
      }
      toDate = from_date;
      leaveDays = 0.5;
      // The session named by the app, resolved against THIS employee's shift:
      // first half runs from the shift start to the branch's half-day cut-off,
      // second half from that cut-off to the shift end.
      halfDayWindow = await getHalfDayWindow(card_no, half_day_session, connection);
      hrs = halfDayWindow.hours || 4;
      const label = halfDayWindow.session === 'second_half' ? 'Second Half' : 'First Half';
      finalReason =
        `${finalReason || `${label} leave`} [${label}: ${halfDayWindow.from_time}-${halfDayWindow.to_time}]`;
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

    if (!isApplyableType(resolvedType)) {
      return {
        status: 'error',
        message: `${resolvedType.desc || resolvedType.code} cannot be applied for — only Casual, Medical, Earned leave and On-Duty are available.`,
      };
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

    // ---- One application per day, and no leave on rostered off days ----
    const clash = await findOverlappingApplication(connection, emp.card_no, from_date, toDate);
    if (clash) {
      const when = clash.from === clash.to ? clash.from : `${clash.from} to ${clash.to}`;
      return {
        status: 'error',
        message: `You have already applied for leave covering ${when} (${clash.status || 'pending'}). Cancel or amend that request first.`,
      };
    }

    const offDays = await findOffDays(connection, card_no, from_date, toDate);
    if (offDays.length) {
      const offSet = new Set(offDays);
      // Every requested day is a rest day / holiday — there is no leave to take.
      const spanDays = Math.round((parseYmd(toDate) - parseYmd(from_date)) / 86400000) + 1;
      if (offSet.size >= spanDays) {
        return {
          status: 'error',
          message: spanDays === 1
            ? `${from_date} is an off day on your duty roster, so no leave is needed.`
            : `Those dates are all off days on your duty roster, so no leave is needed.`,
        };
      }
      // A longer leave may legitimately span a rest day; it just isn't charged
      // for it, so drop those days from the count.
      if (!half_day) {
        leaveDays -= offSet.size;
        offDaysExcluded = offSet.size;
      }
    }

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

      // Requests already in flight are reserved against the balance, so three
      // pending requests can't each pass on their own and overdraw once every
      // one of them is approved.
      const pendingByType = await fetchPendingDaysByType(connection, emp.card_no);
      const pendingDays = pendingByType.get(String(resolvedType.pk)) ?? 0;
      const available = currentBalance - pendingDays;

      if (currentBalance <= 0) {
        return { status: 'error', message: 'No remaining balance for this leave type.' };
      }
      if (available <= 0) {
        return {
          status: 'error',
          message: `Your remaining ${resolvedType.desc || resolvedType.code} is already committed to leave awaiting approval (${pendingDays} day(s)).`,
        };
      }
      if (leaveDays > available) {
        return {
          status: 'error',
          message: pendingDays > 0
            ? `Insufficient balance. You have ${currentBalance} day(s), ${pendingDays} of which are on requests awaiting approval, leaving ${available}. Requested: ${leaveDays}.`
            : `Insufficient balance. Available: ${currentBalance}, Requested: ${leaveDays}`,
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
        COMPC, BRNCH, TR_TYPE, HOD1_MNO, HOD2_MNO, HOD3_MNO,
        START_TIME, END_TIME
      ) VALUES (
        :emp_fk, :leave_type_fk, TO_DATE(:from_date, 'YYYY-MM-DD'), TO_DATE(:to_date, 'YYYY-MM-DD'),
        :leave_days, :hrs, :reason, 'Waiting',
        TO_CHAR(SYSDATE, 'DD-MON-RR HH24:MI', 'NLS_DATE_LANGUAGE=AMERICAN'), :entry_by,
        :previous_balance, :year, :compc, :brnch, 'Online',
        :hod1, :hod2, :hod3,
        :start_time, :end_time
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
      // The half-day session as HRMS stores it: the clock window it covers.
      // Full-day rows leave both null, exactly as they always have.
      start_time: halfDayWindow?.from_time ?? null,
      end_time: halfDayWindow?.to_time ?? null,
    };

    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await connection.execute(insertSql, binds, { autoCommit: true });
        return {
          status: 'success',
          ...(offDaysExcluded
            ? {
                message: `Leave applied for ${leaveDays} day(s). ${offDaysExcluded} roster off day(s) in that range were not counted.`,
              }
            : {}),
        };
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

/**
 * Which half of the day an application covers, or null when it is a full day.
 *
 * The apply path names the session in REASON on every application it writes —
 * it has always done so, which is why that marker, not the stored clock times,
 * is what identifies the session: the times alone cannot be read without also
 * knowing the shift they were cut from (a 13:00 start is the first half of an
 * afternoon shift and the second half of a morning one). Rows imported from
 * elsewhere carry neither, and are reported as a first half — what HRMS assumes
 * for a half day with no stated session.
 */
const halfDaySession = ({ leaveDays, reason, startTime }) => {
  if (leaveDays === null || !(leaveDays > 0 && leaveDays < 1)) return null;

  const text = String(reason ?? '').toUpperCase();
  if (text.includes('SECOND HALF')) return 'second_half';
  if (text.includes('FIRST HALF')) return 'first_half';

  const start = hhmmToMinutes(startTime);
  if (start !== null) return start >= 720 ? 'second_half' : 'first_half';
  return 'first_half';
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
         REASON, APPROVAL_STATUS, START_TIME, END_TIME
       FROM LEAVE_APPLICATION_APPLY
       WHERE EMP_FK IN (${placeholders})
       ORDER BY LEAVE_DATE_FROM DESC, LEAVE_APPLICATION_PK DESC`,
      params,
      { outFormat: OUT_ARRAY },
    );

    return (r.rows ?? []).map(
      ([pk, entryDate, leaveTypeFk, dFrom, dTo, days, reason, status, startTime, endTime]) => {
        const t = leaveTypeFk !== null && leaveTypeFk !== undefined ? typesByPk.get(String(leaveTypeFk)) : null;
        const leaveCode = (t && t.code) || (leaveTypeFk !== null && leaveTypeFk !== undefined ? String(leaveTypeFk) : '');
        const leaveDays = days !== null && days !== undefined ? Number(days) : null;
        const session = halfDaySession({ leaveDays, reason, startTime });
        return {
          leave_application_pk: pk,
          entry_date: entryDate,
          leave_type: String(leaveCode),
          leave_desc: t ? t.desc : null,
          from_date: fmtYmd(dFrom),
          to_date: fmtYmd(dTo),
          leave_days: leaveDays,
          reason,
          status,
          // The Status tab shows "Half Day - First Half"; leave_days alone
          // cannot say which half, so the session travels with the row.
          half_day: session !== null,
          half_day_session: session,
          half_day_start_time: session ? String(startTime ?? '').trim() || null : null,
          half_day_end_time: session ? String(endTime ?? '').trim() || null : null,
        };
      },
    );
  } finally {
    await connection?.close();
  }
};
