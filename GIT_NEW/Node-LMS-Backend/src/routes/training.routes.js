import { Router } from "express";
import { validate } from "../middlewares/validate.middleware.js";
import { requireHrAdmin } from "../middlewares/hrAdmin.middleware.js";
import { requireEmployee } from "../middlewares/employeeAuth.middleware.js";
import { uploadOutlineFile } from "../middlewares/upload.middleware.js";
import * as S from "../models/training.schema.js";
import * as C from "../controllers/training.controller.js";

// Mounted at /training. Plan: docs/Training_Management_Plan.md
//   /training/admin/*        HR admin (admin_card_no + selected compc)
//   /training/me/:card_no/*  employee self-service (Bearer <session_token>)
//   /training/hod/:card_no/* HOD approvals / nominations (Bearer <session_token>)
//   /training/trainer/:card_no/* internal trainer portal (Bearer <session_token>)
const router = Router();
const H = requireHrAdmin;
const E = requireEmployee;

// ── HR: masters ────────────────────────────────────────────────────────────
router.get("/admin/categories", validate(S.hrListSchema), H, C.listCategories);
router.post("/admin/categories", validate(S.categoryCreateSchema), H, C.createCategory);          // {name, is_active}
router.put("/admin/categories/:category_id", validate(S.categoryUpdateSchema), H, C.updateCategory);
router.delete("/admin/categories/:category_id", validate(S.categoryDeleteSchema), H, C.deleteCategory);

router.get("/admin/trainers", validate(S.hrListSchema), H, C.listTrainers);
router.post("/admin/trainers", validate(S.trainerCreateSchema), H, C.createTrainer);              // {trainer_type:"I"|"E", empcode?, name, ...}
router.put("/admin/trainers/:trainer_id", validate(S.trainerUpdateSchema), H, C.updateTrainer);
router.delete("/admin/trainers/:trainer_id", validate(S.trainerDeleteSchema), H, C.deleteTrainer);
router.get("/admin/trainers/:trainer_id/slots", validate(S.trainerSlotsSchema), H, C.trainerSlots);           // the trainer's free slots

router.get("/admin/courses", validate(S.hrCoursesSchema), H, C.listCourses);                       // ?active=1
router.post("/admin/courses", validate(S.courseCreateSchema), H, C.createCourse);
router.put("/admin/courses/:course_id", validate(S.courseUpdateSchema), H, C.updateCourse);
router.delete("/admin/courses/:course_id", validate(S.courseDeleteSchema), H, C.deleteCourse);

router.get("/admin/budget", validate(S.budgetGetSchema), H, C.getBudget);                          // ?fy=2026 (Jul 2026–Jun 2027)
router.put("/admin/budget", validate(S.budgetSaveSchema), H, C.saveBudget);                        // {fy_year, dept_no|null, amount, remarks}
router.delete("/admin/budget/:budget_id", validate(S.budgetDeleteSchema), H, C.deleteBudget);

router.get("/admin/departments", validate(S.hrListSchema), H, C.listDepartments);
router.get("/admin/employees", validate(S.hrEmployeesSchema), H, C.listEmployees);                // ?dept=&brnch=

// ── HR: sessions ───────────────────────────────────────────────────────────
router.get("/admin/sessions", validate(S.sessionsListSchema), H, C.listSessions);                  // ?status=&from=&to=&course_id=&fy=
router.get("/admin/sessions/bookable", validate(S.bookableSessionsSchema), H, C.bookableSessions);// ?course_id=
router.get("/admin/sessions/:session_id", validate(S.sessionGetSchema), H, C.getSession);
router.post("/admin/sessions", validate(S.sessionCreateSchema), H, C.createSession);
router.put("/admin/sessions/:session_id", validate(S.sessionUpdateSchema), H, C.updateSession);
router.post("/admin/sessions/:session_id/status", validate(S.sessionStatusSchema), H, C.setSessionStatus);   // {status, remarks}
router.post("/admin/sessions/:session_id/complete", validate(S.sessionCompleteSchema), H, C.completeSession); // evaluate + certificates
router.post("/admin/sessions/:session_id/participants", validate(S.participantsAddSchema), H, C.addParticipants); // {empcodes:[]}
router.post("/admin/sessions/:session_id/participants/:participant_id/withdraw", validate(S.participantActionSchema), H, C.withdrawParticipant);
router.post("/admin/sessions/:session_id/participants/:participant_id/retest", validate(S.participantActionSchema), H, C.grantRetest);
router.put("/admin/sessions/:session_id/attendance", validate(S.attendanceSaveSchema), H, C.saveAttendance); // {date, rows:[{participant_id,status,hours}]}
router.post("/admin/sessions/:session_id/feedback", validate(S.sessionFeedbackSchema), H, C.addSessionFeedback);
router.get("/admin/sessions/:session_id/trainer-certificate", validate(S.sessionGetSchema), H, C.hrTrainerCertificatePdf);
router.put("/admin/sessions/:session_id/outline", validate(S.hrOutlineTextSchema), H, C.hrOutlineText);       // {text}
router.post("/admin/sessions/:session_id/outline/file", uploadOutlineFile, validate(S.hrSessionFileSchema), H, C.hrOutlineUpload); // multipart "file"
router.delete("/admin/sessions/:session_id/outline/file", validate(S.hrSessionFileSchema), H, C.hrOutlineDelete);
router.get("/admin/sessions/:session_id/outline/file", validate(S.hrSessionFileSchema), H, C.hrOutlineFile);
router.get("/admin/participants/:participant_id/attempts", validate(S.participantAttemptsSchema), H, C.participantAttempts);
router.get("/admin/participants/:participant_id/certificate", validate(S.certificateHrSchema), H, C.hrCertificatePdf);

// ── HR: requests ───────────────────────────────────────────────────────────
router.get("/admin/requests", validate(S.hrRequestsSchema), H, C.hrRequests);                      // ?status=OPEN|PENDING_HR|...
router.post("/admin/requests/:request_id/decision", validate(S.hrDecisionSchema), H, C.hrDecide);  // {decision, remarks, session_id?, course_id?}
router.get("/admin/requests/:request_id/history", validate(S.requestHistorySchema), H, C.requestHistory);

// ── HR: tests ──────────────────────────────────────────────────────────────
router.get("/admin/courses/:course_id/tests", validate(S.courseTestsSchema), H, C.courseTests);
router.put("/admin/courses/:course_id/tests/:kind", validate(S.testSaveSchema), H, C.saveTest);   // kind = PRE|POST
router.post("/admin/tests/:test_id/questions", validate(S.questionCreateSchema), H, C.createQuestion);
router.put("/admin/tests/:test_id/questions/:question_id", validate(S.questionUpdateSchema), H, C.updateQuestion);
router.delete("/admin/tests/:test_id/questions/:question_id", validate(S.questionDeleteSchema), H, C.deleteQuestion);

// ── HR: dashboard / reports ────────────────────────────────────────────────
router.get("/admin/dashboard", validate(S.dashboardSchema), H, C.dashboard);                       // ?fy=
router.get("/admin/reports/:type", validate(S.reportSchema), H, C.runReport);                      // ?from=&to=&dept=&empcode=

// ── Employee ───────────────────────────────────────────────────────────────
router.get("/me/:card_no/catalog", validate(S.myCatalogSchema), E, C.myCatalog);
router.get("/me/:card_no/requests", validate(S.myRequestsSchema), E, C.myRequests);
router.post("/me/:card_no/requests", validate(S.myRequestCreateSchema), E, C.createMyRequest);
router.post("/me/:card_no/requests/:request_id/cancel", validate(S.myRequestCancelSchema), E, C.cancelMyRequest);
router.get("/me/:card_no/trainings", validate(S.myTrainingsSchema), E, C.myTrainings);
router.post("/me/:card_no/trainings/:participant_id/tests/:kind/start", validate(S.myTestStartSchema), E, C.startMyTest);
router.post("/me/:card_no/attempts/:attempt_id/submit", validate(S.myTestSubmitSchema), E, C.submitMyTest); // {answers:{question_id:"A"}}
router.post("/me/:card_no/trainings/:participant_id/feedback", validate(S.myFeedbackSchema), E, C.submitMyFeedback);
router.get("/me/:card_no/trainings/:participant_id/certificate", validate(S.myCertificateSchema), E, C.myCertificatePdf);

router.get("/me/:card_no/sessions/:session_id/outline/file", validate(S.myOutlineFileSchema), E, C.myOutlineFile);

// ── Trainer portal (internal trainers) ─────────────────────────────────────
router.get("/trainer/:card_no/profile", validate(S.trainerMeSchema), E, C.trainerProfile);           // {is_trainer, trainer, stats}
router.put("/trainer/:card_no/profile", validate(S.trainerProfileSchema), E, C.trainerUpdateProfile);
router.get("/trainer/:card_no/slots", validate(S.trainerMeSchema), E, C.trainerListSlots);
router.post("/trainer/:card_no/slots", validate(S.trainerSlotAddSchema), E, C.trainerAddSlot);       // {slot_date, time_from, time_to, remarks}
router.delete("/trainer/:card_no/slots/:slot_id", validate(S.trainerSlotDeleteSchema), E, C.trainerDeleteSlot);
router.get("/trainer/:card_no/sessions", validate(S.trainerMeSchema), E, C.trainerSessions);
router.get("/trainer/:card_no/sessions/:session_id", validate(S.trainerSessionSchema), E, C.trainerSession);
router.put("/trainer/:card_no/sessions/:session_id/outline", validate(S.trainerOutlineTextSchema), E, C.trainerOutlineText);
router.post("/trainer/:card_no/sessions/:session_id/outline/file", uploadOutlineFile, validate(S.trainerSessionFileSchema), E, C.trainerOutlineUpload);
router.delete("/trainer/:card_no/sessions/:session_id/outline/file", validate(S.trainerSessionFileSchema), E, C.trainerOutlineDelete);
router.get("/trainer/:card_no/sessions/:session_id/outline/file", validate(S.trainerSessionFileSchema), E, C.trainerOutlineFile);
router.post("/trainer/:card_no/sessions/:session_id/feedback", validate(S.trainerFeedbackSchema), E, C.trainerFeedback);
router.get("/trainer/:card_no/sessions/:session_id/certificate", validate(S.trainerSessionSchema), E, C.trainerCertificatePdf);
router.get("/trainer/:card_no/test-courses", validate(S.trainerMeSchema), E, C.trainerTestCourses);
router.get("/trainer/:card_no/courses/:course_id/tests", validate(S.trainerCourseTestsSchema), E, C.trainerCourseTests);
router.put("/trainer/:card_no/courses/:course_id/tests/:kind", validate(S.trainerTestSaveSchema), E, C.trainerSaveTest);
router.post("/trainer/:card_no/tests/:test_id/questions", validate(S.trainerQuestionCreateSchema), E, C.trainerCreateQuestion);
router.put("/trainer/:card_no/tests/:test_id/questions/:question_id", validate(S.trainerQuestionUpdateSchema), E, C.trainerUpdateQuestion);
router.delete("/trainer/:card_no/tests/:test_id/questions/:question_id", validate(S.trainerQuestionDeleteSchema), E, C.trainerDeleteQuestion);

// ── HOD ────────────────────────────────────────────────────────────────────
router.get("/hod/:card_no/requests", validate(S.hodListSchema), E, C.hodRequests);                 // {is_hod, pending, items}
router.post("/hod/:card_no/requests/:request_id/decision", validate(S.hodDecisionSchema), E, C.hodDecide);
router.get("/hod/:card_no/team", validate(S.hodListSchema), E, C.hodTeam);
router.get("/hod/:card_no/team/:empcode", validate(S.hodMemberSchema), E, C.hodMember);
router.get("/hod/:card_no/catalog", validate(S.hodListSchema), E, C.hodCatalog);
router.post("/hod/:card_no/nominate", validate(S.hodNominateSchema), E, C.hodNominate);

export default router;
