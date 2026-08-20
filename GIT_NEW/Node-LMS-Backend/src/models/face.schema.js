import { z } from "zod";

// Mirrors FastAPI's face_models.py. `frames: List[str]` carries NO minimum
// length there — the "Minimum 10 frames required" rule is enforced in the router
// as a 400. A .min(1) here would pre-empt that with a 422 and a different
// message for an empty frame list.
export const faceRegisterSchema = z.object({
  body: z.object({
    card_no: z.string().min(1, "card_no is required"),
    frames: z.array(z.string()),
    created_at: z.string().optional().nullable(),
  }),
});

export const faceVerifySchema = z.object({
  body: z.object({
    card_no: z.string().min(1, "card_no is required"),
    frames: z.array(z.string()),
  }),
});

export const faceIdentifySchema = z.object({
  body: z.object({
    frames: z.array(z.string()),
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
