import { verifyToken } from '../services/superAdmin.service.js';

/**
 * Gate for /admin. The Bearer token is signed and expiring, and the USRID it
 * carries is re-checked against SUPER_ADMIN_USRIDS on every request — so
 * removing someone from that list locks them out immediately rather than when
 * their token happens to expire.
 */
export const requireSuperAdmin = (req, res, next) => {
  const header = String(req.headers.authorization ?? '');
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const usrid = verifyToken(token);
  if (!usrid) {
    return res.status(401).json({ detail: 'Administrator sign-in required' });
  }
  res.locals.superAdmin = usrid;
  next();
};
