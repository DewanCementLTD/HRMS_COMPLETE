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

/** Company + the admin's active branch. With a branch, the server limits
 *  everything (branch list, holidays, saves, removals) to that one branch. */
export interface HolidayScope { compc?: string; brnch?: string }

function scope(adminCardNo: string, s: HolidayScope) {
  const q = new URLSearchParams({ admin_card_no: adminCardNo });
  if (s.compc) q.set("compc", s.compc);
  if (s.brnch) q.set("brnch", s.brnch);
  return q.toString();
}

export const fetchHolidays = (adminCardNo: string, s: HolidayScope) =>
  apiRequest<{ items: Holiday[] }>(`/hrms/holidays?${scope(adminCardNo, s)}`);

export const fetchHolidayBranches = (adminCardNo: string, s: HolidayScope) =>
  apiRequest<{ items: HolidayBranchOption[] }>(`/hrms/holidays/branches?${scope(adminCardNo, s)}`);

export const saveHoliday = (adminCardNo: string, s: HolidayScope, input: HolidayInput, id?: number) =>
  apiRequest<HolidaySaveResult>(
    id ? `/hrms/holidays/${id}?${scope(adminCardNo, s)}` : `/hrms/holidays?${scope(adminCardNo, s)}`,
    { method: id ? "PUT" : "POST", body: input },
  );

export const deleteHoliday = (adminCardNo: string, s: HolidayScope, id: number) =>
  apiRequest<HolidaySaveResult>(`/hrms/holidays/${id}?${scope(adminCardNo, s)}`, { method: "DELETE" });
