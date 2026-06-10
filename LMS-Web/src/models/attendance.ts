export interface AttendanceRecord {
  duty_roster_pk?: number;
  card_no?: string;
  roster_date: string;
  in_time?: string;
  out_time?: string;
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
}

export interface AttendanceSummaryResponse {
  body: AttendanceSummary;
}
