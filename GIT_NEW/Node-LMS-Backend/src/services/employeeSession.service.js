import crypto from 'node:crypto';

import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Employee session tokens
//
// Every employee-facing endpoint in this backend authorises on a CARD_NO taken
// straight from the request — /auth/attendance/face, /auth/location/batch and
// the rest carry no token at all. That is tolerable for marking your own
// attendance behind a face check, but offline location sync accepts a bag of
// coordinates for an arbitrary card with nothing to prove who sent them, so it
// gets a real credential.
//
// The token is minted at login (which the app already calls) and signed with a
// server secret, so the phone cannot mint or edit one. It is deliberately the
// same construction as the super-admin panel's: no new dependency, and nothing
// stored server-side, because this API restarts often and holds no sessions.
//
// The card number is inside the signed payload. A token for 100002.1 can only
// ever submit locations for 100002.1 — see requireEmployee.
// ---------------------------------------------------------------------------

const norm = (v) => String(v ?? '').trim();

/** Numeric prefix of a dotted, company-qualified card ("100002.1" → "100002"). */
const cardInt = (cardNo) => {
  const s = norm(cardNo);
  return s.includes('.') ? s.split('.')[0] : s;
};

const tokenSecret = () => {
  const s = norm(process.env.EMPLOYEE_SESSION_SECRET);
  if (s) return s;
  // Nothing configured: derive a throwaway secret so tokens work within one run
  // but never outlive a restart. Logged once so it is not a silent surprise.
  if (!globalThis.__employeeSessionEphemeralSecret) {
    globalThis.__employeeSessionEphemeralSecret = crypto.randomBytes(32).toString('hex');
    logger.warn(
      '[SESSION] EMPLOYEE_SESSION_SECRET is not set — employee tokens will be invalidated on restart',
    );
  }
  return globalThis.__employeeSessionEphemeralSecret;
};

/**
 * How long a token lasts.
 *
 * Long by web standards, and on purpose: this is a field app whose whole point
 * is surviving days without a connection. A driver offline all week must still
 * be able to upload the backlog on Friday without a re-login they cannot
 * perform. 30 days, refreshed on every login.
 */
const SESSION_DAYS = Number(process.env.EMPLOYEE_SESSION_DAYS || 30);

export const issueEmployeeToken = (cardNo, deviceId = null) => {
  const payload = Buffer.from(
    JSON.stringify({
      c: norm(cardNo),
      d: norm(deviceId) || null,
      exp: Date.now() + SESSION_DAYS * 86_400_000,
    }),
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
};

/**
 * The session a token represents, or null when it is invalid, expired or
 * forged. Returns { card_no, device_id }.
 */
export const verifyEmployeeToken = (token) => {
  const [payload, sig] = norm(token).split('.');
  if (!payload || !sig) return null;

  const expected = crypto.createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
  // Constant-time compare so a wrong signature cannot be narrowed down by timing.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const { c, d, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!c || !exp || Date.now() > exp) return null;
    return { card_no: c, device_id: d ?? null };
  } catch {
    return null;
  }
};

/**
 * Whether a session may act for a card.
 *
 * Cards are compared on their numeric prefix as well as in full, because the
 * same person reaches this API as both "100002.1" and "100002" depending on
 * which screen produced the value — the existing queries all match both.
 */
export const sessionOwnsCard = (session, cardNo) => {
  if (!session) return false;
  const a = norm(session.card_no);
  const b = norm(cardNo);
  return a === b || cardInt(a) === cardInt(b);
};

export const employeeSessionDays = () => SESSION_DAYS;
