import { apiRequest } from "./api";
import { EmployeeSearchResult } from "@/models/employee";

export async function searchEmployees(
  query: string,
  adminCardNo: string
): Promise<{ items: EmployeeSearchResult[] }> {
  return apiRequest(
    `/hr/employees/search?q=${encodeURIComponent(query)}&admin_card_no=${adminCardNo}`
  );
}
