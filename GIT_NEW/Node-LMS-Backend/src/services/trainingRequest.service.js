/**
 * Training requests and their approval chain: Employee → HOD 1 → HOD 2 → HR.
 *
 * Approvers are resolved the way leave approvals do it (leaveApproval.service.js):
 * at submit the employee's EMPLOYEE.HOD1 / HOD2 mobiles are copied onto the
 * request, and a signed-in person is "the HOD" for a request when their own
 * HR_EMP_MASTER.MOBILE# matches one of those (last 10 digits). A missing HOD
 * step is skipped; any rejection ends the request.
 *
 * Status: PENDING_HOD1 → PENDING_HOD2 → PENDING_HR → APPROVED → BOOKED → COMPLETED,
 * or REJECTED / CANCELLED.
 *
 * Nominations: a HOD nominating their own team member counts as their own
 * approval (HOD 1 → goes on to HOD 2 if there is one; HOD 2 → straight to HR).
 * HR assigning someone directly skips requests entirely (session participants).
 */

import { getDirectConnection } from "../config/database.js";
import {
  OUT_ARRAY, s, num, numOrNull, ymd, ymdhm, TrainingError, nextId, writeLog, withTx, mapOraError,
  mobileKey, mobileKeySql, loadEmployee, nameOf, EMP_DEPT_SQL, EMP_DESG_SQL,
} from "./trainingShared.service.js";
import { bookParticipant } from "./trainingSession.service.js";

const read = async (fn) => {
  const connection = await getDirectConnection();
  try {
    return await fn(connection);
  } catch (err) {
    return mapOraError(err);
  } finally {
    await connection.close();
  }
};

const OPEN_STATUSES = ["PENDING_HOD1", "PENDING_HOD2", "PENDING_HR", "APPROVED", "BOOKED"];

const REQUEST_SELECT = `
  SELECT r.REQUEST_ID, r.COMPC, r.BRNCH, r.EMPCODE, m.NAME, ${EMP_DEPT_SQL}, ${EMP_DESG_SQL},
         r.SOURCE, r.REQUESTED_BY, (SELECT MAX(z.NAME) FROM HR_EMP_MASTER z WHERE z.EMPCODE = r.REQUESTED_BY),
         r.COURSE_ID, t.COURSE_CODE, t.TITLE, r.REQUESTED_TOPIC, r.REASON, r.PRIORITY,
         r.PREFERRED_FROM, r.PREFERRED_TO,
         r.HOD1_MNO, r.HOD1_FLAG, r.HOD1_DATE, r.HOD1_NAME, r.HOD1_REMARKS,
         r.HOD2_MNO, r.HOD2_FLAG, r.HOD2_DATE, r.HOD2_NAME, r.HOD2_REMARKS,
         r.HR_FLAG, r.HR_DATE, r.HR_NAME, r.HR_REMARKS,
         r.STATUS, r.SESSION_ID, x.SESSION_CODE, x.START_DATE, x.END_DATE, r.CREATED_AT
    FROM HR_TRAINING_REQUEST r
    LEFT JOIN HR_EMP_MASTER m ON m.EMPCODE = r.EMPCODE
    LEFT JOIN HR_TRAINING_COURSE t ON t.COURSE_ID = r.COURSE_ID
    LEFT JOIN HR_TRAINING_SESSION x ON x.SESSION_ID = r.SESSION_ID`;

const rowToRequest = (x) => ({
  request_id: num(x[0]), compc: num(x[1]), brnch: numOrNull(x[2]), empcode: s(x[3]), emp_name: s(x[4]),
  dept_name: s(x[5]), desg_desc: s(x[6]), source: s(x[7]), requested_by: s(x[8]), requested_by_name: s(x[9]),
  course_id: numOrNull(x[10]), course_code: s(x[11]), course_title: s(x[12]), requested_topic: s(x[13]),
  title: s(x[12]) || s(x[13]), reason: s(x[14]), priority: s(x[15]),
  preferred_from: ymd(x[16]), preferred_to: ymd(x[17]),
  hod1: x[18] ? { flag: s(x[19]) || null, date: ymdhm(x[20]), name: s(x[21]), remarks: s(x[22]) } : null,
  hod2: x[23] ? { flag: s(x[24]) || null, date: ymdhm(x[25]), name: s(x[26]), remarks: s(x[27]) } : null,
  hr: { flag: s(x[28]) || null, date: ymdhm(x[29]), name: s(x[30]), remarks: s(x[31]) },
  hod1_mno: s(x[18]), hod2_mno: s(x[23]),
  status: s(x[32]), session_id: numOrNull(x[33]), session_code: s(x[34]),
  session_start: ymd(x[35]), session_end: ymd(x[36]), created_at: ymdhm(x[37]),
});

// Serialise decisions on one request (two approvers clicking at once).
const lockRequest = (c, id) =>
  c.execute(`SELECT 1 FROM HR_TRAINING_REQUEST WHERE REQUEST_ID = :id FOR UPDATE`, { id }, { outFormat: OUT_ARRAY });

// Mobile numbers are internal routing data; don't send them to the browser.
const publicRequest = ({ hod1_mno, hod2_mno, ...rest }) => rest;

/** First pending step for a request whose HOD mobiles are h1/h2. */
const firstStatus = (h1, h2) => (mobileKey(h1) ? "PENDING_HOD1" : mobileKey(h2) ? "PENDING_HOD2" : "PENDING_HR");

const validateCourse = async (c, compc, courseId) => {
  if (!courseId) return;
  const r = await c.execute(
    `SELECT IS_ACTIVE FROM HR_TRAINING_COURSE WHERE COURSE_ID = :id AND COMPC = :compc`,
    { id: courseId, compc }, { outFormat: OUT_ARRAY },
  );
  if (!r.rows?.length) throw new TrainingError("Course not found in your company");
  if (s(r.rows[0][0]) !== "Y") throw new TrainingError("This course is no longer offered");
};

const rejectDuplicate = async (c, empcode, courseId) => {
  if (!courseId) return;
  const r = await c.execute(
    `SELECT STATUS FROM HR_TRAINING_REQUEST
      WHERE EMPCODE = :e AND COURSE_ID = :cid AND STATUS IN (${OPEN_STATUSES.map((st) => `'${st}'`).join(",")})
      FETCH FIRST 1 ROWS ONLY`,
    { e: empcode, cid: courseId }, { outFormat: OUT_ARRAY },
  );
  if (r.rows?.length) throw new TrainingError("There is already an open request for this course", 409);
};

const insertRequest = async (c, emp, fields) => {
  const id = await nextId(c, "HR_TRAINING_REQUEST_SEQ");
  await c.execute(
    `INSERT INTO HR_TRAINING_REQUEST (REQUEST_ID, COMPC, BRNCH, EMPCODE, SOURCE, REQUESTED_BY, COURSE_ID, REQUESTED_TOPIC,
            REASON, PRIORITY, PREFERRED_FROM, PREFERRED_TO, HOD1_MNO, HOD2_MNO,
            HOD1_FLAG, HOD1_DATE, HOD1_NAME, HOD2_FLAG, HOD2_DATE, HOD2_NAME, STATUS, CREATED_BY)
     VALUES (:id, :compc, :brnch, :e, :src, :reqby, :cid, :topic, :reason, :prio,
             TO_DATE(:pf, 'YYYY-MM-DD'), TO_DATE(:pt, 'YYYY-MM-DD'), :h1, :h2,
             :f1, CASE WHEN :f1 IS NULL THEN NULL ELSE SYSDATE END, :n1,
             :f2, CASE WHEN :f2 IS NULL THEN NULL ELSE SYSDATE END, :n2, :st, :reqby)`,
    {
      id, compc: emp.compc, brnch: emp.brnch, e: emp.empcode, src: fields.source, reqby: fields.requested_by,
      cid: fields.course_id ?? null, topic: s(fields.requested_topic) || null, reason: s(fields.reason) || null,
      prio: fields.priority || "MEDIUM", pf: fields.preferred_from || null, pt: fields.preferred_to || null,
      h1: emp.hod1_mno || null, h2: emp.hod2_mno || null,
      f1: fields.hod1_flag ?? null, n1: fields.hod1_name ?? null, f2: fields.hod2_flag ?? null, n2: fields.hod2_name ?? null,
      st: fields.status,
    },
  );
  await writeLog(c, {
    compc: emp.compc, entity: "REQUEST", entityId: id, action: `CREATE_${fields.source}`,
    details: { course_id: fields.course_id, topic: fields.requested_topic, status: fields.status }, actor: fields.requested_by,
  });
  return id;
};

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------

/** Active courses + upcoming sessions of the employee's own company. */
export const employeeCatalog = (empcode) => read(async (c) => {
  const emp = await loadEmployee(c, empcode);
  if (!emp) throw new TrainingError("Employee not found", 404);
  const courses = await c.execute(
    `SELECT t.COURSE_ID, t.COURSE_CODE, t.TITLE, (SELECT k.NAME FROM HR_TRAINING_CATEGORY k WHERE k.CATEGORY_ID = t.CATEGORY_ID),
            t.TRAINING_TYPE, t.DEFAULT_MODE, t.DURATION_HRS, t.DESCRIPTION, t.CERT_REQUIRED,
            (SELECT MIN(x.START_DATE) FROM HR_TRAINING_SESSION x
              WHERE x.COURSE_ID = t.COURSE_ID AND x.STATUS IN ('PLANNED','OPEN') AND x.START_DATE >= TRUNC(SYSDATE))
       FROM HR_TRAINING_COURSE t
      WHERE t.COMPC = :compc AND t.IS_ACTIVE = 'Y'
      ORDER BY UPPER(t.TITLE)`,
    { compc: emp.compc }, { outFormat: OUT_ARRAY },
  );
  return {
    employee: { empcode: emp.empcode, name: emp.name, dept_name: emp.dept_name, compc: emp.compc, has_hod: !!(mobileKey(emp.hod1_mno) || mobileKey(emp.hod2_mno)) },
    courses: (courses.rows ?? []).map((x) => ({
      course_id: num(x[0]), course_code: s(x[1]), title: s(x[2]), category_name: s(x[3]), training_type: s(x[4]),
      default_mode: s(x[5]), duration_hrs: numOrNull(x[6]), description: s(x[7]), cert_required: s(x[8]) === "Y",
      next_session: ymd(x[9]),
    })),
  };
});

export const createMyRequest = (empcode, body) => withTx(async (c) => {
  const emp = await loadEmployee(c, empcode);
  if (!emp) throw new TrainingError("Employee not found", 404);
  await validateCourse(c, emp.compc, body.course_id);
  await rejectDuplicate(c, emp.empcode, body.course_id);
  const status = firstStatus(emp.hod1_mno, emp.hod2_mno);
  const id = await insertRequest(c, emp, { ...body, source: "EMPLOYEE", requested_by: emp.empcode, status });
  return { request_id: id, status };
});

export const listMyRequests = (empcode) => read(async (c) => {
  const r = await c.execute(`${REQUEST_SELECT} WHERE r.EMPCODE = :e ORDER BY r.CREATED_AT DESC`, { e: s(empcode) }, { outFormat: OUT_ARRAY });
  return (r.rows ?? []).map((x) => publicRequest(rowToRequest(x)));
});

export const cancelMyRequest = (empcode, id) => withTx(async (c) => {
  const r = await c.execute(
    `UPDATE HR_TRAINING_REQUEST SET STATUS = 'CANCELLED', UPDATED_BY = :e, UPDATED_AT = SYSDATE
      WHERE REQUEST_ID = :id AND EMPCODE = :e AND STATUS IN ('PENDING_HOD1','PENDING_HOD2','PENDING_HR')`,
    { id, e: s(empcode) },
  );
  if (!r.rowsAffected) throw new TrainingError("Only a request still waiting for approval can be cancelled");
  await writeLog(c, { entity: "REQUEST", entityId: id, action: "CANCEL", actor: empcode });
  return { cancelled: true };
});

// ---------------------------------------------------------------------------
// HOD
// ---------------------------------------------------------------------------

const approverOf = async (c, cardNo) => {
  const emp = await loadEmployee(c, cardNo);
  if (!emp) throw new TrainingError("Employee not found", 404);
  return { ...emp, key: mobileKey(emp.mobile) };
};

/** Which HOD step this approver holds on a request, and whether it is theirs to act on now. */
const hodState = (req, key) => {
  if (!key) return null;
  const isHod1 = mobileKey(req.hod1_mno) === key;
  const isHod2 = !isHod1 && mobileKey(req.hod2_mno) === key;
  if (!isHod1 && !isHod2) return null;
  const step = isHod1 ? 1 : 2;
  return {
    my_step: step,
    my_turn: (step === 1 && req.status === "PENDING_HOD1") || (step === 2 && req.status === "PENDING_HOD2"),
  };
};

const isNamedHod = async (c, key) => {
  if (!key) return false;
  const r = await c.execute(
    `SELECT 1 FROM EMPLOYEE WHERE ${mobileKeySql("HOD1")} = :k OR ${mobileKeySql("HOD2")} = :k FETCH FIRST 1 ROWS ONLY`,
    { k: key }, { outFormat: OUT_ARRAY },
  );
  return !!r.rows?.length;
};

export const hodRequests = (cardNo) => read(async (c) => {
  const me = await approverOf(c, cardNo);
  if (!me.key) return { is_hod: false, items: [], pending: 0 };
  const r = await c.execute(
    `${REQUEST_SELECT}
      WHERE ${mobileKeySql("r.HOD1_MNO")} = :k OR ${mobileKeySql("r.HOD2_MNO")} = :k
      ORDER BY r.CREATED_AT DESC`,
    { k: me.key }, { outFormat: OUT_ARRAY },
  );
  const items = [];
  for (const raw of r.rows ?? []) {
    const req = rowToRequest(raw);
    const st = hodState(req, me.key);
    if (st) items.push({ ...publicRequest(req), ...st });
  }
  const is_hod = items.length > 0 || (await isNamedHod(c, me.key));
  return { is_hod, items, pending: items.filter((i) => i.my_turn).length };
});

export const hodDecide = (cardNo, id, { decision, remarks }) => withTx(async (c) => {
  const me = await approverOf(c, cardNo);
  await lockRequest(c, id);
  const r = await c.execute(`${REQUEST_SELECT} WHERE r.REQUEST_ID = :id`, { id }, { outFormat: OUT_ARRAY });
  if (!r.rows?.length) throw new TrainingError("Request not found", 404);
  const req = rowToRequest(r.rows[0]);
  const st = hodState(req, me.key);
  if (!st) throw new TrainingError("You are not an approver for this request", 403);
  if (!st.my_turn) throw new TrainingError("This request is not waiting for your approval");
  if (decision === "reject" && !s(remarks)) throw new TrainingError("Please give a reason for rejecting");

  const approve = decision === "approve";
  let next = "REJECTED";
  if (approve) {
    const hasHod2 = !!mobileKey(req.hod2_mno) && mobileKey(req.hod2_mno) !== mobileKey(req.hod1_mno);
    next = st.my_step === 1 && hasHod2 ? "PENDING_HOD2" : "PENDING_HR";
  }
  const n = st.my_step;
  await c.execute(
    `UPDATE HR_TRAINING_REQUEST SET HOD${n}_FLAG = :f, HOD${n}_DATE = SYSDATE, HOD${n}_NAME = :name, HOD${n}_REMARKS = :rem,
            STATUS = :st, UPDATED_BY = :updby, UPDATED_AT = SYSDATE
      WHERE REQUEST_ID = :id`,
    { f: approve ? "Y" : "N", name: me.name, rem: s(remarks) || null, st: next, updby: me.empcode, id },
  );
  await writeLog(c, { compc: req.compc, entity: "REQUEST", entityId: id, action: `HOD${n}_${approve ? "APPROVE" : "REJECT"}`, details: { remarks, next }, actor: me.empcode });
  return { request_id: id, status: next };
});

/** The HOD's team: employees who name them as HOD 1 / HOD 2, with training counts. */
export const hodTeam = (cardNo) => read(async (c) => {
  const me = await approverOf(c, cardNo);
  if (!me.key) return { items: [] };
  const r = await c.execute(
    `SELECT m.EMPCODE, m.NAME, ${EMP_DEPT_SQL}, ${EMP_DESG_SQL},
            (SELECT COUNT(*) FROM HR_TRAINING_PARTICIPANT p WHERE p.EMPCODE = m.EMPCODE AND p.STATUS = 'COMPLETED'),
            (SELECT COUNT(*) FROM HR_TRAINING_PARTICIPANT p JOIN HR_TRAINING_SESSION x ON x.SESSION_ID = p.SESSION_ID
              WHERE p.EMPCODE = m.EMPCODE AND p.STATUS = 'BOOKED' AND x.STATUS <> 'CANCELLED'),
            (SELECT COUNT(*) FROM HR_TRAINING_REQUEST q WHERE q.EMPCODE = m.EMPCODE
                AND q.STATUS IN ('PENDING_HOD1','PENDING_HOD2','PENDING_HR','APPROVED')),
            CASE WHEN ${mobileKeySql("e.HOD1")} = :k THEN 1 ELSE 2 END
       FROM EMPLOYEE e
       JOIN HR_EMP_MASTER m ON m.EMPCODE = e.EMPCODE
      WHERE (${mobileKeySql("e.HOD1")} = :k OR ${mobileKeySql("e.HOD2")} = :k)
        AND NVL(m.STATUS, 'A') = 'A' AND m.EMPCODE <> :me
      ORDER BY UPPER(m.NAME)`,
    { k: me.key, me: me.empcode }, { outFormat: OUT_ARRAY },
  );
  return {
    items: (r.rows ?? []).map((x) => ({
      empcode: s(x[0]), name: s(x[1]), dept_name: s(x[2]), desg_desc: s(x[3]),
      completed: num(x[4]), upcoming: num(x[5]), open_requests: num(x[6]), my_step: num(x[7]),
    })),
  };
});

/** Training history of one team member — only for their HOD. */
export const hodMemberHistory = (cardNo, empcode) => read(async (c) => {
  const me = await approverOf(c, cardNo);
  const emp = await loadEmployee(c, empcode);
  if (!emp || !me.key || (mobileKey(emp.hod1_mno) !== me.key && mobileKey(emp.hod2_mno) !== me.key)) {
    throw new TrainingError("This employee is not in your team", 403);
  }
  const r = await c.execute(
    `SELECT x.SESSION_CODE, t.TITLE, x.START_DATE, x.END_DATE, p.STATUS, p.ATTEND_PCT, p.PRE_SCORE_PCT, p.POST_SCORE_PCT, p.CERT_NO
       FROM HR_TRAINING_PARTICIPANT p
       JOIN HR_TRAINING_SESSION x ON x.SESSION_ID = p.SESSION_ID
       JOIN HR_TRAINING_COURSE t ON t.COURSE_ID = x.COURSE_ID
      WHERE p.EMPCODE = :e AND p.STATUS <> 'WITHDRAWN' ORDER BY x.START_DATE DESC`,
    { e: emp.empcode }, { outFormat: OUT_ARRAY },
  );
  return {
    employee: { empcode: emp.empcode, name: emp.name, dept_name: emp.dept_name },
    items: (r.rows ?? []).map((x) => ({
      session_code: s(x[0]), course_title: s(x[1]), start_date: ymd(x[2]), end_date: ymd(x[3]), status: s(x[4]),
      attend_pct: numOrNull(x[5]), pre_score_pct: numOrNull(x[6]), post_score_pct: numOrNull(x[7]), cert_no: s(x[8]) || null,
    })),
  };
});

export const hodNominate = (cardNo, body) => withTx(async (c) => {
  const me = await approverOf(c, cardNo);
  const emp = await loadEmployee(c, body.empcode);
  if (!emp) throw new TrainingError("Employee not found", 404);
  const isHod1 = !!me.key && mobileKey(emp.hod1_mno) === me.key;
  const isHod2 = !isHod1 && !!me.key && mobileKey(emp.hod2_mno) === me.key;
  if (!isHod1 && !isHod2) throw new TrainingError("You can only nominate employees who report to you", 403);
  await validateCourse(c, emp.compc, body.course_id);
  await rejectDuplicate(c, emp.empcode, body.course_id);

  const hasHod2 = !!mobileKey(emp.hod2_mno) && mobileKey(emp.hod2_mno) !== mobileKey(emp.hod1_mno);
  const status = isHod1 && hasHod2 ? "PENDING_HOD2" : "PENDING_HR";
  const id = await insertRequest(c, emp, {
    ...body, source: "HOD", requested_by: me.empcode, status,
    ...(isHod1 ? { hod1_flag: "Y", hod1_name: me.name } : { hod2_flag: "Y", hod2_name: me.name }),
  });
  return { request_id: id, status };
});

// ---------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------

export const hrRequests = (compc, { status, branch } = {}) => read(async (c) => {
  const binds = { compc };
  let where = "r.COMPC = :compc";
  if (status === "OPEN") where += " AND r.STATUS IN ('PENDING_HOD1','PENDING_HOD2','PENDING_HR','APPROVED')";
  else if (status) { where += " AND r.STATUS = :st"; binds.st = status; }
  if (branch) { where += " AND TO_CHAR(r.BRNCH) = :b"; binds.b = String(branch); }
  const r = await c.execute(`${REQUEST_SELECT} WHERE ${where} ORDER BY
      CASE r.STATUS WHEN 'PENDING_HR' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END, r.CREATED_AT DESC`,
  binds, { outFormat: OUT_ARRAY });
  return (r.rows ?? []).map((x) => publicRequest(rowToRequest(x)));
});

/**
 * HR's decision on a request waiting for HR (or approved but not yet booked):
 *   approve                 → APPROVED (book later)
 *   approve + session_id    → BOOKED into that session (capacity checked)
 *   reject (remarks needed) → REJECTED
 */
export const hrDecide = (compc, actor, id, { decision, remarks, session_id, course_id }) => withTx(async (c) => {
  await lockRequest(c, id);
  const r = await c.execute(`${REQUEST_SELECT} WHERE r.REQUEST_ID = :id AND r.COMPC = :compc`,
    { id, compc }, { outFormat: OUT_ARRAY });
  if (!r.rows?.length) throw new TrainingError("Request not found", 404);
  const req = rowToRequest(r.rows[0]);
  const hrName = await nameOf(c, actor);

  if (decision === "reject") {
    if (!["PENDING_HR", "APPROVED"].includes(req.status)) throw new TrainingError(`Request is ${req.status.replace("_", " ").toLowerCase()} — HR cannot act on it yet`);
    if (!s(remarks)) throw new TrainingError("Please give a reason for rejecting");
    await c.execute(
      `UPDATE HR_TRAINING_REQUEST SET HR_FLAG = 'N', HR_DATE = SYSDATE, HR_NAME = :name, HR_REMARKS = :rem,
              STATUS = 'REJECTED', UPDATED_BY = :actor, UPDATED_AT = SYSDATE WHERE REQUEST_ID = :id`,
      { name: hrName, rem: s(remarks), actor, id },
    );
    await writeLog(c, { compc, entity: "REQUEST", entityId: id, action: "HR_REJECT", details: { remarks }, actor });
    return { request_id: id, status: "REJECTED" };
  }

  if (!["PENDING_HR", "APPROVED"].includes(req.status)) {
    throw new TrainingError(`Request is ${req.status.replace("_", " ").toLowerCase()} — HR cannot act on it yet`);
  }
  // A free-text request can be mapped to a catalog course while approving.
  const courseId = course_id ?? req.course_id;
  if (course_id && course_id !== req.course_id) {
    const k = await c.execute(`SELECT 1 FROM HR_TRAINING_COURSE WHERE COURSE_ID = :cid AND COMPC = :compc`, { cid: course_id, compc }, { outFormat: OUT_ARRAY });
    if (!k.rows?.length) throw new TrainingError("Course not found in this company");
  }
  if (session_id) {
    const x = await c.execute(`SELECT COURSE_ID FROM HR_TRAINING_SESSION WHERE SESSION_ID = :sid AND COMPC = :compc`,
      { sid: session_id, compc }, { outFormat: OUT_ARRAY });
    if (!x.rows?.length) throw new TrainingError("Session not found", 404);
    if (courseId && num(x.rows[0][0]) !== courseId) throw new TrainingError("That session is for a different course");
    await bookParticipant(c, { compc, sessionId: session_id, empcode: req.empcode, requestId: id, actor });
  }
  const status = session_id ? "BOOKED" : "APPROVED";
  await c.execute(
    `UPDATE HR_TRAINING_REQUEST SET HR_FLAG = 'Y', HR_DATE = NVL(HR_DATE, SYSDATE), HR_NAME = NVL(HR_NAME, :name),
            HR_REMARKS = NVL(:rem, HR_REMARKS), STATUS = :st, SESSION_ID = :sid,
            COURSE_ID = NVL(:cid, COURSE_ID), UPDATED_BY = :actor, UPDATED_AT = SYSDATE
      WHERE REQUEST_ID = :id`,
    { name: hrName, rem: s(remarks) || null, st: status, sid: session_id ?? null, cid: courseId ?? null, actor, id },
  );
  await writeLog(c, { compc, entity: "REQUEST", entityId: id, action: session_id ? "HR_APPROVE_BOOK" : "HR_APPROVE", details: { remarks, session_id, course_id: courseId }, actor });
  return { request_id: id, status };
});

/** Audit trail of one request (HR). */
export const requestHistory = (compc, id) => read(async (c) => {
  const r = await c.execute(
    `SELECT l.ACTION, l.DETAILS, l.ACTOR, (SELECT MAX(m.NAME) FROM HR_EMP_MASTER m WHERE m.EMPCODE = l.ACTOR), l.ACTED_AT
       FROM HR_TRAINING_LOG l
      WHERE l.ENTITY = 'REQUEST' AND l.ENTITY_ID = :id
        AND EXISTS (SELECT 1 FROM HR_TRAINING_REQUEST r WHERE r.REQUEST_ID = :id AND r.COMPC = :compc)
      ORDER BY l.ACTED_AT, l.LOG_ID`,
    { id, compc }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => ({ action: s(x[0]), details: s(x[1]), actor: s(x[2]), actor_name: s(x[3]), at: ymdhm(x[4]) }));
});
