import { apiRequest } from "./api";

// ── Feature 1: employee-wise GPS trail (one row per recorded point) ──
export interface TrailRow {
  empcode: string;
  name: string;
  department: string;
  designation: string;
  date: string;
  recorded_at: string;          // UTC ISO — convert to local for display
  latitude: number | null;
  longitude: number | null;
  accuracy: number;
  distance_km: number;
  status: string;               // Login | Active | Logout
}

// ── Feature 2: per-employee-per-day tracking summary ──
export interface SummaryRow {
  empcode: string;
  name: string;
  department: string;
  designation: string;
  date: string;
  first_time: string;
  last_time: string;
  total_entries: number;
  total_distance_km: number;
  status: string;               // Present
}

export interface LocationReportFilters {
  adminCardNo: string;
  fromDate: string;             // YYYY-MM-DD
  toDate: string;               // YYYY-MM-DD
  compc?: string;               // selected company (UNIT_ID)
  brnch?: string;               // selected branch (LOCATION)
  deptNo?: string;              // comma-separated
  desgCd?: string;              // comma-separated
  empcodes?: string;            // comma-separated
}

function buildQuery(f: LocationReportFilters): string {
  const p = new URLSearchParams({
    admin_card_no: f.adminCardNo,
    from_date: f.fromDate,
    to_date: f.toDate,
  });
  if (f.compc) p.set("compc", f.compc);
  if (f.brnch) p.set("brnch", f.brnch);
  if (f.deptNo) p.set("dept_no", f.deptNo);
  if (f.desgCd) p.set("desg_cd", f.desgCd);
  if (f.empcodes) p.set("empcodes", f.empcodes);
  return p.toString();
}

export const fetchLocationTrailReport = (f: LocationReportFilters) =>
  apiRequest<{ items: TrailRow[]; from_date: string; to_date: string }>(
    `/location/report/trail?${buildQuery(f)}`
  );

export const fetchLocationSummaryReport = (f: LocationReportFilters) =>
  apiRequest<{ items: SummaryRow[]; from_date: string; to_date: string }>(
    `/location/report/summary?${buildQuery(f)}`
  );
