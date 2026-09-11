import { z } from 'zod';

const usridParam = z.object({ usrid: z.string().min(1, 'usrid is required') });
const codeList = z.array(z.string()).default([]);

export const adminLoginSchema = z.object({
  body: z.object({
    usrid: z.string().min(1, 'Username is required'),
    password: z.string().min(1, 'Password is required'),
  }),
});

export const setCompaniesSchema = z.object({
  params: usridParam,
  body: z.object({ companies: codeList }),
});

export const setBranchesSchema = z.object({
  params: usridParam,
  body: z.object({ branches: codeList }),
});

export const setStatusSchema = z.object({
  params: usridParam,
  body: z.object({ enabled: z.boolean() }),
});

export const setPasswordSchema = z.object({
  params: usridParam,
  body: z.object({ password: z.string().min(6, 'Password must be at least 6 characters') }),
});

export const createUserSchema = z.object({
  body: z.object({
    // SEC_USERNAME.USRID is VARCHAR2(2) — the existing accounts are 'RK', 'SA', '1'.
    usrid: z.string().min(1, 'User id is required').max(2, 'User id can be at most 2 characters'),
    name: z.string().max(40, 'Name is at most 40 characters').optional(),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    // 'M' carries salary-edit rights in the main app; 'U' is an ordinary user.
    ulevl: z.enum(['M', 'U']).optional().default('U'),
    mobile: z.string().optional(),
    ecode: z.string().optional(),
    companies: codeList,
    branches: codeList,
  }),
});
