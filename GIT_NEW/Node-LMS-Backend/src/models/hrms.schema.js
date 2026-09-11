import { z } from "zod";
import { pyInt, pyStr } from "../utils/pydanticTypes.js";

/**
 * Zod schemas for the /hrms/* routes.
 *
 * NOTE: the validate() middleware runs `schema.parse(...)` which strips any
 * query/param key not declared here, so `admin_card_no` (read by the
 * requireHrAdmin middleware from res.locals.validated.query) MUST be present
 * in every query schema below.
 */

// Employee create/update payload (mirrors EmployeeCreateRequest /
// EmployeeUpdateRequest in the FastAPI models/hrms_models.py).
const employeeBody = {
  name: z.string(),
  fhname: z.string().optional(),
  atdtcard: pyStr().optional(),
  sex: z.string().optional(),
  dtofbrth: z.string().optional(),
  nicno: z.string().optional(),
  dtofappt: z.string().optional(),
  dept_no: pyStr().optional(),
  desg_cd: pyStr().optional(),
  // 10 or 11 digits (03001234567, or 3001234567 without the leading zero).
  // Checked on digits alone so spaces or dashes don't count toward the limit.
  mobile: pyStr(
    z.string().refine(
      (v) => {
        const d = String(v).replace(/\D/g, "");
        return d.length >= 10 && d.length <= 11;
      },
      { message: "Mobile number must be 10 or 11 digits" },
    ),
  ),
  email: z.string().optional(),
  address: z.string().optional(),
  unit_id: z.number().int().min(0, "must include a valid unit_id"),
  status: z.string().optional(),
  user_paswd: z.string().min(8, "Password must be at least 8 characters long"),
  hr_admin: z.string().optional(),
  rpt_officer: pyStr().optional(),
  marstat: z.string().optional(),
  grade_cd: pyStr().optional(),
  religion: z.string().optional(),
  // HOD1/HOD2/HOD3 hold the approver's MOBILE NUMBER (see HOD1_MNO on a leave
  // application). The employee form's picker supplies it as a string, and a
  // mobile may carry a leading zero, so coerce rather than demand a number.
  // An empty string means "no HOD" and is dropped before validation.
  hod1: pyInt().nullable().optional(),
  hod2: pyInt().nullable().optional(),
  hod3: pyInt().nullable().optional(),
  basic: z.number().optional(),
  gross: z.number().optional(),
  shift: z.string().optional(),
  w_hour: z.number().optional(),
  bldgrp: z.string().optional(),
  // Recorded when HR moves an employee to another branch. A DATE column in
  // Oracle, but it arrives over JSON as a 'YYYY-MM-DD' string like DTOFAPPT
  // and is written through TO_DATE, so validate it as a string.
  transfer_date: z.string().optional(),
  location: pyStr(z.string().min(1, "Location is required")),
  track_location: z.string().optional(),
  track_location_hr: z.number().int().min(1).max(24).optional(),
  emp_status: z.string().optional(),
  ntn: z.string().optional(),
  bnkcode: z.string().optional(),
  brncode: z.string().optional(),
  bnkacct: z.string().optional(),
  qfication: z.string().optional(),
  qual_detail: z.string().optional(),
  dtofconfirm: z.string().optional(),
};

// GET /hrms/dashboard, /hrms/dashboard/analytics
export const dashboardQuerySchema = z.object({
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
    date: z.string().optional(),
    compc: z.string().optional(),
    brnch: z.string().optional(),
  }),
});

// GET /hrms/employees
export const listEmployeesSchema = z.object({
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
    status: z.string().optional(),
    compc: z.string().optional(),
    brnch: z.string().optional(),
  }),
});

// GET /hrms/employees/search
export const searchEmployeesSchema = z.object({
  query: z.object({
    q: z.string().min(1, "q is required"),
    admin_card_no: z.string().min(1, "admin_card_no is required"),
    compc: z.string().optional(),
    brnch: z.string().optional(),
  }),
});

// GET /hrms/employees/:empcode  and  GET /hrms/employees/:empcode/card
export const employeeDetailSchema = z.object({
  params: z.object({
    empcode: z.string().min(1, "empcode is required"),
  }),
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
  }),
});

// The pickers send "" when HR clears a HOD; Pydantic-style coercion treats an
// empty string as invalid, so strip those keys before the body is validated.
const dropBlankHods = (body) => {
  if (!body || typeof body !== "object") return body;
  const out = { ...body };
  for (const k of ["hod1", "hod2", "hod3"]) {
    if (out[k] === "") out[k] = null;   // cleared in the picker -> clear the column
  }
  return out;
};

// POST /hrms/employees
export const createEmployeeSchema = z.object({
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
  }),
  body: z.preprocess(dropBlankHods, z.object({
    ...employeeBody,
    name: z.string().min(1, "Employee name is required"),
  })),
});

// PUT /hrms/employees/:empcode
export const updateEmployeeSchema = z.object({
  params: z.object({
    empcode: z.string().min(1, "empcode is required"),
  }),
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
  }),
  body: z.preprocess(dropBlankHods, z.object(employeeBody)),
});

// GET /hrms/attendance/bulk  and  /hrms/attendance/details
export const attendanceReportSchema = z.object({
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
    from_date: z.string().min(1, "from_date is required"),
    to_date: z.string().min(1, "to_date is required"),
    compc: z.string().optional(),
    brnch: z.string().optional(),
  }),
});

// GET /hrms/duty-roster/:card_no
export const dutyRosterSchema = z.object({
  params: z.object({
    card_no: z.string().min(1, "card_no is required"),
  }),
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
    month: z.string().optional(),
  }),
});

// PUT /hrms/duty-roster/entry/:pk
// PUT /hrms/duty-roster/bulk — one shift applied across a date range for one
// employee, so a change running for weeks isn't edited a day at a time.
export const bulkDutyRosterShiftSchema = z.object({
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
    compc: z.string().optional(),
    brnch: z.string().optional(),
  }),
  body: z.object({
    card_no: z.string().min(1, "card_no is required"),
    from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from_date must be YYYY-MM-DD"),
    to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to_date must be YYYY-MM-DD"),
    shift: z.string().min(1, "shift is required"),
    // The days HR ticked in the dialog. Left out, the whole range is applied,
    // which is how this endpoint behaved before the day picker.
    dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dates must be YYYY-MM-DD")).optional(),
  }),
});

// GET /hrms/duty-roster/days — the rostered days in a range, for the picker.
export const rosterDaysSchema = z.object({
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
    card_no: z.string().min(1, "card_no is required"),
    from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from_date must be YYYY-MM-DD"),
    to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to_date must be YYYY-MM-DD"),
    compc: z.string().optional(),
    brnch: z.string().optional(),
  }),
});

export const updateDutyRosterEntrySchema = z.object({
  params: z.object({
    pk: z.string().regex(/^\d+$/, "Input should be a valid integer, unable to parse string as an integer")
  }),
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
  }),
  body: z.object({
    shift: z.string().optional(),
    remarks: z.string().optional(),
  }),
});

// POST /hrms/employees/:empcode/reset-password
export const resetPasswordSchema = z.object({
  params: z.object({
    empcode: z.string().min(1, "empcode is required"),
  }),
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
  }),
  // Omit `password` to restore the initial one already on file.
  body: z.object({
    password: z.string().min(8, "Password must be at least 8 characters long").optional(),
  }).optional().default({}),
});
