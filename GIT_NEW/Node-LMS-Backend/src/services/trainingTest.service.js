/**
 * Online MCQ assessment.
 *
 * HR keeps one PRE and one POST test per course, each with its own question
 * bank. An employee booked into a session of that course takes them on the web:
 *   - PRE: once, while the session has not finished.
 *   - POST: once after training starts, plus any retests HR grants.
 *
 * Integrity: correct answers never leave the server — questions go out without
 * CORRECT_OPT, and scoring happens at submit. The time limit is enforced from
 * the attempt's DEADLINE_AT (server clock); answers submitted after the
 * deadline plus a short grace are discarded, and an attempt that was started
 * but never submitted is closed with the answers it has (none) once its
 * deadline passes, so abandoning a test does not buy a fresh attempt.
 */

import { getDirectConnection } from "../config/database.js";
import {
  OUT_ARRAY, s, num, numOrNull, r2, ymdhm, TrainingError, nextId, writeLog, withTx, mapOraError,
} from "./trainingShared.service.js";

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

const GRACE_SECONDS = 60;
const OPTS = ["A", "B", "C", "D"];

// ---------------------------------------------------------------------------
// HR — test + question bank
// ---------------------------------------------------------------------------

const courseInCompany = async (c, compc, courseId) => {
  const r = await c.execute(`SELECT TITLE, PASS_PCT FROM HR_TRAINING_COURSE WHERE COURSE_ID = :id AND COMPC = :compc`,
    { id: courseId, compc }, { outFormat: OUT_ARRAY });
  if (!r.rows?.length) throw new TrainingError("Course not found", 404);
  return { title: s(r.rows[0][0]), pass_pct: num(r.rows[0][1]) };
};

export const getCourseTests = (compc, courseId) => read(async (c) => {
  const course = await courseInCompany(c, compc, courseId);
  const t = await c.execute(
    `SELECT TEST_ID, TEST_KIND, TITLE, TIME_LIMIT_MIN, PASS_PCT, SHUFFLE, IS_ACTIVE,
            (SELECT COUNT(*) FROM HR_TRAINING_ATTEMPT a WHERE a.TEST_ID = t.TEST_ID)
       FROM HR_TRAINING_TEST t WHERE COURSE_ID = :cid`,
    { cid: courseId }, { outFormat: OUT_ARRAY },
  );
  const tests = {};
  for (const x of t.rows ?? []) {
    const q = await c.execute(
      `SELECT QUESTION_ID, SEQ, QUESTION_TEXT, OPT_A, OPT_B, OPT_C, OPT_D, CORRECT_OPT, MARKS, IS_ACTIVE
         FROM HR_TRAINING_QUESTION WHERE TEST_ID = :tid ORDER BY SEQ, QUESTION_ID`,
      { tid: num(x[0]) }, { outFormat: OUT_ARRAY },
    );
    const questions = (q.rows ?? []).map((y) => ({
      question_id: num(y[0]), seq: num(y[1]), question_text: s(y[2]),
      opt_a: s(y[3]), opt_b: s(y[4]), opt_c: s(y[5]) || null, opt_d: s(y[6]) || null,
      correct_opt: s(y[7]), marks: num(y[8]), is_active: s(y[9]) === "Y",
    }));
    tests[s(x[1])] = {
      test_id: num(x[0]), test_kind: s(x[1]), title: s(x[2]), time_limit_min: num(x[3]),
      pass_pct: numOrNull(x[4]), effective_pass_pct: x[4] === null ? course.pass_pct : num(x[4]),
      shuffle: s(x[5]) === "Y", is_active: s(x[6]) === "Y", attempts: num(x[7]),
      questions, total_marks: r2(questions.filter((qq) => qq.is_active).reduce((a, qq) => a + qq.marks, 0)),
    };
  }
  return { course_id: courseId, course_title: course.title, course_pass_pct: course.pass_pct, pre: tests.PRE ?? null, post: tests.POST ?? null };
});

export const saveTest = (compc, actor, courseId, kind, body) => withTx(async (c) => {
  const course = await courseInCompany(c, compc, courseId);
  const binds = {
    title: s(body.title) || `${course.title} — ${kind === "PRE" ? "Pre" : "Post"}-training test`,
    lim: body.time_limit_min ?? 30, pass: body.pass_pct ?? null,
    sh: body.shuffle === false ? "N" : "Y", act: body.is_active === false ? "N" : "Y", actor,
  };
  const ex = await c.execute(`SELECT TEST_ID FROM HR_TRAINING_TEST WHERE COURSE_ID = :cid AND TEST_KIND = :k`,
    { cid: courseId, k: kind }, { outFormat: OUT_ARRAY });
  if (ex.rows?.length) {
    const id = num(ex.rows[0][0]);
    await c.execute(
      `UPDATE HR_TRAINING_TEST SET TITLE = :title, TIME_LIMIT_MIN = :lim, PASS_PCT = :pass, SHUFFLE = :sh, IS_ACTIVE = :act,
              UPDATED_BY = :actor, UPDATED_AT = SYSDATE WHERE TEST_ID = :id`,
      { ...binds, id },
    );
    return { test_id: id };
  }
  const id = await nextId(c, "HR_TRAINING_TEST_SEQ");
  await c.execute(
    `INSERT INTO HR_TRAINING_TEST (TEST_ID, COMPC, COURSE_ID, TEST_KIND, TITLE, TIME_LIMIT_MIN, PASS_PCT, SHUFFLE, IS_ACTIVE, CREATED_BY)
     VALUES (:id, :compc, :cid, :k, :title, :lim, :pass, :sh, :act, :actor)`,
    { ...binds, id, compc, cid: courseId, k: kind },
  );
  await writeLog(c, { compc, entity: "TEST", entityId: id, action: "CREATE", details: { course_id: courseId, kind }, actor });
  return { test_id: id };
});

const testInCompany = async (c, compc, testId) => {
  const r = await c.execute(`SELECT 1 FROM HR_TRAINING_TEST WHERE TEST_ID = :id AND COMPC = :compc`, { id: testId, compc }, { outFormat: OUT_ARRAY });
  if (!r.rows?.length) throw new TrainingError("Test not found", 404);
};

const checkOptions = (b) => {
  if (b.correct_opt === "C" && !s(b.opt_c)) throw new TrainingError("The correct option C is empty");
  if (b.correct_opt === "D" && !s(b.opt_d)) throw new TrainingError("The correct option D is empty");
  if (s(b.opt_d) && !s(b.opt_c)) throw new TrainingError("Fill option C before option D");
};

export const saveQuestion = (compc, testId, questionId, body) => withTx(async (c) => {
  await testInCompany(c, compc, testId);
  checkOptions(body);
  const binds = {
    q: s(body.question_text), a: s(body.opt_a), b: s(body.opt_b), cc: s(body.opt_c) || null, d: s(body.opt_d) || null,
    ok: body.correct_opt, marks: body.marks ?? 1, act: body.is_active === false ? "N" : "Y",
  };
  if (questionId) {
    // Editing a question that has already been answered would re-mark history;
    // HR must retire it and add a new one instead.
    const used = await c.execute(`SELECT COUNT(*) FROM HR_TRAINING_ANSWER WHERE QUESTION_ID = :id`, { id: questionId }, { outFormat: OUT_ARRAY });
    const cur = await c.execute(
      `SELECT QUESTION_TEXT, OPT_A, OPT_B, OPT_C, OPT_D, CORRECT_OPT, MARKS FROM HR_TRAINING_QUESTION WHERE QUESTION_ID = :id AND TEST_ID = :tid`,
      { id: questionId, tid: testId }, { outFormat: OUT_ARRAY },
    );
    if (!cur.rows?.length) throw new TrainingError("Question not found", 404);
    const [q, a, b, cc, d, ok, marks] = cur.rows[0];
    const contentChanged = s(q) !== binds.q || s(a) !== binds.a || s(b) !== binds.b || (s(cc) || null) !== binds.cc
      || (s(d) || null) !== binds.d || s(ok) !== binds.ok || num(marks) !== num(binds.marks);
    if (num(used.rows[0][0]) > 0 && contentChanged) {
      throw new TrainingError("This question has already been answered in a test. Deactivate it and add a new one instead.", 409);
    }
    await c.execute(
      `UPDATE HR_TRAINING_QUESTION SET QUESTION_TEXT = :q, OPT_A = :a, OPT_B = :b, OPT_C = :cc, OPT_D = :d,
              CORRECT_OPT = :ok, MARKS = :marks, IS_ACTIVE = :act WHERE QUESTION_ID = :id AND TEST_ID = :tid`,
      { ...binds, id: questionId, tid: testId },
    );
    return { question_id: questionId };
  }
  const id = await nextId(c, "HR_TRAINING_QUESTION_SEQ");
  const seq = await c.execute(`SELECT NVL(MAX(SEQ), 0) + 1 FROM HR_TRAINING_QUESTION WHERE TEST_ID = :tid`, { tid: testId }, { outFormat: OUT_ARRAY });
  await c.execute(
    `INSERT INTO HR_TRAINING_QUESTION (QUESTION_ID, TEST_ID, SEQ, QUESTION_TEXT, OPT_A, OPT_B, OPT_C, OPT_D, CORRECT_OPT, MARKS, IS_ACTIVE)
     VALUES (:id, :tid, :seq, :q, :a, :b, :cc, :d, :ok, :marks, :act)`,
    { ...binds, id, tid: testId, seq: num(seq.rows[0][0]) },
  );
  return { question_id: id };
});

export const deleteQuestion = (compc, testId, questionId) => withTx(async (c) => {
  await testInCompany(c, compc, testId);
  const used = await c.execute(`SELECT COUNT(*) FROM HR_TRAINING_ANSWER WHERE QUESTION_ID = :id`, { id: questionId }, { outFormat: OUT_ARRAY });
  if (num(used.rows[0][0]) > 0) {
    await c.execute(`UPDATE HR_TRAINING_QUESTION SET IS_ACTIVE = 'N' WHERE QUESTION_ID = :id AND TEST_ID = :tid`, { id: questionId, tid: testId });
    return { deleted: false, deactivated: true };
  }
  const r = await c.execute(`DELETE FROM HR_TRAINING_QUESTION WHERE QUESTION_ID = :id AND TEST_ID = :tid`, { id: questionId, tid: testId });
  if (!r.rowsAffected) throw new TrainingError("Question not found", 404);
  return { deleted: true };
});

// ---------------------------------------------------------------------------
// Employee — take a test
// ---------------------------------------------------------------------------

/** Deterministic shuffle so a resumed attempt shows the same order. */
const seededShuffle = (arr, seed) => {
  const out = [...arr];
  let x = (seed * 9301 + 49297) % 233280;
  for (let i = out.length - 1; i > 0; i--) {
    x = (x * 9301 + 49297) % 233280;
    const j = Math.floor((x / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const loadParticipantTest = async (c, empcode, participantId, kind) => {
  const r = await c.execute(
    `SELECT p.STATUS, p.RETEST_ALLOWED, x.STATUS, t.TEST_ID, t.TITLE, t.TIME_LIMIT_MIN, NVL(t.PASS_PCT, co.PASS_PCT), t.SHUFFLE,
            co.TITLE, p.COMPC
       FROM HR_TRAINING_PARTICIPANT p
       JOIN HR_TRAINING_SESSION x ON x.SESSION_ID = p.SESSION_ID
       JOIN HR_TRAINING_COURSE co ON co.COURSE_ID = x.COURSE_ID
       LEFT JOIN HR_TRAINING_TEST t ON t.COURSE_ID = co.COURSE_ID AND t.TEST_KIND = :k AND t.IS_ACTIVE = 'Y'
      WHERE p.PARTICIPANT_ID = :pid AND p.EMPCODE = :e`,
    { pid: participantId, e: s(empcode), k: kind }, { outFormat: OUT_ARRAY },
  );
  if (!r.rows?.length) throw new TrainingError("Training not found", 404);
  const [pStatus, retest, sStatus, testId, title, limit, passPct, shuffle, courseTitle, compc] = r.rows[0];
  if (!testId) throw new TrainingError(`This training has no ${kind === "PRE" ? "pre" : "post"}-test`, 404);
  return {
    pStatus: s(pStatus), retest: num(retest), sStatus: s(sStatus), testId: num(testId), title: s(title),
    limit: num(limit), passPct: num(passPct), shuffle: s(shuffle) === "Y", courseTitle: s(courseTitle), compc: num(compc),
  };
};

const activeQuestions = async (c, testId) => {
  const q = await c.execute(
    `SELECT QUESTION_ID, QUESTION_TEXT, OPT_A, OPT_B, OPT_C, OPT_D, CORRECT_OPT, MARKS
       FROM HR_TRAINING_QUESTION WHERE TEST_ID = :tid AND IS_ACTIVE = 'Y' ORDER BY SEQ, QUESTION_ID`,
    { tid: testId }, { outFormat: OUT_ARRAY },
  );
  return (q.rows ?? []).map((y) => ({
    question_id: num(y[0]), question_text: s(y[1]),
    options: [["A", y[2]], ["B", y[3]], ["C", y[4]], ["D", y[5]]].filter(([, v]) => s(v)).map(([k, v]) => ({ key: k, text: s(v) })),
    correct: s(y[6]), marks: num(y[7]),
  }));
};

/** Score and close an attempt. `answers` = { [question_id]: 'A'..'D' }. */
const finalize = async (c, attemptId, testId, participantId, kind, passPct, answers) => {
  const questions = await activeQuestions(c, testId);
  let score = 0;
  let total = 0;
  for (const q of questions) {
    total += q.marks;
    const sel = OPTS.includes(answers[q.question_id]) ? answers[q.question_id] : null;
    const ok = sel !== null && sel === q.correct;
    if (ok) score += q.marks;
    await c.execute(
      `INSERT INTO HR_TRAINING_ANSWER (ATTEMPT_ID, QUESTION_ID, SELECTED_OPT, IS_CORRECT) VALUES (:a, :q, :sel, :ok)`,
      { a: attemptId, q: q.question_id, sel, ok: ok ? "Y" : "N" },
    );
  }
  const pct = total ? r2((100 * score) / total) : 0;
  const passed = pct >= passPct;
  await c.execute(
    `UPDATE HR_TRAINING_ATTEMPT SET SUBMITTED_AT = LEAST(SYSDATE, DEADLINE_AT + :g / 86400), SCORE = :sc, TOTAL = :tot,
            PCT = :pct, PASSED = :pa WHERE ATTEMPT_ID = :a`,
    { g: GRACE_SECONDS, sc: r2(score), tot: r2(total), pct, pa: passed ? "Y" : "N", a: attemptId },
  );
  // PRE keeps its one score; POST keeps the best attempt.
  if (kind === "PRE") {
    await c.execute(`UPDATE HR_TRAINING_PARTICIPANT SET PRE_SCORE_PCT = :pct WHERE PARTICIPANT_ID = :p`, { pct, p: participantId });
  } else {
    await c.execute(
      `UPDATE HR_TRAINING_PARTICIPANT SET POST_SCORE_PCT = GREATEST(NVL(POST_SCORE_PCT, 0), :pct) WHERE PARTICIPANT_ID = :p`,
      { pct, p: participantId },
    );
  }
  return { score: r2(score), total: r2(total), pct, passed, pass_pct: passPct };
};

/** Close any of this participant's attempts whose time ran out without a submit. */
const closeExpired = async (c, participantId, testId, kind, passPct) => {
  const r = await c.execute(
    `SELECT ATTEMPT_ID FROM HR_TRAINING_ATTEMPT
      WHERE PARTICIPANT_ID = :p AND TEST_ID = :t AND SUBMITTED_AT IS NULL AND SYSDATE > DEADLINE_AT + :g / 86400`,
    { p: participantId, t: testId, g: GRACE_SECONDS }, { outFormat: OUT_ARRAY },
  );
  for (const [aid] of r.rows ?? []) await finalize(c, num(aid), testId, participantId, kind, passPct, {});
};

/**
 * Start (or resume) an attempt. Returns the questions without answers and the
 * server deadline.
 */
export const startAttempt = (empcode, participantId, kind) => withTx(async (c) => {
  const t = await loadParticipantTest(c, empcode, participantId, kind);
  if (t.pStatus === "WITHDRAWN") throw new TrainingError("You were withdrawn from this training");
  if (kind === "PRE" && !["PLANNED", "OPEN", "IN_PROGRESS"].includes(t.sStatus)) throw new TrainingError("The pre-test is closed for this training");
  if (kind === "POST" && !["IN_PROGRESS", "COMPLETED"].includes(t.sStatus)) throw new TrainingError("The post-test opens once the training has started");
  if (kind === "POST" && t.pStatus === "COMPLETED") throw new TrainingError("You have already passed this training");

  // Serialise per participant so a double-click can't open two attempts.
  await c.execute(`SELECT 1 FROM HR_TRAINING_PARTICIPANT WHERE PARTICIPANT_ID = :p FOR UPDATE`, { p: participantId });
  await closeExpired(c, participantId, t.testId, kind, t.passPct);

  const questions = await activeQuestions(c, t.testId);
  if (!questions.length) throw new TrainingError("This test has no questions yet");

  const open = await c.execute(
    `SELECT ATTEMPT_ID, DEADLINE_AT, STARTED_AT FROM HR_TRAINING_ATTEMPT
      WHERE PARTICIPANT_ID = :p AND TEST_ID = :t AND SUBMITTED_AT IS NULL`,
    { p: participantId, t: t.testId }, { outFormat: OUT_ARRAY },
  );
  let attemptId;
  let deadline;
  if (open.rows?.length) {
    attemptId = num(open.rows[0][0]);
    deadline = open.rows[0][1];
  } else {
    const used = await c.execute(`SELECT COUNT(*) FROM HR_TRAINING_ATTEMPT WHERE PARTICIPANT_ID = :p AND TEST_ID = :t`,
      { p: participantId, t: t.testId }, { outFormat: OUT_ARRAY });
    const allowed = kind === "PRE" ? 1 : 1 + t.retest;
    if (num(used.rows[0][0]) >= allowed) throw new TrainingError("You have used all your attempts for this test");
    attemptId = await nextId(c, "HR_TRAINING_ATTEMPT_SEQ");
    await c.execute(
      `INSERT INTO HR_TRAINING_ATTEMPT (ATTEMPT_ID, TEST_ID, PARTICIPANT_ID, STARTED_AT, DEADLINE_AT)
       VALUES (:a, :t, :p, SYSDATE, SYSDATE + :lim / 1440)`,
      { a: attemptId, t: t.testId, p: participantId, lim: t.limit },
    );
    const d = await c.execute(`SELECT DEADLINE_AT FROM HR_TRAINING_ATTEMPT WHERE ATTEMPT_ID = :a`, { a: attemptId }, { outFormat: OUT_ARRAY });
    deadline = d.rows[0][0];
  }
  const now = await c.execute(`SELECT SYSDATE FROM DUAL`, {}, { outFormat: OUT_ARRAY });
  const secondsLeft = Math.max(0, Math.round((new Date(deadline).getTime() - new Date(now.rows[0][0]).getTime()) / 1000));
  const ordered = t.shuffle ? seededShuffle(questions, attemptId) : questions;
  return {
    attempt_id: attemptId, test_kind: kind, title: t.title, course_title: t.courseTitle,
    time_limit_min: t.limit, pass_pct: t.passPct, seconds_left: secondsLeft, deadline_at: ymdhm(deadline),
    questions: ordered.map(({ correct, ...q }) => q),
  };
});

export const submitAttempt = (empcode, attemptId, answers) => withTx(async (c) => {
  const r = await c.execute(
    `SELECT a.TEST_ID, a.PARTICIPANT_ID, a.SUBMITTED_AT, t.TEST_KIND, NVL(t.PASS_PCT, co.PASS_PCT),
            CASE WHEN SYSDATE > a.DEADLINE_AT + :g / 86400 THEN 'Y' ELSE 'N' END
       FROM HR_TRAINING_ATTEMPT a
       JOIN HR_TRAINING_PARTICIPANT p ON p.PARTICIPANT_ID = a.PARTICIPANT_ID
       JOIN HR_TRAINING_TEST t ON t.TEST_ID = a.TEST_ID
       JOIN HR_TRAINING_COURSE co ON co.COURSE_ID = t.COURSE_ID
      WHERE a.ATTEMPT_ID = :a AND p.EMPCODE = :e
      FOR UPDATE OF a.SUBMITTED_AT`,
    { a: attemptId, e: s(empcode), g: GRACE_SECONDS }, { outFormat: OUT_ARRAY },
  );
  if (!r.rows?.length) throw new TrainingError("Attempt not found", 404);
  const [testId, participantId, submittedAt, kind, passPct, late] = r.rows[0];
  if (submittedAt) throw new TrainingError("This attempt has already been submitted", 409);
  const result = await finalize(c, attemptId, num(testId), num(participantId), s(kind), num(passPct), s(late) === "Y" ? {} : (answers || {}));
  return { ...result, late: s(late) === "Y" };
});

/** Attempts of one participant (HR view). */
export const participantAttempts = (compc, participantId) => read(async (c) => {
  const r = await c.execute(
    `SELECT a.ATTEMPT_ID, t.TEST_KIND, a.STARTED_AT, a.SUBMITTED_AT, a.SCORE, a.TOTAL, a.PCT, a.PASSED
       FROM HR_TRAINING_ATTEMPT a
       JOIN HR_TRAINING_TEST t ON t.TEST_ID = a.TEST_ID
       JOIN HR_TRAINING_PARTICIPANT p ON p.PARTICIPANT_ID = a.PARTICIPANT_ID
      WHERE a.PARTICIPANT_ID = :p AND p.COMPC = :compc
      ORDER BY a.STARTED_AT`,
    { p: participantId, compc }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => ({
    attempt_id: num(x[0]), test_kind: s(x[1]), started_at: ymdhm(x[2]), submitted_at: ymdhm(x[3]),
    score: numOrNull(x[4]), total: numOrNull(x[5]), pct: numOrNull(x[6]), passed: x[7] === null ? null : s(x[7]) === "Y",
  }));
});
