import { z } from 'zod';
import { pyInt, pyBool, pyFloat } from '../utils/pydanticTypes.js';

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
    // A half day is a SESSION, not a clock range: "first_half" | "second_half"
    // ("first" / "second" from older builds are accepted too). The server maps
    // the session to the employee's own shift times, so the app never has to
    // know them — which is why from_time / to_time are gone.
    half_day_session: z.string().optional(),
    // Sent by the app as 0.5 on a half day. Accepted and ignored: the number of
    // days charged is decided server-side from the dates and the session.
    leave_days: pyFloat().optional(),
    // compc/brnch are optional — filled server-side from the employee's row
    // when omitted (mirrors FastAPI's LeaveApplyRequest).
    compc: pyInt().optional(),
    brnch: pyInt().optional(),
    emp_name: z.string().optional().default(''),
  }),
});

// HOD approval decision — POST /auth/leave-approvals/:card_no/:pk
export const hodDecisionSchema = z.object({
  params: z.object({
    card_no: z.string().min(1),
    pk: z.string().min(1),
  }),
  body: z.object({
    decision: z.enum(['approve', 'reject']),
  }),
});

// HOD LOV for the HRMS employee form — scoped to one company.
export const hodOptionsSchema = z.object({
  query: z.object({
    admin_card_no: z.string().min(1),
    compc: z.string().optional(),
    brnch: z.string().optional(),
  }),
});

// ── Leave allocation (LEAVE_OP), HR only ───────────────────────────────
const leaveOpeningQuery = {
  admin_card_no: z.string().min(1),
  compc: z.string().optional(),
  brnch: z.string().optional(),
};

export const leaveOpeningListSchema = z.object({
  query: z.object({
    ...leaveOpeningQuery,
    year: z.string().optional(),
    card_no: z.string().optional(),
  }),
});

export const leaveOpeningScopeSchema = z.object({
  query: z.object(leaveOpeningQuery),
});

export const leaveOpeningSaveSchema = z.object({
  query: z.object({
    admin_card_no: z.string().min(1),
    compc: z.string().optional(),
  }),
  body: z.object({
    card_no: z.string().min(1),
    year: pyInt(),
    op_date: z.string().optional(),
    // A null/blank op_bal clears that leave type's allocation.
    entries: z.array(z.object({
      leave_type_fk: pyInt(),
      op_bal: pyFloat().nullable().optional(),
    })).min(1),
  }),
});
