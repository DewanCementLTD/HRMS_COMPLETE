import { apiRequest } from "./api";
import { LeaveApplyRequest, LeaveStatusResponse } from "@/models/leave";

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
