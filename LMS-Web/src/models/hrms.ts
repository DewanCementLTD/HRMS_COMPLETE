export interface HRMSEmployee {
  empcode: string;
  name?: string;
  fhname?: string;
  atdtcard?: string;
  sex?: string;
  dtofbrth?: string;
  nicno?: string;
  dtofappt?: string;
  dept_no?: string;
  desg_cd?: string;
  mobile?: string;
  email?: string;
  address?: string;
  unit_id?: number;
  status?: string;
  hr_admin?: string;
  rpt_officer?: string;
  marstat?: string;
  grade_cd?: string;
  religion?: string;
  hod1?: number;
  hod2?: number;
  hod3?: number;
  basic?: number;
  gross?: number;
  shift?: string;
  w_hour?: number;
  bldgrp?: string;
  location?: string;
  user_paswd?: string;
  track_location?: string;
  track_location_hr?: number;
}

export interface HRMSEmployeeCreate {
  name: string;
  fhname?: string;
  atdtcard?: string;
  sex?: string;
  dtofbrth?: string;
  nicno?: string;
  dtofappt?: string;
  dept_no?: string;
  desg_cd?: string;
  mobile?: string;
  email?: string;
  address?: string;
  unit_id?: number;
  status?: string;
  user_paswd?: string;
  hr_admin?: string;
  rpt_officer?: string;
  marstat?: string;
  grade_cd?: string;
  religion?: string;
  hod1?: number;
  hod2?: number;
  hod3?: number;
  basic?: number;
  gross?: number;
  shift?: string;
  w_hour?: number;
  bldgrp?: string;
  location?: string;
  track_location?: string;
  track_location_hr?: number;
}

export interface HRDashboardStats {
  total_employees: number;
  present_today: number;
  absent_today: number;
  late_today: number;
  incomplete_today: number;
  on_leave_today: number;
  recent_hires: number;
  department_breakdown: DepartmentStat[];
  yesterday_present?: number;
  yesterday_absent?: number;
  yesterday_on_leave?: number;
  upcoming_birthdays?: UpcomingBirthday[];
  upcoming_anniversaries?: UpcomingAnniversary[];
  upcoming_leaves?: UpcomingLeave[];
  shift_wise?: ShiftStat[];
  top_reasons?: AbsenceReason[];
  turnover_ytd?: number;
}

export interface DepartmentStat {
  department: string;
  total: number;
  present: number;
}

export interface UpcomingBirthday {
  name: string;
  date: string;
  dept: string;
  days_until: number;
}

export interface UpcomingAnniversary {
  name: string;
  date: string;
  years: number;
  dept: string;
  days_until: number;
}

export interface UpcomingLeave {
  name: string;
  from_date: string;
  to_date: string;
  leave_type: number;
  status: string;
  days: number;
  dept: string;
}

export interface ShiftStat {
  shift: string;
  present: number;
  total: number;
  pct: number;
}

export interface AbsenceReason {
  reason: string;
  count: number;
}

export interface HRAnalyticsKpi {
  late_logins: number;
  early_logins: number;
  overtime_hours: number;
  unapproved_leaves: number;
  avg_work_hrs: number;
  attendance_pct: number;
}

export interface DailyAttendance {
  day: string;
  on_time: number;
  late: number;
  absent: number;
}

export interface MonthlyAttendance {
  month: string;
  available: number;
  overtime: number;
  on_leave: number;
  late_clockin: number;
  absent: number;
  attendance_pct: number;
  absenteeism_rate: number;
}

export interface HRAnalytics {
  kpis: HRAnalyticsKpi;
  daily_attendance: DailyAttendance[];
  monthly_attendance: MonthlyAttendance[];
}

export interface HRMSSearchResult {
  empcode: string;
  name?: string;
  fhname?: string;
  atdtcard?: string;
  dept_no?: string;
  desg_cd?: string;
  mobile?: string;
  email?: string;
  status?: string;
  hr_admin?: string;
  unit_id?: number;
  card_no?: string;
  sex?: string;
  location?: string;
  track_location?: string;
  track_location_hr?: number;
}
