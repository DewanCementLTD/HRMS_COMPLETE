import { apiRequest } from "./api";
import {
  LeaveApplyRequest, LeaveStatusResponse, LeaveTypesResponse,
  HodApprovalsResponse, HodOption,
  LeaveOpening, AllocatableEmployee, LeaveOpeningEntry, LeaveYear,
} from "@/models/leave";

export async function fetchLeaveTypes(cardNo: string): Promise<LeaveTypesResponse> {
  return apiRequest<LeaveTypesResponse>(`/auth/leave-types/${cardNo}`);
}

export async function applyLeave(
  cardNo: string,
  data: LeaveApplyRequest
): Promise<{ status: string; message: string }> {
  return apiRequest(`/auth/apply-leave/${cardNo}`, {
    method: "POST",
    body: data,
  });
}

export async function fetchLeaveStatus(cardNo: string): Promise<LeaveStatusResponse> {
  return apiRequest<LeaveStatusResponse>(`/auth/leave-status/${cardNo}`);
}

// ── HOD approvals ──────────────────────────────────────────────────────

export async function fetchHodApprovals(cardNo: string): Promise<HodApprovalsResponse> {
  return apiRequest<HodApprovalsResponse>(`/auth/leave-approvals/${cardNo}`);
}

export async function decideHodApproval(
  cardNo: string,
  pk: number,
  decision: "approve" | "reject"
): Promise<{ status: string; message: string; approval_status?: string }> {
  return apiRequest(`/auth/leave-approvals/${cardNo}/${pk}`, {
    method: "POST",
    body: { decision },
  });
}

/** Employees of one company (any branch), for the HOD 1 / HOD 2 pickers. */
export async function fetchHodOptions(
  adminCardNo: string,
  compc: string
): Promise<{ items: HodOption[] }> {
  const params = new URLSearchParams({ admin_card_no: adminCardNo, compc });
  return apiRequest<{ items: HodOption[] }>(`/hrms/hod-options?${params.toString()}`);
}

// ── Leave allocation (LEAVE_OP), HR only ───────────────────────────────
// The server resolves the company from the admin's rights, so `compc` here is a
// preference, never a grant of access.

const scope = (adminCardNo: string, compc?: string, brnch?: string) => {
  const p = new URLSearchParams({ admin_card_no: adminCardNo });
  if (compc) p.set("compc", compc);
  if (brnch) p.set("brnch", brnch);
  return p;
};

export async function fetchLeaveOpeningYears(
  adminCardNo: string, compc?: string
): Promise<{ items: LeaveYear[] }> {
  return apiRequest(`/hrms/leave-openings/years?${scope(adminCardNo, compc).toString()}`);
}

export async function fetchAllocatableEmployees(
  adminCardNo: string, compc?: string, brnch?: string
): Promise<{ items: AllocatableEmployee[] }> {
  return apiRequest(`/hrms/leave-openings/employees?${scope(adminCardNo, compc, brnch).toString()}`);
}

export async function fetchLeaveOpenings(
  adminCardNo: string, opts: { compc?: string; brnch?: string; year?: number; cardNo?: string }
): Promise<{ items: LeaveOpening[]; compc: number }> {
  const p = scope(adminCardNo, opts.compc, opts.brnch);
  if (opts.year != null) p.set("year", String(opts.year));
  if (opts.cardNo) p.set("card_no", opts.cardNo);
  return apiRequest(`/hrms/leave-openings?${p.toString()}`);
}

export async function saveLeaveOpening(
  adminCardNo: string,
  compc: string | undefined,
  body: { card_no: string; year: number; op_date?: string; entries: LeaveOpeningEntry[] }
): Promise<{ status: string; message: string; saved: number; removed: number; is_active_year: boolean }> {
  return apiRequest(`/hrms/leave-openings?${scope(adminCardNo, compc).toString()}`, {
    method: "POST",
    body,
  });
}
