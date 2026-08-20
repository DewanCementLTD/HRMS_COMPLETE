import { Router } from 'express';
import { validate } from '../middlewares/validate.middleware.js';
import { requireHrAdmin } from '../middlewares/hrAdmin.middleware.js';
// Schemas
import { hrSearchEmployeesSchema, hrFaceEnrollSchema } from '../models/hr.schema.js';
// Controllers
import { hrSearchEmployees, hrEnrollEmployeeFace } from '../controllers/hr.controller.js';

const router = Router();
// Mounted at /hr. Every route requires HR-admin access (admin_card_no query param).
// validate() runs first so requireHrAdmin can read res.locals.validated.query.admin_card_no.

// ---------------------------------------------------------------------------
// Employee search (whole EMPLOYEE view — NOT company/branch scoped, matches FastAPI /hr)
// ---------------------------------------------------------------------------
router.get('/employees/search', validate(hrSearchEmployeesSchema), requireHrAdmin, hrSearchEmployees); // [x] http://localhost:8000/hr/employees/search?q=Saad&admin_card_no=100001.1

// ---------------------------------------------------------------------------
// Face enrollment (HR-initiated; requires >= 10 frames)
// ---------------------------------------------------------------------------
router.post('/face/enroll', validate(hrFaceEnrollSchema), requireHrAdmin, hrEnrollEmployeeFace); // [x] http://localhost:8000/hr/face/enroll?admin_card_no=100017.3  Body: {"card_no":"100002.1","frames":["f1","f2","f3","f4","f5","f6","f7","f8","f9","f10"]}

export default router;
