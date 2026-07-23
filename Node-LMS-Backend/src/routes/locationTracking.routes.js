import { Router } from "express";
import { validate } from "../middlewares/validate.middleware.js";
import { requireHrAdmin } from "../middlewares/hrAdmin.middleware.js";
import * as schemas from "../models/locationTracking.schema.js";
import * as controllers from "../controllers/locationTracking.controller.js";

const router = Router();

// GET /location-tracking/active-employees
router.get("/active-employees", controllers.getActiveTrackingEmployees);

// GET /location-tracking/statistics
router.get("/statistics", controllers.getTrackingStatistics);

// GET /location-tracking/settings/:emp_code
router.get("/settings/:emp_code", validate(schemas.getTrackingSettingsSchema), controllers.getTrackingSettings);

// POST /location-tracking/settings/:emp_code/update
router.post("/settings/:emp_code/update", validate(schemas.updateTrackingSettingsSchema), requireHrAdmin, controllers.updateTrackingSettings);

// GET /location-tracking/geofence/:emp_code
router.get("/geofence/:emp_code", validate(schemas.getGeofenceSchema), controllers.getGeofenceSettings);

export default router;
