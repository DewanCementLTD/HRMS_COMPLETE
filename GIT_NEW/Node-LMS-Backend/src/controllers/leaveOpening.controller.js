/**
 * Leave allocation (LEAVE_OP) — HR only.
 *
 * Every handler resolves the company through resolveCompany() rather than
 * trusting the compc query param, so HR can only ever read or write allocations
 * for a company they hold rights to. The branch comes from the employee's own
 * record at save time (see the service), because ALL_LEAVE_BAL_V matches on it.
 */

import { resolveCompany, resolveBranch } from '../utils/payrollShared.js';
import {
  listLeaveOpeningsData,
  listLeaveOpeningYearsData,
  listAllocatableEmployeesData,
  saveLeaveOpeningData,
} from '../services/leaveOpening.service.js';

// GET /hrms/leave-openings
export const getLeaveOpenings = async (req, res, next) => {
  try {
    const { admin_card_no, compc, brnch, year, card_no } = res.locals.validated.query;
    const company = await resolveCompany(admin_card_no, compc);
    const branch = await resolveBranch(admin_card_no, compc, brnch);
    const items = await listLeaveOpeningsData({ compc: company, brnch: branch, year, card_no });
    res.json({ items, compc: company });
  } catch (err) {
    next(err);
  }
};

// GET /hrms/leave-openings/years
export const getLeaveOpeningYears = async (req, res, next) => {
  try {
    const { admin_card_no, compc, brnch } = res.locals.validated.query;
    const company = await resolveCompany(admin_card_no, compc);
    // The active leave year is configured per company AND branch, so a selected
    // branch narrows it to the one those employees are actually on.
    const branch = await resolveBranch(admin_card_no, compc, brnch);
    res.json({ items: await listLeaveOpeningYearsData(company, branch) });
  } catch (err) {
    next(err);
  }
};

// GET /hrms/leave-openings/employees
export const getAllocatableEmployees = async (req, res, next) => {
  try {
    const { admin_card_no, compc, brnch } = res.locals.validated.query;
    const company = await resolveCompany(admin_card_no, compc);
    const branch = await resolveBranch(admin_card_no, compc, brnch);
    res.json({ items: await listAllocatableEmployeesData(company, branch) });
  } catch (err) {
    next(err);
  }
};

// POST /hrms/leave-openings
export const postLeaveOpening = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    const company = await resolveCompany(admin_card_no, compc);
    const result = await saveLeaveOpeningData({ ...res.locals.validated.body, compc: company });
    if (result.status === 'error') return res.status(400).json({ detail: result.message });
    res.json(result);
  } catch (err) {
    next(err);
  }
};
