import { z } from "zod";

export const getTrackingSettingsSchema = z.object({
  params: z.object({
    emp_code: z.string().min(1, "emp_code is required"),
  }),
});

export const updateTrackingSettingsSchema = z.object({
  params: z.object({
    emp_code: z.string().min(1, "emp_code is required"),
  }),
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
    track_location: z.string().regex(/^[YN]$/i, "track_location must be 'Y' or 'N'"),
    track_location_hr: z.string()
      .regex(/^\d+$/, "Input should be a valid integer")
      .optional()
      .transform(val => (val ? parseInt(val, 10) : 2))
      .refine(val => val >= 1 && val <= 24, "track_location_hr must be between 1 and 24 hours"),
  }),
});

export const getGeofenceSchema = z.object({
  params: z.object({
    emp_code: z.string().min(1, "emp_code is required"),
  }),
});
