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
import faceRoutes from './face.routes.js';
import recruitmentRoutes from './recruitment.routes.js';

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
router.use('/face', reqLogger('face'), faceRoutes);
router.use('/recruitment', reqLogger('recruitment'), recruitmentRoutes);

export default router;