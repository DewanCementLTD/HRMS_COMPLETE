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
export interface InterviewType { type_id: number; descr: string; compc: number | null; brnch: number | null }

/** A row of LEAVE_TYPES as the setup screen sees it. */
export interface LeaveTypeMaster {
  leave_type_pk: number;
  leave_type: string;
  leave_desc: string;
  entitlement: number | null;
  allowed: number | null;
  type: string;
  compc: number | null;
  brnch: number | null;
  /** One of the standard types every company shares — shown, never edited here. */
  shared: boolean;
  /** This company's own addition, so it can be changed and removed. */
  editable: boolean;
  /** Whether employees can actually apply for it (ALL_LEAVE_BAL_V covers CL/ML/EL, plus OD). */
  applyable: boolean;
}

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
/** Shifts the given company actually runs (SHIFT_HEAD), not the global list. */
export const fetchShiftLov     = (compc?: string, brnch?: string) =>
  apiRequest<{ items: ShiftLov[] }>(`/reference/shift-lov${cbQuery(compc, brnch)}`);
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
// Company-only on purpose: a reporting officer can be in any branch of the
// employee's company, never in another company.
export const fetchReportingOfficers  = (compc: string) =>
  apiRequest<{ items: ReportingOfficer[] }>(`/reference/reporting-officers?compc=${encodeURIComponent(compc)}`);
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

export const addLocation    = (adminCardNo: string, descr: string, sname: string, regioncode: string, city: string, compc?: string) =>
  apiRequest<Location>(`/reference/locations${q(adminCardNo)}${compc ? `&compc=${encodeURIComponent(compc)}` : ""}`, { method: "POST", body: { descr, sname, regioncode, city } });

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

// Interview types (setup master, per company; global seed rows are read-only)
export const fetchInterviewTypes = (compc?: string, brnch?: string) =>
  apiRequest<{ items: InterviewType[] }>(`/reference/interview-types${cbQuery(compc, brnch)}`);
export const addInterviewType = (adminCardNo: string, descr: string, compc?: string) =>
  apiRequest<InterviewType>(`/reference/interview-types${qc(adminCardNo, compc)}`, { method: "POST", body: { descr } });
export const deleteInterviewType = (adminCardNo: string, typeId: number, compc?: string) =>
  apiRequest(`/reference/interview-types/${typeId}${qc(adminCardNo, compc)}`, { method: "DELETE" });

// ── Reference-data edits ──────────────────────────────────────────
// These masters could only be added to or deleted; deleting one that employees
// already reference fails, so a typo was unfixable. The company is re-resolved
// server-side from the admin's rights, as with the deletes.

const put = (path: string, adminCardNo: string, body: Record<string, string>, compc?: string) =>
  apiRequest(`/reference/${path}${qc(adminCardNo, compc)}`, { method: "PUT", body });

export const updateEmpStatus = (adminCardNo: string, empStatus: string, descr: string, compc?: string) =>
  put(`emp-statuses/${encodeURIComponent(empStatus)}`, adminCardNo, { descr }, compc);

export const updateQualification = (adminCardNo: string, oldDescr: string, descr: string, compc?: string) =>
  put(`qualifications/${encodeURIComponent(oldDescr)}`, adminCardNo, { descr }, compc);

export const updateBank = (adminCardNo: string, bnkcode: string, bnkname: string, compc?: string) =>
  put(`banks/${encodeURIComponent(bnkcode)}`, adminCardNo, { bnkname }, compc);

export const updateBankBranch = (
  adminCardNo: string, bnkcode: string, brncode: string, brnname: string, compc?: string,
) =>
  put(`bank-branches/${encodeURIComponent(bnkcode)}/${encodeURIComponent(brncode)}`,
      adminCardNo, { brnname }, compc);

export const updateInterviewType = (adminCardNo: string, typeId: string | number, descr: string, compc?: string) =>
  put(`interview-types/${encodeURIComponent(String(typeId))}`, adminCardNo, { descr }, compc);

export const updateBloodGroup = (adminCardNo: string, pk: string | number, blood_group: string, compc?: string) =>
  put(`blood-groups/${encodeURIComponent(String(pk))}`, adminCardNo, { blood_group }, compc);

export const deleteBloodGroup = (adminCardNo: string, pk: string | number, compc?: string) =>
  apiRequest(`/reference/blood-groups/${encodeURIComponent(String(pk))}${qc(adminCardNo, compc)}`, { method: "DELETE" });

// ── Leave types (setup master, per company and branch) ────────────
// The standard CL / ML / EL / OD rows are shared by every company and come back
// read-only; a company can only maintain what it added itself.

export const fetchLeaveTypes = (compc?: string, brnch?: string) =>
  apiRequest<{ items: LeaveTypeMaster[] }>(`/reference/leave-types${cbQuery(compc, brnch)}`);

export const addLeaveType = (
  adminCardNo: string,
  body: { leave_type: string; leave_desc: string; entitlement?: string; allowed?: string },
  compc?: string,
  brnch?: string,
) =>
  apiRequest<{ leave_type_pk: number }>(
    `/reference/leave-types${qc(adminCardNo, compc)}${brnch ? `&brnch=${encodeURIComponent(brnch)}` : ""}`,
    { method: "POST", body },
  );

export const updateLeaveType = (
  adminCardNo: string,
  pk: number,
  body: { leave_desc: string; entitlement?: string; allowed?: string },
  compc?: string,
) => put(`leave-types/${pk}`, adminCardNo, body, compc);

export const deleteLeaveType = (adminCardNo: string, pk: number, compc?: string) =>
  apiRequest(`/reference/leave-types/${pk}${qc(adminCardNo, compc)}`, { method: "DELETE" });
