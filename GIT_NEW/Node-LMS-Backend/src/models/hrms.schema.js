import { z } from "zod";

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
  atdtcard: z.string().optional(),
  sex: z.string().optional(),
  dtofbrth: z.string().optional(),
  nicno: z.string().optional(),
  dtofappt: z.string().optional(),
  dept_no: z.string().optional(),
  desg_cd: z.string().optional(),
  mobile: z.string().min(10, "At least 10 characters are required for the mobile number"),
  email: z.string().optional(),
  address: z.string().optional(),
  unit_id: z.number().int().min(0, "must include a valid unit_id"),
  status: z.string().optional(),
  user_paswd: z.string().min(8, "Password must be at least 8 characters long"),
  hr_admin: z.string().optional(),
  rpt_officer: z.string().optional(),
  marstat: z.string().optional(),
  grade_cd: z.string().optional(),
  religion: z.string().optional(),
  hod1: z.number().int().optional(),
  hod2: z.number().int().optional(),
  hod3: z.number().int().optional(),
  basic: z.number().optional(),
  gross: z.number().optional(),
  shift: z.string().optional(),
  w_hour: z.number().optional(),
  bldgrp: z.string().optional(),
  location: z.string().min(1, "Location is required"),
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

// POST /hrms/employees
export const createEmployeeSchema = z.object({
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
  }),
  body: z.object({
    ...employeeBody,
    name: z.string().min(1, "Employee name is required"),
  }),
});

// PUT /hrms/employees/:empcode
export const updateEmployeeSchema = z.object({
  params: z.object({
    empcode: z.string().min(1, "empcode is required"),
  }),
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
  }),
  body: z.object(employeeBody),
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
