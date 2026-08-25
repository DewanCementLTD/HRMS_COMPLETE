"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { FileText, Printer, DollarSign, Users, CheckSquare, Square, Search, ChevronLeft, Download } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import * as reportService from "@/services/reportService";
import { ReportPrintSheet, ReportType } from "./ReportPrintSheet";
import { ReportFilterBar, ReportFilters, emptyFilters, toParams, isRunnable } from "./ReportFilterBar";

interface ReportMeta {
  id: ReportType;
  title: string;
  category: "payroll" | "general";
  description: string;
}

const REPORT_CATALOG: ReportMeta[] = [
  // Payroll (monetary)
  { id: "allowance-detail", title: "Employee Allowances Detail Report", category: "payroll", description: "Monthly allowance breakdown per employee, one column per allowance type" },
  { id: "allowance-recon", title: "Payroll Reconciliation Detail Report (Allowance)", category: "payroll", description: "Allowance variance between two periods, grouped by allowance" },
  { id: "deduction-detail", title: "Employee Deduction Detail Report", category: "payroll", description: "Monthly deduction breakdown per employee, one column per deduction type" },
  { id: "deduction-recon", title: "Payroll Reconciliation Detail Report (Deduction)", category: "payroll", description: "Deduction variance between two periods, grouped by deduction" },
  { id: "month-wise-deduction", title: "Month Wise Deduction Report", category: "payroll", description: "One deduction tracked across a range of months" },
  { id: "bank-advice", title: "Bank Advice Report", category: "payroll", description: "Disbursement schedule grouped by bank and branch with account details" },
  { id: "pf-detail", title: "P.F Detail Report", category: "payroll", description: "Provident Fund ledger, employer matching and account statement for one employee" },

  // General (non-monetary)
  { id: "absent-supp", title: "Employee Absent and Supplimentary Days Report", category: "general", description: "Absent days and supplementary days per employee for a period" },
  { id: "active-employees", title: "ALL Active Employee Detail Report", category: "general", description: "Active employee roster with grade, designation, department and joining dates" },
];

const CATEGORIES = [
  { id: "payroll" as const, label: "Payroll Reports", icon: DollarSign, desc: "Monetary reports built from the salary process." },
  { id: "general" as const, label: "General Reports", icon: Users, desc: "Non-monetary HR and attendance reports." },
];

// Table container + cell classes shared with the rest of the app so these
// tables read the same as DutyRosterPanel / SetupPanel.
const TABLE_WRAP = "overflow-x-auto rounded-2xl border border-gray-200 shadow-sm bg-white";
const TH = "px-3 py-2.5 text-left font-bold text-gray-700 whitespace-nowrap";
const TD = "px-3 py-2 whitespace-nowrap";

// The checkbox and identifier columns stay pinned while the wide reports scroll
// sideways. They need DIFFERENT left offsets — both at left-0 would stack on
// top of each other — so the checkbox column is given a fixed 3rem width and
// the identifier column starts exactly there.
const STICKY_CHECK = "sticky left-0 z-20 bg-inherit w-12 min-w-[3rem] max-w-[3rem]";
const STICKY_ID = "sticky left-12 z-20 bg-inherit border-r border-gray-200";

const money = (v?: number | null) => (v == null || v === 0 ? "—" : Math.round(v).toLocaleString());

export default function ReportsPage() {
  const { user, activeCompany, activeBranch } = useAuth();

  const [activeCategory, setActiveCategory] = useState<"payroll" | "general">("payroll");
  const [selectedReportId, setSelectedReportId] = useState<ReportType | null>(null);

  const [reportData, setReportData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [showPrintSheet, setShowPrintSheet] = useState(false);

  const [filters, setFilters] = useState<ReportFilters>(emptyFilters());
  // Bumped by Apply; reports only refetch when this changes, not on every keystroke.
  const [runToken, setRunToken] = useState(0);

  const categoryReports = useMemo(
    () => REPORT_CATALOG.filter((r) => r.category === activeCategory),
    [activeCategory]
  );

  useEffect(() => {
    if (selectedReportId && !categoryReports.some((r) => r.id === selectedReportId)) {
      setSelectedReportId(categoryReports[0].id);
    }
  }, [activeCategory, categoryReports, selectedReportId]);

  const activeReportMeta = useMemo(
    () => REPORT_CATALOG.find((r) => r.id === selectedReportId) || REPORT_CATALOG[0],
    [selectedReportId]
  );

  const cardNo = user?.card_no;

  const loadReport = useCallback(async () => {
    if (!cardNo || !user?.hr_admin || !selectedReportId) return;
    if (!isRunnable(selectedReportId, filters)) { setReportData(null); return; }

    setLoading(true);
    setError(null);
    setReportData(null);
    setSelectedKeys(new Set());
    try {
      // Company/branch ride along from the sidebar; the backend re-resolves them
      // against this admin's rights before they reach any bind.
      const params = {
        compc: activeCompany || undefined,
        brnch: activeBranch || undefined,
        ...toParams(selectedReportId, filters),
      };

      const fetchers: Record<ReportType, () => Promise<{ data: unknown }>> = {
        "absent-supp": () => reportService.fetchAbsentSuppReport(cardNo, params),
        "allowance-detail": () => reportService.fetchAllowanceDetailReport(cardNo, params),
        "allowance-recon": () => reportService.fetchAllowanceReconReport(cardNo, params),
        "deduction-detail": () => reportService.fetchDeductionDetailReport(cardNo, params),
        "deduction-recon": () => reportService.fetchDeductionReconReport(cardNo, params),
        "month-wise-deduction": () => reportService.fetchMonthWiseDeductionReport(cardNo, params),
        "bank-advice": () => reportService.fetchBankAdviceReport(cardNo, params),
        "active-employees": () => reportService.fetchActiveEmployeesReport(cardNo, params),
        "pf-detail": () => reportService.fetchPfDetailReport(cardNo, params),
      };

      const res = await fetchers[selectedReportId]();
      setReportData(res?.data ?? null);
    } catch (err) {
      console.error("Failed to load report", err);
      setError(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
    // `filters` is read through the Apply token so typing doesn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardNo, user?.hr_admin, selectedReportId, activeCompany, activeBranch, runToken]);

  // Switching company/branch/report reruns automatically; filter edits need Apply.
  useEffect(() => { loadReport(); }, [loadReport]);

  // Reset filters when moving to a report with a different filter set.
  useEffect(() => { setFilters(emptyFilters()); }, [selectedReportId]);

  // ── Row extraction (shape differs per report family) ──

  const { columns, rows, hasOtHours } = useMemo(() => {
    const d = reportData as Record<string, unknown> | null;
    const none = { columns: [] as string[], rows: [] as Record<string, unknown>[], hasOtHours: false };
    if (!d) return none;
    if (Array.isArray(d.rows)) {
      return {
        columns: (d.columns as string[]) ?? [],
        rows: d.rows as Record<string, unknown>[],
        hasOtHours: Boolean(d.has_ot_hours),
      };
    }
    if (Array.isArray(d.ledger)) return { ...none, rows: d.ledger as Record<string, unknown>[] };
    if (Array.isArray(d.groups)) {
      // Flatten grouped reports for the on-screen list, tagging the group name.
      const flat: Record<string, unknown>[] = [];
      for (const g of d.groups as Record<string, unknown>[]) {
        for (const r of (g.rows as Record<string, unknown>[]) ?? []) {
          flat.push({ ...r, __group: g.descr ?? `${g.bank_name} — ${g.branch_name}` });
        }
      }
      return { ...none, rows: flat };
    }
    return none;
  }, [reportData]);

  const filteredRows = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) =>
      String(r.code ?? "").toLowerCase().includes(q) ||
      String(r.employee_name ?? r.month_year ?? "").toLowerCase().includes(q)
    );
  }, [rows, query]);

  const getRowKey = (r: Record<string, unknown>, idx: number) =>
    String(r.code ?? r.period ?? r.sr_no ?? idx);

  const toggleSelectRow = (key: string) =>
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const allFilteredSelected =
    filteredRows.length > 0 && filteredRows.every((r, i) => selectedKeys.has(getRowKey(r, i)));

  const toggleSelectAll = () =>
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      filteredRows.forEach((r, i) => {
        const k = getRowKey(r, i);
        if (allFilteredSelected) next.delete(k); else next.add(k);
      });
      return next;
    });

  /**
   * What the print sheet renders. With no selection the whole report goes to
   * print; otherwise rows are narrowed while the report's shape (groups,
   * ledger, totals, meta) is preserved so the PDF layout stays intact.
   */
  const printableData = useMemo(() => {
    const d = reportData as Record<string, unknown> | null;
    if (!d || selectedKeys.size === 0) return reportData;
    const keep = (r: Record<string, unknown>, i: number) => selectedKeys.has(getRowKey(r, i));

    if (Array.isArray(d.rows)) return { ...d, rows: (d.rows as Record<string, unknown>[]).filter(keep) };
    if (Array.isArray(d.ledger)) return { ...d, ledger: (d.ledger as Record<string, unknown>[]).filter(keep) };
    if (Array.isArray(d.groups)) {
      // Row keys are assigned over the flattened list, so re-flatten to match.
      let i = 0;
      const groups = (d.groups as Record<string, unknown>[])
        .map((g) => {
          const rows = ((g.rows as Record<string, unknown>[]) ?? []).filter((r) => keep(r, i++));
          return { ...g, rows };
        })
        .filter((g) => (g.rows as unknown[]).length > 0);
      return { ...d, groups };
    }
    return reportData;
  }, [reportData, selectedKeys]);

  if (!user?.hr_admin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <FileText className="h-12 w-12 text-white/40 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white">Access Denied</h2>
          <p className="text-gray-300 mt-2">You don&apos;t have HR admin privileges.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-4 pb-12">
      {showPrintSheet && selectedReportId && (
        <ReportPrintSheet
          reportType={selectedReportId}
          reportTitle={activeReportMeta.title}
          data={printableData}
          companyName={user?.selected_company?.name || ""}
          compc={activeCompany || undefined}
          onClose={() => setShowPrintSheet(false)}
        />
      )}

      <PageHeader
        title="HR & Payroll Reports"
        subtitle="Company- and branch-scoped reports with print-ready output"
      />

      {/* Report Picker — Category card grid */}
      {!selectedReportId ? (
        <div className="space-y-8 print:hidden">
          {CATEGORIES.map((cat) => {
            const reports = REPORT_CATALOG.filter((r) => r.category === cat.id);
            return (
              <section key={cat.id}>
                <div className="flex items-baseline gap-2 mb-4">
                  <h2 className="text-base font-bold text-white">{cat.label}</h2>
                  <span className="text-sm text-gray-300">{cat.desc}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 auto-rows-max">
                  {reports.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setSelectedReportId(r.id)}
                      className="text-left rounded-2xl border border-gray-200 bg-white p-4 flex flex-col gap-2.5 transition-all hover:shadow-md hover:border-indigo-300 shadow-sm"
                    >
                      <span className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
                        <BarChartIcon className="h-4 w-4" />
                      </span>
                      <span className="text-sm font-bold text-gray-900 leading-snug">{r.title}</span>
                      <span className="text-xs text-gray-500 leading-normal">{r.description}</span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        /* Dedicated Report Screen */
        <div className="space-y-4 print:hidden">
          {/* Back link + report header */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <button
                onClick={() => setSelectedReportId(null)}
                className="flex items-center gap-1 text-xs font-medium text-gray-300 hover:text-white transition-colors mb-2"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Back to reports
              </button>
              <div className="flex items-center gap-2.5 flex-wrap mb-1">
                <h3 className="text-lg font-bold text-white">{activeReportMeta.title}</h3>
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                  activeReportMeta.category === "payroll"
                    ? "bg-indigo-100 text-indigo-800"
                    : "bg-slate-100 text-slate-800"
                }`}>
                  {activeReportMeta.category === "payroll" ? "Payroll" : "General"}
                </span>
              </div>
              <p className="text-sm text-gray-300">{activeReportMeta.description}</p>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <ExportDropdown />
              <Button
                size="sm"
                onClick={() => setShowPrintSheet(true)}
                disabled={loading || !reportData}
                className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 whitespace-nowrap"
              >
                <Printer className="h-4 w-4" /> Generate Report ({selectedKeys.size > 0 ? selectedKeys.size : "All"})
              </Button>
            </div>
          </div>
        </div>
      )}

      {selectedReportId && (
        <ReportFilterBar
          reportId={selectedReportId}
          adminCardNo={cardNo!}
          filters={filters}
          onChange={setFilters}
          onApply={() => setRunToken((t) => t + 1)}
          loading={loading}
        />
      )}

      {selectedReportId && error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700 print:hidden">
          {error}
        </div>
      )}

      {selectedReportId && (
      <Card className="border border-gray-200 shadow-sm overflow-hidden print:hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-1.5 font-medium text-gray-700 hover:text-indigo-700 transition-colors"
            >
              {allFilteredSelected
                ? <CheckSquare className="h-4 w-4 text-indigo-600" />
                : <Square className="h-4 w-4 text-gray-400" />}
              Select All Visible ({filteredRows.length})
            </button>
            {selectedKeys.size > 0 && (
              <span className="bg-indigo-100 text-indigo-800 text-[11px] px-2 py-0.5 rounded-full font-semibold">
                {selectedKeys.size} selected
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 bg-white border border-gray-300 rounded-lg px-2.5 py-1 w-full max-w-xs">
            <Search className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <input
              className="bg-transparent text-xs outline-none w-full placeholder:text-gray-400"
              placeholder="Search code or name..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-12 text-gray-500 gap-3">
            <Spinner className="h-5 w-5 text-indigo-600" />
            <span className="text-sm font-medium">Loading report records...</span>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <FileText className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-medium">No records found for these filters.</p>
          </div>
        ) : (
          <div className={TABLE_WRAP}>
            <table className="min-w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100 border-b border-gray-200">
                  <th className={`${TH} text-center ${STICKY_CHECK}`}>
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </th>
                  <ReportHead reportId={selectedReportId} columns={columns} hasOtHours={hasOtHours} />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredRows.map((r, idx) => {
                  const key = getRowKey(r, idx);
                  const isChecked = selectedKeys.has(key);
                  return (
                    <tr
                      key={`${key}-${idx}`}
                      onClick={() => toggleSelectRow(key)}
                      className={`cursor-pointer transition-colors ${
                        isChecked ? "bg-indigo-50" : "bg-white hover:bg-gray-50"
                      }`}
                    >
                      <td className={`${TD} text-center ${STICKY_CHECK}`} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectRow(key)}
                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>
                      <ReportRow reportId={selectedReportId} columns={columns} row={r} idx={idx} hasOtHours={hasOtHours} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      )}
    </div>
  );
}

// Icon for report cards
function BarChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none">
      <rect x="1" y="9" width="3" height="6" rx="1" fill="currentColor" />
      <rect x="6.5" y="5" width="3" height="10" rx="1" fill="currentColor" />
      <rect x="12" y="1" width="3" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}

// Export dropdown menu
function ExportDropdown() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(!open)}
        className="gap-1.5"
      >
        <Download className="h-3.5 w-3.5" /> Export <span className="text-xs">▾</span>
      </Button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-md z-20">
            <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 first:rounded-t-lg">
              Export as Excel
            </button>
            <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-t border-gray-200">
              Export as PDF
            </button>
            <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-t border-gray-200 last:rounded-b-lg">
              Print
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Per-report table head / body ──────────────────────────────────
// Pivot reports build their columns from the response, so the allowance and
// deduction sets are whatever the period actually contains.

function ReportHead({ reportId, columns, hasOtHours }: { reportId: ReportType; columns: string[]; hasOtHours: boolean }) {
  switch (reportId) {
    case "absent-supp":
      return (
        <>
          <th className={`${TH} w-14`}>Sr.#</th>
          <th className={`${TH} ${STICKY_ID}`}>Code</th>
          <th className={TH}>Employee Name</th>
          <th className={TH}>Designation</th>
          <th className={TH}>Department</th>
          <th className={`${TH} text-center`}>Absent</th>
          <th className={`${TH} text-center`}>S.Days</th>
        </>
      );
    case "allowance-detail":
    case "deduction-detail":
    case "month-wise-deduction":
      return (
        <>
          <th className={`${TH} ${STICKY_ID}`}>Code</th>
          <th className={TH}>Employee Name</th>
          {hasOtHours && <th className={`${TH} text-center`}>OT Hours</th>}
          {columns.map((c) => <th key={c} className={`${TH} text-right`}>{c}</th>)}
          <th className={`${TH} text-right text-indigo-900`}>Total</th>
        </>
      );
    case "allowance-recon":
    case "deduction-recon":
      return (
        <>
          <th className={TH}>Type</th>
          <th className={`${TH} ${STICKY_ID}`}>Code</th>
          <th className={TH}>Employee Name</th>
          <th className={`${TH} text-right`}>From Period</th>
          <th className={`${TH} text-right`}>To Period</th>
          <th className={`${TH} text-right`}>Variance</th>
        </>
      );
    case "bank-advice":
      return (
        <>
          <th className={TH}>Bank / Branch</th>
          <th className={`${TH} ${STICKY_ID}`}>Code</th>
          <th className={TH}>Employee Name</th>
          <th className={TH}>Account Number</th>
          <th className={`${TH} text-right`}>Salary Payable</th>
        </>
      );
    case "active-employees":
      return (
        <>
          <th className={`${TH} w-12`}>S.#</th>
          <th className={`${TH} ${STICKY_ID}`}>Code</th>
          <th className={TH}>Employee Name</th>
          <th className={TH}>Unit</th>
          <th className={TH}>Location</th>
          <th className={TH}>Grade</th>
          <th className={TH}>Designation</th>
          <th className={TH}>Department</th>
          <th className={TH}>Section</th>
          <th className={TH}>Qualification</th>
          <th className={TH}>Type</th>
          <th className={TH}>Date Of Birth</th>
          <th className={TH}>Date Of Joining</th>
          <th className={TH}>Date Of Confirm</th>
          <th className={`${TH} text-right`}>Gross</th>
        </>
      );
    case "pf-detail":
      return (
        <>
          <th className={`${TH} w-14`}>S.No</th>
          <th className={`${TH} ${STICKY_ID}`}>Month / Year</th>
          <th className={`${TH} text-right`}>Actual Basic</th>
          <th className={`${TH} text-right`}>Earned Basic</th>
          <th className={`${TH} text-right`}>Actual Gross</th>
          <th className={`${TH} text-right`}>Earned Gross</th>
          <th className={`${TH} text-right`}>P.F Contribution</th>
          <th className={`${TH} text-right`}>Balance</th>
        </>
      );
  }
}

function ReportRow({
  reportId, columns, row: r, idx, hasOtHours,
}: { reportId: ReportType; columns: string[]; row: Record<string, unknown>; idx: number; hasOtHours: boolean }) {
  const str = (k: string) => String(r[k] ?? "");
  const val = (k: string) => r[k] as number | undefined;

  switch (reportId) {
    case "absent-supp":
      return (
        <>
          <td className={`${TD} font-mono`}>{String(r.sr_no ?? idx + 1)}</td>
          <td className={`${TD} font-mono font-bold text-gray-900 ${STICKY_ID}`}>{str("code")}</td>
          <td className={`${TD} font-medium text-gray-900`}>{str("employee_name")}</td>
          <td className={`${TD} text-gray-600`}>{str("designation")}</td>
          <td className={`${TD} text-gray-600`}>{str("department")}</td>
          <td className={`${TD} text-center font-mono`}>{String(r.absent ?? "")}</td>
          <td className={`${TD} text-center font-mono`}>{String(r.s_days ?? "")}</td>
        </>
      );
    case "allowance-detail":
    case "deduction-detail":
    case "month-wise-deduction": {
      const values = (r.values ?? {}) as Record<string, number>;
      return (
        <>
          <td className={`${TD} font-mono font-bold text-gray-900 ${STICKY_ID}`}>{str("code")}</td>
          <td className={`${TD} font-medium text-gray-900`}>{str("employee_name")}</td>
          {hasOtHours && (
            <td className={`${TD} text-center font-mono bg-amber-50/60`}>
              {r.ot_hours == null ? "" : String(r.ot_hours)}
            </td>
          )}
          {columns.map((c) => (
            <td key={c} className={`${TD} text-right font-mono`}>{money(values[c])}</td>
          ))}
          <td className={`${TD} text-right font-mono font-bold text-indigo-900`}>{money(val("total"))}</td>
        </>
      );
    }
    case "allowance-recon":
    case "deduction-recon":
      return (
        <>
          <td className={`${TD} text-gray-600 font-medium`}>{str("__group")}</td>
          <td className={`${TD} font-mono font-bold text-gray-900 ${STICKY_ID}`}>{str("code")}</td>
          <td className={`${TD} font-medium text-gray-900`}>{str("employee_name")}</td>
          <td className={`${TD} text-right font-mono`}>{money(val("from_amount"))}</td>
          <td className={`${TD} text-right font-mono`}>{money(val("to_amount"))}</td>
          <td className={`${TD} text-right font-mono font-bold`}>{money(val("variance"))}</td>
        </>
      );
    case "bank-advice":
      return (
        <>
          <td className={`${TD} text-gray-600`}>{str("__group")}</td>
          <td className={`${TD} font-mono font-bold text-gray-900 ${STICKY_ID}`}>{str("code")}</td>
          <td className={`${TD} font-medium text-gray-900`}>{str("employee_name")}</td>
          <td className={`${TD} font-mono`}>{str("account_number")}</td>
          <td className={`${TD} text-right font-mono font-bold text-emerald-700`}>{money(val("salary_payable"))}</td>
        </>
      );
    case "active-employees":
      return (
        <>
          <td className={`${TD} font-mono`}>{String(r.sr_no ?? idx + 1)}</td>
          <td className={`${TD} font-mono font-bold text-gray-900 ${STICKY_ID}`}>{str("code")}</td>
          <td className={`${TD} font-medium text-gray-900`}>{str("employee_name")}</td>
          <td className={`${TD} text-gray-600`}>{str("unit")}</td>
          <td className={`${TD} text-gray-600`}>{str("location")}</td>
          <td className={`${TD} text-gray-600`}>{str("grade")}</td>
          <td className={`${TD} text-gray-600`}>{str("designation")}</td>
          <td className={`${TD} text-gray-600`}>{str("department")}</td>
          <td className={`${TD} text-gray-600`}>{str("section")}</td>
          <td className={`${TD} text-gray-600`}>{str("qualification")}</td>
          <td className={`${TD} text-gray-600`}>{str("emp_type")}</td>
          <td className={`${TD} text-gray-600`}>{str("date_of_birth")}</td>
          <td className={`${TD} text-gray-600`}>{str("date_of_joining")}</td>
          <td className={`${TD} text-gray-600`}>{str("date_of_confirm")}</td>
          <td className={`${TD} text-right font-mono font-bold`}>{money(val("gross"))}</td>
        </>
      );
    case "pf-detail":
      return (
        <>
          <td className={`${TD} font-mono`}>{String(r.sr_no ?? idx + 1)}</td>
          <td className={`${TD} font-medium text-gray-900 ${STICKY_ID}`}>{str("month_year")}</td>
          <td className={`${TD} text-right font-mono`}>{money(val("actual_basic"))}</td>
          <td className={`${TD} text-right font-mono`}>{money(val("earned_basic"))}</td>
          <td className={`${TD} text-right font-mono`}>{money(val("actual_gross"))}</td>
          <td className={`${TD} text-right font-mono`}>{money(val("earned_gross"))}</td>
          <td className={`${TD} text-right font-mono`}>{money(val("pf_contribution"))}</td>
          <td className={`${TD} text-right font-mono font-bold`}>{money(val("balance"))}</td>
        </>
      );
  }
}
