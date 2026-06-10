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
