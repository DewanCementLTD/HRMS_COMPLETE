import { Router } from 'express';
import { validate } from '../middlewares/validate.middleware.js';
import { resetPasswordSchema } from '../models/hrms.schema.js';
import {
  hodOptionsSchema, leaveOpeningListSchema, leaveOpeningScopeSchema, leaveOpeningSaveSchema,
} from '../models/leave.schema.js';
import {
  getLeaveOpenings, getLeaveOpeningYears, getAllocatableEmployees, postLeaveOpening,
} from '../controllers/leaveOpening.controller.js';
import { getHodOptions } from '../controllers/leave.controller.js';
import { requireHrAdmin } from '../middlewares/hrAdmin.middleware.js';
// Schemas
import {
  dashboardQuerySchema,
  listEmployeesSchema,
  searchEmployeesSchema,
  employeeDetailSchema,
  createEmployeeSchema,
  updateEmployeeSchema,
  attendanceReportSchema,
  dutyRosterSchema,
  updateDutyRosterEntrySchema,
  bulkDutyRosterShiftSchema,
  rosterDaysSchema,
} from '../models/hrms.schema.js';
// Controllers
import {
  dashboard,
  analytics,
  listEmployees,
  searchEmployees,
  getEmployee,
  getEmployeeIdCard,
  registerEmployee,
  editEmployee,
  bulkAttendance,
  attendanceDetails,
  unpostedPunches,
  employeeDutyRoster,
  editDutyRosterEntry,
  bulkEditDutyRosterShift,
  dutyRosterDays,
  resetPassword,
} from '../controllers/hrms.controller.js';

const router = Router();
// Mounted at /hrms. Every route requires HR-admin access (admin_card_no query param).
// validate() runs first so requireHrAdmin can read res.locals.validated.query.admin_card_no.

// ---------------------------------------------------------------------------
// Dashboard  (static routes)
// ---------------------------------------------------------------------------
router.get('/dashboard/analytics', validate(dashboardQuerySchema), requireHrAdmin, analytics); // [x] http://localhost:8000/hrms/dashboard/analytics?admin_card_no=100001.1&date=2026-07-01
router.get('/dashboard',           validate(dashboardQuerySchema), requireHrAdmin, dashboard); // [X] http://localhost:8000/hrms/dashboard?admin_card_no=100001.1&date=2026-07-01

// ---------------------------------------------------------------------------
// Attendance reports  (static routes)
// ---------------------------------------------------------------------------
router.get('/attendance/bulk',    validate(attendanceReportSchema), requireHrAdmin, bulkAttendance); // [X] http://localhost:8000/hrms/attendance/bulk?admin_card_no=100001.1&from_date=2026-06-01&to_date=2026-06-30
router.get('/attendance/details', validate(attendanceReportSchema), requireHrAdmin, attendanceDetails);  // [x] http://localhost:8000/hrms/attendance/details?admin_card_no=100001.1&from_date=2026-06-01&to_date=2026-06-30
router.get('/attendance/unposted', validate(attendanceReportSchema), requireHrAdmin, unpostedPunches); // [x] http://localhost:8000/hrms/attendance/unposted?admin_card_no=100001.1&from_date=2026-08-11&to_date=2026-09-10  — app punches the ERP duty roster never took

// ---------------------------------------------------------------------------
// Leave allocation (LEAVE_OP) — HR grants each employee their yearly leave.
// Company scope is resolved from the admin's rights, never the raw compc param.
router.get( '/leave-openings/years',     validate(leaveOpeningScopeSchema), requireHrAdmin, getLeaveOpeningYears); // [x] http://localhost:8003/hrms/leave-openings/years?admin_card_no=100001.1&compc=1
router.get( '/leave-openings/employees', validate(leaveOpeningScopeSchema), requireHrAdmin, getAllocatableEmployees); // [x] http://localhost:8003/hrms/leave-openings/employees?admin_card_no=100001.1&compc=1
router.get( '/leave-openings',           validate(leaveOpeningListSchema),  requireHrAdmin, getLeaveOpenings); // [x] http://localhost:8003/hrms/leave-openings?admin_card_no=100001.1&compc=1&year=2026
router.post('/leave-openings',           validate(leaveOpeningSaveSchema),  requireHrAdmin, postLeaveOpening); // [x] http://localhost:8003/hrms/leave-openings?admin_card_no=100001.1&compc=1  Body: {"card_no":"100299.1","year":2026,"entries":[{"leave_type_fk":1,"op_bal":12}]}

// HOD list of values for the employee form's HOD 1 / HOD 2 fields, scoped to
// the selected company.
router.get( '/hod-options', validate(hodOptionsSchema), requireHrAdmin, getHodOptions); // [x] http://localhost:8003/hrms/hod-options?admin_card_no=100001.1&compc=1

// Employees  (specific routes BEFORE the /:empcode wildcard)
// ---------------------------------------------------------------------------
router.get( '/employees/search',        validate(searchEmployeesSchema), requireHrAdmin, searchEmployees);   // [x] http://localhost:8000/hrms/employees/search?q=ali&admin_card_no=100001.1
router.get( '/employees/:empcode/card', validate(employeeDetailSchema),  requireHrAdmin, getEmployeeIdCard); // [x] http://localhost:8000/hrms/employees/100660.1/card?admin_card_no=100001.1
router.post('/employees/:empcode/reset-password', validate(resetPasswordSchema), requireHrAdmin, resetPassword); // [x] http://localhost:8003/hrms/employees/100684.1/reset-password?admin_card_no=100001.1  Body: {} or {"password":"newpass123"}
router.get( '/employees/:empcode',      validate(employeeDetailSchema),  requireHrAdmin, getEmployee);       // [x] http://localhost:8000/hrms/employees/100660.1?admin_card_no=100001.1
router.put( '/employees/:empcode',      validate(updateEmployeeSchema),  requireHrAdmin, editEmployee);      // [x] http://localhost:8000/hrms/employees/100660.1?admin_card_no=100001.1 {"email": "hahaha@.com"}
router.get( '/employees',               validate(listEmployeesSchema),   requireHrAdmin, listEmployees);     // [x] http://localhost:8000/hrms/employees?admin_card_no=100001.1&status=A
router.post('/employees',               validate(createEmployeeSchema),  requireHrAdmin, registerEmployee);  // [x] http://localhost:8000/hrms/employees?admin_card_no=100394.1 

// ---------------------------------------------------------------------------
// Duty roster  (read-only, ERP-owned DUTY_ROSTER)
// ---------------------------------------------------------------------------
router.put('/duty-roster/bulk', validate(bulkDutyRosterShiftSchema), requireHrAdmin, bulkEditDutyRosterShift); // [x] http://localhost:8003/hrms/duty-roster/bulk?admin_card_no=100001.1  Body: {"card_no":"100002.1","from_date":"2026-09-01","to_date":"2026-09-30","shift":"G"}
router.get('/duty-roster/days', validate(rosterDaysSchema), requireHrAdmin, dutyRosterDays); // [x] http://localhost:8003/hrms/duty-roster/days?admin_card_no=100001.1&card_no=100002.1&from_date=2026-09-01&to_date=2026-09-15
router.get('/duty-roster/:card_no', validate(dutyRosterSchema), requireHrAdmin, employeeDutyRoster); // [X] http://localhost:8000/hrms/duty-roster/100108.1?admin_card_no=100001.1&month=MAY-26
router.put('/duty-roster/entry/:pk', validate(updateDutyRosterEntrySchema), requireHrAdmin, editDutyRosterEntry); // [x] http://localhost:8000/hrms/duty-roster/entry/1234?admin_card_no=100001.1

export default router;
