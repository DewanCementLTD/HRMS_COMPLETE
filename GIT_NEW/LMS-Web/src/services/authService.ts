import { apiRequest } from "./api";
import { LoginRequest, LoginResponse } from "@/models/auth";
import { DashboardData, EmployeeProfile } from "@/models/employee";
import { LeaveBalanceResponse } from "@/models/leave";

export async function login(data: LoginRequest): Promise<LoginResponse> {
  return apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: data,
  });
}

export async function fetchDashboard(cardNo: string): Promise<DashboardData> {
  return apiRequest<DashboardData>(`/auth/dashboard/${cardNo}`);
}

export async function fetchProfile(cardNo: string): Promise<EmployeeProfile> {
  return apiRequest<EmployeeProfile>(`/auth/profile/${cardNo}`);
}

export async function fetchLeaveBalances(cardNo: string): Promise<LeaveBalanceResponse> {
  return apiRequest<LeaveBalanceResponse>(`/auth/leave-balances/${cardNo}`);
}

export async function changePassword(
  cardNo: string,
  oldPassword: string,
  newPassword: string
): Promise<{ status: string; message: string }> {
  return apiRequest(`/auth/change-password/${cardNo}`, {
    method: "POST",
    body: { old_password: oldPassword, new_password: newPassword },
  });
}
