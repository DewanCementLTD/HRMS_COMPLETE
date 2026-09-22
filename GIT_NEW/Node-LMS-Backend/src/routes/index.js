import { Router } from 'express';
import pinoHttp from 'pino-http';
import { getRouteLogger, logger } from '../utils/logger.js';

import appVersionRoutes from './appVersion.routes.js';
import authRoutes from './auth.routes.js';
import documentsRoutes from './documents.routes.js';
import hrRoutes from './hr.routes.js';
import hrmsRoutes from './hrms.routes.js';
import referenceRoutes from './reference.routes.js';
import locationTrackingRoutes from './locationTracking.routes.js';
import recruitmentRoutes from './recruitment.routes.js';
import payrollRoutes from './payroll.routes.js';
import payrollEntryRoutes from './payrollEntry.routes.js';
import reportsRoutes from './reports.routes.js';
import superAdminRoutes from './superAdmin.routes.js';

const router = Router();

const reqLogger = (prefix) => pinoHttp({
  logger: getRouteLogger(prefix),

  // Without this, pino-http logs EVERY completed request at `useLevel`
  // (default 'info') — including the ones that threw, so 500s showed up as
  // "INFO: ... failed with 500". Map the status onto a real level instead.
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },

  customSuccessMessage: (req, res) => `HTTP ${req.method} ${req.url} completed with ${res.statusCode}`,
  customErrorMessage: (req, res, err) => `HTTP ${req.method} ${req.url} failed with ${res.statusCode} - ${err.message}`,
  serializers: {
    req: (req) => ({ method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});

router.use('/app', reqLogger('app'), appVersionRoutes);
router.use('/auth', reqLogger('auth'), authRoutes);
router.use('/documents', reqLogger('documents'), documentsRoutes);
router.use('/hr', reqLogger('hr'), hrRoutes);
router.use('/hrms', reqLogger('hrms'), hrmsRoutes);
router.use('/reference', reqLogger('reference'), referenceRoutes);
router.use('/location-tracking', reqLogger('location-tracking'), locationTrackingRoutes);
// 2026-09-22: the public /face/* stub routes (register/verify/identify/
// status/delete) were removed — /face/identify ignored the submitted photos
// and returned the first enrolled employee, so anyone could get any
// identification with junk frames. The mobile app sends all face work to the
// real face service (face.sysnovix.com); the web app never calls /face/*.
// POST /auth/attendance/face already calls the real service directly
// (services/faceVerification.service.js), not this. /hr/face/enroll (HR
// admin enrolling a face) is untouched — it uses face.service.js directly,
// not this router. Do not remount a /face/* router here; if a mobile-facing
// identify/verify endpoint is ever needed again, it must proxy to the real
// face service, never reimplement matching locally.
router.use('/recruitment', reqLogger('recruitment'), recruitmentRoutes);
router.use('/payroll', reqLogger('payroll'), payrollRoutes);
router.use('/payroll-entry', reqLogger('payroll-entry'), payrollEntryRoutes);
router.use('/reports', reqLogger('reports'), reportsRoutes);
router.use('/admin', reqLogger('admin'), superAdminRoutes);

export default router;