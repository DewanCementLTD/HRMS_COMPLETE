import { z } from 'zod';
import { pyInt, pyBool } from '../utils/pydanticTypes.js';

// Mirrors FastAPI's LeaveApplyRequest (models/auth_models.py) — the endpoint the
// Flutter app posts to. Every constraint here is one Pydantic actually enforces;
// extra strictness (min lengths, strict number/bool types) turns requests the
// live backend accepts into 422s for the mobile client.
export const applyLeaveSchema = z.object({
  params: z.object({
    card_no: z.string().min(1),
  }),
  body: z.object({
    type: z.string().optional(),
    leave_type_id: pyInt().optional(),
    from_date: z.string(),
    to_date: z.string(),
    // FastAPI declares `reason: str` — required, but an empty string is valid.
    reason: z.string(),
    half_day: pyBool().optional(),
    half_day_session: z.string().optional(), // "first" | "second"
    from_time: z.string().optional(),        // explicit HH:MM for half-day
    to_time: z.string().optional(),
    // compc/brnch are optional — filled server-side from the employee's row
    // when omitted (mirrors FastAPI's LeaveApplyRequest).
    compc: pyInt().optional(),
    brnch: pyInt().optional(),
    emp_name: z.string().optional().default(''),
  }),
});
