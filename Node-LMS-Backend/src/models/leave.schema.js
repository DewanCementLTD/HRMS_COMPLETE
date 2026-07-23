import { z } from 'zod';

export const applyLeaveSchema = z.object({
  params: z.object({
    card_no: z.string().min(1),
  }),
  body: z.object({
    type: z.string().optional(),
    leave_type_id: z.number().int().optional(),
    from_date: z.string().min(1, 'from_date is required'),
    to_date: z.string().min(1, 'to_date is required'),
    reason: z.string().min(1, 'reason is required'),
    half_day: z.boolean().optional(),
    compc: z.number().int().min(1, 'compc is required'),
    brnch: z.number().int().min(1, 'brnch is required'),
    emp_name: z.string().optional(),
  }),
});
