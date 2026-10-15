/**
 * Training sessions: scheduling, booking participants, attendance, completion
 * (evaluation + certificate numbering), feedback, and the employee's own
 * "My Trainings" view.
 *
 * Session status: PLANNED → OPEN → IN_PROGRESS → COMPLETED, or CANCELLED.
 * Participant status: BOOKED → COMPLETED / FAILED / NO_SHOW, or WITHDRAWN.
 *
 * Attendance %: days marked Present or Late ÷ the distinct days HR has taken
 * attendance for in that session (so only days the training was actually held
 * count, and a participant with no mark on such a day is absent).
 */

import { getDirectConnection } from "../config/database.js";
import {
  OUT_ARRAY, s, num, numOrNull, r2, ymd, ymdhm, fyOf, TrainingError, nextId, writeLog, withTx, mapOraError,
  EMP_DEPT_SQL, EMP_DESG_SQL,
} from "./trainingShared.service.js";
import { SESSION_COST_SQL, budgetWarning } from "./trainingMaster.service.js";

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

const ACTIVE_PARTICIPANT = "p.STATUS <> 'WITHDRAWN'";

export const SESSION_SELECT = `
  SELECT x.SESSION_ID, x.SESSION_CODE, x.COURSE_ID, t.COURSE_CODE, t.TITLE, x.TRAINER_ID, tr.NAME, tr.TRAINER_TYPE,
         x.MODE_TYPE, x.VENUE, x.ONLINE_LINK, x.START_DATE, x.END_DATE, x.TIME_FROM, x.TIME_TO, x.TOTAL_HOURS,
         x.CAPACITY, x.DEPT_NO, (SELECT MAX(d.DEPT_NAME) FROM HR_DEPT d WHERE d.DEPT_NO = x.DEPT_NO AND d.COMPC = x.COMPC),
         x.FY_YEAR, x.TRAINER_COST, x.VENUE_COST, x.MATERIAL_COST, x.OTHER_COST, ${SESSION_COST_SQL},
         x.STATUS, x.REMARKS, x.COMPLETED_AT,
         (SELECT COUNT(*) FROM HR_TRAINING_PARTICIPANT p WHERE p.SESSION_ID = x.SESSION_ID AND ${ACTIVE_PARTICIPANT}),
         t.TRAINING_TYPE, t.CERT_REQUIRED, t.PASS_PCT, t.MIN_ATTEND_PCT,
         (SELECT ROUND(AVG(f.RATING_OVERALL), 2) FROM HR_TRAINING_FEEDBACK f
           WHERE f.SESSION_ID = x.SESSION_ID AND f.GIVEN_BY_TYPE = 'EMPLOYEE'),
         x.COMPC, x.OUTLINE_TEXT, x.OUTLINE_FILE_NAME, x.OUTLINE_UPDATED_AT, x.TRAINER_CERT_NO, x.TRAINER_CERT_AT, tr.EMPCODE
    FROM HR_TRAINING_SESSION x
    JOIN HR_TRAINING_COURSE t ON t.COURSE_ID = x.COURSE_ID
    LEFT JOIN HR_TRAINER tr ON tr.TRAINER_ID = x.TRAINER_ID`;

export const rowToSession = (x) => {
  const capacity = num(x[16]);
  const participants = num(x[28]);
  const total = r2(x[24]);
  return {
    session_id: num(x[0]), session_code: s(x[1]), course_id: num(x[2]), course_code: s(x[3]), course_title: s(x[4]),
    trainer_id: numOrNull(x[5]), trainer_name: s(x[6]), trainer_type: s(x[7]),
    mode: s(x[8]), venue: s(x[9]), online_link: s(x[10]),
    start_date: ymd(x[11]), end_date: ymd(x[12]), time_from: s(x[13]), time_to: s(x[14]), total_hours: numOrNull(x[15]),
    capacity, dept_no: numOrNull(x[17]), dept_name: s(x[18]), fy_year: num(x[19]),
    trainer_cost: r2(x[20]), venue_cost: r2(x[21]), material_cost: r2(x[22]), other_cost: r2(x[23]), total_cost: total,
    status: s(x[25]), remarks: s(x[26]), completed_at: ymdhm(x[27]),
    participants, seats_left: Math.max(capacity - participants, 0),
    cost_per_head: participants ? r2(total / participants) : null,
    training_type: s(x[29]), cert_required: s(x[30]) === "Y", pass_pct: num(x[31]), min_attend_pct: num(x[32]),
    avg_rating: numOrNull(x[33]), compc: num(x[34]),
    outline_text: s(x[35]), outline_file_name: s(x[36]) || null, outline_updated_at: ymdhm(x[37]),
    trainer_cert_no: s(x[38]) || null, trainer_cert_at: ymd(x[39]), trainer_empcode: s(x[40]) || null,
  };
};

const loadSession = async (c, compc, id) => {
  const r = await c.execute(`${SESSION_SELECT} WHERE x.SESSION_ID = :id AND x.COMPC = :compc`, { id, compc }, { outFormat: OUT_ARRAY });
  if (!r.rows?.length) throw new TrainingError("Session not found", 404);
  return rowToSession(r.rows[0]);
};

// ---------------------------------------------------------------------------
// Sessions — HR
// ---------------------------------------------------------------------------

export const listSessions = (compc, { status, from, to, course_id, fy } = {}) => read(async (c) => {
  const binds = { compc };
  let where = "x.COMPC = :compc";
  if (status) { where += " AND x.STATUS = :st"; binds.st = status; }
  if (from) { where += " AND x.END_DATE >= TO_DATE(:f, 'YYYY-MM-DD')"; binds.f = from; }
  if (to) { where += " AND x.START_DATE <= TO_DATE(:t, 'YYYY-MM-DD')"; binds.t = to; }
  if (course_id) { where += " AND x.COURSE_ID = :cid"; binds.cid = course_id; }
  if (fy) { where += " AND x.FY_YEAR = :fy"; binds.fy = fy; }
  const r = await c.execute(`${SESSION_SELECT} WHERE ${where} ORDER BY x.START_DATE DESC, x.SESSION_ID DESC`, binds, { outFormat: OUT_ARRAY });
  return (r.rows ?? []).map(rowToSession);
});

/** Sessions an approved request can be booked into: same course (when known), not started/finished, seats left. */
export const listBookableSessions = (compc, courseId) => read(async (c) => {
  const binds = { compc };
  let where = "x.COMPC = :compc AND x.STATUS IN ('PLANNED','OPEN','IN_PROGRESS')";
  if (courseId) { where += " AND x.COURSE_ID = :cid"; binds.cid = courseId; }
  const r = await c.execute(`${SESSION_SELECT} WHERE ${where} ORDER BY x.START_DATE`, binds, { outFormat: OUT_ARRAY });
  return (r.rows ?? []).map(rowToSession);
});

export const PARTICIPANT_SELECT = `
  SELECT p.PARTICIPANT_ID, p.EMPCODE, m.NAME, ${EMP_DEPT_SQL}, ${EMP_DESG_SQL}, p.REQUEST_ID, p.STATUS,
         p.ATTEND_PCT, p.PRE_SCORE_PCT, p.POST_SCORE_PCT, p.PASSED, p.RETEST_ALLOWED, p.CERT_NO, p.CERT_ISSUED_AT,
         (SELECT COUNT(*) FROM HR_TRAINING_ATTEMPT a JOIN HR_TRAINING_TEST q ON q.TEST_ID = a.TEST_ID
           WHERE a.PARTICIPANT_ID = p.PARTICIPANT_ID AND q.TEST_KIND = 'POST'),
         (SELECT MAX(f.RATING_OVERALL) FROM HR_TRAINING_FEEDBACK f WHERE f.PARTICIPANT_ID = p.PARTICIPANT_ID)
    FROM HR_TRAINING_PARTICIPANT p
    LEFT JOIN HR_EMP_MASTER m ON m.EMPCODE = p.EMPCODE`;

export const rowToParticipant = (x) => ({
  participant_id: num(x[0]), empcode: s(x[1]), name: s(x[2]), dept_name: s(x[3]), desg_desc: s(x[4]),
  request_id: numOrNull(x[5]), status: s(x[6]), attend_pct: numOrNull(x[7]),
  pre_score_pct: numOrNull(x[8]), post_score_pct: numOrNull(x[9]),
  improvement: x[8] !== null && x[9] !== null ? r2(num(x[9]) - num(x[8])) : null,
  passed: x[10] === null ? null : s(x[10]) === "Y", retest_allowed: num(x[11]),
  cert_no: s(x[12]) || null, cert_issued_at: ymd(x[13]), post_attempts: num(x[14]), feedback_rating: numOrNull(x[15]),
});

export const getSession = (compc, id) => read(async (c) => {
  const session = await loadSession(c, compc, id);
  const p = await c.execute(`${PARTICIPANT_SELECT} WHERE p.SESSION_ID = :id ORDER BY p.STATUS, UPPER(m.NAME)`, { id }, { outFormat: OUT_ARRAY });
  const participants = (p.rows ?? []).map(rowToParticipant);
  const a = await c.execute(
    `SELECT a.PARTICIPANT_ID, a.SESSION_DATE, a.STATUS, a.HOURS
       FROM HR_TRAINING_ATTENDANCE a JOIN HR_TRAINING_PARTICIPANT p ON p.PARTICIPANT_ID = a.PARTICIPANT_ID
      WHERE p.SESSION_ID = :id`,
    { id }, { outFormat: OUT_ARRAY },
  );
  const attendance = (a.rows ?? []).map((x) => ({ participant_id: num(x[0]), date: ymd(x[1]), status: s(x[2]), hours: numOrNull(x[3]) }));
  const fb = await c.execute(
    `SELECT f.FEEDBACK_ID, f.GIVEN_BY_TYPE, f.GIVEN_BY, m.NAME, f.RATING_CONTENT, f.RATING_TRAINER, f.RATING_OVERALL, f.COMMENTS, f.CREATED_AT
       FROM HR_TRAINING_FEEDBACK f LEFT JOIN HR_EMP_MASTER m ON m.EMPCODE = f.GIVEN_BY
      WHERE f.SESSION_ID = :id ORDER BY f.CREATED_AT DESC`,
    { id }, { outFormat: OUT_ARRAY },
  );
  const feedback = (fb.rows ?? []).map((x) => ({
    feedback_id: num(x[0]), given_by_type: s(x[1]), given_by: s(x[2]), given_by_name: s(x[3]),
    rating_content: numOrNull(x[4]), rating_trainer: numOrNull(x[5]), rating_overall: num(x[6]),
    comments: s(x[7]), created_at: ymdhm(x[8]),
  }));
  const tests = await c.execute(
    `SELECT TEST_KIND FROM HR_TRAINING_TEST WHERE COURSE_ID = :cid AND IS_ACTIVE = 'Y'
        AND EXISTS (SELECT 1 FROM HR_TRAINING_QUESTION q WHERE q.TEST_ID = HR_TRAINING_TEST.TEST_ID AND q.IS_ACTIVE = 'Y')`,
    { cid: session.course_id }, { outFormat: OUT_ARRAY },
  );
  const kinds = new Set((tests.rows ?? []).map((x) => s(x[0])));
  return { session: { ...session, has_pre_test: kinds.has("PRE"), has_post_test: kinds.has("POST") }, participants, attendance, feedback };
});

export const saveSession = (compc, actor, id, body) => withTx(async (c) => {
  const course = await c.execute(
    `SELECT DURATION_HRS, IS_ACTIVE FROM HR_TRAINING_COURSE WHERE COURSE_ID = :id AND COMPC = :compc`,
    { id: body.course_id, compc }, { outFormat: OUT_ARRAY },
  );
  if (!course.rows?.length) throw new TrainingError("Course not found in this company");
  if (body.trainer_id) {
    const t = await c.execute(`SELECT 1 FROM HR_TRAINER WHERE TRAINER_ID = :id AND COMPC = :compc`,
      { id: body.trainer_id, compc }, { outFormat: OUT_ARRAY });
    if (!t.rows?.length) throw new TrainingError("Trainer not found in this company");
  }
  if (body.end_date < body.start_date) throw new TrainingError("End date cannot be before start date");
  if (body.mode === "ONLINE" && !s(body.online_link)) throw new TrainingError("Online sessions need a meeting link");

  const fy = fyOf(body.start_date);
  const cost = num(body.trainer_cost) + num(body.venue_cost) + num(body.material_cost) + num(body.other_cost);
  const binds = {
    course: body.course_id, trainer: body.trainer_id ?? null, smode: body.mode, venue: s(body.venue) || null,
    link: s(body.online_link) || null, sd: body.start_date, ed: body.end_date,
    tf: s(body.time_from) || null, tt: s(body.time_to) || null,
    hrs: body.total_hours ?? (course.rows[0][0] === null ? null : num(course.rows[0][0])),
    cap: body.capacity, dept: body.dept_no ?? null, fy,
    c1: num(body.trainer_cost), c2: num(body.venue_cost), c3: num(body.material_cost), c4: num(body.other_cost),
    rem: s(body.remarks) || null, actor, compc,
  };

  let sessionId = id;
  if (id) {
    const cur = await loadSession(c, compc, id);
    if (["COMPLETED", "CANCELLED"].includes(cur.status)) throw new TrainingError(`A ${cur.status.toLowerCase()} session cannot be edited`);
    if (body.capacity < cur.participants) throw new TrainingError(`Capacity cannot be below the ${cur.participants} people already booked`);
    await c.execute(
      `UPDATE HR_TRAINING_SESSION SET COURSE_ID = :course, TRAINER_ID = :trainer, MODE_TYPE = :smode, VENUE = :venue,
              ONLINE_LINK = :link, START_DATE = TO_DATE(:sd, 'YYYY-MM-DD'), END_DATE = TO_DATE(:ed, 'YYYY-MM-DD'),
              TIME_FROM = :tf, TIME_TO = :tt, TOTAL_HOURS = :hrs, CAPACITY = :cap, DEPT_NO = :dept, FY_YEAR = :fy,
              TRAINER_COST = :c1, VENUE_COST = :c2, MATERIAL_COST = :c3, OTHER_COST = :c4, REMARKS = :rem,
              UPDATED_BY = :actor, UPDATED_AT = SYSDATE
        WHERE SESSION_ID = :id AND COMPC = :compc`,
      { ...binds, id },
    );
    await writeLog(c, { compc, entity: "SESSION", entityId: id, action: "UPDATE", details: { before: cur, after: body }, actor });
  } else {
    const year = String(body.start_date).slice(0, 4);
    const seq = await c.execute(
      `SELECT NVL(MAX(TO_NUMBER(SUBSTR(SESSION_CODE, 10))), 0) + 1 FROM HR_TRAINING_SESSION
        WHERE COMPC = :compc AND SESSION_CODE LIKE 'SES-' || :y || '-%' AND REGEXP_LIKE(SESSION_CODE, '^SES-[0-9]{4}-[0-9]+$')`,
      { compc, y: year }, { outFormat: OUT_ARRAY },
    );
    const code = `SES-${year}-${String(num(seq.rows[0][0])).padStart(4, "0")}`;
    sessionId = await nextId(c, "HR_TRAINING_SESSION_SEQ");
    await c.execute(
      `INSERT INTO HR_TRAINING_SESSION (SESSION_ID, COMPC, SESSION_CODE, COURSE_ID, TRAINER_ID, MODE_TYPE, VENUE, ONLINE_LINK,
              START_DATE, END_DATE, TIME_FROM, TIME_TO, TOTAL_HOURS, CAPACITY, DEPT_NO, FY_YEAR,
              TRAINER_COST, VENUE_COST, MATERIAL_COST, OTHER_COST, STATUS, REMARKS, CREATED_BY)
       VALUES (:id, :compc, :code, :course, :trainer, :smode, :venue, :link,
               TO_DATE(:sd, 'YYYY-MM-DD'), TO_DATE(:ed, 'YYYY-MM-DD'), :tf, :tt, :hrs, :cap, :dept, :fy,
               :c1, :c2, :c3, :c4, :st, :rem, :actor)`,
      { ...binds, id: sessionId, code, st: body.status === "OPEN" ? "OPEN" : "PLANNED" },
    );
    await writeLog(c, { compc, entity: "SESSION", entityId: sessionId, action: "CREATE", details: { code, ...body }, actor });
  }
  const warnings = await budgetWarning(c, compc, fy, body.dept_no ?? null, cost, sessionId);
  return { session_id: sessionId, warnings };
}, { HR_TRAINING_SESSION_UK: "Session code clash — please save again" });

const STATUS_FLOW = { PLANNED: ["OPEN", "CANCELLED"], OPEN: ["IN_PROGRESS", "PLANNED", "CANCELLED"], IN_PROGRESS: ["OPEN", "CANCELLED"] };

export const setSessionStatus = (compc, actor, id, status, remarks) => withTx(async (c) => {
  const cur = await loadSession(c, compc, id);
  if (!(STATUS_FLOW[cur.status] ?? []).includes(status)) {
    throw new TrainingError(`Cannot move a ${cur.status} session to ${status}${status === "COMPLETED" ? " — use Complete & Evaluate" : ""}`);
  }
  await c.execute(
    `UPDATE HR_TRAINING_SESSION SET STATUS = :st, UPDATED_BY = :actor, UPDATED_AT = SYSDATE,
            REMARKS = CASE WHEN :rem IS NULL THEN REMARKS ELSE SUBSTR(NVL2(REMARKS, REMARKS || ' | ', '') || :rem, 1, 1000) END
      WHERE SESSION_ID = :id`,
    { st: status, actor, rem: s(remarks) || null, id },
  );
  if (status === "CANCELLED") {
    // Requests that were booked here go back to HR's "approved, to book" list.
    await c.execute(
      `UPDATE HR_TRAINING_REQUEST SET STATUS = 'APPROVED', SESSION_ID = NULL, UPDATED_BY = :actor, UPDATED_AT = SYSDATE
        WHERE SESSION_ID = :id AND STATUS = 'BOOKED'`,
      { actor, id },
    );
    await c.execute(
      `UPDATE HR_TRAINING_PARTICIPANT SET STATUS = 'WITHDRAWN', UPDATED_BY = :actor, UPDATED_AT = SYSDATE
        WHERE SESSION_ID = :id AND STATUS = 'BOOKED'`,
      { actor, id },
    );
  }
  await writeLog(c, { compc, entity: "SESSION", entityId: id, action: `STATUS_${status}`, details: { from: cur.status, remarks }, actor });
  return { session_id: id, status };
});

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

/**
 * Put one employee into a session (inside the caller's transaction). A
 * previously withdrawn row is reactivated rather than duplicated.
 */
export const bookParticipant = async (c, { compc, sessionId, empcode, requestId = null, actor }) => {
  // Lock the session row so two bookings can't both take the last seat.
  const x = await c.execute(
    `SELECT STATUS, CAPACITY FROM HR_TRAINING_SESSION WHERE SESSION_ID = :id AND COMPC = :compc FOR UPDATE`,
    { id: sessionId, compc }, { outFormat: OUT_ARRAY },
  );
  if (!x.rows?.length) throw new TrainingError("Session not found", 404);
  const [status, capacity] = x.rows[0];
  const cnt = await c.execute(
    `SELECT COUNT(*) FROM HR_TRAINING_PARTICIPANT p WHERE p.SESSION_ID = :id AND ${ACTIVE_PARTICIPANT}`,
    { id: sessionId }, { outFormat: OUT_ARRAY },
  );
  const booked = cnt.rows[0][0];
  if (!["PLANNED", "OPEN", "IN_PROGRESS"].includes(s(status))) throw new TrainingError(`Session is ${s(status).toLowerCase()} — cannot book into it`);

  const emp = await c.execute(`SELECT NAME FROM HR_EMP_MASTER WHERE EMPCODE = :e AND UNIT_ID = :compc`, { e: empcode, compc }, { outFormat: OUT_ARRAY });
  if (!emp.rows?.length) throw new TrainingError(`Employee ${empcode} is not in this company`);

  const existing = await c.execute(
    `SELECT PARTICIPANT_ID, STATUS FROM HR_TRAINING_PARTICIPANT WHERE SESSION_ID = :id AND EMPCODE = :e`,
    { id: sessionId, e: empcode }, { outFormat: OUT_ARRAY },
  );
  if (existing.rows?.length && s(existing.rows[0][1]) !== "WITHDRAWN") {
    throw new TrainingError(`${s(emp.rows[0][0]) || empcode} is already in this session`, 409);
  }
  if (num(booked) >= num(capacity)) throw new TrainingError(`Session is full (${num(capacity)} seats)`, 409);

  let participantId;
  if (existing.rows?.length) {
    participantId = num(existing.rows[0][0]);
    await c.execute(
      `UPDATE HR_TRAINING_PARTICIPANT SET STATUS = 'BOOKED', REQUEST_ID = :rid, UPDATED_BY = :actor, UPDATED_AT = SYSDATE
        WHERE PARTICIPANT_ID = :pid`,
      { rid: requestId, actor, pid: participantId },
    );
  } else {
    participantId = await nextId(c, "HR_TRAINING_PARTICIPANT_SEQ");
    await c.execute(
      `INSERT INTO HR_TRAINING_PARTICIPANT (PARTICIPANT_ID, SESSION_ID, COMPC, EMPCODE, REQUEST_ID, STATUS, CREATED_BY)
       VALUES (:pid, :sid, :compc, :e, :rid, 'BOOKED', :actor)`,
      { pid: participantId, sid: sessionId, compc, e: empcode, rid: requestId, actor },
    );
  }
  await writeLog(c, { compc, entity: "PARTICIPANT", entityId: participantId, action: "BOOK", details: { session_id: sessionId, empcode, request_id: requestId }, actor });
  return participantId;
};

/** HR direct assignment (no request / approval), e.g. compliance training. */
export const addParticipants = (compc, actor, sessionId, empcodes) => withTx(async (c) => {
  const added = [];
  const skipped = [];
  for (const e of [...new Set(empcodes.map(s).filter(Boolean))]) {
    // Each booking in its own savepoint-like try: one bad employee must not
    // lose the others. Capacity is re-read (FOR UPDATE) on every call.
    try {
      await bookParticipant(c, { compc, sessionId, empcode: e, actor });
      // An open approved request for this course is fulfilled by the booking.
      await c.execute(
        `UPDATE HR_TRAINING_REQUEST r SET STATUS = 'BOOKED', SESSION_ID = :sid, UPDATED_BY = :actor, UPDATED_AT = SYSDATE
          WHERE r.EMPCODE = :e AND r.COMPC = :compc AND r.STATUS = 'APPROVED'
            AND r.COURSE_ID = (SELECT COURSE_ID FROM HR_TRAINING_SESSION WHERE SESSION_ID = :sid)`,
        { sid: sessionId, actor, e, compc },
      );
      added.push(e);
    } catch (err) {
      if (!(err instanceof TrainingError)) throw err;
      skipped.push({ empcode: e, reason: err.message });
    }
  }
  return { added, skipped };
});

export const withdrawParticipant = (compc, actor, sessionId, participantId, remarks) => withTx(async (c) => {
  const r = await c.execute(
    `SELECT p.STATUS, p.REQUEST_ID, p.EMPCODE, x.STATUS FROM HR_TRAINING_PARTICIPANT p
       JOIN HR_TRAINING_SESSION x ON x.SESSION_ID = p.SESSION_ID
      WHERE p.PARTICIPANT_ID = :pid AND p.SESSION_ID = :sid AND x.COMPC = :compc`,
    { pid: participantId, sid: sessionId, compc }, { outFormat: OUT_ARRAY },
  );
  if (!r.rows?.length) throw new TrainingError("Participant not found", 404);
  const [pStatus, requestId, empcode, sStatus] = r.rows[0];
  if (s(pStatus) !== "BOOKED") throw new TrainingError(`Participant is already ${s(pStatus).toLowerCase()}`);
  if (s(sStatus) === "COMPLETED") throw new TrainingError("Session is completed");
  await c.execute(
    `UPDATE HR_TRAINING_PARTICIPANT SET STATUS = 'WITHDRAWN', UPDATED_BY = :actor, UPDATED_AT = SYSDATE WHERE PARTICIPANT_ID = :pid`,
    { actor, pid: participantId },
  );
  if (requestId) {
    await c.execute(
      `UPDATE HR_TRAINING_REQUEST SET STATUS = 'APPROVED', SESSION_ID = NULL, UPDATED_BY = :actor, UPDATED_AT = SYSDATE
        WHERE REQUEST_ID = :rid AND STATUS = 'BOOKED'`,
      { actor, rid: requestId },
    );
  }
  await writeLog(c, { compc, entity: "PARTICIPANT", entityId: participantId, action: "WITHDRAW", details: { empcode: s(empcode), remarks }, actor });
  return { withdrawn: true };
});

export const grantRetest = (compc, actor, sessionId, participantId) => withTx(async (c) => {
  const r = await c.execute(
    `UPDATE HR_TRAINING_PARTICIPANT SET RETEST_ALLOWED = RETEST_ALLOWED + 1, UPDATED_BY = :actor, UPDATED_AT = SYSDATE
      WHERE PARTICIPANT_ID = :pid AND SESSION_ID = :sid AND COMPC = :compc AND STATUS <> 'WITHDRAWN'`,
    { actor, pid: participantId, sid: sessionId, compc },
  );
  if (!r.rowsAffected) throw new TrainingError("Participant not found", 404);
  await writeLog(c, { compc, entity: "PARTICIPANT", entityId: participantId, action: "GRANT_RETEST", actor });
  return { granted: true };
});

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

const recomputeAttendance = async (c, sessionId) => {
  const days = await c.execute(
    `SELECT COUNT(DISTINCT a.SESSION_DATE) FROM HR_TRAINING_ATTENDANCE a
       JOIN HR_TRAINING_PARTICIPANT p ON p.PARTICIPANT_ID = a.PARTICIPANT_ID WHERE p.SESSION_ID = :sid`,
    { sid: sessionId }, { outFormat: OUT_ARRAY },
  );
  const total = num(days.rows[0][0]);
  const present = await c.execute(
    `SELECT p.PARTICIPANT_ID,
            (SELECT COUNT(*) FROM HR_TRAINING_ATTENDANCE a WHERE a.PARTICIPANT_ID = p.PARTICIPANT_ID AND a.STATUS IN ('P','L'))
       FROM HR_TRAINING_PARTICIPANT p WHERE p.SESSION_ID = :sid`,
    { sid: sessionId }, { outFormat: OUT_ARRAY },
  );
  for (const [pid, n] of present.rows ?? []) {
    await c.execute(`UPDATE HR_TRAINING_PARTICIPANT SET ATTEND_PCT = :pct WHERE PARTICIPANT_ID = :pid`,
      { pct: total ? r2((100 * num(n)) / total) : null, pid });
  }
};

export const saveAttendance = (compc, actor, sessionId, { date, rows }) => withTx(async (c) => {
  const session = await loadSession(c, compc, sessionId);
  if (session.status === "CANCELLED") throw new TrainingError("Session is cancelled");
  if (date < session.start_date || date > session.end_date) {
    throw new TrainingError(`Date must be within the session (${session.start_date} to ${session.end_date})`);
  }
  const valid = await c.execute(
    `SELECT PARTICIPANT_ID FROM HR_TRAINING_PARTICIPANT WHERE SESSION_ID = :sid AND STATUS <> 'WITHDRAWN'`,
    { sid: sessionId }, { outFormat: OUT_ARRAY },
  );
  const ids = new Set((valid.rows ?? []).map((x) => num(x[0])));
  let saved = 0;
  for (const row of rows) {
    if (!ids.has(row.participant_id)) continue;
    await c.execute(
      `MERGE INTO HR_TRAINING_ATTENDANCE a
       USING (SELECT :pid PID, TO_DATE(:d, 'YYYY-MM-DD') D FROM DUAL) src
          ON (a.PARTICIPANT_ID = src.PID AND a.SESSION_DATE = src.D)
        WHEN MATCHED THEN UPDATE SET a.STATUS = :st, a.HOURS = :hrs, a.UPDATED_BY = :actor, a.UPDATED_AT = SYSDATE
        WHEN NOT MATCHED THEN INSERT (PARTICIPANT_ID, SESSION_DATE, STATUS, HOURS, UPDATED_BY)
             VALUES (src.PID, src.D, :st, :hrs, :actor)`,
      { pid: row.participant_id, d: date, st: row.status, hrs: row.hours ?? null, actor },
    );
    saved++;
  }
  await recomputeAttendance(c, sessionId);
  // Taking attendance means the training has started.
  if (["PLANNED", "OPEN"].includes(session.status)) {
    await c.execute(`UPDATE HR_TRAINING_SESSION SET STATUS = 'IN_PROGRESS', UPDATED_BY = :actor, UPDATED_AT = SYSDATE WHERE SESSION_ID = :sid`,
      { actor, sid: sessionId });
  }
  return { saved };
});

// ---------------------------------------------------------------------------
// Completion — evaluate every participant and issue certificates
// ---------------------------------------------------------------------------

const nextCertNo = async (c, compc) => {
  const year = new Date().getFullYear();
  const prefix = `CERT-${compc}-${year}-`;
  const r = await c.execute(
    `SELECT NVL(MAX(TO_NUMBER(SUBSTR(CERT_NO, :len + 1))), 0) + 1 FROM HR_TRAINING_PARTICIPANT
      WHERE CERT_NO LIKE :p || '%' AND REGEXP_LIKE(SUBSTR(CERT_NO, :len + 1), '^[0-9]+$')`,
    { len: prefix.length, p: prefix }, { outFormat: OUT_ARRAY },
  );
  return `${prefix}${String(num(r.rows[0][0])).padStart(5, "0")}`;
};

const nextTrainerCertNo = async (c, compc) => {
  const prefix = `TCERT-${compc}-${new Date().getFullYear()}-`;
  const r = await c.execute(
    `SELECT NVL(MAX(TO_NUMBER(SUBSTR(TRAINER_CERT_NO, :len + 1))), 0) + 1 FROM HR_TRAINING_SESSION
      WHERE TRAINER_CERT_NO LIKE :p || '%' AND REGEXP_LIKE(SUBSTR(TRAINER_CERT_NO, :len + 1), '^[0-9]+$')`,
    { len: prefix.length, p: prefix }, { outFormat: OUT_ARRAY },
  );
  return `${prefix}${String(num(r.rows[0][0])).padStart(5, "0")}`;
};

/**
 * Evaluates each booked participant (and re-evaluates FAILED ones, so a passed
 * retest counts). Issued certificates are never revoked. Safe to run again on a
 * completed session.
 */
export const completeSession = (compc, actor, sessionId) => withTx(async (c) => {
  const session = await loadSession(c, compc, sessionId);
  if (!["IN_PROGRESS", "OPEN", "COMPLETED"].includes(session.status)) {
    throw new TrainingError(`A ${session.status.toLowerCase()} session cannot be completed`);
  }
  await recomputeAttendance(c, sessionId);
  const daysTaken = await c.execute(
    `SELECT COUNT(DISTINCT a.SESSION_DATE) FROM HR_TRAINING_ATTENDANCE a
       JOIN HR_TRAINING_PARTICIPANT p ON p.PARTICIPANT_ID = a.PARTICIPANT_ID WHERE p.SESSION_ID = :sid`,
    { sid: sessionId }, { outFormat: OUT_ARRAY },
  );
  if (!num(daysTaken.rows[0][0])) throw new TrainingError("Mark attendance for at least one day before completing the session");

  const post = await c.execute(
    `SELECT t.TEST_ID, NVL(t.PASS_PCT, c.PASS_PCT) FROM HR_TRAINING_TEST t JOIN HR_TRAINING_COURSE c ON c.COURSE_ID = t.COURSE_ID
      WHERE t.COURSE_ID = :cid AND t.TEST_KIND = 'POST' AND t.IS_ACTIVE = 'Y'
        AND EXISTS (SELECT 1 FROM HR_TRAINING_QUESTION q WHERE q.TEST_ID = t.TEST_ID AND q.IS_ACTIVE = 'Y')`,
    { cid: session.course_id }, { outFormat: OUT_ARRAY },
  );
  const hasPost = !!post.rows?.length;
  const passPct = hasPost ? num(post.rows[0][1]) : session.pass_pct;

  const people = await c.execute(
    `SELECT PARTICIPANT_ID, STATUS, ATTEND_PCT, POST_SCORE_PCT, CERT_NO, REQUEST_ID FROM HR_TRAINING_PARTICIPANT
      WHERE SESSION_ID = :sid AND STATUS IN ('BOOKED','FAILED','NO_SHOW','COMPLETED')`,
    { sid: sessionId }, { outFormat: OUT_ARRAY },
  );
  const summary = { completed: 0, failed: 0, no_show: 0, certificates: 0 };
  for (const [pid, prevStatus, attendRaw, postRaw, certNo, requestId] of people.rows ?? []) {
    const attend = num(attendRaw);
    const attendOk = attend >= session.min_attend_pct;
    const scoreOk = !hasPost || (postRaw !== null && num(postRaw) >= passPct);
    let status;
    if (s(prevStatus) === "COMPLETED") status = "COMPLETED"; // never downgrade
    else if (attend === 0) status = "NO_SHOW";
    else status = attendOk && scoreOk ? "COMPLETED" : "FAILED";

    let cert = s(certNo) || null;
    if (status === "COMPLETED" && session.cert_required && !cert) {
      cert = await nextCertNo(c, compc);
      summary.certificates++;
    }
    await c.execute(
      `UPDATE HR_TRAINING_PARTICIPANT SET STATUS = :st, PASSED = :passed, CERT_NO = :cert,
              CERT_ISSUED_AT = CASE WHEN :cert IS NOT NULL AND CERT_ISSUED_AT IS NULL THEN SYSDATE ELSE CERT_ISSUED_AT END,
              UPDATED_BY = :actor, UPDATED_AT = SYSDATE
        WHERE PARTICIPANT_ID = :pid`,
      { st: status, passed: status === "COMPLETED" ? "Y" : "N", cert, actor, pid },
    );
    if (requestId && status === "COMPLETED") {
      await c.execute(`UPDATE HR_TRAINING_REQUEST SET STATUS = 'COMPLETED', UPDATED_BY = :actor, UPDATED_AT = SYSDATE
                        WHERE REQUEST_ID = :rid AND STATUS = 'BOOKED'`, { actor, rid: requestId });
    }
    summary[status === "COMPLETED" ? "completed" : status === "FAILED" ? "failed" : "no_show"]++;
  }
  // The trainer gets a certificate of appreciation for conducting the session.
  let trainerCert = session.trainer_cert_no;
  if (session.trainer_id && !trainerCert) {
    trainerCert = await nextTrainerCertNo(c, compc);
    summary.trainer_certificate = trainerCert;
  }
  await c.execute(
    `UPDATE HR_TRAINING_SESSION SET STATUS = 'COMPLETED', COMPLETED_AT = NVL(COMPLETED_AT, SYSDATE),
            TRAINER_CERT_NO = :tc, TRAINER_CERT_AT = CASE WHEN :tc IS NOT NULL AND TRAINER_CERT_AT IS NULL THEN SYSDATE ELSE TRAINER_CERT_AT END,
            UPDATED_BY = :actor, UPDATED_AT = SYSDATE
      WHERE SESSION_ID = :sid`,
    { actor, sid: sessionId, tc: trainerCert },
  );
  await writeLog(c, { compc, entity: "SESSION", entityId: sessionId, action: "COMPLETE", details: summary, actor });
  return summary;
}, {
  HR_TRAINING_CERT_UK: "Certificate number clash — please run Complete again",
  HR_TRAINING_TRAINER_CERT_UK: "Certificate number clash — please run Complete again",
});

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

/** HR / trainer / manager feedback on a session (any number per session). */
export const addSessionFeedback = (compc, actor, sessionId, body) => withTx(async (c) => {
  await loadSession(c, compc, sessionId);
  const id = await nextId(c, "HR_TRAINING_FEEDBACK_SEQ");
  await c.execute(
    `INSERT INTO HR_TRAINING_FEEDBACK (FEEDBACK_ID, SESSION_ID, PARTICIPANT_ID, GIVEN_BY_TYPE, GIVEN_BY,
            RATING_CONTENT, RATING_TRAINER, RATING_OVERALL, COMMENTS)
     VALUES (:id, :sid, NULL, :type, :giver, :rc, :rt, :ro, :cm)`,
    {
      id, sid: sessionId, type: body.given_by_type, giver: actor,
      rc: body.rating_content ?? null, rt: body.rating_trainer ?? null, ro: body.rating_overall, cm: s(body.comments) || null,
    },
  );
  return { feedback_id: id };
});

// ---------------------------------------------------------------------------
// Employee — own trainings
// ---------------------------------------------------------------------------

export const listMyTrainings = (empcode) => read(async (c) => {
  const r = await c.execute(
    `SELECT p.PARTICIPANT_ID, p.STATUS, p.ATTEND_PCT, p.PRE_SCORE_PCT, p.POST_SCORE_PCT, p.PASSED, p.CERT_NO, p.CERT_ISSUED_AT,
            p.RETEST_ALLOWED, x.SESSION_ID, x.SESSION_CODE, x.STATUS, x.MODE_TYPE, x.VENUE, x.ONLINE_LINK,
            x.START_DATE, x.END_DATE, x.TIME_FROM, x.TIME_TO, x.TOTAL_HOURS, t.COURSE_ID, t.COURSE_CODE, t.TITLE,
            t.TRAINING_TYPE, tr.NAME,
            (SELECT MAX(q.TEST_ID) FROM HR_TRAINING_TEST q WHERE q.COURSE_ID = t.COURSE_ID AND q.TEST_KIND = 'PRE' AND q.IS_ACTIVE = 'Y'
                AND EXISTS (SELECT 1 FROM HR_TRAINING_QUESTION z WHERE z.TEST_ID = q.TEST_ID AND z.IS_ACTIVE = 'Y')),
            (SELECT MAX(q.TEST_ID) FROM HR_TRAINING_TEST q WHERE q.COURSE_ID = t.COURSE_ID AND q.TEST_KIND = 'POST' AND q.IS_ACTIVE = 'Y'
                AND EXISTS (SELECT 1 FROM HR_TRAINING_QUESTION z WHERE z.TEST_ID = q.TEST_ID AND z.IS_ACTIVE = 'Y')),
            (SELECT COUNT(*) FROM HR_TRAINING_ATTEMPT a JOIN HR_TRAINING_TEST q ON q.TEST_ID = a.TEST_ID
              WHERE a.PARTICIPANT_ID = p.PARTICIPANT_ID AND q.TEST_KIND = 'PRE'),
            (SELECT COUNT(*) FROM HR_TRAINING_ATTEMPT a JOIN HR_TRAINING_TEST q ON q.TEST_ID = a.TEST_ID
              WHERE a.PARTICIPANT_ID = p.PARTICIPANT_ID AND q.TEST_KIND = 'POST'),
            (SELECT COUNT(*) FROM HR_TRAINING_FEEDBACK f WHERE f.PARTICIPANT_ID = p.PARTICIPANT_ID),
            (SELECT NVL(SUM(NVL(a.HOURS, 0)), 0) FROM HR_TRAINING_ATTENDANCE a WHERE a.PARTICIPANT_ID = p.PARTICIPANT_ID AND a.STATUS IN ('P','L')),
            t.PASS_PCT, t.MIN_ATTEND_PCT, t.CERT_REQUIRED, x.OUTLINE_TEXT, x.OUTLINE_FILE_NAME, x.OUTLINE_UPDATED_AT
       FROM HR_TRAINING_PARTICIPANT p
       JOIN HR_TRAINING_SESSION x ON x.SESSION_ID = p.SESSION_ID
       JOIN HR_TRAINING_COURSE t ON t.COURSE_ID = x.COURSE_ID
       LEFT JOIN HR_TRAINER tr ON tr.TRAINER_ID = x.TRAINER_ID
      WHERE p.EMPCODE = :e AND p.STATUS <> 'WITHDRAWN' AND x.STATUS <> 'CANCELLED'
      ORDER BY x.START_DATE DESC`,
    { e: s(empcode) }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => {
    const pStatus = s(x[1]);
    const sStatus = s(x[11]);
    const preTest = numOrNull(x[25]);
    const postTest = numOrNull(x[26]);
    const preUsed = num(x[27]);
    const postUsed = num(x[28]);
    const retest = num(x[8]);
    const active = pStatus !== "WITHDRAWN";
    return {
      participant_id: num(x[0]), status: pStatus, attend_pct: numOrNull(x[2]),
      pre_score_pct: numOrNull(x[3]), post_score_pct: numOrNull(x[4]), passed: x[5] === null ? null : s(x[5]) === "Y",
      cert_no: s(x[6]) || null, cert_issued_at: ymd(x[7]),
      session_id: num(x[9]), session_code: s(x[10]), session_status: sStatus, mode: s(x[12]), venue: s(x[13]),
      online_link: s(x[14]), start_date: ymd(x[15]), end_date: ymd(x[16]), time_from: s(x[17]), time_to: s(x[18]),
      total_hours: numOrNull(x[19]), course_id: num(x[20]), course_code: s(x[21]), course_title: s(x[22]),
      training_type: s(x[23]), trainer_name: s(x[24]),
      // Pre-test only before the evaluation is done; post-test once training has started.
      can_take_pre: active && !!preTest && preUsed === 0 && ["PLANNED", "OPEN", "IN_PROGRESS"].includes(sStatus),
      can_take_post: active && !!postTest && pStatus !== "COMPLETED" && postUsed < 1 + retest && ["IN_PROGRESS", "COMPLETED"].includes(sStatus),
      has_pre_test: !!preTest, has_post_test: !!postTest, post_attempts_left: postTest ? Math.max(1 + retest - postUsed, 0) : 0,
      can_give_feedback: active && num(x[29]) === 0 && ["IN_PROGRESS", "COMPLETED"].includes(sStatus),
      feedback_given: num(x[29]) > 0, hours_attended: r2(x[30]),
      pass_pct: num(x[31]), min_attend_pct: num(x[32]), cert_required: s(x[33]) === "Y",
      outline_text: s(x[34]), outline_file_name: s(x[35]) || null, outline_updated_at: ymdhm(x[36]),
    };
  });
});

/** Employee's own feedback for a session they attended (once). */
export const submitMyFeedback = (empcode, participantId, body) => withTx(async (c) => {
  const r = await c.execute(
    `SELECT p.SESSION_ID, x.STATUS, p.STATUS FROM HR_TRAINING_PARTICIPANT p JOIN HR_TRAINING_SESSION x ON x.SESSION_ID = p.SESSION_ID
      WHERE p.PARTICIPANT_ID = :pid AND p.EMPCODE = :e`,
    { pid: participantId, e: s(empcode) }, { outFormat: OUT_ARRAY },
  );
  if (!r.rows?.length) throw new TrainingError("Training not found", 404);
  const [sessionId, sStatus, pStatus] = r.rows[0];
  if (s(pStatus) === "WITHDRAWN") throw new TrainingError("You were withdrawn from this training");
  if (!["IN_PROGRESS", "COMPLETED"].includes(s(sStatus))) throw new TrainingError("Feedback opens once the training has started");
  const id = await nextId(c, "HR_TRAINING_FEEDBACK_SEQ");
  await c.execute(
    `INSERT INTO HR_TRAINING_FEEDBACK (FEEDBACK_ID, SESSION_ID, PARTICIPANT_ID, GIVEN_BY_TYPE, GIVEN_BY,
            RATING_CONTENT, RATING_TRAINER, RATING_OVERALL, COMMENTS)
     VALUES (:id, :sid, :pid, 'EMPLOYEE', :giver, :rc, :rt, :ro, :cm)`,
    {
      id, sid: num(sessionId), pid: participantId, giver: s(empcode),
      rc: body.rating_content ?? null, rt: body.rating_trainer ?? null, ro: body.rating_overall, cm: s(body.comments) || null,
    },
  );
  return { feedback_id: id };
}, { HR_TRAINING_FEEDBACK_UK: "You have already given feedback for this training" });
