import { apiRequest } from "./api";

export interface OrgChartNode {
  empcode: string;
  name: string;
  designation: string | null;
  desg_cd: string | null;
  department: string | null;
  dept_no: string | null;
  grade_cd: string | null;
  rpt_officer: string | null;
  unit_id: string;
  company_name: string | null;
  location: string | null;
  branch_name: string | null;
}

export const fetchCompanyOrgChart = (adminCardNo: string, compc?: string, brnch?: string) => {
  const params = new URLSearchParams({ admin_card_no: adminCardNo });
  if (compc) params.set("compc", compc);
  if (brnch) params.set("brnch", brnch);
  return apiRequest<{ items: OrgChartNode[] }>(`/org-chart/company?${params.toString()}`);
};

export const fetchBranchOrgChart = (cardNo: string) =>
  apiRequest<{ items: OrgChartNode[] }>(`/org-chart/branch?card_no=${encodeURIComponent(cardNo)}`);
