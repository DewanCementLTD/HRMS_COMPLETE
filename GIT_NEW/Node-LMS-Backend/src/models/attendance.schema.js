import { z } from 'zod';
import { pyInt, pyFloat } from '../utils/pydanticTypes.js';

// Mirrors FastAPI's FaceAttendanceRequest (models/attendance_models.py).
export const faceAttendanceSchema = z.object({
  body: z.object({
    card_no: z.string().min(1),
    attendance_type: z.string().min(1),
    latitude: pyFloat().optional(),
    longitude: pyFloat().optional(),
    accuracy: pyFloat().optional(),
    address: z.string().optional(),
    formatted_address: z.string().optional(),
    timestamp: z.string().optional(),
    device_id: z.string().optional(),
    device_model: z.string().optional(),
    app_version: z.string().optional(),
    app_build: pyInt().optional(),
    // Base64 JPEG frames of the face being marked. This field was missing from
    // the schema, and Zod strips unknown keys — so frames sent by the app were
    // silently discarded before the controller could ever see them, defeating
    // the face-identity guard.
    frames: z.array(z.string()).optional().nullable(),
    // The phone's own id for this tap. It retries the SAME id when a response
    // goes missing, and the server answers a repeat with the original answer
    // instead of punching again — see services/punchIdempotency.service.js.
    // Optional: builds that send none behave exactly as before.
    client_event_id: z.string().max(100).optional().nullable(),
  }),
});

// GET /auth/attendance/today/:card_no
export const attendanceTodaySchema = z.object({
  params: z.object({
    card_no: z.string().min(1),
  }),
});

export const manualAttendanceSchema = z.object({
  params: z.object({
    card_no: z.string().min(1),
  }),
  body: z.object({
    latitude: pyFloat().optional(),
    longitude: pyFloat().optional(),
  }),
});

export const attendanceRangeSchema = z.object({
  params: z.object({
    card_no: z.string().min(1),
  }),
  query: z.object({
    from_date: z.string().min(1, 'from_date is required'),
    to_date: z.string().min(1, 'to_date is required'),
  }),
});

export const attendanceDateSchema = z.object({
  params: z.object({
    card_no: z.string().min(1),
    date_str: z.string().min(1),
  }),
});

export const attendanceSummarySchema = z.object({
  query: z.object({
    emp_pk: z.string().min(1, 'emp_pk is required'),
    from_date: z.string().min(1, 'from_date is required'),
    to_date: z.string().min(1, 'to_date is required'),
  }),
});
