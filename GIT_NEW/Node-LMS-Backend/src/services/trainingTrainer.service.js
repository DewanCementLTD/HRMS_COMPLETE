/**
 * Trainer portal — what an INTERNAL trainer (HR_TRAINER.TRAINER_TYPE = 'I',
 * linked by EMPCODE) does from their own account:
 *   - keep their trainer profile: expertise, bio, qualifications, contact,
 *     rate (per session / hour / day) or "free of charge"
 *   - publish free slots HR can schedule sessions into
 *   - see the sessions they conduct and who attends
 *   - write the course outline / roadmap for each session (text and/or a
 *     document) — participants see the same outline
 *   - build the pre/post tests of the courses they are teaching
 *   - give feedback on their sessions
 *   - download their certificate of appreciation once a session is completed
 *
 * Every function starts from the signed-in employee's EMPCODE and only touches
 * rows that belong to their own trainer record.
 */

import fs from "node:fs";
import path from "node:path";
import { getDirectConnection } from "../config/database.js";
import { DOCS_ROOT } from "./documents.service.js";
import { logger } from "../utils/logger.js";
import {
  OUT_ARRAY, s, num, ymd, ymdhm, TrainingError, nextId, writeLog, withTx, mapOraError,
} from "./trainingShared.service.js";
import { TRAINER_SELECT, rowToTrainer } from "./trainingMaster.service.js";
import { SESSION_SELECT, rowToSession, PARTICIPANT_SELECT, rowToParticipant } from "./trainingSession.service.js";
import * as tests from "./trainingTest.service.js";

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

const ACTIVE_SESSION = "('PLANNED','OPEN','IN_PROGRESS')";

/** The employee's own internal trainer record, or null. */
const findTrainer = async (c, empcode) => {
  const r = await c.execute(
    `${TRAINER_SELECT} FROM HR_TRAINER t
      WHERE t.EMPCODE = :e AND t.TRAINER_TYPE = 'I'
      ORDER BY CASE t.IS_ACTIVE WHEN 'Y' THEN 0 ELSE 1 END, t.TRAINER_ID
      FETCH FIRST 1 ROWS ONLY`,
    { e: s(empcode) }, { outFormat: OUT_ARRAY },
  );
  return r.rows?.length ? rowToTrainer(r.rows[0]) : null;
};

const requireTrainer = async (c, empcode) => {
  const t = await findTrainer(c, empcode);
  if (!t) throw new TrainingError("You are not set up as a trainer. Ask HR to add you as an internal trainer.", 403);
  return t;
};

const ownSession = async (c, trainer, sessionId) => {
  const r = await c.execute(`${SESSION_SELECT} WHERE x.SESSION_ID = :id AND x.TRAINER_ID = :tid`,
    { id: sessionId, tid: trainer.trainer_id }, { outFormat: OUT_ARRAY });
  if (!r.rows?.length) throw new TrainingError("Session not found among the sessions you conduct", 404);
  return rowToSession(r.rows[0]);
};

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const getProfile = (empcode) => read(async (c) => {
  const trainer = await findTrainer(c, empcode);
  if (!trainer) return { is_trainer: false };
  const stats = await c.execute(
    `SELECT COUNT(CASE WHEN x.STATUS IN ${ACTIVE_SESSION} THEN 1 END),
            COUNT(CASE WHEN x.STATUS = 'COMPLETED' THEN 1 END),
            NVL(SUM(CASE WHEN x.STATUS = 'COMPLETED' THEN x.TOTAL_HOURS END), 0)
       FROM HR_TRAINING_SESSION x WHERE x.TRAINER_ID = :tid`,
    { tid: trainer.trainer_id }, { outFormat: OUT_ARRAY },
  );
  const people = await c.execute(
    `SELECT COUNT(*) FROM HR_TRAINING_PARTICIPANT p JOIN HR_TRAINING_SESSION z ON z.SESSION_ID = p.SESSION_ID
      WHERE z.TRAINER_ID = :tid AND p.STATUS IN ('COMPLETED','FAILED')`,
    { tid: trainer.trainer_id }, { outFormat: OUT_ARRAY },
  );
  const [upcoming, completed, hours] = stats.rows[0];
  const trained = people.rows[0][0];
  return {
    is_trainer: true, trainer,
    stats: { upcoming: num(upcoming), completed: num(completed), hours: num(hours), people_trained: num(trained) },
  };
});

export const updateProfile = (empcode, body) => withTx(async (c) => {
  const t = await requireTrainer(c, empcode);
  await c.execute(
    `UPDATE HR_TRAINER SET EXPERTISE = :exp, BIO = :bio, QUALIFICATIONS = :qual, PHONE = :phone, EMAIL = :email,
            DEFAULT_RATE = :rate, RATE_UNIT = :unit, IS_FREE = :free, UPDATED_BY = :e, UPDATED_AT = SYSDATE
      WHERE TRAINER_ID = :tid`,
    {
      exp: s(body.expertise) || null, bio: s(body.bio) || null, qual: s(body.qualifications) || null,
      phone: s(body.phone) || null, email: s(body.email) || null,
      rate: body.is_free ? 0 : body.default_rate ?? null, unit: body.rate_unit || "SESSION", free: body.is_free ? "Y" : "N",
      e: s(empcode), tid: t.trainer_id,
    },
  );
  await writeLog(c, { compc: t.compc, entity: "TRAINER", entityId: t.trainer_id, action: "SELF_UPDATE", details: body, actor: empcode });
  return { trainer_id: t.trainer_id };
});

// ---------------------------------------------------------------------------
// Free slots
// ---------------------------------------------------------------------------

export const listSlots = (empcode) => read(async (c) => {
  const t = await requireTrainer(c, empcode);
  const r = await c.execute(
    `SELECT SLOT_ID, SLOT_DATE, TIME_FROM, TIME_TO, REMARKS FROM HR_TRAINER_SLOT
      WHERE TRAINER_ID = :tid AND SLOT_DATE >= TRUNC(SYSDATE) ORDER BY SLOT_DATE, TIME_FROM`,
    { tid: t.trainer_id }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => ({ slot_id: num(x[0]), slot_date: ymd(x[1]), time_from: s(x[2]), time_to: s(x[3]), remarks: s(x[4]) }));
});

export const addSlot = (empcode, body) => withTx(async (c) => {
  const t = await requireTrainer(c, empcode);
  if (body.time_to <= body.time_from) throw new TrainingError("End time must be after start time");
  const past = await c.execute(`SELECT CASE WHEN TO_DATE(:d, 'YYYY-MM-DD') < TRUNC(SYSDATE) THEN 1 ELSE 0 END FROM DUAL`,
    { d: body.slot_date }, { outFormat: OUT_ARRAY });
  if (num(past.rows[0][0])) throw new TrainingError("Pick today or a future date");
  const overlap = await c.execute(
    `SELECT 1 FROM HR_TRAINER_SLOT WHERE TRAINER_ID = :tid AND SLOT_DATE = TO_DATE(:d, 'YYYY-MM-DD')
        AND TIME_FROM < :tt AND TIME_TO > :tf FETCH FIRST 1 ROWS ONLY`,
    { tid: t.trainer_id, d: body.slot_date, tf: body.time_from, tt: body.time_to }, { outFormat: OUT_ARRAY },
  );
  if (overlap.rows?.length) throw new TrainingError("This overlaps a slot you already added", 409);
  const id = await nextId(c, "HR_TRAINER_SLOT_SEQ");
  await c.execute(
    `INSERT INTO HR_TRAINER_SLOT (SLOT_ID, TRAINER_ID, SLOT_DATE, TIME_FROM, TIME_TO, REMARKS)
     VALUES (:id, :tid, TO_DATE(:d, 'YYYY-MM-DD'), :tf, :tt, :rem)`,
    { id, tid: t.trainer_id, d: body.slot_date, tf: body.time_from, tt: body.time_to, rem: s(body.remarks) || null },
  );
  return { slot_id: id };
});

export const deleteSlot = (empcode, slotId) => withTx(async (c) => {
  const t = await requireTrainer(c, empcode);
  const r = await c.execute(`DELETE FROM HR_TRAINER_SLOT WHERE SLOT_ID = :id AND TRAINER_ID = :tid`, { id: slotId, tid: t.trainer_id });
  if (!r.rowsAffected) throw new TrainingError("Slot not found", 404);
  return { deleted: true };
});

// ---------------------------------------------------------------------------
// Sessions I conduct
// ---------------------------------------------------------------------------

export const listMySessions = (empcode) => read(async (c) => {
  const t = await requireTrainer(c, empcode);
  const r = await c.execute(`${SESSION_SELECT} WHERE x.TRAINER_ID = :tid AND x.STATUS <> 'CANCELLED'
      ORDER BY CASE WHEN x.STATUS IN ${ACTIVE_SESSION} THEN 0 ELSE 1 END, x.START_DATE`,
  { tid: t.trainer_id }, { outFormat: OUT_ARRAY });
  return (r.rows ?? []).map(rowToSession);
});

export const getMySession = (empcode, sessionId) => read(async (c) => {
  const t = await requireTrainer(c, empcode);
  const session = await ownSession(c, t, sessionId);
  const p = await c.execute(`${PARTICIPANT_SELECT} WHERE p.SESSION_ID = :id AND p.STATUS <> 'WITHDRAWN' ORDER BY UPPER(m.NAME)`,
    { id: sessionId }, { outFormat: OUT_ARRAY });
  const fb = await c.execute(
    `SELECT FEEDBACK_ID, RATING_CONTENT, RATING_TRAINER, RATING_OVERALL, COMMENTS, CREATED_AT
       FROM HR_TRAINING_FEEDBACK WHERE SESSION_ID = :id AND GIVEN_BY_TYPE = 'TRAINER' AND GIVEN_BY = :e
      ORDER BY CREATED_AT DESC`,
    { id: sessionId, e: s(empcode) }, { outFormat: OUT_ARRAY },
  );
  // Participants' ratings are shown as an aggregate only — individual employee
  // feedback about the trainer stays with HR.
  const agg = await c.execute(
    `SELECT COUNT(*), ROUND(AVG(RATING_TRAINER), 2), ROUND(AVG(RATING_CONTENT), 2), ROUND(AVG(RATING_OVERALL), 2)
       FROM HR_TRAINING_FEEDBACK WHERE SESSION_ID = :id AND GIVEN_BY_TYPE = 'EMPLOYEE'`,
    { id: sessionId }, { outFormat: OUT_ARRAY },
  );
  const [n, rt, rc, ro] = agg.rows[0];
  return {
    session,
    participants: (p.rows ?? []).map(rowToParticipant).map(({ request_id, retest_allowed, feedback_rating, ...rest }) => rest),
    my_feedback: (fb.rows ?? []).map((x) => ({
      feedback_id: num(x[0]), rating_content: x[1] === null ? null : num(x[1]), rating_trainer: x[2] === null ? null : num(x[2]),
      rating_overall: num(x[3]), comments: s(x[4]), created_at: ymdhm(x[5]),
    })),
    participant_ratings: { count: num(n), trainer: rt === null ? null : num(rt), content: rc === null ? null : num(rc), overall: ro === null ? null : num(ro) },
  };
});

export const addMyFeedback = (empcode, sessionId, body) => withTx(async (c) => {
  const t = await requireTrainer(c, empcode);
  const session = await ownSession(c, t, sessionId);
  if (!["IN_PROGRESS", "COMPLETED"].includes(session.status)) throw new TrainingError("Feedback opens once the session has started");
  const id = await nextId(c, "HR_TRAINING_FEEDBACK_SEQ");
  await c.execute(
    `INSERT INTO HR_TRAINING_FEEDBACK (FEEDBACK_ID, SESSION_ID, PARTICIPANT_ID, GIVEN_BY_TYPE, GIVEN_BY,
            RATING_CONTENT, RATING_TRAINER, RATING_OVERALL, COMMENTS)
     VALUES (:id, :sid, NULL, 'TRAINER', :giver, :rc, NULL, :ro, :cm)`,
    { id, sid: sessionId, giver: s(empcode), rc: body.rating_content ?? null, ro: body.rating_overall, cm: s(body.comments) || null },
  );
  return { feedback_id: id };
});

// ---------------------------------------------------------------------------
// Course outline / roadmap (text + optional document) — per session
// ---------------------------------------------------------------------------

export const OUTLINE_DIR = path.join(DOCS_ROOT, "TRAINING_OUTLINES");
export const OUTLINE_EXTS = new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".txt", ".png", ".jpg", ".jpeg"]);
export const OUTLINE_MAX_BYTES = 20 * 1024 * 1024;

const removeStored = (stored) => {
  if (!stored) return;
  fs.promises.unlink(path.join(OUTLINE_DIR, path.basename(stored))).catch((e) => {
    if (e.code !== "ENOENT") logger.warn(`[TRAINING] could not delete outline file ${stored}: ${e.message}`);
  });
};

/** Who may change a session's outline: its own trainer, or HR of that company. */
const outlineSession = async (c, sessionId, { empcode, compc }) => {
  if (compc) {
    const r = await c.execute(`${SESSION_SELECT} WHERE x.SESSION_ID = :id AND x.COMPC = :compc`, { id: sessionId, compc }, { outFormat: OUT_ARRAY });
    if (!r.rows?.length) throw new TrainingError("Session not found", 404);
    return rowToSession(r.rows[0]);
  }
  return ownSession(c, await requireTrainer(c, empcode), sessionId);
};

const assertEditable = (session) => {
  if (session.status === "CANCELLED") throw new TrainingError("The session is cancelled");
};

export const saveOutlineText = (sessionId, who, text) => withTx(async (c) => {
  const session = await outlineSession(c, sessionId, who);
  assertEditable(session);
  await c.execute(
    `UPDATE HR_TRAINING_SESSION SET OUTLINE_TEXT = :t, OUTLINE_UPDATED_BY = :by2, OUTLINE_UPDATED_AT = SYSDATE WHERE SESSION_ID = :id`,
    { t: s(text) || null, by2: s(who.actor), id: sessionId },
  );
  return { saved: true };
});

export const saveOutlineFile = (sessionId, who, file) => withTx(async (c) => {
  const session = await outlineSession(c, sessionId, who);
  assertEditable(session);
  if (!file?.buffer?.length) throw new TrainingError("Choose a file to upload");
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (!OUTLINE_EXTS.has(ext)) throw new TrainingError("Allowed files: PDF, Word, PowerPoint, Excel, text or image");
  if (file.buffer.length > OUTLINE_MAX_BYTES) throw new TrainingError("File is larger than 20 MB");

  await fs.promises.mkdir(OUTLINE_DIR, { recursive: true });
  const stored = `session_${sessionId}_${Date.now()}${ext}`;
  await fs.promises.writeFile(path.join(OUTLINE_DIR, stored), file.buffer);
  const prev = await c.execute(`SELECT OUTLINE_FILE_PATH FROM HR_TRAINING_SESSION WHERE SESSION_ID = :id`, { id: sessionId }, { outFormat: OUT_ARRAY });
  try {
    await c.execute(
      `UPDATE HR_TRAINING_SESSION SET OUTLINE_FILE_NAME = :n, OUTLINE_FILE_PATH = :p, OUTLINE_UPDATED_BY = :by2, OUTLINE_UPDATED_AT = SYSDATE
        WHERE SESSION_ID = :id`,
      { n: path.basename(file.originalname).slice(0, 255), p: stored, by2: s(who.actor), id: sessionId },
    );
  } catch (e) {
    removeStored(stored);
    throw e;
  }
  removeStored(s(prev.rows?.[0]?.[0]));
  return { file_name: file.originalname };
});

export const deleteOutlineFile = (sessionId, who) => withTx(async (c) => {
  await outlineSession(c, sessionId, who);
  const prev = await c.execute(`SELECT OUTLINE_FILE_PATH FROM HR_TRAINING_SESSION WHERE SESSION_ID = :id`, { id: sessionId }, { outFormat: OUT_ARRAY });
  await c.execute(
    `UPDATE HR_TRAINING_SESSION SET OUTLINE_FILE_NAME = NULL, OUTLINE_FILE_PATH = NULL, OUTLINE_UPDATED_BY = :by2, OUTLINE_UPDATED_AT = SYSDATE
      WHERE SESSION_ID = :id`,
    { by2: s(who.actor), id: sessionId },
  );
  removeStored(s(prev.rows?.[0]?.[0]));
  return { deleted: true };
});

/**
 * Resolve the outline document for download. Allowed for the session's
 * trainer, anyone booked on it, or HR of its company.
 */
export const outlineFileFor = (sessionId, { empcode, compc }) => read(async (c) => {
  const r = await c.execute(
    `SELECT x.OUTLINE_FILE_NAME, x.OUTLINE_FILE_PATH, x.COMPC,
            (SELECT tr.EMPCODE FROM HR_TRAINER tr WHERE tr.TRAINER_ID = x.TRAINER_ID),
            (SELECT COUNT(*) FROM HR_TRAINING_PARTICIPANT p WHERE p.SESSION_ID = x.SESSION_ID AND p.EMPCODE = :e AND p.STATUS <> 'WITHDRAWN')
       FROM HR_TRAINING_SESSION x WHERE x.SESSION_ID = :id`,
    { id: sessionId, e: s(empcode) || "-" }, { outFormat: OUT_ARRAY },
  );
  const x = r.rows?.[0];
  const allowed = x && (compc ? num(x[2]) === num(compc) : s(x[3]) === s(empcode) || num(x[4]) > 0);
  if (!allowed) throw new TrainingError("Session not found", 404);
  if (!x[1]) throw new TrainingError("No outline document has been uploaded", 404);
  const abs = path.join(OUTLINE_DIR, path.basename(s(x[1])));
  if (!fs.existsSync(abs)) throw new TrainingError("The outline document is missing on the server — ask the trainer to upload it again", 404);
  return { abs, name: s(x[0]) || path.basename(abs) };
});

// ---------------------------------------------------------------------------
// Tests of the courses I teach
// ---------------------------------------------------------------------------

/** Courses the trainer may build tests for: those with a session of theirs that is not finished. */
export const myTestCourses = (empcode) => read(async (c) => {
  const t = await requireTrainer(c, empcode);
  const r = await c.execute(
    `SELECT co.COURSE_ID, co.COURSE_CODE, co.TITLE, MIN(x.START_DATE),
            (SELECT COUNT(*) FROM HR_TRAINING_TEST q WHERE q.COURSE_ID = co.COURSE_ID AND q.TEST_KIND = 'PRE' AND q.IS_ACTIVE = 'Y'),
            (SELECT COUNT(*) FROM HR_TRAINING_TEST q WHERE q.COURSE_ID = co.COURSE_ID AND q.TEST_KIND = 'POST' AND q.IS_ACTIVE = 'Y')
       FROM HR_TRAINING_SESSION x JOIN HR_TRAINING_COURSE co ON co.COURSE_ID = x.COURSE_ID
      WHERE x.TRAINER_ID = :tid AND x.STATUS IN ${ACTIVE_SESSION}
      GROUP BY co.COURSE_ID, co.COURSE_CODE, co.TITLE
      ORDER BY MIN(x.START_DATE)`,
    { tid: t.trainer_id }, { outFormat: OUT_ARRAY },
  );
  return (r.rows ?? []).map((x) => ({
    course_id: num(x[0]), course_code: s(x[1]), title: s(x[2]), next_session: ymd(x[3]),
    has_pre_test: num(x[4]) > 0, has_post_test: num(x[5]) > 0,
  }));
});

const assertCourse = async (c, t, courseId) => {
  const r = await c.execute(
    `SELECT 1 FROM HR_TRAINING_SESSION WHERE TRAINER_ID = :tid AND COURSE_ID = :cid AND STATUS IN ${ACTIVE_SESSION} FETCH FIRST 1 ROWS ONLY`,
    { tid: t.trainer_id, cid: courseId }, { outFormat: OUT_ARRAY },
  );
  if (!r.rows?.length) throw new TrainingError("You can only edit tests of courses you are currently teaching", 403);
};

const assertTest = async (empcode, testId) => {
  const c = await getDirectConnection();
  try {
    const t = await requireTrainer(c, empcode);
    const r = await c.execute(`SELECT COURSE_ID FROM HR_TRAINING_TEST WHERE TEST_ID = :id AND COMPC = :compc`,
      { id: testId, compc: t.compc }, { outFormat: OUT_ARRAY });
    if (!r.rows?.length) throw new TrainingError("Test not found", 404);
    await assertCourse(c, t, num(r.rows[0][0]));
    return t;
  } finally {
    await c.close();
  }
};

const assertCourseAccess = async (empcode, courseId) => {
  const c = await getDirectConnection();
  try {
    const t = await requireTrainer(c, empcode);
    await assertCourse(c, t, courseId);
    return t;
  } finally {
    await c.close();
  }
};

export const courseTests = async (empcode, courseId) => {
  const t = await assertCourseAccess(empcode, courseId);
  return tests.getCourseTests(t.compc, courseId);
};
export const saveTest = async (empcode, courseId, kind, body) => {
  const t = await assertCourseAccess(empcode, courseId);
  return tests.saveTest(t.compc, empcode, courseId, kind, body);
};
export const saveQuestion = async (empcode, testId, questionId, body) => {
  const t = await assertTest(empcode, testId);
  return tests.saveQuestion(t.compc, testId, questionId, body);
};
export const deleteQuestion = async (empcode, testId, questionId) => {
  const t = await assertTest(empcode, testId);
  return tests.deleteQuestion(t.compc, testId, questionId);
};
