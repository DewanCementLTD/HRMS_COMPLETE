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
