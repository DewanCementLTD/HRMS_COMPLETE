import { z } from 'zod';

export const loginSchema = z.object({
  body: z.object({
    username: z.string().min(1, 'Username is required'),
    password: z.string().min(1, 'Password is required'),
    app_version: z.string().optional(),
    app_build: z.number().int().optional(),
    platform: z.enum(['ANDROID', 'IOS']).optional(),
  }),
});

export const changePasswordSchema = z.object({
  params: z.object({
    card_no: z.string().min(1, 'card_no is required'),
  }),
  body: z.object({
    old_password: z.string().min(1, 'Current password is required'),
    new_password: z.string().min(8, 'New password must be at least 8 characters'),
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

export const emergencyContactSchema = z.object({
  params: z.object({
    card_no: z.string().min(1, 'card_no is required'),
  }),
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    relationship: z.string().default(''),
    phone: z.string().default(''),
  }),
});

