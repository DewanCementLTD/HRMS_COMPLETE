import { apiRequest } from "./api";
import { HRMSEmployee, HRMSEmployeeCreate, HRMSSearchResult, HRDashboardStats, HRAnalytics } from "@/models/hrms";

export async function searchHRMSEmployees(
  query: string,
  adminCardNo: string
): Promise<{ items: HRMSSearchResult[] }> {
  return apiRequest(
    `/hrms/employees/search?q=${encodeURIComponent(query)}&admin_card_no=${adminCardNo}`
  );
}

export async function getHRMSEmployee(
  empcode: string,
  adminCardNo: string
): Promise<HRMSEmployee> {
  return apiRequest<HRMSEmployee>(
    `/hrms/employees/${empcode}?admin_card_no=${adminCardNo}`
  );
}

export interface EmployeeCard {
  empcode: string;
  card_no?: string;
  name?: string;
  fhname?: string;
  designation?: string;
  department?: string;
  company_name?: string;
  compc?: string;
  branch_name?: string;
  nicno?: string;
  mobile?: string;
  email?: string;
  atdtcard?: string;
  dtofappt?: string;
  sex?: string;
  bldgrp?: string;
}

export async function getEmployeeCard(
  empcode: string,
  adminCardNo: string
): Promise<EmployeeCard> {
  return apiRequest<EmployeeCard>(
    `/hrms/employees/${encodeURIComponent(empcode)}/card?admin_card_no=${encodeURIComponent(adminCardNo)}`
  );
}

// ── Monthly duty roster (read-only, from the ERP's DUTY_ROSTER) ──
export interface DutyRosterRow {
  roster_date: string;
  shift?: string;
  day_name?: string;
  time_in?: string | null;
  time_out?: string | null;
  fh_late?: string | null;
  fh_half_day?: string | null;
  sh_late?: string | null;
  sh_half_day?: string | null;
  early_out?: string | null;
  remarks?: string | null;
}
export interface DutyRoster {
  months: string[];
  month: string | null;
  rows: DutyRosterRow[];
}

export async function getEmployeeRoster(
  cardNo: string,
  adminCardNo: string,
  month?: string
): Promise<DutyRoster> {
  const parts = [`admin_card_no=${encodeURIComponent(adminCardNo)}`];
  if (month) parts.push(`month=${encodeURIComponent(month)}`);
  return apiRequest<DutyRoster>(
    `/hrms/duty-roster/${encodeURIComponent(cardNo)}?${parts.join("&")}`
  );
}

export async function createHRMSEmployee(
  data: HRMSEmployeeCreate,
  adminCardNo: string
): Promise<{ status: string; message: string; empcode?: string }> {
  return apiRequest(`/hrms/employees?admin_card_no=${adminCardNo}`, {
    method: "POST",
    body: data,
  });
}

export async function updateHRMSEmployee(
  empcode: string,
  data: Partial<HRMSEmployeeCreate>,
  adminCardNo: string
): Promise<{ status: string; message: string }> {
  return apiRequest(`/hrms/employees/${empcode}?admin_card_no=${adminCardNo}`, {
    method: "PUT",
    body: data,
  });
}

export async function listHRMSEmployees(
  adminCardNo: string,
  status?: string,
  compc?: string,
  brnch?: string,
): Promise<{ items: HRMSSearchResult[] }> {
  const params = new URLSearchParams({ admin_card_no: adminCardNo });
  if (status) params.set("status", status);
  if (compc)  params.set("compc", compc);
  if (brnch)  params.set("brnch", brnch);
  return apiRequest(`/hrms/employees?${params.toString()}`);
}

export async function fetchHRDashboard(
  adminCardNo: string,
  date?: string,
  compc?: string,
  brnch?: string,
): Promise<HRDashboardStats> {
  const params = new URLSearchParams({ admin_card_no: adminCardNo });
  if (date)  params.set("date", date);
  if (compc) params.set("compc", compc);
  if (brnch) params.set("brnch", brnch);
  return apiRequest<HRDashboardStats>(`/hrms/dashboard?${params.toString()}`);
}

export async function updateLocationTracking(
  empcode: string,
  trackLocation: "Y" | "N",
  trackLocationHr: number,
  adminCardNo: string
): Promise<{ success: boolean; message: string }> {
  const params = new URLSearchParams({
    track_location: trackLocation,
    track_location_hr: String(trackLocationHr),
    admin_card_no: adminCardNo,
  });
  return apiRequest(`/location-tracking/settings/${encodeURIComponent(empcode)}/update?${params.toString()}`, {
    method: "POST",
  });
}

export async function fetchHRAnalytics(
  adminCardNo: string,
  date?: string,
  compc?: string,
  brnch?: string,
): Promise<HRAnalytics> {
  const params = new URLSearchParams({ admin_card_no: adminCardNo });
  if (date)  params.set("date", date);
  if (compc) params.set("compc", compc);
  if (brnch) params.set("brnch", brnch);
  return apiRequest<HRAnalytics>(`/hrms/dashboard/analytics?${params.toString()}`);
}
