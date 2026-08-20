export interface LeaveBalance {
  leave_type: string;
  leave_type_pk?: number;
  leave_desc?: string;
  balance: number;
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
  balance: number;
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
