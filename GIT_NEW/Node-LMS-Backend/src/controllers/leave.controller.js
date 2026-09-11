import {
  getLeaveBalancesData,
  getLeaveTypesData,
  getLeaveStatusData,
  applyLeaveData,
} from '../services/leave.service.js';
import {
  getHodApprovalsData,
  decideHodApprovalData,
  getHodOptionsData,
} from '../services/leaveApproval.service.js';

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

// GET /auth/leave-approvals/:card_no — leave applications this user approves as
// HOD 1 or HOD 2, with which step they are and whether it's their turn.
export const getHodApprovals = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const result = await getHodApprovalsData(card_no);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

// POST /auth/leave-approvals/:card_no/:pk — approve or reject one application.
export const decideHodApproval = async (req, res, next) => {
  try {
    const { card_no, pk } = res.locals.validated.params;
    const { decision } = res.locals.validated.body;
    const result = await decideHodApprovalData(card_no, Number(pk), decision);
    if (result.status === 'error') return res.status(400).json({ detail: result.message });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

// GET /hrms/hod-options — employees of the selected company, keyed by the mobile
// number that HOD1/HOD2 actually store.
export const getHodOptions = async (req, res, next) => {
  try {
    const { compc, brnch } = res.locals.validated.query;
    const items = await getHodOptionsData(compc, brnch);
    res.json({ items });
  } catch (err) {
    next(err);
  }
};
