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
} from '../services/attendance.service.js';
import { buildAttendancePdf } from '../services/attendancePdf.service.js';
import { forceUpdateBlock } from '../services/appVersion.service.js';
import { identifyScannedCard } from '../services/faceVerification.service.js';
import { lookupByPhone } from '../services/auth.service.js';
import { logger } from '../utils/logger.js';

// POST /auth/attendance/face

export const faceAttendance = async (req, res, next) => {
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
        return res.status(400).json({
          detail: {
            code: 'FACE_NOT_RECOGNIZED',
            message: 'Face not recognized. Attendance not marked.',
          },
        });
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
      return res.status(400).json({ detail: result.message });
    }
    return res.json({
      body: {
        attendance_id: '',
        marked_at: result.marked_at ?? null,
        location_verified: result.location_verified ?? false,
        message: result.message ?? 'Attendance marked successfully',
        // Who was actually marked — the scanned/identified person, which may
        // differ from the card the client sent. Lets the kiosk show the right
        // name instead of the pre-filled one. Both were missing here.
        card_no: cardToMark,
        marked_for: scannedName,
      },
    });
  } catch (err) {
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
      return res.status(400).json({ detail: result.message });
    }
    return res.json({ status: result.status, message: result.message });
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

