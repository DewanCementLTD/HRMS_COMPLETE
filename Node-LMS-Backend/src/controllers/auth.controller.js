import { authenticateUser, getProfile, lookupByPhone, changePassword, saveEmergencyContact as saveEmergencyContactService } from '../services/auth.service.js';
import { forceUpdateBlock } from '../services/appVersion.service.js';

import { logger } from '../utils/logger.js';
export const login = async (req, res, next) => {
  try {
    const { username, password, app_version, app_build, platform } = res.locals.validated.body;

    // Bug 5.3: Force-update guard — blocks outdated mobile apps (HTTP 426).
    // Web omits app_version so web logins are never affected.
    const blk = await forceUpdateBlock(app_version, app_build, platform || 'ANDROID');
    if (blk) {
      return res.status(426).json({
        detail: { code: 'FORCE_UPDATE', message: blk.message, update_url: blk.update_url },
      });
    }

    const result = await authenticateUser(username, password);
    if (!result)
      return res.status(401).json({ detail: 'Invalid username or password.' });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const profile = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const data = await getProfile(card_no);
    if (!data)
      return res.status(404).json({ detail: 'Employee not found.' });
    res.json(data);
  } catch (err) {
    next(err);
  }
};

export const lookup = async (req, res, next) => {
  try {
    const { phone } = res.locals.validated.params;
    const data = await lookupByPhone(phone);
    if (!data)
      return res.status(404).json({ detail: 'No employee found for this number.' });
    res.json(data);
  } catch (err) {
    next(err);
  }
};

export const updatePassword = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const { old_password, new_password } = res.locals.validated.body;
    logger.info(`Attempting to change password for card_no: ${card_no}, old_password: ${old_password}, new_password: ${new_password}`); // Debugging line
    const result = await changePassword(card_no, old_password, new_password);
    if (!result.success)
      return res.status(400).json({ detail: 'Current password is incorrect.' });
    res.json({ status: 'SUCCESS', message: 'Password updated successfully.' });
  } catch (err) {
    next(err);
  }
};

export const saveEmergencyContact = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const { name, relationship, phone } = res.locals.validated.body;
    const result = await saveEmergencyContactService(card_no, name, relationship, phone);
    if (result.status === 'error') {
      return res.status(500).json({ detail: result.message });
    }
    res.json({ status: 'SUCCESS', message: result.message });
  } catch (err) {
    next(err);
  }
};
