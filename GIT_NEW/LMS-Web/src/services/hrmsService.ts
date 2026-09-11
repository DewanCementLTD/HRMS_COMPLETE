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

/** ID-card footer + QR details for the employee's company, from
 *  HR_COMPANY_BRANDING (see LMS-Backend/sql/2026-08-24_company_branding.sql).
 *  Absent on older backends — the card then falls back to its own default. */
export interface CardBranding {
  brand_name?: string;
  tagline?: string;
  website?: string;
  qr_url?: string;
  phone?: string;
  email?: string;
  show_on_card?: string;
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
  branding?: CardBranding;
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
  pk?: number;
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
  /** Derived server-side from TMS_DUTY_ROSTER_V — leave type + reason, "Absent",
   *  or the roster's own remark. */
  remarks?: string | null;
  roster_remarks?: string | null;
  leave_remarks?: string | null;
  leave_type?: string | null;
  leave_desc?: string | null;
  leave_type_fk?: number | null;
  leave_days?: number | null;
  absent?: number | null;
  is_absent?: boolean;
  is_leave?: boolean;
  updated_by?: string | null;
}
export interface DutyRoster {
  months: string[];
  month: string | null;
  rows: DutyRosterRow[];
  /** The company and branch the roster is filed under — SHIFT_HEAD is keyed on both. */
  compc?: string | null;
  brnch?: string | null;
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

export async function updateRosterEntry(
  pk: number,
  adminCardNo: string,
  fields: { shift?: string; remarks?: string }
): Promise<{ status: string; updated_by?: string }> {
  return apiRequest<{ status: string; updated_by?: string }>(
    `/hrms/duty-roster/entry/${pk}?admin_card_no=${encodeURIComponent(adminCardNo)}`,
    { method: "PUT", body: fields }
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

/**
 * Restore an employee's login password to the initial one HR set on their HRMS
 * record. Pass `password` to issue a new one (that value becomes the new
 * initial). Employees' own password changes never touch the initial, so this
 * works regardless of what they changed it to.
 */
export async function resetEmployeePassword(
  empcode: string,
  adminCardNo: string,
  password?: string,
): Promise<{ status: string; message: string }> {
  return apiRequest(
    `/hrms/employees/${empcode}/reset-password?admin_card_no=${encodeURIComponent(adminCardNo)}`,
    { method: "POST", body: password ? { password } : {} },
  );
}

/**
 * Apply one shift to every roster day in a date range for one employee.
 *
 * Days already carrying approved leave are skipped server-side, and the branch
 * is re-resolved from the admin's rights, so this can't reach past the roster
 * being viewed.
 */
export async function bulkUpdateRosterShift(
  adminCardNo: string,
  body: { card_no: string; from_date: string; to_date: string; shift: string; dates?: string[] },
  scope?: { compc?: string; brnch?: string },
): Promise<{ status: string; updated: number; shift: string }> {
  const q = new URLSearchParams({ admin_card_no: adminCardNo });
  if (scope?.compc) q.set("compc", scope.compc);
  if (scope?.brnch) q.set("brnch", scope.brnch);
  return apiRequest(`/hrms/duty-roster/bulk?${q.toString()}`, { method: "PUT", body });
}

/** One rostered day in the range the bulk-shift dialog is asking about. */
export interface RosterDay {
  date: string;
  day: string;
  shift: string;
  on_leave: boolean;
  is_holiday: boolean;
  is_rest: boolean;
  /** False for days on approved leave, which the update leaves alone. */
  selectable: boolean;
}

/**
 * The rostered days between two dates, so HR can pick which of them the new
 * shift applies to rather than taking the whole range.
 */
export async function fetchRosterDays(
  adminCardNo: string,
  cardNo: string,
  fromDate: string,
  toDate: string,
  scope?: { compc?: string; brnch?: string },
): Promise<{ items: RosterDay[] }> {
  const q = new URLSearchParams({
    admin_card_no: adminCardNo,
    card_no: cardNo,
    from_date: fromDate,
    to_date: toDate,
  });
  if (scope?.compc) q.set("compc", scope.compc);
  if (scope?.brnch) q.set("brnch", scope.brnch);
  return apiRequest(`/hrms/duty-roster/days?${q.toString()}`);
}
