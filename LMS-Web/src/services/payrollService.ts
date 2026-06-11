import { apiRequest } from "./api";

// ── Types ──
export interface FinancialYear {
  rule_id: number; from_date: string; to_date: string; status: string;
  scode: string; descr: string; rate?: number; intrst?: number;
  filer?: number; nonfiler?: number; unit_id?: number;
}
export interface PayrollPeriod {
  period: number; rule_id?: number; period_frm: string; period_to: string;
  status: string; block_flag: string; p_days?: number; scode: string; unit_id?: number;
}
export interface TaxMaster {
  tax_id: number; tax_desc: string; fyear: string; status: string; slabs: number;
}
export interface TaxDetail {
  tax_id: number; srno: number; slab_from?: number; slab_to?: number; slab_rate?: number;
  date_from?: string; date_to?: string; slab_ded?: number; fixed_tax?: number;
}
export interface LoanType { loan_cd: string; loan_desc: string }
export interface Loan {
  doc: number; old_empcode: string; name: string; loan_cd: string; loan_desc: string;
  dept_name: string; loan_date?: string; loan_amt: number; instalment_amt?: number;
  nof_instalment?: number; loan_recover: number; balance: number; start_dt?: string;
  charge_int: string; int_rate?: number; chq_no: string; chq_dt?: string;
  remarks: string; unit_id?: number;
}

const a = (adminCardNo: string) => `admin_card_no=${encodeURIComponent(adminCardNo)}`;
const ac = (adminCardNo: string, compc?: string) =>
  `${a(adminCardNo)}${compc ? `&compc=${encodeURIComponent(compc)}` : ""}`;

// ── Period Opening ──
export const fetchFinancialYears = (adminCardNo: string, compc?: string) =>
  apiRequest<{ items: FinancialYear[] }>(`/payroll/financial-years?${ac(adminCardNo, compc)}`);
export const createFinancialYear = (adminCardNo: string, compc: string | undefined, body: Record<string, unknown>) =>
  apiRequest(`/payroll/financial-years?${ac(adminCardNo, compc)}`, { method: "POST", body });
export const updateFinancialYear = (adminCardNo: string, ruleId: number, body: Record<string, unknown>) =>
  apiRequest(`/payroll/financial-years/${ruleId}?${a(adminCardNo)}`, { method: "PUT", body });
export const setFinancialYearStatus = (adminCardNo: string, ruleId: number, status: string) =>
  apiRequest(`/payroll/financial-years/${ruleId}/status?${a(adminCardNo)}`, { method: "PATCH", body: { status } });

export const fetchPeriods = (adminCardNo: string, compc?: string, ruleId?: number) =>
  apiRequest<{ items: PayrollPeriod[] }>(`/payroll/periods?${ac(adminCardNo, compc)}${ruleId != null ? `&rule_id=${ruleId}` : ""}`);
export const createPeriod = (adminCardNo: string, compc: string | undefined, body: Record<string, unknown>) =>
  apiRequest(`/payroll/periods?${ac(adminCardNo, compc)}`, { method: "POST", body });
export const setPeriodStatus = (adminCardNo: string, period: number, body: { status?: string; block?: string }) =>
  apiRequest(`/payroll/periods/${period}/status?${a(adminCardNo)}`, { method: "PATCH", body });

// ── Tax Slabs (global) ──
export const fetchTaxMasters = (adminCardNo: string) =>
  apiRequest<{ items: TaxMaster[] }>(`/payroll/tax-masters?${a(adminCardNo)}`);
export const createTaxMaster = (adminCardNo: string, body: { tax_desc: string; fyear?: string }) =>
  apiRequest(`/payroll/tax-masters?${a(adminCardNo)}`, { method: "POST", body });
export const setTaxMasterStatus = (adminCardNo: string, taxId: number, status: string) =>
  apiRequest(`/payroll/tax-masters/${taxId}/status?${a(adminCardNo)}`, { method: "PATCH", body: { status } });
export const deleteTaxMaster = (adminCardNo: string, taxId: number) =>
  apiRequest(`/payroll/tax-masters/${taxId}?${a(adminCardNo)}`, { method: "DELETE" });
export const fetchTaxDetails = (adminCardNo: string, taxId: number) =>
  apiRequest<{ items: TaxDetail[] }>(`/payroll/tax-masters/${taxId}/details?${a(adminCardNo)}`);
export const addTaxDetail = (adminCardNo: string, taxId: number, body: Record<string, unknown>) =>
  apiRequest(`/payroll/tax-masters/${taxId}/details?${a(adminCardNo)}`, { method: "POST", body });
export const deleteTaxDetail = (adminCardNo: string, taxId: number, srno: number) =>
  apiRequest(`/payroll/tax-masters/${taxId}/details/${srno}?${a(adminCardNo)}`, { method: "DELETE" });

// ── Loans ──
export const fetchLoanTypes = (adminCardNo: string) =>
  apiRequest<{ items: LoanType[] }>(`/payroll/loan-types?${a(adminCardNo)}`);
export const addLoanType = (adminCardNo: string, loan_desc: string) =>
  apiRequest(`/payroll/loan-types?${a(adminCardNo)}`, { method: "POST", body: { loan_desc } });
export const deleteLoanType = (adminCardNo: string, loanCd: string) =>
  apiRequest(`/payroll/loan-types/${encodeURIComponent(loanCd)}?${a(adminCardNo)}`, { method: "DELETE" });

export const fetchLoans = (adminCardNo: string, compc?: string, empcode?: string) =>
  apiRequest<{ items: Loan[] }>(`/payroll/loans?${ac(adminCardNo, compc)}${empcode ? `&empcode=${encodeURIComponent(empcode)}` : ""}`);
export const createLoan = (adminCardNo: string, compc: string | undefined, body: Record<string, unknown>) =>
  apiRequest(`/payroll/loans?${ac(adminCardNo, compc)}`, { method: "POST", body });
export const updateLoan = (adminCardNo: string, doc: number, body: Record<string, unknown>) =>
  apiRequest(`/payroll/loans/${doc}?${a(adminCardNo)}`, { method: "PUT", body });
export const deleteLoan = (adminCardNo: string, doc: number, compc?: string) =>
  apiRequest(`/payroll/loans/${doc}?${ac(adminCardNo, compc)}`, { method: "DELETE" });
