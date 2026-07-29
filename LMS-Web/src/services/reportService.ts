import { apiRequest } from "./api";

export interface ReportFilterParams {
  compc?: string;
  brnch?: string;
  desg_cd?: string;
  dept_no?: string;
  period?: number;
  from_date?: string;
  to_date?: string;
  allowance_id?: string;
  deduction_id?: string;
  empcode?: string;
}

const buildQuery = (adminCardNo: string, params: ReportFilterParams = {}) => {
  const q = new URLSearchParams({ admin_card_no: adminCardNo });
  if (params.compc) q.set("compc", params.compc);
  if (params.brnch) q.set("brnch", params.brnch);
  if (params.desg_cd) q.set("desg_cd", params.desg_cd);
  if (params.dept_no) q.set("dept_no", params.dept_no);
  if (params.period) q.set("period", String(params.period));
  if (params.from_date) q.set("from_date", params.from_date);
  if (params.to_date) q.set("to_date", params.to_date);
  if (params.allowance_id) q.set("allowance_id", params.allowance_id);
  if (params.deduction_id) q.set("deduction_id", params.deduction_id);
  if (params.empcode) q.set("empcode", params.empcode);
  return q.toString();
};

export const fetchAbsentSuppReport = (adminCardNo: string, params?: ReportFilterParams) =>
  apiRequest<{ data: any[] }>(`/reports/absent-supp?${buildQuery(adminCardNo, params)}`);

export const fetchAllowanceDetailReport = (adminCardNo: string, params?: ReportFilterParams) =>
  apiRequest<{ data: any[] }>(`/reports/allowance-detail?${buildQuery(adminCardNo, params)}`);

export const fetchAllowanceReconReport = (adminCardNo: string, params?: ReportFilterParams) =>
  apiRequest<{ data: any[] }>(`/reports/allowance-recon?${buildQuery(adminCardNo, params)}`);

export const fetchDeductionDetailReport = (adminCardNo: string, params?: ReportFilterParams) =>
  apiRequest<{ data: any[] }>(`/reports/deduction-detail?${buildQuery(adminCardNo, params)}`);

export const fetchDeductionReconReport = (adminCardNo: string, params?: ReportFilterParams) =>
  apiRequest<{ data: any[] }>(`/reports/deduction-recon?${buildQuery(adminCardNo, params)}`);

export const fetchMonthWiseDeductionReport = (adminCardNo: string, params?: ReportFilterParams) =>
  apiRequest<{ data: any[] }>(`/reports/month-wise-deduction?${buildQuery(adminCardNo, params)}`);

export const fetchBankAdviceReport = (adminCardNo: string, params?: ReportFilterParams) =>
  apiRequest<{ data: any[] }>(`/reports/bank-advice?${buildQuery(adminCardNo, params)}`);

export const fetchActiveEmployeesReport = (adminCardNo: string, params?: ReportFilterParams) =>
  apiRequest<{ data: any[] }>(`/reports/active-employees?${buildQuery(adminCardNo, params)}`);

export const fetchPfDetailReport = (adminCardNo: string, params?: ReportFilterParams) =>
  apiRequest<{ data: any }>(`/reports/pf-detail?${buildQuery(adminCardNo, params)}`);
