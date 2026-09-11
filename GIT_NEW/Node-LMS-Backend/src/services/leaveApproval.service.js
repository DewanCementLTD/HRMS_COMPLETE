import { getDirectConnection } from '../config/database.js';
import { logger } from '../utils/logger.js';

const OUT_ARRAY = 4001; // oracledb.OUT_FORMAT_ARRAY

// ---------------------------------------------------------------------------
// HOD leave approvals
//
// A leave application stamps its approvers' MOBILE NUMBERS into
// LEAVE_APPLICATION_APPLY.HOD1_MNO / HOD2_MNO (copied from the applicant's
// EMPLOYEE.HOD1 / HOD2 — those columns hold mobiles, not employee PKs, which is
// what the _MNO suffix records). A person is therefore "a HOD" for an
// application when their own mobile matches one of those columns; nothing marks
// anyone as a HOD globally, and being HR is unrelated — an HR user approves only
// for the employees who actually name them.
//
// The per-step decisions live in columns the schema already carries and nothing
// had been writing to: HODn_APP_FLAG ('Y'/'N'), HODn_APP_DATE, HODn_NAME.
//
// Steps: both mobiles present => two-step, HOD 1 first then HOD 2. Only one
// present => single step. Either approver rejecting ends it immediately.
// ---------------------------------------------------------------------------

const norm = (v) => String(v ?? '').trim();

// Mobiles are stored inconsistently (leading zero, +92, spaces), so compare on
// the last 10 digits.
const mobileKey = (v) => {
  const digits = norm(v).replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
};

const fmtYmd = (v) => {
  if (!v) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
};

/** The signed-in user's own mobile + name, used to match against HODn_MNO. */
const resolveApprover = async (connection, cardNo) => {
  const card = norm(cardNo);
  const prefix = card.includes('.') ? card.split('.')[0] : card;
  try {
    const r = await connection.execute(
      `SELECT TO_CHAR(h."MOBILE#"), h.NAME, h.EMPCODE, h.UNIT_ID
         FROM HR_EMP_MASTER h
         LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
        WHERE TO_CHAR(e.CARD_NO) = :card
           OR TO_CHAR(h."ATDTCARD#") = :card
           OR h.EMPCODE = :card
        FETCH FIRST 1 ROWS ONLY`,
      { card },
      { outFormat: OUT_ARRAY },
    );
    const row = r.rows?.[0];
    if (row) {
      return { mobile: norm(row[0]), name: norm(row[1]), empcode: norm(row[2]), unit_id: row[3] };
    }
  } catch (e) {
    logger.info(`[LEAVE_APPROVAL] approver lookup failed for ${cardNo}: ${e.message ?? e}`);
  }
  // A user may sign in with their mobile as the card number.
  return { mobile: prefix, name: '', empcode: '', unit_id: null };
};

/**
 * Which step is this approver on, and can they act right now?
 * Returns null when the approver isn't named on the application at all.
 */
const approvalState = (row, approverMobile) => {
  const me = mobileKey(approverMobile);
  const h1 = mobileKey(row.hod1_mno);
  const h2 = mobileKey(row.hod2_mno);
  const isHod1 = !!me && me === h1;
  const isHod2 = !!me && me === h2 && !isHod1;
  if (!isHod1 && !isHod2) return null;

  const twoStep = !!h1 && !!h2 && h1 !== h2;
  const f1 = norm(row.hod1_app_flag).toUpperCase();
  const f2 = norm(row.hod2_app_flag).toUpperCase();
  const myFlag = isHod1 ? f1 : f2;

  // HOD 1 goes first; HOD 2 only sees it as actionable once HOD 1 approved.
  const myTurn = !myFlag && (isHod1 || !twoStep || f1 === 'Y');

  return {
    step: isHod1 ? 1 : 2,
    total_steps: twoStep ? 2 : 1,
    my_decision: myFlag === 'Y' ? 'approved' : myFlag === 'N' ? 'rejected' : null,
    my_turn: myTurn,
    waiting_on: twoStep && !f1 ? 'HOD 1' : twoStep && f1 === 'Y' && !f2 ? 'HOD 2' : null,
  };
};

const SELECT_APPLICATIONS = `
  SELECT a.LEAVE_APPLICATION_PK, a.EMP_FK, a.LEAVE_TYPE_FK,
         a.LEAVE_DATE_FROM, a.LEAVE_DATE_TO, a.LEAVE_DAYS, a.HRS,
         a.REASON, a.APPROVAL_STATUS, a.ENTRY_DATE, a.ENTRY_BY,
         a.HOD1_MNO, a.HOD2_MNO,
         a.HOD1_APP_FLAG, a.HOD1_APP_DATE, a.HOD1_NAME,
         a.HOD2_APP_FLAG, a.HOD2_APP_DATE, a.HOD2_NAME,
         a.COMPC, a.BRNCH,
         (SELECT MIN(t.LEAVE_TYPE) FROM LEAVE_TYPES t WHERE t.LEAVE_TYPE_PK = a.LEAVE_TYPE_FK) AS LEAVE_CODE,
         (SELECT MIN(t.LEAVE_DESC) FROM LEAVE_TYPES t WHERE t.LEAVE_TYPE_PK = a.LEAVE_TYPE_FK) AS LEAVE_DESC,
         (SELECT MIN(e.EMP_NAME) FROM EMPLOYEE e WHERE TO_CHAR(e.CARD_NO) = TO_CHAR(a.EMP_FK)) AS EMP_NAME
    FROM LEAVE_APPLICATION_APPLY a`;

const rowToApplication = (r) => ({
  leave_application_pk: r[0],
  emp_fk: r[1] === null || r[1] === undefined ? null : String(r[1]),
  leave_type_fk: r[2],
  from_date: fmtYmd(r[3]),
  to_date: fmtYmd(r[4]),
  leave_days: r[5] === null || r[5] === undefined ? null : Number(r[5]),
  hrs: r[6] === null || r[6] === undefined ? null : Number(r[6]),
  reason: r[7],
  status: norm(r[8]),
  entry_date: r[9],
  entry_by: norm(r[10]),
  hod1_mno: norm(r[11]),
  hod2_mno: norm(r[12]),
  hod1_app_flag: norm(r[13]),
  hod1_app_date: r[14],
  hod1_name: norm(r[15]),
  hod2_app_flag: norm(r[16]),
  hod2_app_date: r[17],
  hod2_name: norm(r[18]),
  compc: r[19],
  brnch: r[20],
  leave_type: norm(r[21]),
  leave_desc: norm(r[22]),
  emp_name: norm(r[23]),
});

// ---------------------------------------------------------------------------
// LIST — applications this user approves
// ---------------------------------------------------------------------------
export const getHodApprovalsData = async (card_no) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const approver = await resolveApprover(connection, card_no);
    const key = mobileKey(approver.mobile);
    if (!key) return { is_hod: false, approver_mobile: '', items: [] };

    // Oracle can't index our normalised key, so filter on the last 10 digits of
    // each column and confirm the match in JS.
    const r = await connection.execute(
      `${SELECT_APPLICATIONS}
        WHERE SUBSTR(REGEXP_REPLACE(NVL(a.HOD1_MNO, 'x'), '[^0-9]', ''), -10) = :k
           OR SUBSTR(REGEXP_REPLACE(NVL(a.HOD2_MNO, 'x'), '[^0-9]', ''), -10) = :k
        ORDER BY a.LEAVE_DATE_FROM DESC, a.LEAVE_APPLICATION_PK DESC`,
      { k: key },
      { outFormat: OUT_ARRAY },
    );

    const items = [];
    for (const raw of r.rows ?? []) {
      const app = rowToApplication(raw);
      const state = approvalState(app, approver.mobile);
      if (!state) continue;
      items.push({ ...app, ...state });
    }

    // Having applications to approve proves it; otherwise ask the employee data,
    // so a HOD with an empty queue still gets the tab.
    const is_hod = items.length > 0 || (await isNamedHod(connection, key));
    return { is_hod, approver_mobile: approver.mobile, items };
  } finally {
    await connection?.close();
  }
};

/**
 * Is this person named as HOD 1 / HOD 2 on anybody's employee record?
 *
 * This is what gates the Leave Approvals tab, and it is deliberately about the
 * employee data rather than any role flag: an HR user who heads a department is
 * a HOD, an HR user who doesn't is not.
 */
const isNamedHod = async (connection, key) => {
  if (!key) return false;
  try {
    const r = await connection.execute(
      `SELECT 1 FROM EMPLOYEE
        WHERE SUBSTR(REGEXP_REPLACE(NVL(TO_CHAR(HOD1), 'x'), '[^0-9]', ''), -10) = :k
           OR SUBSTR(REGEXP_REPLACE(NVL(TO_CHAR(HOD2), 'x'), '[^0-9]', ''), -10) = :k
        FETCH FIRST 1 ROWS ONLY`,
      { k: key },
      { outFormat: OUT_ARRAY },
    );
    return (r.rows ?? []).length > 0;
  } catch (e) {
    logger.info(`[LEAVE_APPROVAL] is_hod check failed: ${e.message ?? e}`);
    return false;
  }
};

/**
 * Copy a fully-approved application into the legacy LEAVE_APPLICATION table.
 *
 * LEAVE_APPLICATION is what the rest of the ERP reads as the record of granted
 * leave (its approved rows carry APPROVAL_STATUS = 'Y'); LEAVE_APPLICATION_APPLY
 * is only the self-service request queue. The link is the table's own
 * LEAVE_APPLICATION_APPLY_FK column.
 *
 * Written as INSERT..SELECT so every column is copied straight across, and with
 * a NOT EXISTS guard so re-approving or replaying can't post the same leave
 * twice. The PK comes from the table's TRG_LEAVE_APP_AUTO_PK trigger, so it is
 * never supplied here.
 */
const postToLeaveApplication = async (connection, pk) => {
  const r = await connection.execute(
    `INSERT INTO LEAVE_APPLICATION (
        EMP_FK, LEAVE_TYPE_FK, LEAVE_DATE_FROM, LEAVE_DATE_TO, LEAVE_DAYS,
        REASON, APPROVAL_STATUS, APPROVAL_DATE, ENTRY_DATE, ENTRY_BY,
        PREVIOUS_BALANCE, BALANCE, YEAR, HRS, COMPC, BRNCH, TR_DATE, TR_TYPE,
        LEAVE_APPLICATION_APPLY_FK
     )
     SELECT a.EMP_FK, a.LEAVE_TYPE_FK, a.LEAVE_DATE_FROM, a.LEAVE_DATE_TO, a.LEAVE_DAYS,
            a.REASON, 'Y', SYSDATE, a.ENTRY_DATE, a.ENTRY_BY,
            a.PREVIOUS_BALANCE, a.BALANCE,
            -- The ERP's leave year, not the calendar year the request was filed
            -- in. ALL_LEAVE_BAL_V subtracts availed leave with
            --   year = (SELECT y.year FROM year y
            --            WHERE active_flag='Y' AND compc=.. AND brnch=..)
            -- so a row stamped 2026 would never reduce a 2025 balance.
            NVL((SELECT MAX(y.YEAR) FROM YEAR y
                  WHERE y.ACTIVE_FLAG = 'Y'
                    AND TO_CHAR(y.COMPC) = TO_CHAR(a.COMPC)
                    AND TO_CHAR(y.BRNCH) = TO_CHAR(a.BRNCH)), a.YEAR),
            a.HRS, a.COMPC, a.BRNCH, SYSDATE, a.TR_TYPE,
            a.LEAVE_APPLICATION_PK
       FROM LEAVE_APPLICATION_APPLY a
      WHERE a.LEAVE_APPLICATION_PK = :pk
        AND a.COMPC IS NOT NULL
        AND a.BRNCH IS NOT NULL
        AND NOT EXISTS (
              SELECT 1 FROM LEAVE_APPLICATION l
               WHERE l.LEAVE_APPLICATION_APPLY_FK = a.LEAVE_APPLICATION_PK)`,
    { pk },
    { autoCommit: true },
  );
  // The roster points at the LEAVE_APPLICATION row, so hand its PK back. Read it
  // through the FK link rather than a MAX(), which would race another approval.
  const found = await connection.execute(
    `SELECT LEAVE_APPLICATION_PK FROM LEAVE_APPLICATION
      WHERE LEAVE_APPLICATION_APPLY_FK = :pk
      FETCH FIRST 1 ROWS ONLY`,
    { pk },
    { outFormat: OUT_ARRAY },
  );
  return {
    inserted: (r.rowsAffected ?? 0) > 0,
    leave_application_pk: found.rows?.[0]?.[0] ?? null,
  };
};

/**
 * Mark the employee's roster days as leave.
 *
 * DUTY_ROSTER carries LEAVE_APPLICATION_FK / LEAVE_TYPE_FK / LEAVE_DAYS /
 * LEAVE_REMARKS for exactly this, though nothing had ever written to them (0 of
 * 141,744 rows populated), so this sets the convention: the FK points at the
 * LEAVE_APPLICATION row, the remarks carry the applicant's reason, and a half
 * day books 0.5.
 *
 * Only rows inside the approved date range are touched, matched on the
 * employee's card plus company/branch. STATUS is deliberately left alone — that
 * column feeds the attendance reports, and what a leave day should count as
 * there is a separate decision.
 */
const stampRosterWithLeave = async (connection, app, legacyPk) => {
  const perDay = app.leave_days != null && Number(app.leave_days) === 0.5 ? 0.5 : 1;
  const r = await connection.execute(
    `UPDATE DUTY_ROSTER
        SET LEAVE_APPLICATION_FK = :legacyPk,
            LEAVE_TYPE_FK        = :typeFk,
            LEAVE_DAYS           = :perDay,
            LEAVE_REMARKS        = SUBSTR(:remarks, 1, 100)
      WHERE TO_CHAR(CARD_NO) = TO_CHAR(:card)
        AND ROSTER_DATE BETWEEN TO_DATE(:fromDate, 'YYYY-MM-DD') AND TO_DATE(:toDate, 'YYYY-MM-DD')
        AND TO_CHAR(COMPC) = TO_CHAR(:compc)
        AND TO_CHAR(BRNCH) = TO_CHAR(:brnch)`,
    {
      legacyPk,
      typeFk: app.leave_type_fk,
      perDay,
      remarks: app.reason || `${app.leave_desc || app.leave_type} approved`,
      card: app.emp_fk,
      fromDate: app.from_date,
      toDate: app.to_date,
      compc: app.compc,
      brnch: app.brnch,
    },
    { autoCommit: true },
  );
  return r.rowsAffected ?? 0;
};

/**
 * Balance still available for this employee/leave type, counting only leave that
 * is already APPROVED.
 *
 * Checked again at approval time because the apply-time check can be overtaken:
 * several requests may be in flight, and HR can allocate or withdraw leave in
 * between. Without this a chain of individually-valid requests could still be
 * approved past the entitlement.
 */
const availableBalance = async (connection, app) => {
  try {
    // NOT NVL(...,0): ALL_LEAVE_BAL_V only reports CL/ML/EL (types 1-3). For any
    // other type it returns no row, and treating that as a zero balance blocked
    // approvals outright — which is what stopped HOD 2 on a "CL / ML (Contract
    // Staff)" request that HOD 1 had already approved. No row means "this type
    // carries no balance to check", so the check is skipped.
    const r = await connection.execute(
      `SELECT SUM(v.BALANCE)
         FROM ALL_LEAVE_BAL_V v
        WHERE TO_CHAR(v.CARD_NO) = TO_CHAR(:card)
          AND v.LEAVE_TYPE_PK = :typeFk`,
      { card: app.emp_fk, typeFk: app.leave_type_fk },
      { outFormat: OUT_ARRAY },
    );
    const value = r.rows?.[0]?.[0];
    return value === null || value === undefined ? null : Number(value);
  } catch (e) {
    logger.info(`[LEAVE_APPROVAL] balance check skipped: ${String(e.message).split(String.fromCharCode(10))[0]}`);
    return null;   // never block an approval on a lookup failure
  }
};

// ---------------------------------------------------------------------------
// DECIDE — approve / reject one application
// ---------------------------------------------------------------------------
export const decideHodApprovalData = async (card_no, pk, decision) => {
  const wantApprove = String(decision).toLowerCase() === 'approve';
  const wantReject = String(decision).toLowerCase() === 'reject';
  if (!wantApprove && !wantReject) {
    return { status: 'error', message: "Decision must be 'approve' or 'reject'" };
  }

  let connection;
  try {
    connection = await getDirectConnection();
    const approver = await resolveApprover(connection, card_no);
    if (!mobileKey(approver.mobile)) {
      return { status: 'error', message: 'Could not resolve your employee record.' };
    }

    const r = await connection.execute(
      `${SELECT_APPLICATIONS} WHERE a.LEAVE_APPLICATION_PK = :pk`,
      { pk },
      { outFormat: OUT_ARRAY },
    );
    const raw = r.rows?.[0];
    if (!raw) return { status: 'error', message: 'Leave application not found.' };

    const app = rowToApplication(raw);
    const state = approvalState(app, approver.mobile);
    if (!state) return { status: 'error', message: 'You are not an approver for this application.' };
    if (state.my_decision) {
      return { status: 'error', message: `You have already ${state.my_decision} this application.` };
    }
    if (/^(approved|rejected)$/i.test(app.status)) {
      return { status: 'error', message: `This application is already ${app.status.toLowerCase()}.` };
    }
    if (!state.my_turn) {
      return {
        status: 'error',
        message: `This application is still waiting on ${state.waiting_on || 'the previous approver'}.`,
      };
    }

    // The last approval is the one that actually spends the balance, so verify
    // it is still there. OD types carry no balance and are exempt.
    if (wantApprove && (state.total_steps === 1 || state.step === 2)) {
      const isOd = /OD|ON\s*DUTY|OUT\s*DOOR/i.test(`${app.leave_type} ${app.leave_desc}`);
      if (!isOd) {
        const balance = await availableBalance(connection, app);
        const days = Number(app.leave_days ?? 0);
        if (balance !== null && days > balance) {
          return {
            status: 'error',
            message: `${app.emp_name || 'This employee'} no longer has enough ${app.leave_desc || app.leave_type}: ${balance} day(s) left but this request is for ${days}. Other leave was approved in the meantime.`,
          };
        }
      }
    }

    const flag = wantApprove ? 'Y' : 'N';
    const slot = state.step === 1 ? 'HOD1' : 'HOD2';

    // Overall status: a rejection ends it; otherwise it is approved once every
    // required step has said yes.
    const otherFlag =
      state.step === 1 ? norm(app.hod2_app_flag).toUpperCase() : norm(app.hod1_app_flag).toUpperCase();
    let newStatus = 'Waiting';
    if (wantReject) newStatus = 'Rejected';
    else if (state.total_steps === 1 || otherFlag === 'Y') newStatus = 'Approved';

    await connection.execute(
      `UPDATE LEAVE_APPLICATION_APPLY
          SET ${slot}_APP_FLAG = :flag,
              ${slot}_APP_DATE = TO_CHAR(SYSDATE, 'DD-MON-RR HH24:MI', 'NLS_DATE_LANGUAGE=AMERICAN'),
              ${slot}_NAME     = :name,
              APPROVAL_STATUS  = :status
        WHERE LEAVE_APPLICATION_PK = :pk`,
      { flag, name: approver.name || String(card_no), status: newStatus, pk },
      { autoCommit: true },
    );

    // Once every approver has signed off, the leave becomes a real record in
    // LEAVE_APPLICATION. The decision itself is already committed, so a failure
    // here is reported rather than thrown — the approval must not be undone.
    let posted = false;
    let rosterDays = 0;
    let postError = null;
    if (newStatus === 'Approved') {
      try {
        const result = await postToLeaveApplication(connection, pk);
        posted = result.inserted;
        // Stamp the roster with the granted leave as soon as it is approved.
        if (result.leave_application_pk != null) {
          rosterDays = await stampRosterWithLeave(connection, app, result.leave_application_pk);
        }
      } catch (err) {
        postError = String(err.message).split('\n')[0];
        logger.warn(`[LEAVE_APPROVAL] posting ${pk} to LEAVE_APPLICATION failed: ${postError}`);
      }
    }

    let message;
    if (wantReject) message = 'Leave rejected.';
    else if (newStatus !== 'Approved') message = 'Approved — forwarded to HOD 2.';
    else if (postError) message = 'Leave approved, but posting it to the leave register failed — please tell IT.';
    else message = 'Leave approved.';

    return {
      status: 'success',
      message,
      approval_status: newStatus,
      posted_to_leave_application: posted,
      roster_days_marked: rosterDays,
    };
  } finally {
    await connection?.close();
  }
};

// ---------------------------------------------------------------------------
// HOD LOV — employees of one company, keyed by mobile (what HOD1/HOD2 store)
// ---------------------------------------------------------------------------
export const getHodOptionsData = async (compc, brnch) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const binds = {};
    const conds = [`h."MOBILE#" IS NOT NULL`];
    if (compc !== null && compc !== undefined && String(compc).trim() !== '') {
      conds.push('TO_CHAR(h.UNIT_ID) = TO_CHAR(:compc)');
      binds.compc = String(compc).trim();
    }
    if (brnch !== null && brnch !== undefined && String(brnch).trim() !== '') {
      conds.push('TO_CHAR(h.LOCATION) = TO_CHAR(:brnch)');
      binds.brnch = String(brnch).trim();
    }

    const r = await connection.execute(
      `SELECT TO_CHAR(h."MOBILE#"), h.NAME, h.EMPCODE, h.UNIT_ID,
              (SELECT MIN(d.DEPT_NAME) FROM HR_DEPT d
                WHERE LTRIM(d.DEPT_NO, '0') = LTRIM(h.DEPT_NO, '0')
                  AND TO_CHAR(d.COMPC) = TO_CHAR(h.UNIT_ID)) AS DEPT_NAME
         FROM HR_EMP_MASTER h
        WHERE ${conds.join(' AND ')}
          AND NVL(h.STATUS, 'A') = 'A'
        ORDER BY h.NAME`,
      binds,
      { outFormat: OUT_ARRAY },
    );

    // One row per mobile: the mobile is the stored identifier, so duplicate
    // employee records would otherwise give the LOV two identical choices.
    const seen = new Set();
    const items = [];
    for (const [mobile, name, empcode, unitId, dept] of r.rows ?? []) {
      const m = mobileKey(mobile);
      // MOBILE# is free text and some records hold a card number ("100346.1")
      // rather than a phone. Those can never match a HODn_MNO, so keep only
      // values that look like a mobile.
      if (!m || m.length !== 10 || norm(mobile).includes('.')) continue;
      if (seen.has(m)) continue;
      seen.add(m);
      items.push({
        mobile: norm(mobile),
        name: norm(name),
        empcode: norm(empcode),
        unit_id: unitId,
        department: norm(dept),
      });
    }
    return items;
  } finally {
    await connection?.close();
  }
};
