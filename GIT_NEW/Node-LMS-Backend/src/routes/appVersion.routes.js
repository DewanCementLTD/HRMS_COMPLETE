import { Router } from 'express';
import { validate } from '../middlewares/validate.middleware.js';
// Schemas
import { versionCheckSchema } from '../models/appVersion.schema.js';
// Controllers
import { versionCheck, downloadLatestApk } from '../controllers/appVersion.controller.js';
import { logger } from '../utils/logger.js';
import { uiConfig } from '../config/tenant.js';

const router = Router();
// Mounted at /app. Mirrors FastAPI routers/app_version_router.py. No auth —
// these are called by the mobile app before/without a login.

// ---------------------------------------------------------------------------
// Version check (up-to-date / soft update / force update)
// ---------------------------------------------------------------------------
router.get('/version-check', validate(versionCheckSchema), versionCheck); // http://localhost:8000/app/version-check?platform=ANDROID&version=1.4.2&build=48

router.get('/test-logs', (req, res) => {
  logger.warn("This is a test warning to verify file location tracking.");
  logger.error(new Error("Simulated error stack"), "This is a test error to verify error stacks and locations.");
  res.json({ message: "Test logs generated in terminal and app.log!" });
});


// ---------------------------------------------------------------------------
// Latest APK download (drop the release into static/apk/app-latest.apk)
// ---------------------------------------------------------------------------
router.get('/download/latest', downloadLatestApk); // http://localhost:8000/app/download/latest

// ---------------------------------------------------------------------------
// Tenant UI switches for the shared web app (no secrets; see config/tenant.js)
// ---------------------------------------------------------------------------
router.get('/ui-config', (req, res) => res.json(uiConfig())); // http://localhost:8003/app/ui-config

export default router;
