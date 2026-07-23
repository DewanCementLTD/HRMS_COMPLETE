import { z } from "zod";

export const faceRegisterSchema = z.object({
  body: z.object({
    card_no: z.string().min(1, "card_no is required"),
    frames: z.array(z.string()).min(1, "frames are required"),
    created_at: z.string().optional().nullable(),
  }),
});

export const faceVerifySchema = z.object({
  body: z.object({
    card_no: z.string().min(1, "card_no is required"),
    frames: z.array(z.string()).min(1, "frames are required"),
  }),
});

export const faceIdentifySchema = z.object({
  body: z.object({
    frames: z.array(z.string()).min(1, "frames are required"),
  }),
});

export const faceStatusSchema = z.object({
  params: z.object({
    card_no: z.string().min(1, "card_no is required"),
  }),
});

export const faceDeleteSchema = z.object({
  params: z.object({
    card_no: z.string().min(1, "card_no is required"),
  }),
});
