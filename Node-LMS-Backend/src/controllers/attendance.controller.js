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

    const result = await smartMarkAttendance(body.card_no, body.attendance_type, {
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
    const pdfBuffer = await buildAttendancePdf(card_no, from_date, to_date);
    const filename = `attendance_${card_no}_${from_date}_to_${to_date}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (e) {
    return res.status(500).json({ detail: `PDF generation failed: ${e.message ?? e}` });
  }
};

