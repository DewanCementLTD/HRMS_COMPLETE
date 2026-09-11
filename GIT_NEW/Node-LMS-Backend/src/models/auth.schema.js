import { z } from 'zod';
import { pyInt } from '../utils/pydanticTypes.js';

export const loginSchema = z.object({
  body: z.object({
    username: z.string().min(1, 'Username is required'),
    password: z.string().min(1, 'Password is required'),
    // FastAPI's LoginRequest is app_version: Optional[str], app_build:
    // Optional[int], platform: Optional[str] — an unconstrained string and a
    // COERCING int. The mobile app sends app_build as a string and platform in
    // its own casing, both of which a z.number()/z.enum() pair rejects with 422
    // even though the live backend accepts them. Match Pydantic exactly.
    app_version: z.string().optional(),
    app_build: pyInt().optional(),
    platform: z.string().optional(),
    // Optional, and only recorded inside the issued session token so a stolen
    // token can be traced to a handset. Nothing rejects a login without it.
    device_id: z.string().max(400).optional(),
  }),
});

export const changePasswordSchema = z.object({
  params: z.object({
    card_no: z.string().min(1, 'card_no is required'),
  }),
  body: z.object({
    old_password: z.string().min(1, 'Current password is required'),
    // FastAPI's ChangePasswordRequest imposes no length rule; an 8-char minimum
    // here rejects passwords the live backend accepts.
    new_password: z.string().min(1, 'New password is required'),
  }),
});

export const card_noSchema = z.object({
  params: z.object({
    card_no: z.string().min(1, 'card_no is required'),
  }),
});

export const phoneSchema = z.object({
  params: z.object({
    phone: z.string().min(1, 'Phone number is required'),
  }),
});

// The mobile app posts `relation`; the web posts `relationship`. Both name the
// same stored column, so either satisfies the schema and the controller reads
// whichever arrived — requiring one spelling would break the other client.
export const emergencyContactSchema = z.object({
  params: z.object({
    card_no: z.string().min(1, 'card_no is required'),
  }),
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    relation: z.string().optional(),
    relationship: z.string().optional(),
    phone: z.string().default(''),
    phone_number: z.string().optional(),
  }),
});

