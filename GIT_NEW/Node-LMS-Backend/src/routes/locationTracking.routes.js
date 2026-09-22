import { Router } from "express";
import { validate } from "../middlewares/validate.middleware.js";
import { requireHrAdmin } from "../middlewares/hrAdmin.middleware.js";
import * as schemas from "../models/locationTracking.schema.js";
import * as controllers from "../controllers/locationTracking.controller.js";

const router = Router();

// GET /location-tracking/active-employees
// 2026-09-22: was open with no login and listed every tracked employee's
// name, today's check-in time and duty status. Nothing found calls it
// (mobile app doesn't; grepped LMS-Web and a month of access logs) — gated
// anyway, same admin_card_no + requireHrAdmin check /auth/location/summary uses.
router.get("/active-employees", validate(schemas.adminOnlySchema), requireHrAdmin, controllers.getActiveTrackingEmployees);

// GET /location-tracking/statistics — same reasoning as active-employees above.
router.get("/statistics", validate(schemas.adminOnlySchema), requireHrAdmin, controllers.getTrackingStatistics);

// GET /location-tracking/settings/:emp_code
router.get("/settings/:emp_code", validate(schemas.getTrackingSettingsSchema), controllers.getTrackingSettings);

// POST /location-tracking/settings/:emp_code/update
router.post("/settings/:emp_code/update", validate(schemas.updateTrackingSettingsSchema), requireHrAdmin, controllers.updateTrackingSettings);

// GET /location-tracking/geofence/:emp_code
router.get("/geofence/:emp_code", validate(schemas.getGeofenceSchema), controllers.getGeofenceSettings);

export default router;
