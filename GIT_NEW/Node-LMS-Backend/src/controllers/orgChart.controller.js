/**
 * Org chart controllers — thin handlers for /org-chart/*.
 *
 * /company is HR-admin gated and scoped via resolveFilterLists, exactly as
 * the /hrms/* listing endpoints are (never trusting raw compc/brnch).
 * /branch is employee self-service, scoped to the caller's own branch.
 */

import { resolveFilterLists } from "../services/adminRights.service.js";
import { empcodeForCard } from "../services/documents.service.js";
import { getOrgChartCompanyView, getOrgChartBranchView } from "../services/orgChart.service.js";

// GET /org-chart/company
export const companyOrgChart = async (req, res, next) => {
  try {
    const { admin_card_no, compc, brnch } = res.locals.validated.query;
    const { finalCompanies, finalBranches } = await resolveFilterLists(admin_card_no, compc, brnch);
    res.json({ items: await getOrgChartCompanyView(finalCompanies, finalBranches) });
  } catch (err) {
    next(err);
  }
};

// GET /org-chart/branch
export const branchOrgChart = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.query;
    const empcode = await empcodeForCard(card_no);
    if (!empcode) return res.status(404).json({ detail: "Employee not found" });
    res.json({ items: await getOrgChartBranchView(empcode) });
  } catch (err) {
    next(err);
  }
};
