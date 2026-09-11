/**
 * Controller handlers for /reports/*.
 *
 * Company/branch scope is enforced here, not in the client. `resolveCompany`
 * clamps the requested company to the ones the HR admin actually has rights to
 * (falling back to their first allowed company), and `resolveBranch` returns
 * null when the sidebar is on "All Branches" — which is exactly the
 * `NVL(:mloc, a.location)` semantics the report SQL already uses. compc maps to
 * UNIT_ID and brnch to LOCATION, the same mapping used across hrmsFilters.js
 * and the payroll modules.
 *
 * The resolved unit/location are what reach the binds, so a caller cannot widen
 * its own scope by editing the query string. Report-specific filters
 * (designation, department, period range, …) are applied on top.
 */

import { resolveCompany, resolveBranch } from "../utils/payrollShared.js";
import * as reportsService from "../services/reports.service.js";

// Resolve the { unitId, location } scope shared by every report.
const scope = async (query) => {
  const { admin_card_no, compc, brnch } = query;
  const unitId = await resolveCompany(admin_card_no, compc);
  const location = await resolveBranch(admin_card_no, compc, brnch);
  return { unitId, location };
};

// Every report handler is the same shape: resolve scope, call the service,
// return { status, data }. `build` maps the validated query onto service args.
const handler = (serviceFn, build) => async (req, res, next) => {
  try {
    const query = res.locals.validated.query;
    const { unitId, location } = await scope(query);
    const data = await serviceFn({ unitId, location, ...build(query) });
    res.json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};

// GET /reports/lookups — periods + designation groups for the filter bar.
export const getLookups = async (req, res, next) => {
  try {
    const { unitId } = await scope(res.locals.validated.query);
    const [periods, desg_groups, deductions] = await Promise.all([
      reportsService.listReportPeriods(unitId),
      reportsService.listDesgGroups(),
      reportsService.listDeductionTypes(),
    ]);
    res.json({ status: "success", data: { unit_id: unitId, periods, desg_groups, deductions } });
  } catch (err) {
    next(err);
  }
};

export const getAllowanceDetailReport = handler(
  reportsService.getAllowanceDetailReport,
  (q) => ({ periodFrom: q.period_from, periodTo: q.period_to, empcode: q.empcode, rtype: q.rtype })
);

export const getDeductionDetailReport = handler(
  reportsService.getDeductionDetailReport,
  (q) => ({ periodFrom: q.period_from, periodTo: q.period_to, empcode: q.empcode, rtype: q.rtype })
);

export const getAllowanceReconReport = handler(
  reportsService.getAllowanceReconReport,
  (q) => ({ periodFrom: q.period_from, periodTo: q.period_to, empcode: q.empcode })
);

export const getDeductionReconReport = handler(
  reportsService.getDeductionReconReport,
  (q) => ({ periodFrom: q.period_from, periodTo: q.period_to, empcode: q.empcode })
);

export const getMonthWiseDeductionReport = handler(
  reportsService.getMonthWiseDeductionReport,
  (q) => ({
    periodFrom: q.period_from, periodTo: q.period_to,
    deductionId: q.deduction_id, deptNo: q.dept_no, empcode: q.empcode,
  })
);

export const getBankAdviceReport = handler(
  reportsService.getBankAdviceReport,
  (q) => ({ period: q.period, desgGrp: q.desg_grp, transId: q.trans_id, rtype: q.rtype })
);

export const getAbsentSuppReport = handler(
  reportsService.getAbsentSuppReport,
  (q) => ({ period: q.period, deptNo: q.dept_no })
);

export const getMonthlyAttendanceReport = handler(
  reportsService.getMonthlyAttendanceReport,
  (q) => ({ fromDate: q.from_date, toDate: q.to_date, deptNo: q.dept_no })
);

export const getActiveEmployeesReport = handler(
  reportsService.getActiveEmployeesReport,
  (q) => ({
    rtype: q.rtype, empcode: q.empcode, empStatus: q.emp_status,
    grossFrom: q.gross_from, grossTo: q.gross_to,
    desgCd: q.desg_cd, deptNo: q.dept_no, desgGrp: q.desg_grp, gradeCd: q.grade_cd,
  })
);

export const getPfDetailReport = handler(
  reportsService.getPfDetailReport,
  (q) => ({ empcode: q.empcode })
);
