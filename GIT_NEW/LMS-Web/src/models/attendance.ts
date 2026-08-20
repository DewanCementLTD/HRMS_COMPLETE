export interface AttendanceRecord {
  duty_roster_pk?: number;
  card_no?: string;
  roster_date: string;
  in_time?: string | null;
  out_time?: string | null;
  roster_shift?: string;
  w_hrs?: number;
  w_mnt?: number;
  late_hrs?: number;
  late_mnt?: number;
  ot_hrs?: number;
  ot_mnt?: number;
  absent_days?: number;
  status?: string;
  day_name?: string;
  roster_month?: string;
  roster_remarks?: string;
  leave_remarks?: string | null;
  // ERP duty-roster status flags (TMS_DUTY_ROSTER_V):
  //   late → yellow, absent → red, half day → orange
  morning_late?: string | null;
  early_out_late?: string | null;
  half_day?: number;
  is_late?: boolean;
  is_absent?: boolean;
  is_half_day?: boolean;
}

export interface AttendanceReportResponse {
  items: AttendanceRecord[];
}

export interface AttendanceSummary {
  total_days: number;
  present: number;
  incomplete: number;
  total_minutes: number;
  late_minutes: number;
  overtime_minutes: number;
  absent_days: number;
  late_days?: number;
  half_days?: number;
}

export interface AttendanceSummaryResponse {
  body: AttendanceSummary;
}
