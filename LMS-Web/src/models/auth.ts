export interface LoginRequest {
  username: string;
  password: string;
}

export interface CompanyItem {
  code: string;
  name: string;
}

export interface BranchItem {
  code: string;
  name: string;
}

export interface LoginResponse {
  status: string;
  card_no: string;
  emp_name: string;
  face_registered: boolean;
  hr_admin: boolean;
  has_self_service: boolean;
  has_employee_features: boolean;
  allowed_companies: string[];
  allowed_branches: string[];
  company_list: CompanyItem[];
  branch_list: BranchItem[];
  can_edit_salary?: boolean;
}

export interface User {
  card_no: string;
  emp_name: string;
  face_registered: boolean;
  hr_admin: boolean;
  has_employee_features: boolean;
  allowed_companies: string[];
  allowed_branches: string[];
  company_list: CompanyItem[];
  branch_list: BranchItem[];
  selected_company: CompanyItem | null;
  selected_branch: BranchItem | null;
  can_edit_salary?: boolean;
}
