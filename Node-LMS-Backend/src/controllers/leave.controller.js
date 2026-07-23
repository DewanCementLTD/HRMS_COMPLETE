import {
  getLeaveBalancesData,
  getLeaveTypesData,
  getLeaveStatusData,
  applyLeaveData,
} from '../services/leave.service.js';

export const getLeaveBalances = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const items = await getLeaveBalancesData(card_no);
    res.json({ items });
  } catch (err) {
    next(err);
  }
};

// GET /auth/leave-types/:card_no  — full LEAVE_TYPES LOV merged with balances.
export const getLeaveTypes = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const items = await getLeaveTypesData(card_no);
    res.json({ items });
  } catch (err) {
    next(err);
  }
};

export const getLeaveStatus = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const items = await getLeaveStatusData(card_no);
    res.json({ items });
  } catch (err) {
    next(err);
  }
};

export const applyLeave = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const result = await applyLeaveData(card_no, res.locals.validated.body);
    if (result.status === 'error')
      return res.status(400).json({ detail: result.message || 'Leave application failed.' });
    res.json({ status: 'SUCCESS', message: result.message || 'Leave applied successfully' });
  } catch (err) {
    next(err);
  }
};
