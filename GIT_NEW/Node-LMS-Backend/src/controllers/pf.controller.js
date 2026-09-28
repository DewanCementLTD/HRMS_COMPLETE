/**
 * Provident Fund controllers.
 *
 * HR routes run behind requireHrAdmin and resolve the company/branch through
 * resolveCompany/resolveBranch, so an admin only ever sees companies within
 * their rights. The employee route runs behind requireEmployee, so the card in
 * the path is always the caller's own.
 */

import { resolveCompany, resolveBranch, checked } from "../utils/payrollShared.js";
import {
  getPfSummary, listPfMembers, getPfStatement, listPfLoans,
  setPfOpening, setPfMembership, getMyPf,
} from "../services/pf.service.js";

const scope = async (query) => {
  const { admin_card_no, compc, brnch } = query;
  const unitId = await resolveCompany(admin_card_no, compc);
  return { unitId, branch: await resolveBranch(admin_card_no, compc, brnch) };
};

// GET /pf/summary
export const pfSummary = async (req, res, next) => {
  try {
    const { unitId, branch } = await scope(res.locals.validated.query);
    res.json(await getPfSummary(unitId, branch));
  } catch (err) {
    next(err);
  }
};

// GET /pf/members
export const pfMembers = async (req, res, next) => {
  try {
    const q = res.locals.validated.query;
    const { unitId, branch } = await scope(q);
    res.json({ items: await listPfMembers(unitId, { branch, scope: q.scope, q: q.q }) });
  } catch (err) {
    next(err);
  }
};

// GET /pf/members/:empcode/statement
export const pfStatement = async (req, res, next) => {
  try {
    const { unitId } = await scope(res.locals.validated.query);
    const st = await getPfStatement(unitId, res.locals.validated.params.empcode);
    if (!st) return res.status(404).json({ detail: "Employee not found in this company" });
    res.json(st);
  } catch (err) {
    next(err);
  }
};

// GET /pf/loans
export const pfLoans = async (req, res, next) => {
  try {
    const { unitId, branch } = await scope(res.locals.validated.query);
    res.json({ items: await listPfLoans(unitId, branch) });
  } catch (err) {
    next(err);
  }
};

// PUT /pf/members/:empcode/opening   {amount}
export const pfSetOpening = async (req, res, next) => {
  try {
    const { query, params, body } = res.locals.validated;
    const { unitId } = await scope(query);
    checked(res, await setPfOpening(unitId, params.empcode, body.amount));
  } catch (err) {
    next(err);
  }
};

// PATCH /pf/members/:empcode/membership   {pf_ind, member_since?}
export const pfSetMembership = async (req, res, next) => {
  try {
    const { query, params, body } = res.locals.validated;
    const { unitId } = await scope(query);
    checked(res, await setPfMembership(unitId, params.empcode, body.pf_ind, body.member_since));
  } catch (err) {
    next(err);
  }
};

// GET /auth/pf/:card_no   (employee, own data only)
export const myPf = async (req, res, next) => {
  try {
    const data = await getMyPf(res.locals.validated.params.card_no);
    if (!data) return res.status(404).json({ detail: "Employee not found" });
    res.setHeader("Cache-Control", "private, no-store");
    res.json(data);
  } catch (err) {
    next(err);
  }
};
