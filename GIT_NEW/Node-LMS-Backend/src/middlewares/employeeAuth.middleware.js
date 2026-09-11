import { verifyEmployeeToken, sessionOwnsCard } from '../services/employeeSession.service.js';
import { logger } from '../utils/logger.js';

/**
 * Gate for employee self-service endpoints that accept data rather than just
 * returning it.
 *
 * Two things are checked, and the second matters as much as the first: the
 * token must be genuine, and the card in the request must be the card the token
 * was issued for. Without that second check a valid employee could upload a
 * location trail against a colleague's card.
 *
 * The card is read from wherever the route puts it — validated params first,
 * then body, then query — so this sits in front of any of the existing route
 * shapes without each one needing its own variant.
 */
export const requireEmployee = (req, res, next) => {
  const header = String(req.headers.authorization ?? '');
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';

  const session = verifyEmployeeToken(token);
  if (!session) {
    return res.status(401).json({
      detail: { code: 'SESSION_REQUIRED', message: 'Sign in again to continue' },
    });
  }

  const v = res.locals.validated ?? {};
  const requestedCard =
    v.params?.card_no ?? req.params?.card_no ??
    v.body?.card_no ?? req.body?.card_no ??
    v.query?.card_no ?? req.query?.card_no ?? null;

  // A request that names no card is acting on the token's own card, which is
  // always allowed; res.locals.employee below tells the handler which that is.
  if (requestedCard && !sessionOwnsCard(session, requestedCard)) {
    logger.warn(
      `[SESSION] card mismatch: token=${session.card_no} tried to act for ${requestedCard}`,
    );
    return res.status(403).json({
      detail: {
        code: 'CARD_MISMATCH',
        message: 'This session cannot submit data for that employee',
      },
    });
  }

  res.locals.employee = session;
  next();
};
