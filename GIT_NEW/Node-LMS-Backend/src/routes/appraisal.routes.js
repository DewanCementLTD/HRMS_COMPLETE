import { Router } from "express";
import { validate } from "../middlewares/validate.middleware.js";
import { requireHrAdmin } from "../middlewares/hrAdmin.middleware.js";
import { requireEmployee } from "../middlewares/employeeAuth.middleware.js";
import { uploadOutlineFile } from "../middlewares/upload.middleware.js";
import * as S from "../models/appraisal.schema.js";
import * as C from "../controllers/appraisal.controller.js";

// Mounted at /appraisal. Tables: scripts/appraisal_ddl.sql (DCL process, v2)
//   /appraisal/admin/*           HR admin (admin_card_no + selected compc)
//   /appraisal/me/:card_no/*     employee self-service (Bearer <session_token>)
//   /appraisal/review/:card_no/* line manager / HODs / CEO (Bearer <session_token>)
const router = Router();
const H = requireHrAdmin;
const E = requireEmployee;
// Evidence files: one document under "file", up to 20 MB (same limits as training outlines).
const uploadEvidence = uploadOutlineFile;

// ── HR: setup ──────────────────────────────────────────────────────────────
router.get("/admin/lookups", validate(S.hrListSchema), H, C.lookups);                               // departments, designations, grades, periods, courses
router.get("/admin/employees", validate(S.hrEmployeesSchema), H, C.listEmployees);
router.get("/admin/competencies", validate(S.hrListSchema), H, C.listCompetencies);
router.post("/admin/competencies", validate(S.competencyCreateSchema), H, C.createCompetency);
router.post("/admin/competencies/load-dcl", validate(S.hrListSchema), H, C.loadDclCompetencies);   // the 10 DCL competencies, others deactivated
router.put("/admin/competencies/:item_id", validate(S.competencyUpdateSchema), H, C.updateCompetency);
router.delete("/admin/competencies/:item_id", validate(S.competencyDeleteSchema), H, C.deleteCompetency);

router.get("/admin/scale", validate(S.hrListSchema), H, C.getScale);
router.put("/admin/scale", validate(S.scaleSaveSchema), H, C.saveScale);                            // {bands:[...]} replaces the grade scale
router.post("/admin/scale/reset", validate(S.hrListSchema), H, C.resetScale);

router.get("/admin/promotion-setup", validate(S.hrListSchema), H, C.getPromoSetup);
router.put("/admin/promotion-setup", validate(S.promoSetupSchema), H, C.savePromoSetup);            // {settings, bands}
router.post("/admin/promotion-setup/reset", validate(S.hrListSchema), H, C.resetPromoSetup);

router.get("/admin/mgmt-approvers", validate(S.hrListSchema), H, C.listMgmt);                      // CEO / management
router.post("/admin/mgmt-approvers", validate(S.mgmtAddSchema), H, C.addMgmt);
router.put("/admin/mgmt-approvers/:approver_id", validate(S.mgmtSetSchema), H, C.setMgmt);
router.delete("/admin/mgmt-approvers/:approver_id", validate(S.mgmtDeleteSchema), H, C.deleteMgmt);

// ── HR: cycles ─────────────────────────────────────────────────────────────
router.get("/admin/cycles", validate(S.hrListSchema), H, C.listCycles);
router.post("/admin/cycles", validate(S.cycleCreateSchema), H, C.createCycle);
router.get("/admin/cycles/:cycle_id", validate(S.cycleGetSchema), H, C.getCycle);
router.put("/admin/cycles/:cycle_id", validate(S.cycleUpdateSchema), H, C.updateCycle);
router.delete("/admin/cycles/:cycle_id", validate(S.cycleGetSchema), H, C.deleteCycle);
router.post("/admin/cycles/:cycle_id/status", validate(S.cycleStatusSchema), H, C.setCycleStatus); // {status: ACTIVE|CLOSED}
router.post("/admin/cycles/:cycle_id/phase", validate(S.cyclePhaseSchema), H, C.setCyclePhase);    // {phase: OBJECTIVES|MIDYEAR|YEAREND}
router.post("/admin/cycles/:cycle_id/goals", validate(S.cycleGoalCreateSchema), H, C.createCycleGoal);
router.put("/admin/cycles/:cycle_id/goals/:goal_id", validate(S.cycleGoalUpdateSchema), H, C.updateCycleGoal);
router.delete("/admin/cycles/:cycle_id/goals/:goal_id", validate(S.cycleGoalDeleteSchema), H, C.deleteCycleGoal);
router.post("/admin/cycles/:cycle_id/launch/preview", validate(S.launchSchema), H, C.previewLaunch);
router.post("/admin/cycles/:cycle_id/launch", validate(S.launchSchema), H, C.launchCycle);       // {empcodes?, dept_nos?, brnch?, emp_statuses?}
router.get("/admin/cycles/:cycle_id/bell-curve", validate(S.bellCurveSchema), H, C.bellCurve);     // ?dept=
router.post("/admin/cycles/:cycle_id/bulk-approve", validate(S.hrBulkApproveSchema), H, C.bulkApprove);

// ── HR: appraisals ─────────────────────────────────────────────────────────
router.get("/admin/appraisals", validate(S.hrAppraisalsSchema), H, C.hrList);                       // ?cycle_id=&stage=&dept=&q=
router.get("/admin/appraisals/:appraisal_id", validate(S.hrAppraisalSchema), H, C.hrGet);
router.get("/admin/appraisals/:appraisal_id/evidence/:att_id", validate(S.hrEvidenceSchema), H, C.hrEvidence);
router.post("/admin/appraisals/:appraisal_id/rows", validate(S.hrRowCreateSchema), H, C.hrCreateRow);
router.put("/admin/appraisals/:appraisal_id/rows/:goal_id", validate(S.hrRowUpdateSchema), H, C.hrUpdateRow);
router.delete("/admin/appraisals/:appraisal_id/rows/:goal_id", validate(S.hrRowDeleteSchema), H, C.hrDeleteRow);
router.put("/admin/appraisals/:appraisal_id/adjust", validate(S.hrAdjustSchema), H, C.hrAdjust);   // {grade|null, reason}
router.put("/admin/appraisals/:appraisal_id/recommendations", validate(S.hrRecsSchema), H, C.hrRecommendations);
router.post("/admin/appraisals/:appraisal_id/decision", validate(S.hrDecisionSchema), H, C.hrDecide); // {decision: approve|return, remarks}
router.put("/admin/appraisals/:appraisal_id/approvers", validate(S.hrReassignSchema), H, C.hrReassign);
router.post("/admin/appraisals/:appraisal_id/cancel", validate(S.hrCancelSchema), H, C.hrCancel);

// ── HR: promotion evaluation (sheets 1–5) ──────────────────────────────────
router.get("/admin/promotion-cases", validate(S.hrCasesSchema), H, C.hrCases);
router.get("/admin/promotion-cases/:case_id", validate(S.hrCaseSchema), H, C.hrCase);
router.put("/admin/promotion-cases/:case_id/eligibility", validate(S.hrEligibilitySchema), H, C.hrEligibility);
router.post("/admin/promotion-cases/:case_id/eligibility/submit", validate(S.hrCaseSchema), H, C.hrSubmitEligibility);
router.put("/admin/promotion-cases/:case_id/history", validate(S.hrHistorySchema), H, C.hrHistory);
router.put("/admin/promotion-cases/:case_id/scorecard", validate(S.hrScorecardSchema), H, C.hrScorecard);
router.post("/admin/promotion-cases/:case_id/review/submit", validate(S.hrCaseSchema), H, C.hrSubmitReview);
router.post("/admin/promotion-cases/:case_id/signoff", validate(S.hrSignoffSchema), H, C.hrCaseSignoff);
router.post("/admin/promotion-cases/:case_id/ceo-decision", validate(S.hrCeoSchema), H, C.hrCeoDecision);
router.post("/admin/promotion-cases/:case_id/cancel", validate(S.hrCaseCancelSchema), H, C.hrCancelCase);

// ── HR: recommendations / apply ────────────────────────────────────────────
router.get("/admin/recommendations", validate(S.recListSchema), H, C.listRecommendations);         // ?cycle_id=&kind=&status=
router.post("/admin/recommendations/increment/:rec_id/apply", validate(S.applyIncrementSchema), H, C.applyIncrement);
router.post("/admin/recommendations/promotion/:rec_id/apply", validate(S.applyPromotionSchema), H, C.applyPromotion);
router.post("/admin/recommendations/:kind/:rec_id/reject", validate(S.recRejectSchema), H, C.rejectRecommendation);

// ── HR: dashboard / reports / summary sheet ────────────────────────────────
router.get("/admin/dashboard", validate(S.dashboardSchema), H, C.dashboard);                        // ?cycle_id=
router.get("/admin/reports", validate(S.hrListSchema), H, C.reportTypes);
router.get("/admin/reports/:type", validate(S.reportSchema), H, C.runReport);                       // ?cycle_id=&dept=&empcode=&limit=
router.get("/admin/summary-sheet", validate(S.summarySchema), H, C.summarySheet);                   // ?cycle_id=&dept=
router.put("/admin/profiles/:empcode", validate(S.profileSchema), H, C.saveProfile);                // prior experience, category, resource type, remarks

// ── Employee ───────────────────────────────────────────────────────────────
router.get("/me/:card_no/appraisals", validate(S.myListSchema), E, C.myList);
router.get("/me/:card_no/history", validate(S.myListSchema), E, C.myHistory);
router.get("/me/:card_no/appraisals/:appraisal_id", validate(S.myAppraisalSchema), E, C.myGet);
router.post("/me/:card_no/appraisals/:appraisal_id/rows", validate(S.myRowCreateSchema), E, C.myCreateRow);
router.put("/me/:card_no/appraisals/:appraisal_id/rows/:goal_id", validate(S.myRowUpdateSchema), E, C.myUpdateRow);
router.delete("/me/:card_no/appraisals/:appraisal_id/rows/:goal_id", validate(S.myRowDeleteSchema), E, C.myDeleteRow);
router.post("/me/:card_no/appraisals/:appraisal_id/objectives/submit", validate(S.mySubmitSchema), E, C.mySubmitObjectives);
router.put("/me/:card_no/appraisals/:appraisal_id/midyear", validate(S.myMidYearSchema), E, C.mySaveMidYear);
router.post("/me/:card_no/appraisals/:appraisal_id/midyear/submit", validate(S.mySubmitSchema), E, C.mySubmitMidYear);
router.post("/me/:card_no/appraisals/:appraisal_id/acknowledge", validate(S.myAckSchema), E, C.myAcknowledge);
router.post("/me/:card_no/appraisals/:appraisal_id/evidence", uploadEvidence, validate(S.myEvidenceUploadSchema), E, C.myUploadEvidence); // multipart "file" (+ emp_goal_id)
router.get("/me/:card_no/appraisals/:appraisal_id/evidence/:att_id", validate(S.myEvidenceSchema), E, C.myEvidence);
router.delete("/me/:card_no/appraisals/:appraisal_id/evidence/:att_id", validate(S.myEvidenceSchema), E, C.myDeleteEvidence);
router.get("/me/:card_no/promotion-cases", validate(S.myListSchema), E, C.myCases);
router.get("/me/:card_no/promotion-cases/:case_id", validate(S.myCaseSchema), E, C.myCase);
router.put("/me/:card_no/promotion-cases/:case_id/self-assessment", validate(S.mySelfAssessSchema), E, C.mySaveSelfAssessment);
router.post("/me/:card_no/promotion-cases/:case_id/self-assessment/submit", validate(S.myCaseSchema), E, C.mySubmitSelfAssessment);

// ── Reviewer (line manager / HODs / CEO) ───────────────────────────────────
router.get("/review/:card_no/inbox", validate(S.reviewInboxSchema), E, C.reviewInbox);             // {is_reviewer, pending, items, cases}
router.get("/review/:card_no/appraisals/:appraisal_id", validate(S.reviewGetSchema), E, C.reviewGet);
router.get("/review/:card_no/appraisals/:appraisal_id/lookups", validate(S.reviewGetSchema), E, C.reviewLookups);
router.get("/review/:card_no/appraisals/:appraisal_id/evidence/:att_id", validate(S.reviewEvidenceSchema), E, C.reviewEvidence);
router.post("/review/:card_no/appraisals/:appraisal_id/rows", validate(S.reviewRowCreateSchema), E, C.reviewCreateRow);
router.put("/review/:card_no/appraisals/:appraisal_id/rows/:goal_id", validate(S.reviewRowUpdateSchema), E, C.reviewUpdateRow);
router.delete("/review/:card_no/appraisals/:appraisal_id/rows/:goal_id", validate(S.reviewRowDeleteSchema), E, C.reviewDeleteRow);
router.put("/review/:card_no/appraisals/:appraisal_id/ratings", validate(S.reviewRatingsSchema), E, C.reviewRatings);
router.put("/review/:card_no/appraisals/:appraisal_id/recommendations", validate(S.reviewRecsSchema), E, C.reviewRecommendations);
router.post("/review/:card_no/appraisals/:appraisal_id/decision", validate(S.reviewDecisionSchema), E, C.reviewDecide);
router.get("/review/:card_no/promotion-cases/:case_id", validate(S.reviewCaseSchema), E, C.reviewCase);
router.get("/review/:card_no/promotion-cases/:case_id/lookups", validate(S.reviewCaseSchema), E, C.reviewCaseLookups);
router.put("/review/:card_no/promotion-cases/:case_id/competencies", validate(S.reviewRateCaseSchema), E, C.reviewRateCase); // {competencies, submit?}
router.post("/review/:card_no/promotion-cases/:case_id/signoff", validate(S.reviewCaseSignoffSchema), E, C.reviewCaseSignoff);
router.post("/review/:card_no/promotion-cases/:case_id/hod-decision", validate(S.reviewHodFinalSchema), E, C.reviewHodFinal);
router.post("/review/:card_no/promotion-cases/:case_id/ceo-decision", validate(S.reviewCeoSchema), E, C.reviewCeoFinal);

export default router;
