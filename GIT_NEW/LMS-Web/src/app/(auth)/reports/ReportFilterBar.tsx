"use client";

import { toLocalYmd } from "@/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { Filter, Building2, MapPin, RotateCcw, Search, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useAuth } from "@/context/AuthContext";
import * as reportService from "@/services/reportService";
import type { ReportFilterParams, ReportPeriod } from "@/services/reportService";
import * as referenceService from "@/services/referenceService";
import type { ReportType } from "./ReportPrintSheet";

/**
 * Which controls a given report shows. Driven by the binds its Oracle query
 * actually takes, so no report offers a filter the SQL would ignore.
 */
type FilterKey =
  | "periodRange" | "period" | "salaryData" | "employee" | "department"
  | "designation" | "desgGroup" | "grade" | "empStatus" | "grossRange"
  | "deduction" | "bankAdviceType" | "employeeStatusType"
  // A calendar date range — the monthly attendance cycle (e.g. 21st to 20th)
  // straddles two payroll periods, so it can't use the period picker.
  | "dateRange"
  // Staff strength: Permanent / Contract / both.
  | "staffType";

const REPORT_FILTERS: Record<ReportType, FilterKey[]> = {
  "allowance-detail": ["periodRange", "salaryData", "employee"],
  "deduction-detail": ["periodRange", "salaryData", "employee"],
  "allowance-recon": ["periodRange", "employee"],
  "deduction-recon": ["periodRange", "employee"],
  "month-wise-deduction": ["deduction", "periodRange", "department", "employee"],
  "bank-advice": ["period", "desgGroup", "bankAdviceType"],
  "pf-detail": ["employee"],
  "absent-supp": ["period", "department"],
  "monthly-attendance": ["dateRange", "department"],
  // A date range, not a payroll period: quick to pick and the same for every company.
  "late": ["dateRange", "department"],
  "staff-strength": ["dateRange", "department", "staffType"],
  "active-employees": [
    "employeeStatusType", "designation", "desgGroup", "department",
    "grade", "empStatus", "grossRange", "employee",
  ],
};

/** Filters that must be set before the report can run (mirrors the 422s). */
const REQUIRED: Partial<Record<ReportType, FilterKey[]>> = {
  "month-wise-deduction": ["deduction"],
  "pf-detail": ["employee"],
};

export interface ReportFilters {
  period: number | null;
  periodFrom: number | null;
  periodTo: number | null;
  salaryData: "C" | "P";
  employee: string;
  department: string;
  designation: string;
  desgGroup: string;
  grade: string;
  empStatus: string;
  grossFrom: string;
  grossTo: string;
  deduction: string;
  bankAdviceType: "IN" | "OT";
  employeeStatusType: "A" | "U" | "C";
  fromDate: string;
  toDate: string;
  staffType: "" | "P" | "C";
}

/** Strength reports default to today (the "as on" date); others to the pay cycle. */
const AS_ON_TODAY: ReportType[] = ["staff-strength"];

export const emptyFilters = (reportId?: ReportType | null): ReportFilters => ({
  period: null, periodFrom: null, periodTo: null,
  salaryData: "C", employee: "", department: "", designation: "",
  desgGroup: "", grade: "", empStatus: "", grossFrom: "", grossTo: "",
  deduction: "", bankAdviceType: "IN", employeeStatusType: "A",
  // Default to the running 21st-to-20th cycle, the window HR prints.
  ...(reportId && AS_ON_TODAY.includes(reportId)
    ? { fromDate: toLocalYmd(new Date()), toDate: toLocalYmd(new Date()) }
    : reportId === "late"
    ? { fromDate: toLocalYmd(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), toDate: toLocalYmd(new Date()) }
    : defaultCycle()),
  staffType: "",
});

/** Ready-made date ranges for the date-range reports, so no period list is needed. */
function quickRange(kind: string): { from: string; to: string } | null {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  if (kind === "today") return { from: toLocalYmd(now), to: toLocalYmd(now) };
  if (kind === "month") return { from: toLocalYmd(new Date(y, m, 1)), to: toLocalYmd(now) };
  if (kind === "last") return { from: toLocalYmd(new Date(y, m - 1, 1)), to: toLocalYmd(new Date(y, m, 0)) };
  if (kind === "cycle") { const c = defaultCycle(); return { from: c.fromDate, to: c.toDate }; }
  return null;
}

/** The pay cycle containing today: 21st of last month to the 20th of this one. */
function defaultCycle(): { fromDate: string; toDate: string } {
  const now = new Date();
  // Local date: toISOString() would shift east-of-Greenwich dates back a day,
  // which is what made "this month" start on the 31st of the previous month.
  const ymd = toLocalYmd;
  const to = new Date(now.getFullYear(), now.getMonth(), 20);
  if (now.getDate() <= 20) to.setMonth(to.getMonth() - 1);
  const from = new Date(to.getFullYear(), to.getMonth() - 1, 21);
  return { fromDate: ymd(from), toDate: ymd(to) };
}

/** Map the UI filter state onto the query-string params for a given report. */
export function toParams(reportId: ReportType | null, f: ReportFilters): ReportFilterParams {
  if (!reportId) return {};
  const keys = REPORT_FILTERS[reportId];
  const p: ReportFilterParams = {};
  if (keys.includes("periodRange")) { p.period_from = f.periodFrom; p.period_to = f.periodTo; }
  if (keys.includes("period")) p.period = f.period;
  if (keys.includes("salaryData")) p.rtype = f.salaryData;
  if (keys.includes("bankAdviceType")) p.rtype = f.bankAdviceType;
  if (keys.includes("employeeStatusType")) p.rtype = f.employeeStatusType;
  if (keys.includes("employee")) p.empcode = f.employee;
  if (keys.includes("department")) p.dept_no = f.department;
  if (keys.includes("designation")) p.desg_cd = f.designation;
  if (keys.includes("desgGroup")) p.desg_grp = f.desgGroup;
  if (keys.includes("grade")) p.grade_cd = f.grade;
  if (keys.includes("empStatus")) p.emp_status = f.empStatus;
  if (keys.includes("grossRange")) {
    p.gross_from = f.grossFrom === "" ? null : Number(f.grossFrom);
    p.gross_to = f.grossTo === "" ? null : Number(f.grossTo);
  }
  if (keys.includes("deduction")) p.deduction_id = f.deduction;
  if (keys.includes("dateRange")) { p.from_date = f.fromDate; p.to_date = f.toDate; }
  if (keys.includes("staffType")) p.staff_type = f.staffType;
  return p;
}

/** True when every required filter for this report has a value. */
export function isRunnable(reportId: ReportType | null, f: ReportFilters): boolean {
  if (!reportId) return false;
  const keys = REPORT_FILTERS[reportId];
  if (keys.includes("periodRange") && (f.periodFrom == null || f.periodTo == null)) return false;
  if (keys.includes("period") && f.period == null) return false;
  if (keys.includes("dateRange") && (!f.fromDate || !f.toDate)) return false;
  for (const k of REQUIRED[reportId] ?? []) {
    if (!f[k as keyof ReportFilters]) return false;
  }
  return true;
}

// ── Small presentational helpers ──────────────────────────────────

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`space-y-1 ${wide ? "min-w-[220px]" : "min-w-[150px]"}`}>
      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

const selectCls =
  "w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white font-medium " +
  "focus:outline-none focus:ring-2 focus:ring-indigo-300";

/** Value of the report Company picker that runs the report across every company. */
export const ALL_COMPANIES = "ALL";

/**
 * True when the report runs over several companies: "ALL" or a comma list of
 * picked codes ("1,3"). Those runs merge per-company results and match
 * periods by month, exactly as "All Companies" always has.
 */
export const isMultiCompany = (c: string) => c === ALL_COMPANIES || c.includes(",");

/**
 * Company picker for the report scope: tick one, several or all companies.
 * The value is a code, a comma list, or ALL_COMPANIES when every one is ticked.
 */
function CompanyPicker({
  companies,
  value,
  onChange,
}: {
  companies: { code: string | number; name: string }[];
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const codes = companies.map((c) => String(c.code));
  const picked = value === ALL_COMPANIES ? codes : value.split(",").filter((c) => codes.includes(c));

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const emit = (next: string[]) => {
    if (!next.length) return; // a report always needs at least one company
    const ordered = codes.filter((c) => next.includes(c));
    onChange(ordered.length === codes.length && codes.length > 1 ? ALL_COMPANIES : ordered.join(","));
  };
  const toggle = (code: string) =>
    emit(picked.includes(code) ? picked.filter((c) => c !== code) : [...picked, code]);

  const label =
    value === ALL_COMPANIES ? "All Companies"
    : picked.length === 1 ? companies.find((c) => String(c.code) === picked[0])?.name ?? picked[0]
    : `${picked.length} companies`;

  if (companies.length <= 1) {
    return <span className="py-0.5 pr-1">{companies[0]?.name ?? ""}</span>;
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 font-semibold text-indigo-800 focus:outline-none py-0.5 pr-1">
        <span className="max-w-[220px] truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true"
          className="absolute left-0 top-full mt-1.5 z-30 w-64 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
          <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer border-b border-gray-100 mb-1">
            <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-indigo-600"
              checked={picked.length === codes.length}
              onChange={() => emit(picked.length === codes.length ? [codes[0]] : codes)} />
            <span className="text-sm font-semibold text-gray-800">All Companies</span>
          </label>
          {companies.map((c) => (
            <label key={c.code} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                checked={picked.includes(String(c.code))}
                onChange={() => toggle(String(c.code))} />
              <span className="text-sm text-gray-700 truncate">{c.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReportFilterBar({
  reportId,
  adminCardNo,
  filters,
  onChange,
  onApply,
  loading,
  company,
  onCompanyChange,
}: {
  reportId: ReportType | null;
  adminCardNo: string;
  filters: ReportFilters;
  onChange: (next: ReportFilters) => void;
  onApply: () => void;
  loading: boolean;
  /** Company the report runs for: a code, a comma list of codes, or ALL_COMPANIES. */
  company: string;
  onCompanyChange: (compc: string) => void;
}) {
  const { user, activeCompany, activeBranch } = useAuth();
  // Every hook runs before the "no report" return below (rules of hooks).
  const keys: FilterKey[] = reportId ? REPORT_FILTERS[reportId] : [];
  const has = (k: FilterKey) => keys.includes(k);
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  // Split filters into primary (first 3) and secondary (4+)
  const primaryKeys = keys.slice(0, 3);
  const secondaryKeys = keys.slice(3);
  const hasMoreFilters = secondaryKeys.length > 0;

  const [periods, setPeriods] = useState<ReportPeriod[]>([]);
  const [desgGroups, setDesgGroups] = useState<string[]>([]);
  const [departments, setDepartments] = useState<referenceService.Department[]>([]);
  const [designations, setDesignations] = useState<referenceService.Designation[]>([]);
  const [grades, setGrades] = useState<referenceService.Grade[]>([]);
  const [empStatuses, setEmpStatuses] = useState<referenceService.EmpStatus[]>([]);
  const [deductions, setDeductions] = useState<{ deduction_id: string; deduction_desc: string }[]>([]);

  const companies = user?.company_list ?? [];
  const allCompanies = isMultiCompany(company);
  // Lookups: the report's own company (ALL → month list across companies).
  // Branch only applies while the report runs for the top-bar company.
  const compc = company || undefined;
  const brnch = company && String(company) === String(activeCompany) ? activeBranch || undefined : undefined;
  // Shared reference lists take no "ALL"; empty = every company in the admin's rights.
  const refCompc = allCompanies ? undefined : compc;

  // Periods, designation groups and deduction types come from the reports
  // module itself — periods depend on the resolved unit, so this reloads when
  // the sidebar changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await reportService.fetchReportLookups(adminCardNo, { compc, brnch });
        if (cancelled) return;
        setPeriods(r.data.periods);
        setDesgGroups(r.data.desg_groups.map((d) => d.desg_grp));
        setDeductions(r.data.deductions ?? []);
      } catch (e) {
        console.error("Failed to load report lookups", e);
      }
    })();
    return () => { cancelled = true; };
  }, [adminCardNo, compc, brnch]);

  // The rest are the shared reference lists the other HR screens already use.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settle = <T,>(p: Promise<{ items: T[] }>): Promise<T[]> =>
        p.then((r) => r.items || []).catch(() => []);
      const [d, g, s, dg] = await Promise.all([
        settle(referenceService.fetchDepartments(refCompc, brnch)),
        settle(referenceService.fetchGrades(refCompc, brnch)),
        settle(referenceService.fetchEmpStatuses(refCompc)),
        settle(referenceService.fetchDesignations(undefined, refCompc, brnch)),
      ]);
      if (cancelled) return;
      setDepartments(d); setGrades(g); setEmpStatuses(s); setDesignations(dg);
    })();
    return () => { cancelled = true; };
  }, [refCompc, brnch]);

  // Default the period range to the newest period once the list arrives or report changes.
  useEffect(() => {
    if (!periods.length) return;
    const latest = periods[0].period;
    const needsPeriod = keys.includes("period") && filters.period == null;
    const needsPeriodRange = keys.includes("periodRange") && (filters.periodFrom == null || filters.periodTo == null);

    if (needsPeriod || needsPeriodRange) {
      onChange({
        ...filters,
        period: filters.period ?? latest,
        periodFrom: filters.periodFrom ?? latest,
        periodTo: filters.periodTo ?? latest,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods, reportId, filters.period, filters.periodFrom, filters.periodTo]);

  // Built on the latest edit rather than this render's `filters`, so two set()
  // calls in one handler (a quick date range sets From and To) both stick.
  const latestFilters = useRef(filters);
  useEffect(() => { latestFilters.current = filters; }, [filters]);
  const set = <K extends keyof ReportFilters>(k: K, v: ReportFilters[K]) => {
    latestFilters.current = { ...latestFilters.current, [k]: v };
    onChange(latestFilters.current);
  };

  const periodOptions = useMemo(
    () => periods.map((p) => ({ value: p.period, label: p.label })),
    [periods]
  );

  if (!reportId) return null;
  const branchName = brnch ? user?.selected_branch?.name || "All Branches" : "All Branches";
  const runnable = isRunnable(reportId, filters);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm print:hidden">
      {/* Inherited scope — set from the sidebar, not editable here, because the
          backend re-resolves it against the admin's rights anyway. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2.5 bg-gray-50/70 rounded-t-2xl">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
          <Filter className="h-3.5 w-3.5 text-indigo-600" /> Scope
        </span>
        <label className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 border border-indigo-100 pl-2.5 pr-1 py-0.5 text-xs font-semibold text-indigo-800">
          <Building2 className="h-3.5 w-3.5" />
          <CompanyPicker companies={companies} value={company} onChange={onCompanyChange} />
        </label>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
          <MapPin className="h-3.5 w-3.5" /> {branchName}
        </span>
        <span className="text-[11px] text-gray-400">
          {allCompanies ? (company === ALL_COMPANIES ? "every company in your rights" : "the ticked companies") + " · periods are matched by month" : "branch follows the top-bar selection"}
        </span>
      </div>

      {/* Primary filters row */}
      <div className="flex flex-wrap items-end gap-3 p-4">
        <FilterRenderer keys={primaryKeys} filters={filters} set={set} has={has}
          periods={periods} periodOptions={periodOptions} designations={designations}
          desgGroups={desgGroups} departments={departments} grades={grades}
          empStatuses={empStatuses} deductions={deductions} reportId={reportId} />
      </div>

      {/* Actions row with more filters toggle */}
      <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-3 flex-wrap">
        {hasMoreFilters && (
          <button
            onClick={() => setShowMoreFilters(!showMoreFilters)}
            className="text-xs font-bold text-indigo-600 hover:text-indigo-700 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 transition-colors"
          >
            {showMoreFilters ? "− Fewer filters" : "+ More filters"}
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => onChange(emptyFilters(reportId))} disabled={loading}>
            <RotateCcw className="h-4 w-4 mr-1.5" /> Reset
          </Button>
          <Button size="sm" onClick={onApply} disabled={loading || !runnable}
            className="bg-indigo-600 hover:bg-indigo-700 text-white">
            <Search className="h-4 w-4 mr-1.5" /> Apply
          </Button>
        </div>
      </div>

      {/* Secondary filters row - only shown when toggled */}
      {showMoreFilters && secondaryKeys.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 p-4 border-t border-dashed border-gray-200">
          <FilterRenderer keys={secondaryKeys} filters={filters} set={set} has={has}
            periods={periods} periodOptions={periodOptions} designations={designations}
            desgGroups={desgGroups} departments={departments} grades={grades}
            empStatuses={empStatuses} deductions={deductions} reportId={reportId} />
        </div>
      )}

      {!runnable && (
        <div className="px-4 pb-3 -mt-1 text-xs text-amber-700">
          Set the fields marked * to run this report.
        </div>
      )}
    </div>
  );
}

// Helper component to render filter fields based on a list of filter keys
function FilterRenderer({
  keys,
  filters,
  set,
  has,
  periods,
  periodOptions,
  designations,
  desgGroups,
  departments,
  grades,
  empStatuses,
  deductions,
  reportId,
}: {
  keys: FilterKey[];
  filters: ReportFilters;
  set: <K extends keyof ReportFilters>(k: K, v: ReportFilters[K]) => void;
  has: (k: FilterKey) => boolean;
  periods: ReportPeriod[];
  periodOptions: { value: number; label: string }[];
  designations: referenceService.Designation[];
  desgGroups: string[];
  departments: referenceService.Department[];
  grades: referenceService.Grade[];
  empStatuses: referenceService.EmpStatus[];
  deductions: { deduction_id: string; deduction_desc: string }[];
  reportId: ReportType;
}) {
  return (
    <>
      {keys.includes("periodRange") && (
        <>
          <Field label="Period From *">
            <select className={selectCls} value={filters.periodFrom ?? ""}
              onChange={(e) => set("periodFrom", e.target.value ? Number(e.target.value) : null)}>
              {!periodOptions.length && <option value="">No periods</option>}
              {periodOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Period To *">
            <select className={selectCls} value={filters.periodTo ?? ""}
              onChange={(e) => set("periodTo", e.target.value ? Number(e.target.value) : null)}>
              {!periodOptions.length && <option value="">No periods</option>}
              {periodOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
        </>
      )}

      {keys.includes("dateRange") && (
        <>
          <Field label="Quick range">
            <select className={selectCls} value=""
              onChange={(e) => {
                const r = quickRange(e.target.value);
                if (r) { set("fromDate", r.from); set("toDate", r.to); }
              }}>
              <option value="">Pick…</option>
              <option value="today">Today</option>
              <option value="month">This month</option>
              <option value="last">Last month</option>
              <option value="cycle">Pay cycle (21–20)</option>
            </select>
          </Field>
          <Field label="From Date *">
            <input type="date" className={selectCls} value={filters.fromDate}
              onChange={(e) => set("fromDate", e.target.value)} />
          </Field>
          <Field label="To Date *">
            <input type="date" className={selectCls} value={filters.toDate}
              min={filters.fromDate || undefined}
              onChange={(e) => set("toDate", e.target.value)} />
          </Field>
        </>
      )}

      {keys.includes("period") && (
        <Field label="Period *">
          <select className={selectCls} value={filters.period ?? ""}
            onChange={(e) => set("period", e.target.value ? Number(e.target.value) : null)}>
            {!periodOptions.length && <option value="">No periods</option>}
            {periodOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>
      )}

      {keys.includes("salaryData") && (
        <Field label="Salary Data">
          <select className={selectCls} value={filters.salaryData}
            onChange={(e) => set("salaryData", e.target.value as "C" | "P")}>
            <option value="C">Current</option>
            <option value="P">Posted (Final)</option>
          </select>
        </Field>
      )}

      {keys.includes("employeeStatusType") && (
        <Field label="Employees">
          <select className={selectCls} value={filters.employeeStatusType}
            onChange={(e) => set("employeeStatusType", e.target.value as "A" | "U" | "C")}>
            <option value="A">All Active</option>
            <option value="C">Confirmed</option>
            <option value="U">Un-Confirmed</option>
          </select>
        </Field>
      )}

      {keys.includes("staffType") && (
        <Field label="Type">
          <select className={selectCls} value={filters.staffType}
            onChange={(e) => set("staffType", e.target.value as "" | "P" | "C")}>
            <option value="">Permanent &amp; Contract</option>
            <option value="P">Permanent</option>
            <option value="C">Contract</option>
          </select>
        </Field>
      )}

      {keys.includes("bankAdviceType") && (
        <Field label="Advice Type">
          <select className={selectCls} value={filters.bankAdviceType}
            onChange={(e) => set("bankAdviceType", e.target.value as "IN" | "OT")}>
            <option value="IN">Included</option>
            <option value="OT">Other</option>
          </select>
        </Field>
      )}

      {keys.includes("deduction") && (
        <Field label="Deduction *" wide>
          <SearchableSelect
            value={filters.deduction}
            onChange={(v) => set("deduction", v)}
            placeholder="Select deduction…"
            options={deductions.map((d) => ({ value: d.deduction_id, label: d.deduction_desc }))}
          />
        </Field>
      )}

      {keys.includes("designation") && (
        <Field label="Designation" wide>
          <SearchableSelect
            value={filters.designation}
            onChange={(v) => set("designation", v)}
            placeholder="All designations"
            options={designations.map((d) => ({ value: d.desg_cd, label: d.desg_desc }))}
          />
        </Field>
      )}

      {keys.includes("desgGroup") && (
        <Field label="Designation Group">
          <select className={selectCls} value={filters.desgGroup}
            onChange={(e) => set("desgGroup", e.target.value)}>
            <option value="">All Designations</option>
            {desgGroups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
      )}

      {keys.includes("department") && (
        <Field label="Department" wide>
          <SearchableSelect
            value={filters.department}
            onChange={(v) => set("department", v)}
            placeholder="All departments"
            options={departments.map((d) => ({ value: String(d.dept_no), label: d.dept_name }))}
          />
        </Field>
      )}

      {keys.includes("grade") && (
        <Field label="Grade">
          <select className={selectCls} value={filters.grade}
            onChange={(e) => set("grade", e.target.value)}>
            <option value="">All Grades</option>
            {grades.map((g) => <option key={g.grade_cd} value={g.grade_cd}>{g.descr || g.grade_cd}</option>)}
          </select>
        </Field>
      )}

      {keys.includes("empStatus") && (
        <Field label="Employee Status">
          <select className={selectCls} value={filters.empStatus}
            onChange={(e) => set("empStatus", e.target.value)}>
            <option value="">All Statuses</option>
            {empStatuses.map((s) => <option key={s.emp_status} value={s.emp_status}>{s.descr}</option>)}
          </select>
        </Field>
      )}

      {keys.includes("grossRange") && (
        <>
          <Field label="Gross From">
            <input type="number" className={selectCls} placeholder="0" value={filters.grossFrom}
              onChange={(e) => set("grossFrom", e.target.value)} />
          </Field>
          <Field label="Gross To">
            <input type="number" className={selectCls} placeholder="999999" value={filters.grossTo}
              onChange={(e) => set("grossTo", e.target.value)} />
          </Field>
        </>
      )}

      {keys.includes("employee") && (
        <Field label={REQUIRED[reportId]?.includes("employee") ? "Employee Code *" : "Employee Code"}>
          <input className={selectCls} placeholder="All employees" value={filters.employee}
            onChange={(e) => set("employee", e.target.value)} />
        </Field>
      )}
    </>
  );
}
