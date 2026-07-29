import * as reportsService from "../services/reports.service.js";

/**
 * Controller handlers for /reports/* endpoints.
 */

export const getAbsentSuppReport = async (req, res, next) => {
  try {
    const data = await reportsService.getAbsentSuppReport(req.query);
    res.json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};

export const getAllowanceDetailReport = async (req, res, next) => {
  try {
    const data = await reportsService.getAllowanceDetailReport(req.query);
    res.json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};

export const getAllowanceReconReport = async (req, res, next) => {
  try {
    const data = await reportsService.getAllowanceReconReport(req.query);
    res.json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};

export const getDeductionDetailReport = async (req, res, next) => {
  try {
    const data = await reportsService.getDeductionDetailReport(req.query);
    res.json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};

export const getDeductionReconReport = async (req, res, next) => {
  try {
    const data = await reportsService.getDeductionReconReport(req.query);
    res.json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};

export const getMonthWiseDeductionReport = async (req, res, next) => {
  try {
    const data = await reportsService.getMonthWiseDeductionReport(req.query);
    res.json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};

export const getBankAdviceReport = async (req, res, next) => {
  try {
    const data = await reportsService.getBankAdviceReport(req.query);
    res.json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};

export const getActiveEmployeesReport = async (req, res, next) => {
  try {
    const data = await reportsService.getActiveEmployeesReport(req.query);
    res.json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};

export const getPfDetailReport = async (req, res, next) => {
  try {
    const data = await reportsService.getPfDetailReport(req.query);
    res.json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};
