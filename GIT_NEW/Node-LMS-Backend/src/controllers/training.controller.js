/**
 * Training Management controllers.
 *
 * HR handlers run behind requireHrAdmin and resolve the company through
 * resolveCompany, so an admin only ever sees companies within their rights.
 * Employee / HOD handlers run behind requireEmployee: the card is always the
 * bearer token's own, resolved to its EMPCODE here.
 */

import { resolveCompany, resolveBranch } from "../utils/payrollShared.js";
import { fyOf, resolveEmpcode } from "../services/trainingShared.service.js";
import * as master from "../services/trainingMaster.service.js";
import * as sessions from "../services/trainingSession.service.js";
import * as requests from "../services/trainingRequest.service.js";
import * as tests from "../services/trainingTest.service.js";
import * as reports from "../services/trainingReports.service.js";
import * as trainer from "../services/trainingTrainer.service.js";
import { loadCertificate, loadTrainerCertificate, buildCertificatePdf } from "../services/trainingCertificatePdf.service.js";

const v = (res) => res.locals.validated;

/** Wrap an HR handler: fn({ compc, actor, branch, q, params, body }) → JSON. */
const hr = (fn) => async (req, res, next) => {
  try {
    const { query, params = {}, body = {} } = v(res);
    const compc = await resolveCompany(query.admin_card_no, query.compc);
    const branch = query.brnch ? await resolveBranch(query.admin_card_no, query.compc, query.brnch) : null;
    const out = await fn({ compc, actor: query.admin_card_no, branch, q: query, params, body }, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (err) {
    next(err);
  }
};

/** Wrap an employee/HOD handler: fn({ empcode, params, body }) → JSON. */
const me = (fn) => async (req, res, next) => {
  try {
    const { params = {}, body = {} } = v(res);
    const empcode = await resolveEmpcode(res.locals.employee?.card_no ?? params.card_no);
    res.setHeader("Cache-Control", "private, no-store");
    const out = await fn({ empcode, params, body }, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (err) {
    next(err);
  }
};

const sendFile = (res, { abs, name }) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.download(abs, name);
};

const sendPdf = async (res, cert) => {
  const pdf = await buildCertificatePdf(cert);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="certificate_${cert.cert_no}.pdf"`);
  res.send(pdf);
};

// ── HR: masters ────────────────────────────────────────────────────────────
export const listCategories = hr(({ compc }) => master.listCategories(compc).then((items) => ({ items })));
export const createCategory = hr(({ compc, actor, body }) => master.saveCategory(compc, actor, null, body));
export const updateCategory = hr(({ compc, actor, params, body }) => master.saveCategory(compc, actor, params.category_id, body));
export const deleteCategory = hr(({ compc, params }) => master.deleteCategory(compc, params.category_id));

export const listTrainers = hr(({ compc }) => master.listTrainers(compc).then((items) => ({ items })));
export const createTrainer = hr(({ compc, actor, body }) => master.saveTrainer(compc, actor, null, body));
export const updateTrainer = hr(({ compc, actor, params, body }) => master.saveTrainer(compc, actor, params.trainer_id, body));
export const deleteTrainer = hr(({ compc, params }) => master.deleteTrainer(compc, params.trainer_id));

export const listCourses = hr(({ compc, q }) => master.listCourses(compc, { activeOnly: q.active === "1" }).then((items) => ({ items })));
export const createCourse = hr(({ compc, actor, body }) => master.saveCourse(compc, actor, null, body));
export const updateCourse = hr(({ compc, actor, params, body }) => master.saveCourse(compc, actor, params.course_id, body));
export const deleteCourse = hr(({ compc, params }) => master.deleteCourse(compc, params.course_id));

export const getBudget = hr(({ compc, q }) => master.getBudget(compc, q.fy ?? fyOf()));
export const saveBudget = hr(({ compc, actor, body }) => master.saveBudget(compc, actor, body));
export const deleteBudget = hr(({ compc, params }) => master.deleteBudget(compc, params.budget_id));

export const trainerSlots = hr(({ compc, params }) => master.listTrainerSlots(compc, params.trainer_id).then((items) => ({ items })));

export const listDepartments = hr(({ compc }) => master.listDepartments(compc).then((items) => ({ items })));
export const listEmployees = hr(({ compc, branch, q }) => master.listEmployees(compc, { branch, dept: q.dept }).then((items) => ({ items })));

// ── HR: sessions ───────────────────────────────────────────────────────────
export const listSessions = hr(({ compc, q }) => sessions.listSessions(compc, q).then((items) => ({ items })));
export const bookableSessions = hr(({ compc, q }) => sessions.listBookableSessions(compc, q.course_id).then((items) => ({ items })));
export const getSession = hr(({ compc, params }) => sessions.getSession(compc, params.session_id));
export const createSession = hr(({ compc, actor, body }) => sessions.saveSession(compc, actor, null, body));
export const updateSession = hr(({ compc, actor, params, body }) => sessions.saveSession(compc, actor, params.session_id, body));
export const setSessionStatus = hr(({ compc, actor, params, body }) => sessions.setSessionStatus(compc, actor, params.session_id, body.status, body.remarks));
export const completeSession = hr(({ compc, actor, params }) => sessions.completeSession(compc, actor, params.session_id));
export const addParticipants = hr(({ compc, actor, params, body }) => sessions.addParticipants(compc, actor, params.session_id, body.empcodes));
export const withdrawParticipant = hr(({ compc, actor, params, body }) =>
  sessions.withdrawParticipant(compc, actor, params.session_id, params.participant_id, body?.remarks));
export const grantRetest = hr(({ compc, actor, params }) => sessions.grantRetest(compc, actor, params.session_id, params.participant_id));
export const participantAttempts = hr(({ compc, params }) => tests.participantAttempts(compc, params.participant_id).then((items) => ({ items })));
export const saveAttendance = hr(({ compc, actor, params, body }) => sessions.saveAttendance(compc, actor, params.session_id, body));
export const addSessionFeedback = hr(({ compc, actor, params, body }) => sessions.addSessionFeedback(compc, actor, params.session_id, body));
export const hrCertificatePdf = hr(async ({ compc, params }, res) => {
  await sendPdf(res, await loadCertificate(params.participant_id, { compc }));
});

export const hrTrainerCertificatePdf = hr(async ({ compc, params }, res) => {
  await sendPdf(res, await loadTrainerCertificate(params.session_id, { compc }));
});
export const hrOutlineText = hr(({ compc, actor, params, body }) => trainer.saveOutlineText(params.session_id, { compc, actor }, body.text));
export const hrOutlineUpload = hr(({ compc, actor, params }, res) => trainer.saveOutlineFile(params.session_id, { compc, actor }, res.req.file));
export const hrOutlineDelete = hr(({ compc, actor, params }) => trainer.deleteOutlineFile(params.session_id, { compc, actor }));
export const hrOutlineFile = hr(async ({ compc, params }, res) => {
  sendFile(res, await trainer.outlineFileFor(params.session_id, { compc }));
});

// ── HR: requests ───────────────────────────────────────────────────────────
export const hrRequests = hr(({ compc, branch, q }) => requests.hrRequests(compc, { status: q.status, branch }).then((items) => ({ items })));
export const hrDecide = hr(({ compc, actor, params, body }) => requests.hrDecide(compc, actor, params.request_id, body));
export const requestHistory = hr(({ compc, params }) => requests.requestHistory(compc, params.request_id).then((items) => ({ items })));

// ── HR: tests ──────────────────────────────────────────────────────────────
export const courseTests = hr(({ compc, params }) => tests.getCourseTests(compc, params.course_id));
export const saveTest = hr(({ compc, actor, params, body }) => tests.saveTest(compc, actor, params.course_id, params.kind, body));
export const createQuestion = hr(({ compc, params, body }) => tests.saveQuestion(compc, params.test_id, null, body));
export const updateQuestion = hr(({ compc, params, body }) => tests.saveQuestion(compc, params.test_id, params.question_id, body));
export const deleteQuestion = hr(({ compc, params }) => tests.deleteQuestion(compc, params.test_id, params.question_id));

// ── HR: dashboard / reports ────────────────────────────────────────────────
export const dashboard = hr(({ compc, q }) => reports.dashboard(compc, q.fy ?? fyOf()));
export const runReport = hr(({ compc, params, q }) => {
  if (params.type === "history" && !q.empcode) {
    const err = new Error("Pick an employee for the training history report");
    err.status = 400;
    throw err;
  }
  return reports.runReport(compc, params.type, q);
});

// ── Employee ───────────────────────────────────────────────────────────────
export const myCatalog = me(({ empcode }) => requests.employeeCatalog(empcode));
export const myRequests = me(({ empcode }) => requests.listMyRequests(empcode).then((items) => ({ items })));
export const createMyRequest = me(({ empcode, body }) => requests.createMyRequest(empcode, body));
export const cancelMyRequest = me(({ empcode, params }) => requests.cancelMyRequest(empcode, params.request_id));
export const myTrainings = me(({ empcode }) => sessions.listMyTrainings(empcode).then((items) => ({ items })));
export const startMyTest = me(({ empcode, params }) => tests.startAttempt(empcode, params.participant_id, params.kind));
export const submitMyTest = me(({ empcode, params, body }) => tests.submitAttempt(empcode, params.attempt_id, body.answers));
export const submitMyFeedback = me(({ empcode, params, body }) => sessions.submitMyFeedback(empcode, params.participant_id, body));
export const myCertificatePdf = me(async ({ empcode, params }, res) => {
  await sendPdf(res, await loadCertificate(params.participant_id, { empcode }));
});

export const myOutlineFile = me(async ({ empcode, params }, res) => {
  sendFile(res, await trainer.outlineFileFor(params.session_id, { empcode }));
});

// ── Trainer portal ─────────────────────────────────────────────────────────
export const trainerProfile = me(({ empcode }) => trainer.getProfile(empcode));
export const trainerUpdateProfile = me(({ empcode, body }) => trainer.updateProfile(empcode, body));
export const trainerListSlots = me(({ empcode }) => trainer.listSlots(empcode).then((items) => ({ items })));
export const trainerAddSlot = me(({ empcode, body }) => trainer.addSlot(empcode, body));
export const trainerDeleteSlot = me(({ empcode, params }) => trainer.deleteSlot(empcode, params.slot_id));
export const trainerSessions = me(({ empcode }) => trainer.listMySessions(empcode).then((items) => ({ items })));
export const trainerSession = me(({ empcode, params }) => trainer.getMySession(empcode, params.session_id));
export const trainerOutlineText = me(({ empcode, params, body }) =>
  trainer.saveOutlineText(params.session_id, { empcode, actor: empcode }, body.text));
export const trainerOutlineUpload = me(({ empcode, params }, res) =>
  trainer.saveOutlineFile(params.session_id, { empcode, actor: empcode }, res.req.file));
export const trainerOutlineDelete = me(({ empcode, params }) => trainer.deleteOutlineFile(params.session_id, { empcode, actor: empcode }));
export const trainerOutlineFile = me(async ({ empcode, params }, res) => {
  sendFile(res, await trainer.outlineFileFor(params.session_id, { empcode }));
});
export const trainerFeedback = me(({ empcode, params, body }) => trainer.addMyFeedback(empcode, params.session_id, body));
export const trainerCertificatePdf = me(async ({ empcode, params }, res) => {
  await sendPdf(res, await loadTrainerCertificate(params.session_id, { empcode }));
});
export const trainerTestCourses = me(({ empcode }) => trainer.myTestCourses(empcode).then((items) => ({ items })));
export const trainerCourseTests = me(({ empcode, params }) => trainer.courseTests(empcode, params.course_id));
export const trainerSaveTest = me(({ empcode, params, body }) => trainer.saveTest(empcode, params.course_id, params.kind, body));
export const trainerCreateQuestion = me(({ empcode, params, body }) => trainer.saveQuestion(empcode, params.test_id, null, body));
export const trainerUpdateQuestion = me(({ empcode, params, body }) => trainer.saveQuestion(empcode, params.test_id, params.question_id, body));
export const trainerDeleteQuestion = me(({ empcode, params }) => trainer.deleteQuestion(empcode, params.test_id, params.question_id));

// ── HOD ────────────────────────────────────────────────────────────────────
export const hodRequests = me(({ empcode }) => requests.hodRequests(empcode));
export const hodDecide = me(({ empcode, params, body }) => requests.hodDecide(empcode, params.request_id, body));
export const hodTeam = me(({ empcode }) => requests.hodTeam(empcode));
export const hodMember = me(({ empcode, params }) => requests.hodMemberHistory(empcode, params.empcode));
export const hodNominate = me(({ empcode, body }) => requests.hodNominate(empcode, body));
export const hodCatalog = me(({ empcode }) => requests.employeeCatalog(empcode));
