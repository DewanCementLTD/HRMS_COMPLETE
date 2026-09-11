export interface LeaveBalance {
  leave_type: string;
  leave_type_pk?: number;
  leave_desc?: string;
  /** What is still available: approved leave gone, pending requests held back. */
  balance: number;
  /** Entitlement left before pending requests are held back. */
  total_balance?: number;
  /** Days held by requests awaiting approval. */
  pending_days?: number;
  is_od?: boolean;
}

export interface LeaveBalanceResponse {
  items: LeaveBalance[];
}

// Apply-leave dropdown/LOV — curated from LEAVE_TYPES only (not the raw balance
// feed, which also carries display-only rows like ABSENT/contract buckets).
export interface LeaveType {
  leave_type: string;
  leave_type_pk: number;
  leave_desc?: string;
  /** What can still be applied for: entitlement left minus pending requests. */
  balance: number;
  /** Entitlement left before pending requests are deducted. */
  total_balance?: number;
  /** Days held by requests awaiting approval. */
  pending_days?: number;
  is_od: boolean;
}

export interface LeaveTypesResponse {
  items: LeaveType[];
}

export interface LeaveApplyRequest {
  // Leave type code/PK/description string — codes aren't guaranteed unique
  // (duplicate 'CL'), so the PK is what actually gets submitted.
  type: string;
  from_date: string;
  to_date: string;
  reason: string;
  half_day?: boolean;
  half_day_session?: "first" | "second";
  from_time?: string;
  to_time?: string;
  compc?: number;
  brnch?: number;
  emp_name?: string;
}

export interface LeaveApplication {
  leave_type: string;
  leave_desc?: string;
  from_date: string;
  to_date: string;
  leave_days?: number;
  reason?: string;
  status: string;
  entry_date?: string;
}

export interface LeaveStatusResponse {
  items: LeaveApplication[];
}

// ── HOD approvals ──────────────────────────────────────────────────────
// An application names its approvers by MOBILE NUMBER in HOD1_MNO/HOD2_MNO
// (copied from the applicant's EMPLOYEE.HOD1/HOD2). Two approvers => two steps,
// HOD 1 first; one approver => a single step.
export interface HodApproval {
  leave_application_pk: number;
  emp_fk: string | null;
  emp_name: string;
  leave_type: string;
  leave_desc: string;
  from_date: string;
  to_date: string;
  leave_days: number | null;
  reason: string;
  status: string;
  entry_date?: string;
  hod1_name?: string;
  hod2_name?: string;
  hod1_app_flag?: string;
  hod2_app_flag?: string;
  step: 1 | 2;
  total_steps: 1 | 2;
  my_decision: "approved" | "rejected" | null;
  my_turn: boolean;
  waiting_on: string | null;
}

export interface HodApprovalsResponse {
  is_hod: boolean;
  approver_mobile: string;
  items: HodApproval[];
}

// HOD list of values for the employee form — the value stored on the employee
// is the mobile number.
export interface HodOption {
  mobile: string;
  name: string;
  empcode: string;
  unit_id: number | string;
  department: string;
}

// ── Leave allocation (LEAVE_OP), HR only ───────────────────────────────
// OP_BAL is the entitlement ALL_LEAVE_BAL_V reads as `new_entitled`, keyed by
// (employee, leave type, year, company, branch).
export interface LeaveOpening {
  card_no: string;
  emp_name: string;
  leave_type_fk: number;
  leave_type: string;
  leave_desc: string;
  op_bal: number | null;
  op_date: string | null;
  year: number;
  compc: number | string;
  brnch: number | string;
}

export interface AllocatableEmployee {
  card_no: string;
  emp_name: string;
  compc: number | string;
  brnch: number | string;
  department: string;
}

export interface LeaveOpeningEntry {
  leave_type_fk: number;
  op_bal: number | null;
}

// A leave year as the ERP defines it (the YEAR table), not a calendar year.
// Only the active one is reflected in ALL_LEAVE_BAL_V.
export interface LeaveYear {
  year: number;
  /** True for the year ALL_LEAVE_BAL_V actually reads (YEAR.ACTIVE_FLAG='Y'). */
  active: boolean;
  year_from?: string | null;
  year_to?: string | null;
  /** From Payroll > Period Opening (HR_FINANCIAL_YEAR). */
  rule_id?: number;
  scode?: string;
  open?: boolean;
  /** How many branches / active employees this active year covers. */
  branches?: number;
  employees?: number;
  /** Other years flagged active on this company's *other* branches. */
  other_active_years?: number[];
}
