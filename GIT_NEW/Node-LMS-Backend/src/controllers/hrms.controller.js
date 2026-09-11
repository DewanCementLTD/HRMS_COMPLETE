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
  resetEmployeePassword,
  getEmployeeByEmpcode,
  getEmployeeCard,
  updateEmployee,
  searchEmployeesHrms,
  listEmployeesHrms,
  getHrDashboardStats,
  getHrAnalytics,
  getBulkAttendanceSummary,
  getBulkAttendanceDetails,
  getUnpostedPunches,
  getEmployeeRoster,
  updateRosterEntry,
  bulkUpdateRosterShift,
  getRosterDaysInRange,
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

    // BASIC is derived by TRG_HR_EMP_MASTER_BIU (gross / 1.55), so it is never
    // accepted from a client.
    delete data.basic;

    // Only ULEVL='M' admins may set the gross salary.
    if (!(await adminCanEditSalary(admin_card_no))) {
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

    // Drop null/undefined fields (mirrors request.model_dump(exclude_none=True)),
    // except the HOD columns: there a null is the instruction to clear the
    // approver, and dropping it would make "remove HOD" a silent no-op.
    const CLEARABLE = new Set(["hod1", "hod2", "hod3"]);
    const data = {};
    for (const [k, v] of Object.entries(res.locals.validated.body)) {
      if (v !== undefined && (v !== null || CLEARABLE.has(k))) data[k] = v;
    }

    // BASIC is derived by the DB: TRG_HR_EMP_MASTER_BIU sets it to gross / 1.55
    // on insert and on every gross change. Accepting it here would let a stale
    // value stick on an update that doesn't touch gross.
    delete data.basic;

    if (!(await adminCanEditSalary(admin_card_no))) {
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

// GET /hrms/attendance/unposted — app punches the ERP roster never took, i.e.
// days HRMS is reporting as absent for someone who did mark attendance.
export const unpostedPunches = async (req, res, next) => {
  try {
    const { admin_card_no, from_date, to_date, compc, brnch } = res.locals.validated.query;
    const { finalCompanies, finalBranches } = await resolveFilterLists(admin_card_no, compc, brnch);
    const items = await getUnpostedPunches(from_date, to_date, finalCompanies, finalBranches);
    res.json({ items, count: items.length, from_date, to_date });
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

// PUT /hrms/duty-roster/bulk — apply one shift to every roster day in a range.
export const bulkEditDutyRosterShift = async (req, res, next) => {
  try {
    const { admin_card_no, compc, brnch } = res.locals.validated.query;
    const { card_no, from_date, to_date, shift, dates } = res.locals.validated.body;

    // Same audit stamp format the single-row edit writes.
    const now = new Date();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const stamp = `${admin_card_no} ${String(now.getDate()).padStart(2, "0")}-${months[now.getMonth()]}-`
      + `${String(now.getFullYear()).slice(-2)} ${String(now.getHours()).padStart(2, "0")}:`
      + `${String(now.getMinutes()).padStart(2, "0")}`;

    // The branch is re-resolved from the admin's rights, never trusted raw.
    // finalBranches is the admin's allowed set; a branch outside it is dropped,
    // leaving the update scoped to the employee alone.
    const { finalBranches } = await resolveFilterLists(admin_card_no, compc, brnch);
    const requested = String(brnch ?? "").trim();
    const branch = requested && (finalBranches ?? []).map(String).includes(requested)
      ? requested
      : null;
    const result = await bulkUpdateRosterShift(card_no, from_date, to_date, shift, stamp, branch, dates);
    if (result.status === "error") return res.status(400).json({ detail: result.message });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

// GET /hrms/duty-roster/days — the rostered days in a range, so the bulk-shift
// dialog can list them for HR to pick from.
export const dutyRosterDays = async (req, res, next) => {
  try {
    const { admin_card_no, card_no, from_date, to_date, compc, brnch } = res.locals.validated.query;

    // Resolved from the admin's own rights, exactly as the update does.
    const { finalBranches } = await resolveFilterLists(admin_card_no, compc, brnch);
    const requested = String(brnch ?? "").trim();
    const branch = requested && (finalBranches ?? []).map(String).includes(requested)
      ? requested
      : null;

    const result = await getRosterDaysInRange(card_no, from_date, to_date, branch);
    if (result.status === "error") return res.status(400).json({ detail: result.message });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

// POST /hrms/employees/:empcode/reset-password — HR restores the employee's
// login password to the initial one on their HRMS record (or sets a new one).
export const resetPassword = async (req, res, next) => {
  try {
    const { empcode } = res.locals.validated.params;
    const { password } = res.locals.validated.body ?? {};
    const result = await resetEmployeePassword(empcode, password);
    if (result.status === "error") return res.status(400).json({ detail: result.message });
    res.json(result);
  } catch (err) {
    next(err);
  }
};
