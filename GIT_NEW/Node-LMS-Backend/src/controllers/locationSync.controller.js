import {
  syncLocationBatch,
  getTrackingState,
  getSyncedEventIds,
} from '../services/locationSync.service.js';
import { logger } from '../utils/logger.js';

/**
 * POST /auth/location/sync
 *
 * Upload a batch of locally-stored GPS points. Partial success is the norm, so
 * the HTTP status reflects whether the request was processed, not whether every
 * point was accepted: a 200 with three SYNCED and one REJECTED is a successful
 * request. The phone acts on the per-point results, never on the status alone.
 */
export const locationSync = async (req, res, next) => {
  try {
    const { card_no, points } = res.locals.validated.body;

    // requireEmployee has already refused any card this session does not own,
    // so the card is safe to use — but the session's own card is what gets
    // written, so a mismatch can never reach the table even if that check moves.
    const cardNo = res.locals.employee?.card_no ?? card_no;

    const { results, counts } = await syncLocationBatch(cardNo, points);

    return res.json({
      success: true,
      card_no: cardNo,
      counts,
      results,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /auth/location/tracking-state/:card_no
 *
 * The one call the app makes to decide whether to be capturing: HR's setting,
 * the interval, today's shift, and whether the latest checkout was final.
 */
export const trackingState = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const cardNo = res.locals.employee?.card_no ?? card_no;

    const result = await getTrackingState(cardNo);
    if (result.status === 'error') {
      return res.status(result.code ?? 400).json({ detail: result.message });
    }
    return res.json({ body: result.data });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /auth/location/sync-status
 *
 * Reconciliation: given the phone's pending ids, say which this server already
 * holds. Used after a reinstall or a lost response, so the app can settle its
 * queue without re-uploading everything.
 */
export const locationSyncStatus = async (req, res, next) => {
  try {
    const { card_no, client_event_ids } = res.locals.validated.body;
    const cardNo = res.locals.employee?.card_no ?? card_no;

    const synced = await getSyncedEventIds(cardNo, client_event_ids);
    const syncedSet = new Set(synced.map((s) => s.client_event_id));

    logger.info(
      `[LOCATION_SYNC] status check card=${cardNo}: ${synced.length}/${client_event_ids.length} already stored`,
    );

    return res.json({
      success: true,
      card_no: cardNo,
      synced,
      pending: client_event_ids.filter((id) => !syncedSet.has(id)),
    });
  } catch (err) {
    next(err);
  }
};
