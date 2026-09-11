import * as svc from '../services/superAdmin.service.js';
import { logger } from '../utils/logger.js';

const send = (res, result) =>
  result.status === 'error'
    ? res.status(400).json({ detail: result.message })
    : res.json(result);

// POST /admin/login
export const login = async (req, res, next) => {
  try {
    const { usrid, password } = res.locals.validated.body;
    const result = await svc.authenticateSuperAdmin(usrid, password);
    if (result.status === 'error') {
      // Every failure reads the same from outside, so a wrong username and a
      // wrong password can't be told apart.
      logger.warn(`[ADMIN] failed sign-in for ${String(usrid).slice(0, 40)}`);
      return res.status(401).json({ detail: result.message });
    }
    logger.info(`[ADMIN] ${result.user.usrid} signed in`);
    res.json(result);
  } catch (err) { next(err); }
};

// GET /admin/me — lets the panel confirm a stored token is still good.
export const me = async (req, res) => {
  res.json({ status: 'success', usrid: res.locals.superAdmin });
};

// GET /admin/users
export const listUsers = async (req, res, next) => {
  try {
    res.json({ items: await svc.listHrUsers() });
  } catch (err) { next(err); }
};

// GET /admin/scope — companies + branches to assign from
export const scopeOptions = async (req, res, next) => {
  try {
    res.json(await svc.listScopeOptions());
  } catch (err) { next(err); }
};

// PUT /admin/users/:usrid/companies
export const setCompanies = async (req, res, next) => {
  try {
    const { usrid } = res.locals.validated.params;
    const { companies } = res.locals.validated.body;
    logger.info(`[ADMIN] ${res.locals.superAdmin} set companies for ${usrid}: ${companies.join(',') || '(none)'}`);
    send(res, await svc.setUserCompanies(usrid, companies));
  } catch (err) { next(err); }
};

// PUT /admin/users/:usrid/branches
export const setBranches = async (req, res, next) => {
  try {
    const { usrid } = res.locals.validated.params;
    const { branches } = res.locals.validated.body;
    logger.info(`[ADMIN] ${res.locals.superAdmin} set branches for ${usrid}: ${branches.join(',') || '(none)'}`);
    send(res, await svc.setUserBranches(usrid, branches));
  } catch (err) { next(err); }
};

// PUT /admin/users/:usrid/status
export const setStatus = async (req, res, next) => {
  try {
    const { usrid } = res.locals.validated.params;
    const { enabled } = res.locals.validated.body;
    // Locking yourself out of the panel you are standing in is never intended.
    if (!enabled && String(usrid).toUpperCase() === String(res.locals.superAdmin).toUpperCase()) {
      return res.status(400).json({ detail: 'You cannot disable your own account' });
    }
    logger.info(`[ADMIN] ${res.locals.superAdmin} ${enabled ? 'enabled' : 'disabled'} ${usrid}`);
    send(res, await svc.setUserStatus(usrid, enabled));
  } catch (err) { next(err); }
};

// PUT /admin/users/:usrid/password
export const setPassword = async (req, res, next) => {
  try {
    const { usrid } = res.locals.validated.params;
    const { password } = res.locals.validated.body;
    logger.info(`[ADMIN] ${res.locals.superAdmin} reset the password for ${usrid}`);
    send(res, await svc.setUserPassword(usrid, password));
  } catch (err) { next(err); }
};

// POST /admin/users
export const createUser = async (req, res, next) => {
  try {
    const body = res.locals.validated.body;
    logger.info(`[ADMIN] ${res.locals.superAdmin} created HR user ${body.usrid}`);
    send(res, await svc.createHrUser(body));
  } catch (err) { next(err); }
};
