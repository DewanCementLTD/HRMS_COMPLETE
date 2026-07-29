import { Router } from "express";
import { validate } from "../middlewares/validate.middleware.js";
import { requireHrAdmin } from "../middlewares/hrAdmin.middleware.js";
import { reportQuerySchema } from "../models/reports.schema.js";
import * as controller from "../controllers/reports.controller.js";

const router = Router();

// All routes require HR admin authentication via admin_card_no query param
router.get("/absent-supp", validate(reportQuerySchema), requireHrAdmin, controller.getAbsentSuppReport);
router.get("/allowance-detail", validate(reportQuerySchema), requireHrAdmin, controller.getAllowanceDetailReport);
router.get("/allowance-recon", validate(reportQuerySchema), requireHrAdmin, controller.getAllowanceReconReport);
router.get("/deduction-detail", validate(reportQuerySchema), requireHrAdmin, controller.getDeductionDetailReport);
router.get("/deduction-recon", validate(reportQuerySchema), requireHrAdmin, controller.getDeductionReconReport);
router.get("/month-wise-deduction", validate(reportQuerySchema), requireHrAdmin, controller.getMonthWiseDeductionReport);
router.get("/bank-advice", validate(reportQuerySchema), requireHrAdmin, controller.getBankAdviceReport);
router.get("/active-employees", validate(reportQuerySchema), requireHrAdmin, controller.getActiveEmployeesReport);
router.get("/pf-detail", validate(reportQuerySchema), requireHrAdmin, controller.getPfDetailReport);

export default router;
