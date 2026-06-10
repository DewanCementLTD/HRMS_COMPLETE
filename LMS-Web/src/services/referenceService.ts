import { apiRequest } from "./api";

export interface Department  { dept_no: number; dept_name: string }
export interface Grade       { grade_cd: string; descr: string }
export interface Designation { grade_cd: string; desg_cd: string; desg_desc: string }
export interface Shift       { shift: string; shift_desc: string; time_from?: string; time_to?: string }
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
export const fetchBloodGroups  = (compc?: string, brnch?: string) =>
  apiRequest<{ items: BloodGroup[] }>(`/reference/blood-groups${cbQuery(compc, brnch)}`);
export const fetchCadre        = (compc?: string, brnch?: string) =>
  apiRequest<{ items: Cadre[] }>(`/reference/cadre${cbQuery(compc, brnch)}`);
export const fetchEmpStatuses  = () =>
  apiRequest<{ items: EmpStatus[] }>("/reference/emp-statuses");
export const fetchBanks        = (compc?: string) =>
  apiRequest<{ items: Bank[] }>(`/reference/banks${compc ? `?compc=${encodeURIComponent(compc)}` : ""}`);
export const fetchBankBranches = (bnkcode?: string) =>
  apiRequest<{ items: BankBranch[] }>(`/reference/bank-branches${bnkcode ? `?bnkcode=${encodeURIComponent(bnkcode)}` : ""}`);
export const fetchQualifications = () =>
  apiRequest<{ items: Qualification[] }>("/reference/qualifications");
export const fetchUnits              = () => apiRequest<{ items: Unit[]             }>("/reference/units");
export const fetchReligions          = () => apiRequest<{ items: Religion[]         }>("/reference/religions");
export const fetchReportingOfficers  = () => apiRequest<{ items: ReportingOfficer[] }>("/reference/reporting-officers");
export const fetchLocations          = () => apiRequest<{ items: Location[]         }>("/reference/locations");

const q = (adminCardNo: string) => `?admin_card_no=${encodeURIComponent(adminCardNo)}`;

export const addDepartment  = (adminCardNo: string, dept_name: string) =>
  apiRequest<Department>(`/reference/departments${q(adminCardNo)}`, { method: "POST", body: { dept_name } });

export const addGrade       = (adminCardNo: string, grade_cd: string, descr: string) =>
  apiRequest<Grade>(`/reference/grades${q(adminCardNo)}`, { method: "POST", body: { grade_cd, descr } });

export const addDesignation = (adminCardNo: string, grade_cd: string, desg_desc: string) =>
  apiRequest<Designation>(`/reference/designations${q(adminCardNo)}`, { method: "POST", body: { grade_cd, desg_desc } });

export const addShift       = (adminCardNo: string, shift: string, shift_desc: string, time_from?: string, time_to?: string) =>
  apiRequest<Shift>(`/reference/shifts${q(adminCardNo)}`, { method: "POST", body: { shift, shift_desc, time_from, time_to } });

export const addBloodGroup  = (adminCardNo: string, blood_group: string) =>
  apiRequest<BloodGroup>(`/reference/blood-groups${q(adminCardNo)}`, { method: "POST", body: { blood_group } });

export const addCadre       = (adminCardNo: string, cadre: string) =>
  apiRequest<Cadre>(`/reference/cadre${q(adminCardNo)}`, { method: "POST", body: { cadre } });

export const addUnit        = (adminCardNo: string, unit_name: string) =>
  apiRequest<Unit>(`/reference/units${q(adminCardNo)}`, { method: "POST", body: { unit_name } });

export const addLocation    = (adminCardNo: string, lcode: string, descr: string, sname: string, regioncode: string, city: string) =>
  apiRequest<Location>(`/reference/locations${q(adminCardNo)}`, { method: "POST", body: { lcode, descr, sname, regioncode, city } });

export const updateLocation = (adminCardNo: string, lcode: string, descr: string, sname: string, regioncode: string, city: string) =>
  apiRequest<Location>(`/reference/locations/${encodeURIComponent(lcode)}${q(adminCardNo)}`, { method: "PUT", body: { lcode, descr, sname, regioncode, city } });
