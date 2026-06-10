export interface LeaveBalance {
  leave_type: number | string;
  leave_desc?: string;
  balance: number;
}

export interface LeaveBalanceResponse {
  items: LeaveBalance[];
}

export interface LeaveApplyRequest {
  from_date: string;
  to_date: string;
  reason: string;
  leave_type_id: number;
  compc: number;
  brnch: number;
  emp_name: string;
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
