import { apiRequest } from "./api";

// Provident Fund (/pf/* on the Node backend). Amounts are exact — never rounded server-side.

export interface PfSettings {
  unit_id: number; pf_ded_code: string; loan_codes: string[];
  loan_spread: number; zakat_rate: number; profit_divisor: number;
}
export interface PfRate {
  fy_from: string; fy_to: string; fy_label: string; profit_rate: number;
  status: string; remarks: string; posted_on?: string | null;
  posted_members: number; posted_profit: number;
}
export interface PfOpening {
  old_empcode: string; name: string; as_of_fy: string; as_of_fy_label: string;
  emp_contrib: number; emp_profit: number; emp_deductions: number;
  co_contrib: number; co_profit: number; co_deductions: number;
  emp_balance: number; co_balance: number; remarks: string;
}
export interface PfZakatRow {
  old_empcode: string; empcode: string; name: string; pf_ind: string;
  zakat_exempt: boolean; decl_date: string | null; decl_ref: string; remarks: string;
}
export interface PfWithdrawal {
  doc: number; old_empcode: string; name?: string; date: string; amount: number;
  remarks: string; chq_no?: string; chq_dt?: string | null;
}
export interface PfLine {
  line_type: string; value_date: string; period?: number | null; ref_doc?: number | null;
  earned_gross?: number | null; fpo?: number | null; basic?: number | null; payroll_deducted?: number | null;
  emp_amt: number; co_amt: number; days: number; emp_product: number; co_product: number;
}
export interface PfLoanLine { line_type: string; value_date: string; amount: number; days: number; product: number; ref_doc?: number | null }
export interface PfPart { opening: number; contribution: number; product: number; profit: number; withdrawn: number; closing: number; loan_interest?: number }
export interface PfYear {
  fy_from: string; fy_to: string; fy_label: string; cutoff: string;
  profit_rate: number; loan_rate: number; status: "posted" | "computed"; provisional: boolean;
  lines: PfLine[]; emp: PfPart; co: PfPart;
  loan: { opening: number; product: number; interest: number; closing: number; lines: PfLoanLine[] };
}
export interface PfMember {
  old_empcode: string; empcode?: string; name?: string; atdtcard?: string;
  joining_date?: string | null; exit_date?: string | null; pf_ind?: string; pf_member_since?: string | null;
  designation?: string; department?: string; zakat_exempt?: boolean; decl_date?: string | null; decl_ref?: string;
}
export interface PfStatement {
  member: PfMember; upto: string; take_on: PfOpening | null; years: PfYear[];
  balances: { employee: number; company: number; loan_outstanding: number };
  warnings: string[];
}
export interface PfSettlement {
  member: PfMember; settlement_date: string;
  years: { fy_label: string; fy_from: string; cutoff: string; status: string; provisional: boolean; profit_rate: number;
           emp: { contribution: number; profit: number; withdrawn: number; loan_interest: number };
           co: { contribution: number; profit: number; withdrawn: number } }[];
  totals: { emp: { contribution: number; profit: number; withdrawn: number; loan_interest: number };
            co: { contribution: number; profit: number; withdrawn: number } };
  employee_part: number; zakat: number; zakat_exempt: boolean; company_part: number;
  gross_dues: number; less_loan_outstanding: number; amount_payable: number;
  permanent_withdrawals: PfWithdrawal[];
}

const ac = (adminCardNo: string, compc?: string) =>
  `admin_card_no=${encodeURIComponent(adminCardNo)}${compc ? `&compc=${encodeURIComponent(compc)}` : ""}`;
const emp = (empcode?: string) => (empcode ? `&empcode=${encodeURIComponent(empcode)}` : "");

// ── Settings ──
export const fetchPfSettings = (adminCardNo: string, compc?: string) =>
  apiRequest<PfSettings>(`/pf/settings?${ac(adminCardNo, compc)}`);
export const savePfSettings = (adminCardNo: string, compc: string | undefined, body: Record<string, unknown>) =>
  apiRequest(`/pf/settings?${ac(adminCardNo, compc)}`, { method: "PUT", body });

// ── Profit rates & year-end posting ──
export const fetchPfRates = (adminCardNo: string, compc?: string) =>
  apiRequest<{ items: PfRate[] }>(`/pf/rates?${ac(adminCardNo, compc)}`);
export const savePfRate = (adminCardNo: string, compc: string | undefined, body: { fy_from: string; profit_rate: number; remarks?: string }) =>
  apiRequest(`/pf/rates?${ac(adminCardNo, compc)}`, { method: "POST", body });
export const deletePfRate = (adminCardNo: string, compc: string | undefined, fyFrom: string) =>
  apiRequest(`/pf/rates/${fyFrom}?${ac(adminCardNo, compc)}`, { method: "DELETE" });
export const postPfYear = (adminCardNo: string, compc: string | undefined, fyFrom: string) =>
  apiRequest<{ status: string; fy_label: string; members_posted: number; total_profit: number; skipped: { old_empcode: string; reason: string }[] }>(
    `/pf/years/post?${ac(adminCardNo, compc)}`, { method: "POST", body: { fy_from: fyFrom } });

// ── Opening balances ──
export const fetchPfOpenings = (adminCardNo: string, compc?: string, empcode?: string) =>
  apiRequest<{ items: PfOpening[] }>(`/pf/openings?${ac(adminCardNo, compc)}${emp(empcode)}`);
export const savePfOpening = (adminCardNo: string, compc: string | undefined, empcode: string, body: Record<string, unknown>) =>
  apiRequest(`/pf/openings/${encodeURIComponent(empcode)}?${ac(adminCardNo, compc)}`, { method: "PUT", body });
export const deletePfOpening = (adminCardNo: string, compc: string | undefined, empcode: string) =>
  apiRequest(`/pf/openings/${encodeURIComponent(empcode)}?${ac(adminCardNo, compc)}`, { method: "DELETE" });
export const importPfOpenings = (adminCardNo: string, compc: string | undefined, asOfFy: string, overwrite: boolean) =>
  apiRequest<{ status: string; imported: number; skipped: { old_empcode: string; reason: string }[] }>(
    `/pf/openings/import?${ac(adminCardNo, compc)}`, { method: "POST", body: { as_of_fy: asOfFy, overwrite } });

// ── Withdrawals (read-only: loan type 16 in Payroll → Loans) ──
export const fetchPfWithdrawals = (adminCardNo: string, compc?: string, empcode?: string) =>
  apiRequest<{ items: PfWithdrawal[] }>(`/pf/withdrawals?${ac(adminCardNo, compc)}${emp(empcode)}`);

// ── Zakat exemption ──
export const fetchPfZakat = (adminCardNo: string, compc?: string) =>
  apiRequest<{ items: PfZakatRow[] }>(`/pf/zakat?${ac(adminCardNo, compc)}`);
export const savePfZakat = (adminCardNo: string, compc: string | undefined, empcode: string,
  body: { zakat_exempt: boolean; decl_date?: string; decl_ref?: string; remarks?: string }) =>
  apiRequest(`/pf/zakat/${encodeURIComponent(empcode)}?${ac(adminCardNo, compc)}`, { method: "PUT", body });

// ── Statement & settlement ──
export const fetchPfStatement = (adminCardNo: string, compc: string | undefined, empcode: string, upto?: string) =>
  apiRequest<PfStatement>(`/pf/statement?${ac(adminCardNo, compc)}${emp(empcode)}${upto ? `&upto=${upto}` : ""}`);
export const fetchPfSettlement = (adminCardNo: string, compc: string | undefined, empcode: string, upto?: string) =>
  apiRequest<PfSettlement>(`/pf/settlement?${ac(adminCardNo, compc)}${emp(empcode)}${upto ? `&upto=${upto}` : ""}`);

/** Exact amount for display: thousands separators, up to 4 decimals (as in the Excel statements), no rounding to whole rupees. */
export const pfMoney = (v?: number | null) =>
  v == null ? "—" : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const pfPct = (v?: number | null) =>
  v == null ? "—" : `${(Number(v) * 100).toLocaleString(undefined, { maximumFractionDigits: 6 })}%`;
