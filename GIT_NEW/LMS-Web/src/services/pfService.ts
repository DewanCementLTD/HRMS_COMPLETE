import { apiRequest } from "./api";

// ── Types ──
export interface PfTotals {
  opening: number; contributions: number; withdrawals: number; balance: number;
  loan_taken: number; loan_outstanding: number; available: number; pending: number;
  last_period: number | null; last_period_label: string;
}

export interface PfMember extends PfTotals {
  old_empcode: string; empcode: string; name: string; on_master: boolean;
  status: string; emp_status: string; pf_ind: "Y" | "N"; pf_mem_dt: string | null;
  dept_name: string; desg_desc: string;
}

export interface PfSummary {
  unit_id: number;
  totals: PfTotals;
  counts: { members: number; pf_flagged: number; with_balance: number; active_loans: number; not_on_master: number };
  last_posted: { period: number; label: string } | null;
  monthly: { period: number; period_frm: string | null; amount: number; employees: number; label: string }[];
}

export interface PfLine {
  sr: number; date: string | null; month: string;
  type: "opening" | "contribution" | "withdrawal" | "loan";
  description: string; period?: number; doc?: number; basic?: number | null;
  credit: number; debit: number; memo_amount?: number; balance: number;
}

export interface PfLoan {
  doc: number; emp_key: string; loan_cd: string; loan_desc: string; kind: "loan" | "withdrawal";
  loan_date: string | null; amount: number; recovered: number; outstanding: number;
  instalment_amt: number | null; nof_instalment: number | null; start_dt: string | null;
  deduct_from_salary: boolean; remarks: string; chq_no: string;
}

export interface PfLoanRow extends PfLoan {
  old_empcode: string; name: string; dept_name: string; pf_balance: number; pf_available: number;
}

export interface PfStatement {
  member: PfMember;
  unit_name: string;
  lines: PfLine[];
  loans: PfLoan[];
  pending: { period: number; amount: number; period_frm: string | null; label: string }[];
}

export interface MyPf { accounts: (PfStatement & { unit_id: number })[] }

const q = (adminCardNo: string, compc?: string, brnch?: string) =>
  `admin_card_no=${encodeURIComponent(adminCardNo)}` +
  (compc ? `&compc=${encodeURIComponent(compc)}` : "") +
  (brnch ? `&brnch=${encodeURIComponent(brnch)}` : "");

// ── HR ──
export const fetchPfSummary = (adminCardNo: string, compc?: string, brnch?: string) =>
  apiRequest<PfSummary>(`/pf/summary?${q(adminCardNo, compc, brnch)}`);

export const fetchPfMembers = (adminCardNo: string, compc?: string, brnch?: string, scope: "members" | "all" = "members") =>
  apiRequest<{ items: PfMember[] }>(`/pf/members?${q(adminCardNo, compc, brnch)}&scope=${scope}`);

export const fetchPfStatement = (adminCardNo: string, empcode: string, compc?: string) =>
  apiRequest<PfStatement>(`/pf/members/${encodeURIComponent(empcode)}/statement?${q(adminCardNo, compc)}`);

export const fetchPfLoans = (adminCardNo: string, compc?: string, brnch?: string) =>
  apiRequest<{ items: PfLoanRow[] }>(`/pf/loans?${q(adminCardNo, compc, brnch)}`);

export const setPfOpening = (adminCardNo: string, empcode: string, amount: number, compc?: string) =>
  apiRequest(`/pf/members/${encodeURIComponent(empcode)}/opening?${q(adminCardNo, compc)}`, { method: "PUT", body: { amount } });

export const setPfMembership = (adminCardNo: string, empcode: string, pf_ind: "Y" | "N", compc?: string, member_since?: string) =>
  apiRequest(`/pf/members/${encodeURIComponent(empcode)}/membership?${q(adminCardNo, compc)}`, {
    method: "PATCH", body: { pf_ind, member_since: member_since || undefined },
  });

// ── Employee (own data only; the bearer token must belong to cardNo) ──
export const fetchMyPf = (cardNo: string, token: string) =>
  apiRequest<MyPf>(`/auth/pf/${encodeURIComponent(cardNo)}`, { headers: { Authorization: `Bearer ${token}` } });
