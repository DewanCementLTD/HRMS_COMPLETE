/**
 * HRMS controllers — thin request/response handlers for the /hrms/* routes.
 *
 * HR-admin access is enforced by the requireHrAdmin middleware before these
 * run. The company/branch rights are resolved server-side via
 * resolveFilterLists (never trusting the raw compc/brnch query params), exactly
 * as the FastAPI hrms_router does with _resolve_filter_lists.
 */

import { resolveFilterLists, adminCanEditSalary } from "../services/adminRights.service.js";
import {
  createEmployee,
  getEmployeeByEmpcode,
  getEmployeeCard,
  updateEmployee,
  searchEmployeesHrms,
  listEmployeesHrms,
  getHrDashboardStats,
  getHrAnalytics,
  getBulkAttendanceSummary,
  getBulkAttendanceDetails,
  getEmployeeRoster,
  updateRosterEntry,
} from "../services/hrms.service.js";

// GET /hrms/dashboard
export const dashboard = async (req, res, next) => {
  try {
    const { admin_card_no, date, compc, brnch } = res.locals.validated.query;
    const { finalCompanies, finalBranches } = await resolveFilterLists(admin_card_no, compc, brnch);
    res.json(await getHrDashboardStats(date ?? null, finalCompanies, finalBranches));
  } catch (err) {
    next(err);
  }
};

// GET /hrms/dashboard/analytics
export const analytics = async (req, res, next) => {
  try {
    const { admin_card_no, date, compc, brnch } = res.locals.validated.query;
    const { finalCompanies, finalBranches } = await resolveFilterLists(admin_card_no, compc, brnch);
    res.json(await getHrAnalytics(date ?? null, finalCompanies, finalBranches));
  } catch (err) {
    next(err);
  }
};

// GET /hrms/employees
export const listEmployees = async (req, res, next) => {
  try {
    const { admin_card_no, status, compc, brnch } = res.locals.validated.query;
    const { finalCompanies, finalBranches } = await resolveFilterLists(admin_card_no, compc, brnch);
    res.json({ items: await listEmployeesHrms(status ?? null, finalCompanies, finalBranches) });
  } catch (err) {
    next(err);
  }
};

// GET /hrms/employees/search
export const searchEmployees = async (req, res, next) => {
  try {
    const { q, admin_card_no, compc, brnch } = res.locals.validated.query;
    const { finalCompanies, finalBranches } = await resolveFilterLists(admin_card_no, compc, brnch);
    res.json({ items: await searchEmployeesHrms(q, finalCompanies, finalBranches) });
  } catch (err) {
    next(err);
  }
};

// GET /hrms/employees/:empcode
export const getEmployee = async (req, res, next) => {
  try {
    const { empcode } = res.locals.validated.params;
    const emp = await getEmployeeByEmpcode(empcode);
    if (!emp) return res.status(404).json({ detail: "Employee not found" });
    res.json(emp);
  } catch (err) {
    next(err);
  }
};

// GET /hrms/employees/:empcode/card
export const getEmployeeIdCard = async (req, res, next) => {
  try {
    const { empcode } = res.locals.validated.params;
    const card = await getEmployeeCard(empcode);
    if (!card) return res.status(404).json({ detail: "Employee not found" });
    res.json(card);
  } catch (err) {
    next(err);
  }
};

// POST /hrms/employees
export const registerEmployee = async (req, res, next) => {
  try {
    const { admin_card_no } = res.locals.validated.query;
    const data = { ...res.locals.validated.body };

    // Only ULEVL='M' admins may set basic/gross salary.
    if (!(await adminCanEditSalary(admin_card_no))) {
      delete data.basic;
      delete data.gross;
    }

    const result = await createEmployee(data);
    if (result.status === "error") {
      return res.status(400).json({ detail: result.message || "Registration failed" });
    }
    res.json({
      status: "success",
      message: `Employee registered successfully with EMPCODE: ${result.empcode}`,
      empcode: result.empcode,
    });
  } catch (err) {
    next(err);
  }
};

// PUT /hrms/employees/:empcode
export const editEmployee = async (req, res, next) => {
  try {
    const { empcode } = res.locals.validated.params;
    const { admin_card_no } = res.locals.validated.query;

    const existing = await getEmployeeByEmpcode(empcode);
    if (!existing) return res.status(404).json({ detail: "Employee not found" });

    // Drop null/undefined fields (mirrors request.model_dump(exclude_none=True)).
    const data = {};
    for (const [k, v] of Object.entries(res.locals.validated.body)) {
      if (v !== null && v !== undefined) data[k] = v;
    }

    if (!(await adminCanEditSalary(admin_card_no))) {
      delete data.basic;
      delete data.gross;
    }

    const result = await updateEmployee(empcode, data);
    if (result.status === "error") {
      return res.status(400).json({ detail: result.message || "Update failed" });
    }
    res.json({ status: "success", message: result.message || "Employee updated successfully" });
  } catch (err) {
    next(err);
  }
};

// GET /hrms/attendance/bulk
export const bulkAttendance = async (req, res, next) => {
  try {
    const { admin_card_no, from_date, to_date, compc, brnch } = res.locals.validated.query;
    const { finalCompanies, finalBranches } = await resolveFilterLists(admin_card_no, compc, brnch);
    const items = await getBulkAttendanceSummary(from_date, to_date, finalCompanies, finalBranches);
    res.json({ items, from_date, to_date });
  } catch (err) {
    next(err);
  }
};

// GET /hrms/attendance/details
export const attendanceDetails = async (req, res, next) => {
  try {
    const { admin_card_no, from_date, to_date, compc, brnch } = res.locals.validated.query;
    const { finalCompanies, finalBranches } = await resolveFilterLists(admin_card_no, compc, brnch);
    const items = await getBulkAttendanceDetails(from_date, to_date, finalCompanies, finalBranches);
    res.json({ items, from_date, to_date });
  } catch (err) {
    next(err);
  }
};

// GET /hrms/duty-roster/:card_no
export const employeeDutyRoster = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const { month } = res.locals.validated.query;
    res.json(await getEmployeeRoster(card_no, month ?? null));
  } catch (err) {
    next(err);
  }
};

// PUT /hrms/duty-roster/entry/:pk
export const editDutyRosterEntry = async (req, res, next) => {
  try {
    const { pk } = res.locals.validated.params;
    const { admin_card_no } = res.locals.validated.query;
    const { shift, remarks } = res.locals.validated.body;
    
    // In Node.js, we don't have datetime.now():%d-%b-%y %H:%M exactly built-in easily
    // Let's format it manually similar to FastAPI
    const now = new Date();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const d = String(now.getDate()).padStart(2, '0');
    const m = months[now.getMonth()];
    const y = String(now.getFullYear()).slice(-2);
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const stamp = `${admin_card_no} ${d}-${m}-${y} ${h}:${min}`;

    const result = await updateRosterEntry(pk, shift, remarks, stamp);
    if (result.status === "error") {
      return res.status(400).json({ detail: result.message });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
};
