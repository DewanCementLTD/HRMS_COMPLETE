/**
 * Setup → Holidays (HR only).
 *
 * The company comes from resolveCompany(), never straight from the query, and
 * the branches are checked against the admin's own branch rights, so HR can
 * only give a holiday to branches they manage.
 */

import { resolveCompany } from '../utils/payrollShared.js';
import { getAdminRights } from '../services/adminRights.service.js';
import {
  listHolidaysData,
  listHolidayBranchesData,
  saveHolidayData,
  deleteHolidayData,
} from '../services/holiday.service.js';

const send = (res, result) =>
  result.status === 'error' ? res.status(400).json({ detail: result.message }) : res.json(result);

// GET /hrms/holidays
export const getHolidays = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    const company = await resolveCompany(admin_card_no, compc);
    res.json({ items: await listHolidaysData(company), compc: company });
  } catch (err) {
    next(err);
  }
};

// GET /hrms/holidays/branches
export const getHolidayBranches = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    const company = await resolveCompany(admin_card_no, compc);
    const { allowedBranches } = await getAdminRights(admin_card_no);
    res.json({ items: await listHolidayBranchesData(company, allowedBranches), compc: company });
  } catch (err) {
    next(err);
  }
};

const save = (withId) => async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    const { holiday_from, holiday_to, reason, branches } = res.locals.validated.body;
    const company = await resolveCompany(admin_card_no, compc);
    const { allowedBranches } = await getAdminRights(admin_card_no);
    send(res, await saveHolidayData({
      holiday_id: withId ? res.locals.validated.params.id : null,
      compc: company,
      from: holiday_from,
      to: holiday_to,
      reason,
      branches,
      by: admin_card_no,
      allowedBranches,
    }));
  } catch (err) {
    next(err);
  }
};

// POST /hrms/holidays
export const postHoliday = save(false);

// PUT /hrms/holidays/:id
export const putHoliday = save(true);

// DELETE /hrms/holidays/:id
export const delHoliday = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    const company = await resolveCompany(admin_card_no, compc);
    send(res, await deleteHolidayData(res.locals.validated.params.id, company));
  } catch (err) {
    next(err);
  }
};
