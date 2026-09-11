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
  roster_remarks?: string | null;
  leave_remarks?: string | null;
  /** Ready-to-print remark: leave type + reason, "Absent", or the roster's own. */
  remarks?: string | null;
  leave_type?: string | null;
  leave_desc?: string | null;
  leave_type_fk?: number | null;
  leave_application_fk?: number | null;
  leave_days?: number | null;
  is_leave?: boolean;
  // ERP duty-roster status flags (TMS_DUTY_ROSTER_V):
  //   late → yellow, absent → red, half day → orange
  morning_late?: string | null;
  early_out_late?: string | null;
  half_day?: number;
  is_late?: boolean;
  is_absent?: boolean;
  is_half_day?: boolean;
  /** Every label that applied to the day, most significant first — `status` is
   *  flags[0], and `remarks` is all of them joined. A day the ERP flags absent
   *  despite a punch reads ["Absent", "Morning Late"]. */
  status_flags?: string[];
  /** MORNING_LATE / MORNING_HALF_DAY specifically, as opposed to the early-out
   *  equivalents that `is_late` / `is_half_day` also cover. */
  is_morning_late?: boolean;
  is_morning_half_day?: boolean;
  /** Rostered rest day (ROSTER_SHIFT = 'R') or a public holiday — neither is an
   *  absence, however empty the punch columns are. */
  is_rest?: boolean;
  is_holiday?: boolean;
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
