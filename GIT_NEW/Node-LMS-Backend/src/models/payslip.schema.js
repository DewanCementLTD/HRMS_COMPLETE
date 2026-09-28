import { z } from 'zod';
import { pyInt } from '../utils/pydanticTypes.js';

// Employee self-service payslips (mobile). The card in the path must be the
// card the bearer token was issued for — requireEmployee enforces that.

export const myPayslipsSchema = z.object({
  params: z.object({
    card_no: z.string().min(1, 'card_no is required'),
  }),
});

export const myPayslipSchema = z.object({
  params: z.object({
    card_no: z.string().min(1, 'card_no is required'),
    period: pyInt(),
  }),
});
