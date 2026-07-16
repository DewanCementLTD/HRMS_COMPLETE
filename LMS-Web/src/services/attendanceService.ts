import { apiRequest } from "./api";
import { AttendanceReportResponse, AttendanceSummaryResponse } from "@/models/attendance";

export async function fetchAttendanceReport(
  cardNo: string,
  date: string
): Promise<AttendanceReportResponse> {
  return apiRequest<AttendanceReportResponse>(
    `/auth/attendance/report/${cardNo}/${date}`
  );
}

export async function fetchAttendanceRange(
  cardNo: string,
  fromDate: string,
  toDate: string
): Promise<AttendanceReportResponse> {
  return apiRequest<AttendanceReportResponse>(
    `/auth/attendance/report-range/${cardNo}?from_date=${fromDate}&to_date=${toDate}`
  );
}

export async function fetchAttendanceSummary(
  cardNo: string,
  fromDate: string,
  toDate: string
): Promise<AttendanceSummaryResponse> {
  return apiRequest<AttendanceSummaryResponse>(
    `/auth/attendance/summary?emp_pk=${cardNo}&from_date=${fromDate}&to_date=${toDate}`
  );
}

// ── Bulk attendance (all employees) — HRMS Attendance tab ──
export interface BulkAttendanceRow {
  empcode: string;
  name?: string;
  atdtcard?: string;
  card_no?: string;
  dept_name?: string;
  unit_id?: number;
  location?: string;
  emp_status?: string;
  total_days: number;
  present_days: number;
  absent_days: number;
  late_days: number;
  half_days: number;
  working_minutes: number;
}

export interface AttendanceDetailRow {
  atdtcard?: string;
  card_no?: string;
  name?: string;
  roster_date: string;
  day_name?: string | null;
  duty_in?: string | null;
  duty_out?: string | null;
  in_time?: string | null;
  out_time?: string | null;
  // ERP status flags: late → yellow, absent → red, half day → orange
  status?: string;
  is_late?: boolean;
  is_absent?: boolean;
  is_half_day?: boolean;
}

function scopeQS(compc?: string, brnch?: string): string {
  let s = "";
  if (compc) s += `&compc=${encodeURIComponent(compc)}`;
  if (brnch) s += `&brnch=${encodeURIComponent(brnch)}`;
  return s;
}

export const fetchBulkAttendance = (
  adminCardNo: string, fromDate: string, toDate: string, compc?: string, brnch?: string,
) =>
  apiRequest<{ items: BulkAttendanceRow[]; from_date: string; to_date: string }>(
    `/hrms/attendance/bulk?admin_card_no=${encodeURIComponent(adminCardNo)}&from_date=${fromDate}&to_date=${toDate}${scopeQS(compc, brnch)}`
  );

export const fetchAttendanceDetails = (
  adminCardNo: string, fromDate: string, toDate: string, compc?: string, brnch?: string,
) =>
  apiRequest<{ items: AttendanceDetailRow[]; from_date: string; to_date: string }>(
    `/hrms/attendance/details?admin_card_no=${encodeURIComponent(adminCardNo)}&from_date=${fromDate}&to_date=${toDate}${scopeQS(compc, brnch)}`
  );
