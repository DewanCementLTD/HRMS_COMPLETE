import { Router } from "express";
import { validate } from "../middlewares/validate.middleware.js";
import { requireHrAdmin } from "../middlewares/hrAdmin.middleware.js";
import * as schemas from "../models/reports.schema.js";
import * as controller from "../controllers/reports.controller.js";

const router = Router();

// All routes require HR admin authentication via admin_card_no query param.
// Company/branch scope is re-resolved in the controller against the admin's
// rights, so compc/brnch in the query string are a request, not a grant.

// Filter-bar lookups (periods for this unit + designation groups).
router.get("/lookups", validate(schemas.lookupsSchema), requireHrAdmin, controller.getLookups);

// ── Payroll reports ──
router.get("/allowance-detail", validate(schemas.allowanceDetailSchema), requireHrAdmin, controller.getAllowanceDetailReport);
router.get("/allowance-recon", validate(schemas.allowanceReconSchema), requireHrAdmin, controller.getAllowanceReconReport);
router.get("/deduction-detail", validate(schemas.deductionDetailSchema), requireHrAdmin, controller.getDeductionDetailReport);
router.get("/deduction-recon", validate(schemas.deductionReconSchema), requireHrAdmin, controller.getDeductionReconReport);
router.get("/month-wise-deduction", validate(schemas.monthWiseDeductionSchema), requireHrAdmin, controller.getMonthWiseDeductionReport);
router.get("/bank-advice", validate(schemas.bankAdviceSchema), requireHrAdmin, controller.getBankAdviceReport);
router.get("/pf-detail", validate(schemas.pfDetailSchema), requireHrAdmin, controller.getPfDetailReport);

// ── General reports ──
router.get("/absent-supp", validate(schemas.absentSuppSchema), requireHrAdmin, controller.getAbsentSuppReport);
router.get("/active-employees", validate(schemas.activeEmployeesSchema), requireHrAdmin, controller.getActiveEmployeesReport);

export default router;
