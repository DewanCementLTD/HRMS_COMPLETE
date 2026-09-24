import { z } from "zod";

/**
 * Zod schemas for the /org-chart/* routes.
 *
 * validate() strips any query key not declared here, so admin_card_no (read
 * by requireHrAdmin from res.locals.validated.query) must stay present on
 * the company-view schema.
 */

// GET /org-chart/company (HR admin — all/filtered company & branch)
export const orgChartCompanySchema = z.object({
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
    compc: z.string().optional(),
    brnch: z.string().optional(),
  }),
});

// GET /org-chart/branch (employee self-service — own branch only)
export const orgChartBranchSchema = z.object({
  query: z.object({
    card_no: z.string().min(1, "card_no is required"),
  }),
});
