import { z } from 'zod';
import { pyFloat } from '../utils/pydanticTypes.js';

// Mirrors FastAPI's LocationPoint (models/location_models.py) exactly:
//   latitude: float          (required)
//   longitude: float         (required)
//   accuracy: float = 0.0    (optional, DEFAULTS to 0.0 — not undefined)
//   recorded_at: str         (REQUIRED — was optional here)
// Pydantic coerces numeric strings, which the GPS batch sender relies on.
const LocationPointSchema = z.object({
  latitude: pyFloat(),
  longitude: pyFloat(),
  accuracy: pyFloat().optional().default(0.0),
  recorded_at: z.string(),
  attendance_date: z.string().optional(),
});

export const locationBatchSchema = z.object({
  body: z.object({
    card_no: z.string().min(1),
    // FastAPI puts no minimum on this list; an empty batch is a valid no-op
    // there, so a .min(1) here would 422 a request the live backend accepts.
    locations: z.array(LocationPointSchema),
  }),
});

export const locationHistorySchema = z.object({
  params: z.object({
    card_no: z.string().min(1),
  }),
  query: z.object({
    date: z.string().min(1, 'date is required'),
    admin_card_no: z.string().min(1, 'admin_card_no is required'),
  }),
});

export const locationSummarySchema = z.object({
  query: z.object({
    date: z.string().min(1, 'date is required'),
    admin_card_no: z.string().min(1, 'admin_card_no is required'),
    compc: z.string().optional(),
    brnch: z.string().optional(),
  }),
});

export const locationReportSchema = z.object({
  query: z.object({
    from_date: z.string().min(1, 'from_date is required'),
    to_date: z.string().min(1, 'to_date is required'),
    admin_card_no: z.string().min(1, 'admin_card_no is required'),
    compc: z.string().optional(),
    brnch: z.string().optional(),
    dept_no: z.string().optional(),
    desg_cd: z.string().optional(),
    empcodes: z.string().optional(),
    region: z.string().optional(),
    category: z.string().optional(),
  }),
});

export const myLocationHistorySchema = z.object({
  params: z.object({
    card_no: z.string().min(1),
  }),
  query: z.object({
    date: z.string().min(1, 'date is required'),
  }),
});

