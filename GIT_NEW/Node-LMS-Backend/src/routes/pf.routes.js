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

// Mounted at /pf. HR admin only; the employee's own view is /auth/pf/:card_no.
const router = Router();

router.get("/summary", validate(pfSummarySchema), requireHrAdmin, pfSummary);                                // GET /pf/summary?admin_card_no=&compc=&brnch=
router.get("/members", validate(pfMembersSchema), requireHrAdmin, pfMembers);                                // GET /pf/members?admin_card_no=&compc=&scope=members|all&q=
router.get("/members/:empcode/statement", validate(pfStatementSchema), requireHrAdmin, pfStatement);         // GET /pf/members/100038.1/statement?admin_card_no=&compc=
router.put("/members/:empcode/opening", validate(pfOpeningSchema), requireHrAdmin, pfSetOpening);            // PUT   {amount}
router.patch("/members/:empcode/membership", validate(pfMembershipSchema), requireHrAdmin, pfSetMembership); // PATCH {pf_ind:"Y"|"N", member_since?}
router.get("/loans", validate(pfLoansSchema), requireHrAdmin, pfLoans);                                      // GET /pf/loans?admin_card_no=&compc=

export default router;
