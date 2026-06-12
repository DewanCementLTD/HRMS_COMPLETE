import { apiRequest } from "./api";

// ── Types ──
export interface OpenPeriod {
  period: number; rule_id?: number; period_frm: string; period_to: string;
  label: string; p_days?: number;
}
export interface RecoveryType { value: string; label: string }
export interface AllowanceType { allowance_id: string; allowance_desc: string; allowance_type?: number }
export interface DeductionType { deduction_id: string; deduction_desc: string }

export interface RecoverableLoan {
  doc: number; old_empcode: string; loan_desc: string; loan_amt: number; balance: number;
  name: string; empcode: string; designation: string; department: string;
}
export interface LoanRecovery {
  rowid: string; doc: number; period: number; recovered_amt: number; recovery_type: string;
  recovery_type_label: string; balance_amt: number; remarks: string; old_empcode: string;
  name: string; empcode: string; designation: string; department: string; loan_amt: number; loan_desc: string;
}
export interface MonthlyAllowance {
  old_empcode: string; allowance_id: string; amount: number; ot_hour?: number | null; remarks: string;
  allowance_desc: string; name: string; empcode: string; designation: string; department: string;
}
export interface MonthlyDeduction {
  old_empcode: string; deduction_id: string; amount: number; remarks: string;
  deduction_desc: string; name: string; empcode: string; designation: string; department: string;
}
export interface AbsentDay {
  old_empcode: string; absent_days: number; name: string; empcode: string;
  designation: string; department: string;
}

const a = (adminCardNo: string) => `admin_card_no=${encodeURIComponent(adminCardNo)}`;
const ac = (adminCardNo: string, compc?: string) =>
  `${a(adminCardNo)}${compc ? `&compc=${encodeURIComponent(compc)}` : ""}`;
const acb = (adminCardNo: string, compc?: string, brnch?: string) =>
  `${ac(adminCardNo, compc)}${brnch ? `&brnch=${encodeURIComponent(brnch)}` : ""}`;

// ── Open period / LOVs ──
export const fetchOpenPeriods = (adminCardNo: string, compc?: string) =>
  apiRequest<{ items: OpenPeriod[] }>(`/payroll-entry/open-periods?${ac(adminCardNo, compc)}`);
export const fetchRecoveryTypes = (adminCardNo: string) =>
  apiRequest<{ items: RecoveryType[] }>(`/payroll-entry/recovery-types?${a(adminCardNo)}`);
export const fetchAllowanceTypes = (adminCardNo: string) =>
  apiRequest<{ items: AllowanceType[] }>(`/payroll-entry/allowance-types?${a(adminCardNo)}`);
export const fetchDeductionTypes = (adminCardNo: string, compc?: string) =>
  apiRequest<{ items: DeductionType[] }>(`/payroll-entry/deduction-types?${ac(adminCardNo, compc)}`);

// ── Loan recovery ──
export const fetchRecoverableLoans = (adminCardNo: string, compc?: string, brnch?: string) =>
  apiRequest<{ items: RecoverableLoan[] }>(`/payroll-entry/loans?${acb(adminCardNo, compc, brnch)}`);
export const fetchLoanRecoveries = (adminCardNo: string, compc?: string, brnch?: string, doc?: number) =>
  apiRequest<{ items: LoanRecovery[] }>(`/payroll-entry/loan-recoveries?${acb(adminCardNo, compc, brnch)}${doc != null ? `&doc=${doc}` : ""}`);
export const createLoanRecovery = (adminCardNo: string, compc: string | undefined, body: Record<string, unknown>) =>
  apiRequest(`/payroll-entry/loan-recoveries?${ac(adminCardNo, compc)}`, { method: "POST", body });
export const deleteLoanRecovery = (adminCardNo: string, rowid: string, compc?: string) =>
  apiRequest(`/payroll-entry/loan-recoveries?${ac(adminCardNo, compc)}&rowid=${encodeURIComponent(rowid)}`, { method: "DELETE" });

// ── Monthly allowances ──
export const fetchMonthlyAllowances = (adminCardNo: string, compc?: string, brnch?: string, empcode?: string) =>
  apiRequest<{ items: MonthlyAllowance[] }>(`/payroll-entry/allowances?${acb(adminCardNo, compc, brnch)}${empcode ? `&empcode=${encodeURIComponent(empcode)}` : ""}`);
export const saveMonthlyAllowance = (adminCardNo: string, compc: string | undefined, body: Record<string, unknown>) =>
  apiRequest(`/payroll-entry/allowances?${ac(adminCardNo, compc)}`, { method: "POST", body });
export const deleteMonthlyAllowance = (adminCardNo: string, empcode: string, allowanceId: string, compc?: string) =>
  apiRequest(`/payroll-entry/allowances?${ac(adminCardNo, compc)}&empcode=${encodeURIComponent(empcode)}&allowance_id=${encodeURIComponent(allowanceId)}`, { method: "DELETE" });

// ── Monthly deductions ──
export const fetchMonthlyDeductions = (adminCardNo: string, compc?: string, brnch?: string, empcode?: string) =>
  apiRequest<{ items: MonthlyDeduction[] }>(`/payroll-entry/deductions?${acb(adminCardNo, compc, brnch)}${empcode ? `&empcode=${encodeURIComponent(empcode)}` : ""}`);
export const saveMonthlyDeduction = (adminCardNo: string, compc: string | undefined, body: Record<string, unknown>) =>
  apiRequest(`/payroll-entry/deductions?${ac(adminCardNo, compc)}`, { method: "POST", body });
export const deleteMonthlyDeduction = (adminCardNo: string, empcode: string, deductionId: string, compc?: string) =>
  apiRequest(`/payroll-entry/deductions?${ac(adminCardNo, compc)}&empcode=${encodeURIComponent(empcode)}&deduction_id=${encodeURIComponent(deductionId)}`, { method: "DELETE" });

// ── Absent days ──
export const fetchAbsentDays = (adminCardNo: string, compc?: string, brnch?: string, empcode?: string) =>
  apiRequest<{ items: AbsentDay[] }>(`/payroll-entry/absent-days?${acb(adminCardNo, compc, brnch)}${empcode ? `&empcode=${encodeURIComponent(empcode)}` : ""}`);
export const fetchEmployeeAbsent = (adminCardNo: string, empcode: string, compc?: string) =>
  apiRequest<{ absent_days: number; period: number | null }>(`/payroll-entry/absent-days/employee?${ac(adminCardNo, compc)}&empcode=${encodeURIComponent(empcode)}`);
export const saveAbsentDays = (adminCardNo: string, compc: string | undefined, body: Record<string, unknown>) =>
  apiRequest(`/payroll-entry/absent-days?${ac(adminCardNo, compc)}`, { method: "POST", body });
export const deleteAbsentDays = (adminCardNo: string, empcode: string, compc?: string) =>
  apiRequest(`/payroll-entry/absent-days?${ac(adminCardNo, compc)}&empcode=${encodeURIComponent(empcode)}`, { method: "DELETE" });
