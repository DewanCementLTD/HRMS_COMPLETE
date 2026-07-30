import { apiRequest } from "./api";

/**
 * HR & Payroll report endpoints.
 *
 * `compc` / `brnch` are sent from the sidebar selection but the backend
 * re-resolves them against the HR admin's rights, so they are a request for
 * scope rather than a grant of it.
 */

// ── Shared shapes ─────────────────────────────────────────────────

export interface ReportMetaData {
  unit_id: number;
  unit_name: string;
  location: string | null;
  location_name: string;
  /** Resolved "Mon-YYYY" labels for the report's period bind(s). */
  period_labels: string[];
  filters: Record<string, string | number | null>;
  generated_at: string;
}

/** Cross-tab reports: one row per employee, one column per allowance/deduction. */
export interface PivotRow {
  code: string;
  employee_name: string;
  location?: string;
  /** Overtime hours (allowance report only; null elsewhere). */
  ot_hours?: number | null;
  values: Record<string, number>;
  total: number;
}
export interface PivotReport {
  columns: string[];
  rows: PivotRow[];
  column_totals: Record<string, number>;
  /** True only for the allowance report, which carries an OT Hours column. */
  has_ot_hours?: boolean;
  grand_total: number;
  meta: ReportMetaData;
}

/** Reconciliation reports: one block per allowance/deduction. */
export interface ReconRow {
  code: string;
  employee_name: string;
  from_amount: number;
  to_amount: number;
  variance: number;
}
export interface ReconGroup {
  trans_id: string;
  descr: string;
  rows: ReconRow[];
  totals: { from_amount: number; to_amount: number; variance: number };
}
export interface ReconReport {
  groups: ReconGroup[];
  meta: ReportMetaData;
}

export interface BankAdviceRow {
  code: string;
  employee_name: string;
  account_number: string;
  gross: number;
  total_allowance: number;
  total_deduction: number;
  salary_payable: number;
}
export interface BankAdviceGroup {
  bank_code: string;
  bank_name: string;
  branch_code: string;
  branch_name: string;
  location_name: string;
  rows: BankAdviceRow[];
  total: number;
}
export interface BankAdviceReport {
  groups: BankAdviceGroup[];
  grand_total: number;
  meta: ReportMetaData;
}

export interface AbsentSuppRow {
  sr_no: number;
  unit_id: number;
  period: number;
  location_name: string;
  department: string;
  designation: string;
  code: string;
  employee_name: string;
  absent: number;
  s_days: number;
}
export interface AbsentSuppReport {
  rows: AbsentSuppRow[];
  meta: ReportMetaData;
}

export interface ActiveEmployeeRow {
  sr_no: number;
  unit: string;
  location: string;
  emp_type: string;
  code: string;
  employee_name: string;
  father_name: string;
  address: string;
  sex: string;
  date_of_birth: string;
  date_of_joining: string;
  date_of_confirm: string;
  designation: string;
  grade: string;
  department: string;
  section: string;
  phone: string;
  bank_account: string;
  nic: string;
  ntn: string;
  qualification: string;
  gross: number;
  basic: number;
  rebate: number;
  status: string;
}
export interface ActiveEmployeesReport {
  rows: ActiveEmployeeRow[];
  meta: ReportMetaData;
}

export interface PfLedgerRow {
  sr_no: number;
  period: number;
  month_year: string;
  actual_basic: number;
  earned_basic: number;
  actual_gross: number;
  earned_gross: number;
  pf_contribution: number;
  balance: number;
}
export interface PfDetailReport {
  employee_header: { code: string; name: string; unit: string; department: string; designation: string };
  ledger: PfLedgerRow[];
  totals: {
    actual_basic: number; earned_basic: number;
    actual_gross: number; earned_gross: number; pf_contribution: number;
  };
  account_summary: {
    employee_contribution: number;
    employer_contribution: number;
    loan_against_pf: number;
    permanent_withdrawal_pf: number;
    total_pf: number;
  };
  pw_withdrawals: { date: string; amount: number }[];
  meta: ReportMetaData;
}

export interface ReportPeriod {
  period: number;
  scode: string;
  status: string;
  period_frm: string;
  label: string;
}
export interface ReportLookups {
  unit_id: number;
  periods: ReportPeriod[];
  desg_groups: { desg_grp: string }[];
  deductions: { deduction_id: string; deduction_desc: string }[];
}

// ── Query building ────────────────────────────────────────────────

/** Union of every filter any report accepts; each call sends only its own. */
export interface ReportFilterParams {
  compc?: string;
  brnch?: string;
  period?: number | null;
  period_from?: number | null;
  period_to?: number | null;
  /** 'C' = current salary process, 'P' = posted/final. Also 'IN'/'OT' for bank advice, 'A'/'U'/'C' for the employee roster. */
  rtype?: string;
  empcode?: string;
  dept_no?: string;
  desg_cd?: string;
  desg_grp?: string;
  grade_cd?: string;
  emp_status?: string;
  gross_from?: number | null;
  gross_to?: number | null;
  deduction_id?: string;
  trans_id?: string;
}

const buildQuery = (adminCardNo: string, params: ReportFilterParams = {}) => {
  const q = new URLSearchParams({ admin_card_no: adminCardNo });
  for (const [k, v] of Object.entries(params)) {
    // Skip empties so the backend sees "no filter" rather than a blank bind.
    if (v === undefined || v === null || v === "") continue;
    q.set(k, String(v));
  }
  return q.toString();
};

const get = <T,>(path: string, adminCardNo: string, params?: ReportFilterParams) =>
  apiRequest<{ status: string; data: T }>(`/reports/${path}?${buildQuery(adminCardNo, params)}`);

// ── Endpoints ─────────────────────────────────────────────────────

export const fetchReportLookups = (adminCardNo: string, params?: ReportFilterParams) =>
  get<ReportLookups>("lookups", adminCardNo, params);

export const fetchAllowanceDetailReport = (adminCardNo: string, params?: ReportFilterParams) =>
  get<PivotReport>("allowance-detail", adminCardNo, params);

export const fetchDeductionDetailReport = (adminCardNo: string, params?: ReportFilterParams) =>
  get<PivotReport>("deduction-detail", adminCardNo, params);

export const fetchMonthWiseDeductionReport = (adminCardNo: string, params?: ReportFilterParams) =>
  get<PivotReport>("month-wise-deduction", adminCardNo, params);

export const fetchAllowanceReconReport = (adminCardNo: string, params?: ReportFilterParams) =>
  get<ReconReport>("allowance-recon", adminCardNo, params);

export const fetchDeductionReconReport = (adminCardNo: string, params?: ReportFilterParams) =>
  get<ReconReport>("deduction-recon", adminCardNo, params);

export const fetchBankAdviceReport = (adminCardNo: string, params?: ReportFilterParams) =>
  get<BankAdviceReport>("bank-advice", adminCardNo, params);

export const fetchAbsentSuppReport = (adminCardNo: string, params?: ReportFilterParams) =>
  get<AbsentSuppReport>("absent-supp", adminCardNo, params);

export const fetchActiveEmployeesReport = (adminCardNo: string, params?: ReportFilterParams) =>
  get<ActiveEmployeesReport>("active-employees", adminCardNo, params);

export const fetchPfDetailReport = (adminCardNo: string, params?: ReportFilterParams) =>
  get<PfDetailReport>("pf-detail", adminCardNo, params);
