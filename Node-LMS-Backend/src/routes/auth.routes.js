import { Router } from 'express';
import { validate } from '../middlewares/validate.middleware.js';
import { requireHrAdmin } from '../middlewares/hrAdmin.middleware.js';
// Schemas
import { loginSchema, changePasswordSchema, card_noSchema, phoneSchema, emergencyContactSchema } from '../models/auth.schema.js';
import {
  faceAttendanceSchema,
  manualAttendanceSchema,
  attendanceRangeSchema,
  attendanceDateSchema,
  attendanceSummarySchema,
} from '../models/attendance.schema.js';
import { applyLeaveSchema } from '../models/leave.schema.js';
import {
  locationBatchSchema,
  locationHistorySchema,
  locationSummarySchema,
  locationReportSchema,
  myLocationHistorySchema,
} from '../models/location.schema.js';

// Controllers
import { login, profile, lookup, updatePassword, saveEmergencyContact } from '../controllers/auth.controller.js';
import { getDashboard } from '../controllers/dashboard.controller.js';
import {
  faceAttendance,
  manualAttendance,
  attendanceReportRange,
  attendanceReportByDate,
  attendanceSummary,
  attendanceReportPdf,
} from '../controllers/attendance.controller.js';
import { getLeaveBalances, getLeaveTypes, getLeaveStatus, applyLeave } from '../controllers/leave.controller.js';
import {
  locationBatch,
  locationHistory,
  locationSummary,
  locationReportSummary,
  locationTrail,
} from '../controllers/location.controller.js';

const router = Router();
// Append /auth to all routes defined in this file
// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
router.post('/login',                    validate(loginSchema),          login); // [x] POST http://localhost:8000/auth/login  (JSON body, NOT query params, no quotes around values) Body: {"username":"3363052865","password":"abcd1234"}
router.get( '/profile/:card_no',         validate(card_noSchema),        profile); // [x] http://localhost:8000/auth/profile/100002.1, 
router.get( '/lookup/:phone',            validate(phoneSchema),           lookup);     // [x] http://localhost:8000/auth/lookup/03363052865
router.post('/change-password/:card_no', validate(changePasswordSchema), updatePassword); // [x] http://localhost:8000/auth/change-password/100002.1  Body: {"old_password":"abcd1234","new_password":"newpass1"}
router.post('/emergency-contact/:card_no', validate(emergencyContactSchema), saveEmergencyContact); // [x] http://localhost:8000/auth/emergency-contact/100660.1 Body: {{ "name": "Khalid", "relationship": "Father", "phone": "03312463813" }} 


// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
router.get('/dashboard/:card_no', validate(card_noSchema), getDashboard); // [x] http://localhost:8000/auth/dashboard/100660.1

// ---------------------------------------------------------------------------
// Attendance  (specific routes BEFORE /:card_no wildcard)
// ---------------------------------------------------------------------------
router.post('/attendance/face',                          validate(faceAttendanceSchema),   faceAttendance); // http://localhost:8000/auth/attendance/face  Body: {"card_no":"100002.1","attendance_type":"check_in","latitude":24.8,"longitude":67.0}
router.get( '/attendance/summary',                       validate(attendanceSummarySchema), attendanceSummary); // [x] http://localhost:8000/auth/attendance/summary?emp_pk=100660.1&from_date=2026-06-01&to_date=2026-07-31
router.get( '/attendance/report-range/:card_no',         validate(attendanceRangeSchema),  attendanceReportRange); // [x] http://localhost:8000/auth/attendance/report-range/100660.1?from_date=2026-01-01&to_date=2026-07-31
router.get( '/attendance/report-pdf/:card_no',           validate(attendanceRangeSchema),  attendanceReportPdf); // [x] http://localhost:8000/auth/attendance/report-pdf/100002.1?from_date=2026-06-01&to_date=2026-07-31  
router.get( '/attendance/report/:card_no/:date_str',     validate(attendanceDateSchema),   attendanceReportByDate); // [x] http://localhost:8000/auth/attendance/report/100660.1/29-JUN-2026
router.post('/attendance/:card_no',                      validate(manualAttendanceSchema), manualAttendance); // [x] http://localhost:8000/auth/attendance/100660.1  Body: {"latitude":24.8,"longitude":67.0}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------
router.get( '/leave-balances/:card_no', validate(card_noSchema),   getLeaveBalances); // [x] http://localhost:8000/auth/leave-balances/100660.1
router.get( '/leave-types/:card_no',    validate(card_noSchema),   getLeaveTypes); // [x] http://localhost:8000/auth/leave-types/100660.1
router.get( '/leave-status/:card_no',   validate(card_noSchema),   getLeaveStatus); // [x] http://localhost:8000/auth/leave-status/100660.1
router.post('/apply-leave/:card_no',    validate(applyLeaveSchema), applyLeave); // [x] http://localhost:8000/auth/apply-leave/100660.1  Body: {"leave_type_id":1,"from_date":"2026-07-05","to_date":"2026-07-06","reason":"Personal","half_day":false}


// ---------------------------------------------------------------------------
// Location  (specific routes BEFORE /:card_no wildcard)
// ---------------------------------------------------------------------------
router.post('/location/batch',           validate(locationBatchSchema),   locationBatch); // [x] http://localhost:8000/auth/location/batch {"card_no":"100002.1","locations":[{"latitude":24.8607,"longitude":67.0011,"accuracy":10.0,"recorded_at":"2026-07-01T09:00:00Z"},{"latitude":24.8615,"longitude":67.0025,"accuracy":8.5,"recorded_at":"2026-07-01T09:05:00Z"}]}
router.get("/location/report/summary", validate(locationReportSchema), requireHrAdmin, locationReportSummary);  // [x] http://localhost:8000/auth/location/report/summary?admin_card_no=100001.1&from_date=2022-01-01&to_date=2026-07-07&compc=1
router.get( '/location/report/trail',    validate(locationReportSchema), requireHrAdmin,  locationTrail); // [x] http://localhost:8000/auth/location/report/trail?admin_card_no=100001.1&from_date=2022-01-01&to_date=2026-07-07&compc=1
router.get( '/location/summary',         validate(locationSummarySchema), requireHrAdmin, locationSummary); // [x] http://localhost:8000/auth/location/summary?date=2026-07-01&admin_card_no=100017.3
router.get( '/location/my-history/:card_no', validate(myLocationHistorySchema), locationHistory);  // [x] http://localhost:8000/auth/location/my-history/100660.1?date=2026-07-03
router.get( '/location/history/:card_no', validate(locationHistorySchema), requireHrAdmin, locationHistory); // [x] http://localhost:8000/auth/location/history/100002.1?date=2026-07-01&admin_card_no=100017.3

export default router;
