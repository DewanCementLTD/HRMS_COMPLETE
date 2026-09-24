import { Router } from 'express';
import { validate } from '../middlewares/validate.middleware.js';
import { requireHrAdmin } from '../middlewares/hrAdmin.middleware.js';
import { orgChartCompanySchema, orgChartBranchSchema } from '../models/orgChart.schema.js';
import { companyOrgChart, branchOrgChart } from '../controllers/orgChart.controller.js';

const router = Router();
// Mounted at /org-chart.

// Company-wide view (HR admin only, scoped via resolveFilterLists).
router.get('/company', validate(orgChartCompanySchema), requireHrAdmin, companyOrgChart); // [x] http://localhost:8000/org-chart/company?admin_card_no=100001.1

// Branch-only view (any employee, self-service — scoped to their own branch).
router.get('/branch', validate(orgChartBranchSchema), branchOrgChart); // [x] http://localhost:8000/org-chart/branch?card_no=100660.1

export default router;
