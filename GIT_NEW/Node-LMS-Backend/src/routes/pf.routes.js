import { Router } from "express";
import { validate } from "../middlewares/validate.middleware.js";
import { requireHrAdmin } from "../middlewares/hrAdmin.middleware.js";
import {
  pfSummarySchema, pfMembersSchema, pfLoansSchema, pfStatementSchema,
  pfOpeningSchema, pfMembershipSchema,
} from "../models/pf.schema.js";
import {
  pfSummary, pfMembers, pfLoans, pfStatement, pfSetOpening, pfSetMembership,
} from "../controllers/pf.controller.js";
import {
  getSettingsSchema, saveSettingsSchema,
  listRatesSchema, saveRateSchema, deleteRateSchema,
  listOpeningsSchema, saveOpeningSchema, deleteOpeningSchema, importOpeningsSchema,
  listWithdrawalsSchema, listZakatSchema, saveZakatSchema,
  statementSchema, settlementSchema, postYearSchema,
} from "../models/pfLedger.schema.js";
import {
  getPfSettings, putPfSettings,
  getPfRates, postPfRate, delPfRate,
  getPfOpenings, putPfOpening, delPfOpening, postPfOpeningsImport,
  getPfWithdrawals, getPfZakat, putPfZakat,
  getPfStatement, getPfSettlement, postPfYear,
} from "../controllers/pfLedger.controller.js";

// Mounted at /pf. HR admin only; the employee's own view is /auth/pf/:card_no.
const router = Router();

router.get("/summary", validate(pfSummarySchema), requireHrAdmin, pfSummary);                                // GET /pf/summary?admin_card_no=&compc=&brnch=
router.get("/members", validate(pfMembersSchema), requireHrAdmin, pfMembers);                                // GET /pf/members?admin_card_no=&compc=&scope=members|all&q=
router.get("/members/:empcode/statement", validate(pfStatementSchema), requireHrAdmin, pfStatement);         // GET /pf/members/100038.1/statement?admin_card_no=&compc=
router.put("/members/:empcode/opening", validate(pfOpeningSchema), requireHrAdmin, pfSetOpening);            // PUT   {amount}
router.patch("/members/:empcode/membership", validate(pfMembershipSchema), requireHrAdmin, pfSetMembership); // PATCH {pf_ind:"Y"|"N", member_since?}
router.get("/loans", validate(pfLoansSchema), requireHrAdmin, pfLoans);                                      // GET /pf/loans?admin_card_no=&compc=

// ── PF ledger: profit, 100% company share, PF loan markup, zakat, settlement ──
// (services/pfLedger.service.js + utils/pfEngine.js; tables in sql/2026-10-01_provident_fund.sql)
router.get("/settings", validate(getSettingsSchema), requireHrAdmin, getPfSettings);
router.put("/settings", validate(saveSettingsSchema), requireHrAdmin, putPfSettings);

// Yearly profit rate declared by the trustees (the only figure HR provides).
router.get("/rates", validate(listRatesSchema), requireHrAdmin, getPfRates);
router.post("/rates", validate(saveRateSchema), requireHrAdmin, postPfRate);
router.delete("/rates/:fy_from", validate(deleteRateSchema), requireHrAdmin, delPfRate);
router.post("/years/post", validate(postYearSchema), requireHrAdmin, postPfYear);

// Take-on balances for the ledger (bulk import from HR_PF_BALANCES, or per member).
router.post("/openings/import", validate(importOpeningsSchema), requireHrAdmin, postPfOpeningsImport);
router.get("/openings", validate(listOpeningsSchema), requireHrAdmin, getPfOpenings);
router.put("/openings/:empcode", validate(saveOpeningSchema), requireHrAdmin, putPfOpening);
router.delete("/openings/:empcode", validate(deleteOpeningSchema), requireHrAdmin, delPfOpening);

// Permanent withdrawals are HR_LOAN_MST rows of loan type 16 (entered in Payroll → Loans).
router.get("/withdrawals", validate(listWithdrawalsSchema), requireHrAdmin, getPfWithdrawals);

// Zakat exemption declaration per member (no declaration on file = 2.5% deducted at settlement).
router.get("/zakat", validate(listZakatSchema), requireHrAdmin, getPfZakat);
router.put("/zakat/:empcode", validate(saveZakatSchema), requireHrAdmin, putPfZakat);

router.get("/statement", validate(statementSchema), requireHrAdmin, getPfStatement);
router.get("/settlement", validate(settlementSchema), requireHrAdmin, getPfSettlement);

export default router;
