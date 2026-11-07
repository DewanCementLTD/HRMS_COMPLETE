import { apiRequest } from "./api";

// Setup → Holidays: public holidays for chosen branches of one company.

export interface HolidayBranchOption {
  brnch: string;
  name: string;
  /** Active employees currently in the branch. */
  employees: number;
}

export interface Holiday {
  holiday_id: number;
  holiday_from: string; // YYYY-MM-DD
  holiday_to: string;   // YYYY-MM-DD
  reason: string;
  created_by: string;
  created_at: string;
  /** Roster days currently marked with this holiday. */
  roster_days: number;
  branches: { brnch: string; name: string }[];
}

export interface HolidayInput {
  holiday_from: string;
  holiday_to?: string;
  reason: string;
  branches: string[];
}

export interface HolidaySaveResult {
  status: string;
  message: string;
  holiday_id?: number;
  roster_days: number;
}

function scope(adminCardNo: string, compc?: string) {
  const q = new URLSearchParams({ admin_card_no: adminCardNo });
  if (compc) q.set("compc", compc);
  return q.toString();
}

export const fetchHolidays = (adminCardNo: string, compc?: string) =>
  apiRequest<{ items: Holiday[] }>(`/hrms/holidays?${scope(adminCardNo, compc)}`);

export const fetchHolidayBranches = (adminCardNo: string, compc?: string) =>
  apiRequest<{ items: HolidayBranchOption[] }>(`/hrms/holidays/branches?${scope(adminCardNo, compc)}`);

export const saveHoliday = (adminCardNo: string, compc: string | undefined, input: HolidayInput, id?: number) =>
  apiRequest<HolidaySaveResult>(
    id ? `/hrms/holidays/${id}?${scope(adminCardNo, compc)}` : `/hrms/holidays?${scope(adminCardNo, compc)}`,
    { method: id ? "PUT" : "POST", body: input },
  );

export const deleteHoliday = (adminCardNo: string, compc: string | undefined, id: number) =>
  apiRequest<HolidaySaveResult>(`/hrms/holidays/${id}?${scope(adminCardNo, compc)}`, { method: "DELETE" });
