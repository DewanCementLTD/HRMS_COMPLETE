import { apiRequest } from "./api";

export interface Department  { dept_no: number; dept_name: string }
export interface Grade       { grade_cd: string; descr: string }
export interface Designation { grade_cd: string; desg_cd: string; desg_desc: string }
export interface Shift {
  shift_head_pk?: number;
  shift: string;
  shift_desc: string;
  time_from?: string;
  time_to?: string;
  overtime_start_time?: string;
  allow_in_time?: string;
  late_start_tm?: string;
  late_end_tm?: string;
  half_day_tm?: string;
  half_day_end_tm?: string;
  sat_start_tm?: string;
  sat_end_time?: string;
  sat_allow_in_tm?: string;
  sat_haf_day_tm?: string;
  late_sit_tm?: string;
  late_sit_allow_tm?: string;
  early_out_late_start?: string;
  early_out_late_end?: string;
  early_out_hday_start?: string;
  early_out_hday_end?: string;
  duty_hrs?: number | string;
  day_name?: string;
  compc?: number;
  brnch?: number;
}
// One shift's editable fields as sent to the API (all strings; duty_hrs coerced server-side).
export type ShiftInput = { shift: string } & Partial<Record<
  "shift_desc" | "time_from" | "time_to" | "overtime_start_time" | "allow_in_time"
  | "late_start_tm" | "late_end_tm" | "half_day_tm" | "half_day_end_tm"
  | "sat_start_tm" | "sat_end_time" | "sat_allow_in_tm" | "sat_haf_day_tm"
  | "late_sit_tm" | "late_sit_allow_tm" | "early_out_late_start" | "early_out_late_end"
  | "early_out_hday_start" | "early_out_hday_end" | "duty_hrs" | "day_name", string>>;
export interface ShiftLov    { shift: string; descr: string }
export interface BloodGroup  { pk: number; blood_group: string }
export interface Cadre       { pk: number; cadre: string }
export interface Unit            { unit_id: number; unit_name: string }
export interface Religion        { code: string; label: string }
export interface ReportingOfficer { empcode: string; name: string }
export interface Location    { lcode: string; descr: string; sname: string; regioncode: string; city: string }
export interface EmpStatus   { emp_status: string; descr: string }
export interface Bank        { bnkcode: string; bnkname: string }
export interface BankBranch  { brncode: string; brnname: string }
export interface Qualification { descr: string }

function cbQuery(compc?: string, brnch?: string, extra = ""): string {
  const parts: string[] = [];
  if (compc) parts.push(`compc=${encodeURIComponent(compc)}`);
  if (brnch) parts.push(`brnch=${encodeURIComponent(brnch)}`);
  if (extra) parts.push(extra);
  return parts.length ? `?${parts.join("&")}` : "";
}

export const fetchDepartments  = (compc?: string, brnch?: string) =>
  apiRequest<{ items: Department[] }>(`/reference/departments${cbQuery(compc, brnch)}`);
export const fetchGrades       = (compc?: string, brnch?: string) =>
  apiRequest<{ items: Grade[] }>(`/reference/grades${cbQuery(compc, brnch)}`);
export const fetchDesignations = (grade_cd?: string, compc?: string, brnch?: string) =>
  apiRequest<{ items: Designation[] }>(
    `/reference/designations${cbQuery(compc, brnch, grade_cd ? `grade_cd=${encodeURIComponent(grade_cd)}` : "")}`
  );
export const fetchShifts       = (compc?: string, brnch?: string) =>
  apiRequest<{ items: Shift[] }>(`/reference/shifts${cbQuery(compc, brnch)}`);
export const fetchShiftLov     = () =>
  apiRequest<{ items: ShiftLov[] }>(`/reference/shift-lov`);
export const fetchBloodGroups  = (compc?: string, brnch?: string) =>
  apiRequest<{ items: BloodGroup[] }>(`/reference/blood-groups${cbQuery(compc, brnch)}`);
export const fetchCadre        = (compc?: string, brnch?: string) =>
  apiRequest<{ items: Cadre[] }>(`/reference/cadre${cbQuery(compc, brnch)}`);
export const fetchEmpStatuses  = (compc?: string) =>
  apiRequest<{ items: EmpStatus[] }>(`/reference/emp-statuses${compc ? `?compc=${encodeURIComponent(compc)}` : ""}`);
export const fetchBanks        = (compc?: string) =>
  apiRequest<{ items: Bank[] }>(`/reference/banks${compc ? `?compc=${encodeURIComponent(compc)}` : ""}`);
export const fetchBankBranches = (bnkcode?: string) =>
  apiRequest<{ items: BankBranch[] }>(`/reference/bank-branches${bnkcode ? `?bnkcode=${encodeURIComponent(bnkcode)}` : ""}`);
export const fetchQualifications = (compc?: string) =>
  apiRequest<{ items: Qualification[] }>(`/reference/qualifications${compc ? `?compc=${encodeURIComponent(compc)}` : ""}`);
export const fetchUnits              = () => apiRequest<{ items: Unit[]             }>("/reference/units");
export const fetchReligions          = () => apiRequest<{ items: Religion[]         }>("/reference/religions");
export const fetchReportingOfficers  = () => apiRequest<{ items: ReportingOfficer[] }>("/reference/reporting-officers");
export const fetchLocations          = (compc?: string, adminCardNo?: string) => {
  const parts: string[] = [];
  if (compc) parts.push(`compc=${encodeURIComponent(compc)}`);
  if (adminCardNo) parts.push(`admin_card_no=${encodeURIComponent(adminCardNo)}`);
  return apiRequest<{ items: Location[] }>(`/reference/locations${parts.length ? `?${parts.join("&")}` : ""}`);
};

const q = (adminCardNo: string) => `?admin_card_no=${encodeURIComponent(adminCardNo)}`;

export const addDepartment  = (adminCardNo: string, dept_name: string) =>
  apiRequest<Department>(`/reference/departments${q(adminCardNo)}`, { method: "POST", body: { dept_name } });

export const addGrade       = (adminCardNo: string, grade_cd: string, descr: string) =>
  apiRequest<Grade>(`/reference/grades${q(adminCardNo)}`, { method: "POST", body: { grade_cd, descr } });

export const addDesignation = (adminCardNo: string, grade_cd: string, desg_desc: string) =>
  apiRequest<Designation>(`/reference/designations${q(adminCardNo)}`, { method: "POST", body: { grade_cd, desg_desc } });

export const addShift       = (adminCardNo: string, fields: ShiftInput, compc?: string, brnch?: string) => {
  const parts = [`admin_card_no=${encodeURIComponent(adminCardNo)}`];
  if (compc) parts.push(`compc=${encodeURIComponent(compc)}`);
  if (brnch) parts.push(`brnch=${encodeURIComponent(brnch)}`);
  return apiRequest<{ status: string }>(`/reference/shifts?${parts.join("&")}`, { method: "POST", body: fields });
};
export const updateShift    = (adminCardNo: string, pk: number, fields: ShiftInput) =>
  apiRequest<{ status: string }>(`/reference/shifts/${pk}${q(adminCardNo)}`, { method: "PUT", body: fields });
export const deleteShift    = (adminCardNo: string, pk: number) =>
  apiRequest<{ status: string }>(`/reference/shifts/${pk}${q(adminCardNo)}`, { method: "DELETE" });

export const addBloodGroup  = (adminCardNo: string, blood_group: string) =>
  apiRequest<BloodGroup>(`/reference/blood-groups${q(adminCardNo)}`, { method: "POST", body: { blood_group } });

export const addCadre       = (adminCardNo: string, cadre: string) =>
  apiRequest<Cadre>(`/reference/cadre${q(adminCardNo)}`, { method: "POST", body: { cadre } });

export const addUnit        = (adminCardNo: string, unit_name: string) =>
  apiRequest<Unit>(`/reference/units${q(adminCardNo)}`, { method: "POST", body: { unit_name } });

export const addLocation    = (adminCardNo: string, lcode: string, descr: string, sname: string, regioncode: string, city: string, compc?: string) =>
  apiRequest<Location>(`/reference/locations${q(adminCardNo)}${compc ? `&compc=${encodeURIComponent(compc)}` : ""}`, { method: "POST", body: { lcode, descr, sname, regioncode, city } });

export const updateLocation = (adminCardNo: string, lcode: string, descr: string, sname: string, regioncode: string, city: string) =>
  apiRequest<Location>(`/reference/locations/${encodeURIComponent(lcode)}${q(adminCardNo)}`, { method: "PUT", body: { lcode, descr, sname, regioncode, city } });

// ── Per-company lookup management (Setup section) ──
const qc = (adminCardNo: string, compc?: string) =>
  `?admin_card_no=${encodeURIComponent(adminCardNo)}${compc ? `&compc=${encodeURIComponent(compc)}` : ""}`;

export const addEmpStatus = (adminCardNo: string, descr: string, compc?: string) =>
  apiRequest<EmpStatus>(`/reference/emp-statuses${qc(adminCardNo, compc)}`, { method: "POST", body: { descr } });
export const deleteEmpStatus = (adminCardNo: string, empStatus: string, compc?: string) =>
  apiRequest(`/reference/emp-statuses/${encodeURIComponent(empStatus)}${qc(adminCardNo, compc)}`, { method: "DELETE" });

export const addBank = (adminCardNo: string, bnkname: string, compc?: string) =>
  apiRequest<Bank>(`/reference/banks${qc(adminCardNo, compc)}`, { method: "POST", body: { bnkname } });
export const deleteBank = (adminCardNo: string, bnkcode: string, compc?: string) =>
  apiRequest(`/reference/banks/${encodeURIComponent(bnkcode)}${qc(adminCardNo, compc)}`, { method: "DELETE" });

export const addBankBranch = (adminCardNo: string, bnkcode: string, brnname: string, compc?: string) =>
  apiRequest<BankBranch>(`/reference/bank-branches${qc(adminCardNo, compc)}`, { method: "POST", body: { bnkcode, brnname } });
export const deleteBankBranch = (adminCardNo: string, bnkcode: string, brncode: string, compc?: string) =>
  apiRequest(`/reference/bank-branches/${encodeURIComponent(bnkcode)}/${encodeURIComponent(brncode)}${qc(adminCardNo, compc)}`, { method: "DELETE" });

export const addQualification = (adminCardNo: string, descr: string, compc?: string) =>
  apiRequest<Qualification>(`/reference/qualifications${qc(adminCardNo, compc)}`, { method: "POST", body: { descr } });
export const deleteQualification = (adminCardNo: string, descr: string, compc?: string) =>
  apiRequest(`/reference/qualifications/${encodeURIComponent(descr)}${qc(adminCardNo, compc)}`, { method: "DELETE" });
