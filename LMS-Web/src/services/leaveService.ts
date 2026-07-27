import { apiRequest } from "./api";
import { LeaveApplyRequest, LeaveStatusResponse, LeaveTypesResponse } from "@/models/leave";

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
