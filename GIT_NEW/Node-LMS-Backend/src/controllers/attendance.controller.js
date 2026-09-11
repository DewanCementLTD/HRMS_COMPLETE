/**
 * Attendance controllers — HTTP shapes mirror the FastAPI LMS-Backend
 * (routers/attendance_router.py) so this server is a drop-in replacement:
 *   - success/error status codes and JSON bodies match FastAPI exactly
 *   - FastAPI's HTTPException(detail=...) serializes as { "detail": ... }, so
 *     error responses here use the same { detail } envelope.
 */

import {
  smartMarkAttendance,
  getAttendanceReport,
  getAttendanceReportRange,
  getAttendanceSummary,
  getTodayAttendanceState,
} from '../services/attendance.service.js';
import {
  claimPunch,
  completePunch,
  releasePunch,
} from '../services/punchIdempotency.service.js';
import { buildAttendancePdf } from '../services/attendancePdf.service.js';
import { forceUpdateBlock } from '../services/appVersion.service.js';
import { identifyScannedCard } from '../services/faceVerification.service.js';
import { lookupByPhone } from '../services/auth.service.js';
import { getTrackingState } from '../services/locationSync.service.js';
import { logger } from '../utils/logger.js';

/**
 * A punch the server did NOT persist.
 *
 * The app is online-only: it queues nothing and shows no success screen unless
 * the server confirms. A business rejection (face not recognised, outside the
 * geofence, duplicate punch, shift not open) therefore has to arrive as a
 * complete body the employee can read — 400, never a bare 200, and never an
 * empty body, which the app would read as a dead connection.
 */
// A rejection stores no attendance, so it also hands the client_event_id back:
// the employee's next attempt must be a real attempt, not a replay of this.
const punchRejected = async (res, message, code = null, clientEventId = null) => {
  if (clientEventId) await releasePunch(clientEventId);
  return res.status(400).json({
    success: false,
    status: 'error',
    message,
    ...(code ? { code } : {}),
    // FastAPI-era clients read the rejection out of `detail`.
    detail: code ? { code, message } : message,
  });
};

// POST /auth/attendance/face  and  POST /auth/attendance/biometric

export const faceAttendance = async (req, res, next) => {
  const clientEventId = String(res.locals.validated.body.client_event_id ?? '').trim();
  let claimed = false;

  try {
    const body = res.locals.validated.body;

    // Block attendance from app versions below the required minimum. Only fires
    // when the client sends a too-old version — web/version-less callers pass.
    const blk = await forceUpdateBlock(body.app_version, body.app_build, 'ANDROID');
    if (blk) {
      return res.status(426).json({
        detail: { code: 'FORCE_UPDATE', message: blk.message, update_url: blk.update_url },
      });
    }

    // Replay guard. The phone retries the same client_event_id when a response
    // goes missing; without this, that retry becomes a SECOND punch, and a
    // second punch an hour after check-in is a check-OUT. Claim the id before
    // anything is written, and answer a replay with the original answer.
    if (clientEventId) {
      const claim = await claimPunch(clientEventId, body.card_no);
      if (!claim.claimed) {
        if (claim.replay) {
          return res
            .status(claim.replay.http_status || 200)
            .json({ ...claim.replay.body, duplicate: true });
        }
        // A twin attempt holds the id and never finished. Punching again could
        // check the employee out, so report what today actually looks like and
        // let the app render that instead.
        const state = await getTodayAttendanceState(body.card_no);
        logger.warn(
          `[ATTENDANCE] duplicate punch ${clientEventId} for card=${body.card_no} answered from ` +
            `today's state (${state.state}) rather than marking again`,
        );
        // Marked already — the twin got there. That is a success, and the app
        // should show it as one.
        if (state.state !== 'NOT_MARKED') {
          return res.json({
            success: true,
            status: 'success',
            action: 'noop',
            duplicate: true,
            message: `Attendance already marked at ${state.check_in_time}`,
            marked_at: state.check_in_time,
            card_no: state.card_no,
            marked_card_no: state.card_no,
            today: state,
          });
        }

        // Nothing marked and the id is held: we genuinely cannot say what
        // happened, and must not punch again to find out. A failure status, not
        // a 200 — the employee is being asked to try again.
        return res.status(409).json({
          success: false,
          status: 'error',
          code: 'DUPLICATE_IN_FLIGHT',
          duplicate: true,
          message: 'Could not confirm your attendance. Please try again.',
          today: state,
        });
      }
      claimed = true;
    }

    // Face guard: the FACE is the source of truth — mark whoever was actually
    // scanned, not whatever card the client sent (the kiosk flow can pre-fill a
    // previously-logged-in card). When the app sends the scanned frames, ask the
    // 8002 face service to identify the person and mark THAT card, overriding the
    // submitted card_no. If the face can't be confidently identified, mark no one.
    // Frames are optional for now so older app builds still work (unverified);
    // once the frame-sending app ships, this becomes the only accepted path.
    let cardToMark = body.card_no;
    let scannedName = null;
    if (body.frames && body.frames.length) {
      const { card_no: scannedCard, emp_name, reason } =
        await identifyScannedCard(body.frames);
      scannedName = emp_name;
      if (!scannedCard) {
        logger.warn(
          `[FACE_GUARD] no confident identity for face-mark (submitted card=${body.card_no}): ${reason}`
        );
        return punchRejected(
          res,
          'Face not recognized. Attendance not marked.',
          'FACE_NOT_RECOGNIZED',
          clientEventId,
        );
      }
      if (scannedCard !== body.card_no) {
        logger.warn(
          `[FACE_GUARD] overriding submitted card=${body.card_no} with scanned identity=${scannedCard} (${scannedName})`
        );
      }
      cardToMark = scannedCard;
    } else {
      logger.warn(
        `[FACE_GUARD] UNVERIFIED face-mark for card=${body.card_no} (no frames sent by app version=${body.app_version})`
      );
    }

    const result = await smartMarkAttendance(cardToMark, body.attendance_type, {
      latitude: body.latitude,
      longitude: body.longitude,
      accuracy: body.accuracy,
      address: body.address,
      formatted_address: body.formatted_address,
      timestamp: body.timestamp,
      device_id: body.device_id,
      device_model: body.device_model,
      app_version: body.app_version,
    });

    if (result.status === 'error') {
      return punchRejected(res, result.message || 'Attendance could not be marked.', null, clientEventId);
    }
    // What the mark means for location tracking, so the app does not have to
    // make a second call after every check-in and check-out — and so it never
    // has to decide for itself whether a checkout was the final one. Added
    // alongside the existing keys, never replacing them: a client that ignores
    // `tracking` behaves exactly as it did before.
    let tracking = null;
    try {
      const state = await getTrackingState(cardToMark);
      if (state.status === 'success') tracking = state.data;
    } catch (e) {
      // Never fail a successful attendance mark over the tracking hint.
      logger.warn(`[ATTENDANCE] tracking state unavailable for ${cardToMark}: ${e.message ?? e}`);
    }

    // Who was actually marked. The face service names the person it identified;
    // when the client sent no frames there is no scanned name, so fall back to
    // the employee the marked card belongs to — the app trusts the server's
    // identification over what the phone sent, so it must always get one.
    let markedFor = scannedName;
    if (!markedFor) {
      try {
        markedFor = (await lookupByPhone(cardToMark))?.emp_name || null;
      } catch (e) {
        logger.warn(`[ATTENDANCE] name lookup failed for ${cardToMark}: ${e.message ?? e}`);
      }
    }
    if (!markedFor) markedFor = tracking?.employee_name || null;

    const payload = {
      // Was always '' here. Now carries today's ATTENDANCE_RECORDS id when it
      // is known, kept as a string so the field's type never changes.
      attendance_id: tracking?.attendance_id != null ? String(tracking.attendance_id) : '',
      marked_at: result.marked_at ?? null,
      location_verified: result.location_verified ?? false,
      message: result.message ?? 'Attendance marked successfully',
      card_no: cardToMark,
      // The card the punch was persisted against, under the name the app reads.
      marked_card_no: cardToMark,
      marked_for: markedFor,
      // 'check_in' | 'check_out' | 'noop' — what the mark actually did.
      action: result.action ?? null,
      // Lifted out of `tracking` so a check-out says plainly whether it was the
      // final one; both stay inside `tracking` as well for existing callers.
      is_final_checkout: tracking?.is_final_checkout ?? null,
      tracking_state: tracking?.tracking_state ?? null,
      // true = the ERP duty roster shows this check-in, so HRMS will report the
      // day as present. false = saved here but the roster did not take it (the
      // day will read as absent until corrected). null = not applicable.
      // The punch is stored either way; this is never a reason to fail the mark.
      posted_to_erp: result.posted_to_erp ?? null,
      tracking,
    };

    // success:true means the punch is persisted in HRMS — nothing else sets it.
    // Kept alongside the original `body` envelope so older builds still parse.
    const response = { success: true, status: 'success', ...payload, body: payload };

    // Remember the answer BEFORE sending it: the retry this protects against
    // happens precisely when the response never arrives, so it has to be
    // replayable even though this client never saw it.
    if (clientEventId) await completePunch(clientEventId, 200, response);

    return res.json(response);
  } catch (err) {
    // Nothing reliable was stored, so give the id back — the employee's retry
    // must be a real attempt rather than a replay of a crash.
    if (claimed) {
      try {
        await releasePunch(clientEventId);
      } catch (e) {
        logger.info(`[ATTENDANCE] could not release punch ${clientEventId}: ${e.message ?? e}`);
      }
    }
    next(err);
  }
};

// POST /auth/attendance/:card_no  (catch-all — manual mark)
export const manualAttendance = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const { latitude, longitude } = res.locals.validated.body;

    const result = await smartMarkAttendance(card_no, 'check_in', { latitude, longitude });

    if (result.status === 'error') {
      return punchRejected(res, result.message || 'Attendance could not be marked.');
    }
    return res.json({ success: true, status: result.status, message: result.message });
  } catch (err) {
    next(err);
  }
};

// GET /auth/attendance/today/:card_no — what this employee has punched today
// and what the next tap would do. Replaces deriving it from the month report.
export const todayAttendanceState = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    res.json(await getTodayAttendanceState(card_no));
  } catch (err) {
    next(err);
  }
};

// GET /auth/attendance/report-range/:card_no
export const attendanceReportRange = async (req, res) => {
  try {
    const { card_no } = res.locals.validated.params;
    const { from_date, to_date } = res.locals.validated.query;
    const items = await getAttendanceReportRange(card_no, from_date, to_date);
    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ detail: String(e.message ?? e) });
  }
};

// GET /auth/attendance/report/:card_no/:date_str
export const attendanceReportByDate = async (req, res) => {
  try {
    const { card_no, date_str } = res.locals.validated.params;
    const items = await getAttendanceReport(card_no, date_str);
    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ detail: String(e.message ?? e) });
  }
};

// GET /auth/attendance/summary
export const attendanceSummary = async (req, res) => {
  try {
    const { emp_pk, from_date, to_date } = res.locals.validated.query;
    const data = await getAttendanceSummary(emp_pk, from_date, to_date);
    return res.json({ body: data });
  } catch (e) {
    return res.status(500).json({ detail: String(e.message ?? e) });
  }
};

export const attendanceReportPdf = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const { from_date, to_date } = res.locals.validated.query;

    // Input guards ported from FastAPI's attendance_report_pdf
    // (routers/attendance_router.py). Without them a malformed date reached
    // Oracle and came back as a 500 instead of a clean 400.
    for (const [label, value] of [['from_date', from_date], ['to_date', to_date]]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || Number.isNaN(Date.parse(`${value}T00:00:00`))) {
        return res.status(400).json({ detail: `${label} must be in YYYY-MM-DD format` });
      }
    }
    if (from_date > to_date) {
      return res.status(400).json({ detail: 'from_date must not be after to_date' });
    }

    // Unknown card = no roster rows AND no employee record. A real employee with
    // simply no attendance in the range still gets an (empty) report, not a 404.
    const rows = await getAttendanceReportRange(card_no, from_date, to_date);
    let found = null;
    try {
      found = await lookupByPhone(card_no);
    } catch (e) {
      logger.warn(`[REPORT_PDF] name lookup failed for card=${card_no}: ${e.message ?? e}`);
    }
    if ((!rows || rows.length === 0) && !found) {
      return res.status(404).json({ detail: 'Card not found' });
    }

    const pdfBuffer = await buildAttendancePdf(card_no, from_date, to_date);
    const filename = `attendance_${card_no}_${from_date}_to_${to_date}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (e) {
    return res.status(500).json({ detail: `PDF generation failed: ${e.message ?? e}` });
  }
};

