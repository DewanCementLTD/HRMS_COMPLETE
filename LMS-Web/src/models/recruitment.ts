export interface Job {
  job_id: number;
  job_title: string;
  dept_no: number | null;
  dept_name: string | null;
  open_positions: number;
  filled_positions: number;
  remaining_positions: number;
  job_desc: string | null;
  skills_req: string | null;
  status: "OPEN" | "CLOSED" | "ON_HOLD";
  created_by: string | null;
  created_at: string | null;
}

export interface Application {
  app_id: number;
  job_id: number;
  job_title: string;
  candidate_name: string;
  mobile: string | null;
  email: string | null;
  source: string | null;
  app_date: string | null;
  status: "PENDING" | "SHORTLISTED" | "REJECTED";
  notes: string | null;
  created_at: string | null;
}

export interface Interview {
  interview_id: number;
  app_id: number;
  candidate_name: string;
  job_title: string;
  interview_date: string | null;
  interview_type: string | null;
  interviewer: string | null;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  feedback: string | null;
  created_at: string | null;
}

export interface Offer {
  offer_id: number;
  app_id: number;
  candidate_name: string;
  job_title: string;
  offer_date: string | null;
  salary_offered: number | null;
  status: "SENT" | "ACCEPTED" | "REJECTED";
  notes: string | null;
  created_at: string | null;
}

export interface RecruitmentAnalytics {
  open_jobs: number;
  total_applications: number;
  pending: number;
  shortlisted: number;
  rejected: number;
  total_interviews: number;
  hires_this_month: number;
  avg_time_to_hire_days: number;
  avg_cost_per_hire: number;
  monthly_hires: { month: string; hires: number }[];
}
