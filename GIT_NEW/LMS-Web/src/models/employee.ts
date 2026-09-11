export interface DashboardData {
  emp_pk?: number;
  card_no: string;
  emp_no?: string;
  emp_name: string;
  date_of_join?: string;
  nic_no?: string;
  /** Raw HR_EMP_MASTER codes (kept for the mobile client's contract). */
  designation?: string;
  department?: string;
  /** Resolved names — what the dashboard shows. */
  designation_name?: string | null;
  department_name?: string | null;
  compcnm?: string;
  compc?: number;
  branch?: number;
  brnchnm?: string;
  hod?: number;
  hod_nm?: string;
  balance?: number;
}

export interface EmployeeProfile {
  emp_name: string;
  department?: string;
  designation?: string;
  email_address?: string;
  mobile_no?: string;
  date_of_birth?: string;
  date_of_join?: string;
  father_name?: string;
  nic_no?: string;
  emp_pk?: number;
  card_no?: string;
  emp_no?: string;
  emp_code?: string;
  emp_status?: string;
  salary?: number;
  type?: string;
  compc?: number;
  brnch?: number;
}

export interface EmployeeSearchResult {
  card_no: string;
  emp_name: string;
  department?: string;
  designation?: string;
  face_registered: boolean;
  mobile_no?: string;
  empcode?: string;
}
