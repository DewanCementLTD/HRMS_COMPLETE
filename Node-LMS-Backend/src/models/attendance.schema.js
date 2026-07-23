import { z } from 'zod';

export const faceAttendanceSchema = z.object({
  body: z.object({
    card_no: z.string().min(1),
    attendance_type: z.string().min(1),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    accuracy: z.number().optional(),
    address: z.string().optional(),
    formatted_address: z.string().optional(),
    timestamp: z.string().optional(),
    device_id: z.string().optional(),
    device_model: z.string().optional(),
    app_version: z.string().optional(),
    app_build: z.number().int().optional(),
  }),
});

export const manualAttendanceSchema = z.object({
  params: z.object({
    card_no: z.string().min(1),
  }),
  body: z.object({
    latitude: z.number().optional(),
    longitude: z.number().optional(),
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
