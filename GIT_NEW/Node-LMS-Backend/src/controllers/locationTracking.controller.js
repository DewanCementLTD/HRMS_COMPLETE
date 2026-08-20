import * as locationTrackingService from "../services/locationTracking.service.js";

const handleResult = (res, result) => {
  if (result.status === "error") {
    return res.status(result.code || 400).json({ detail: result.message });
  }
  res.json(result.data);
};

export const getTrackingSettings = async (req, res, next) => {
  try {
    const { emp_code } = res.locals.validated.params;
    handleResult(res, await locationTrackingService.getTrackingSettings(emp_code));
  } catch (err) {
    next(err);
  }
};

export const updateTrackingSettings = async (req, res, next) => {
  try {
    const { emp_code } = res.locals.validated.params;
    const { track_location, track_location_hr } = res.locals.validated.query;
    handleResult(res, await locationTrackingService.updateTrackingSettings(emp_code, track_location, track_location_hr));
  } catch (err) {
    next(err);
  }
};

export const getGeofenceSettings = async (req, res, next) => {
  try {
    const { emp_code } = res.locals.validated.params;
    handleResult(res, await locationTrackingService.getGeofenceSettings(emp_code));
  } catch (err) {
    next(err);
  }
};

export const getActiveTrackingEmployees = async (req, res, next) => {
  try {
    handleResult(res, await locationTrackingService.getActiveTrackingEmployees());
  } catch (err) {
    next(err);
  }
};

export const getTrackingStatistics = async (req, res, next) => {
  try {
    handleResult(res, await locationTrackingService.getTrackingStatistics());
  } catch (err) {
    next(err);
  }
};
