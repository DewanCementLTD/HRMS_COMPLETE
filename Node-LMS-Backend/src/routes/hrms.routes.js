import { Router } from 'express';
import { validate } from '../middlewares/validate.middleware.js';
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
  employeeDutyRoster,
  editDutyRosterEntry,
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

// ---------------------------------------------------------------------------
// Employees  (specific routes BEFORE the /:empcode wildcard)
// ---------------------------------------------------------------------------
router.get( '/employees/search',        validate(searchEmployeesSchema), requireHrAdmin, searchEmployees);   // [x] http://localhost:8000/hrms/employees/search?q=ali&admin_card_no=100001.1
router.get( '/employees/:empcode/card', validate(employeeDetailSchema),  requireHrAdmin, getEmployeeIdCard); // [x] http://localhost:8000/hrms/employees/100660.1/card?admin_card_no=100001.1
router.get( '/employees/:empcode',      validate(employeeDetailSchema),  requireHrAdmin, getEmployee);       // [x] http://localhost:8000/hrms/employees/100660.1?admin_card_no=100001.1
router.put( '/employees/:empcode',      validate(updateEmployeeSchema),  requireHrAdmin, editEmployee);      // [x] http://localhost:8000/hrms/employees/100660.1?admin_card_no=100001.1 {"email": "hahaha@.com"}
router.get( '/employees',               validate(listEmployeesSchema),   requireHrAdmin, listEmployees);     // [x] http://localhost:8000/hrms/employees?admin_card_no=100001.1&status=A
router.post('/employees',               validate(createEmployeeSchema),  requireHrAdmin, registerEmployee);  // [x] http://localhost:8000/hrms/employees?admin_card_no=100394.1 

// ---------------------------------------------------------------------------
// Duty roster  (read-only, ERP-owned DUTY_ROSTER)
// ---------------------------------------------------------------------------
router.get('/duty-roster/:card_no', validate(dutyRosterSchema), requireHrAdmin, employeeDutyRoster); // [X] http://localhost:8000/hrms/duty-roster/100108.1?admin_card_no=100001.1&month=MAY-26
router.put('/duty-roster/entry/:pk', validate(updateDutyRosterEntrySchema), requireHrAdmin, editDutyRosterEntry); // [x] http://localhost:8000/hrms/duty-roster/entry/1234?admin_card_no=100001.1

export default router;
