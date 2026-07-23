import { z } from 'zod';

const LocationPointSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().optional(),
  recorded_at: z.string().optional(),
  attendance_date: z.string().optional(),
});

export const locationBatchSchema = z.object({
  body: z.object({
    card_no: z.string().min(1),
    locations: z.array(LocationPointSchema).min(1, 'At least one location is required'),
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

