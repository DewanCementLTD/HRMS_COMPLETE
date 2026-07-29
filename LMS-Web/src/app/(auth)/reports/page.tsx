"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { FileText, Search, Printer, DollarSign, Users, CheckSquare, Square, Filter } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import * as reportService from "@/services/reportService";
import { ReportPrintSheet, ReportType } from "./ReportPrintSheet";

interface ReportMeta {
  id: ReportType;
  title: string;
  category: "payroll" | "general";
  description: string;
}

const REPORT_CATALOG: ReportMeta[] = [
  // Payroll Reports (Money related)
  { id: "allowance-detail", title: "Employee Allowances Detail Report", category: "payroll", description: "Monthly allowances breakdown (Expenses, LFA, Medical, Overtime) per employee" },
  { id: "allowance-recon", title: "Payroll Reconciliation Detail Report (Allowance)", category: "payroll", description: "Comparative reconciliation of allowances between two periods" },
  { id: "deduction-detail", title: "Employee Deduction Detail Report", category: "payroll", description: "Monthly deductions breakdown (Loans, Advance Salary, Cable, Cell, Electric)" },
  { id: "deduction-recon", title: "Payroll Reconciliation Detail Report (Deduction)", category: "payroll", description: "Comparative reconciliation of deductions between two periods" },
  { id: "month-wise-deduction", title: "Month Wise Deduction Report", category: "payroll", description: "Multi-month deduction tracking across custom date ranges" },
  { id: "bank-advice", title: "Bank Advice Report", category: "payroll", description: "Bank disbursement schedule grouped by Bank & Branch with account details" },
  { id: "pf-detail", title: "P.F Detail Report", category: "payroll", description: "Provident Fund monthly ledger, employer matching, and loan/withdrawal account statement" },

  // General Reports (Non-monetary)
  { id: "absent-supp", title: "Employee Absent and Supplementary Days Report", category: "general", description: "Monthly absent days and supplementary days summary per employee" },
  { id: "active-employees", title: "ALL Active Employee Detail Report", category: "general", description: "Complete roster of active employees with grade, designation, department, qualification & joining dates" },
];

export default function ReportsPage() {
  const { user, activeCompany, activeBranch } = useAuth();
  
  // Tab state
  const [activeCategory, setActiveCategory] = useState<"payroll" | "general">("payroll");
  const [selectedReportId, setSelectedReportId] = useState<ReportType>("allowance-detail");
  
  // Data & loading state
  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  
  // Selection state (Row IDs / Employee codes selected)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  
  // Print Overlay State
  const [showPrintSheet, setShowPrintSheet] = useState(false);

  // Filters state
  const [period, setPeriod] = useState<number>(202607);
  const [subCategory, setSubCategory] = useState<string>("L.F.A");

  // Filter available reports based on active top-level category
  const categoryReports = useMemo(() => {
    return REPORT_CATALOG.filter((r) => r.category === activeCategory);
  }, [activeCategory]);

  // Ensure selectedReportId stays valid when category changes
  useEffect(() => {
    if (!categoryReports.some((r) => r.id === selectedReportId)) {
      setSelectedReportId(categoryReports[0].id);
    }
  }, [activeCategory, categoryReports, selectedReportId]);

  const activeReportMeta = useMemo(() => {
    return REPORT_CATALOG.find((r) => r.id === selectedReportId) || REPORT_CATALOG[0];
  }, [selectedReportId]);

  // Fetch report data from API
  const loadReport = useCallback(async () => {
    if (!user?.hr_admin) return;
    setLoading(true);
    setReportData(null);
    setSelectedKeys(new Set());
    try {
      const params = {
        compc: activeCompany || undefined,
        brnch: activeBranch || undefined,
        period: period,
      };

      let res: any;
      switch (selectedReportId) {
        case "absent-supp":
          res = await reportService.fetchAbsentSuppReport(user.card_no, params);
          break;
        case "allowance-detail":
          res = await reportService.fetchAllowanceDetailReport(user.card_no, params);
          break;
        case "allowance-recon":
          res = await reportService.fetchAllowanceReconReport(user.card_no, params);
          break;
        case "deduction-detail":
          res = await reportService.fetchDeductionDetailReport(user.card_no, params);
          break;
        case "deduction-recon":
          res = await reportService.fetchDeductionReconReport(user.card_no, params);
          break;
        case "month-wise-deduction":
          res = await reportService.fetchMonthWiseDeductionReport(user.card_no, params);
          break;
        case "bank-advice":
          res = await reportService.fetchBankAdviceReport(user.card_no, params);
          break;
        case "active-employees":
          res = await reportService.fetchActiveEmployeesReport(user.card_no, params);
          break;
        case "pf-detail":
          res = await reportService.fetchPfDetailReport(user.card_no, params);
          break;
      }
      setReportData(res?.data || null);
    } catch (err) {
      console.error("Failed to load report", err);
    } finally {
      setLoading(false);
    }
  }, [user?.card_no, user?.hr_admin, selectedReportId, activeCompany, activeBranch, period]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  // Rows extraction
  const rawRows: any[] = useMemo(() => {
    if (!reportData) return [];
    if (Array.isArray(reportData)) return reportData;
    if (reportData.ledger) return reportData.ledger;
    return [];
  }, [reportData]);

  // Filtered rows by search query
  const filteredRows = useMemo(() => {
    if (!query.trim()) return rawRows;
    const q = query.toLowerCase();
    return rawRows.filter((r) => {
      const code = String(r.code || r.sr_no || "").toLowerCase();
      const name = String(r.employee_name || r.month_year || "").toLowerCase();
      return code.includes(q) || name.includes(q);
    });
  }, [rawRows, query]);

  // Selection handlers
  const getRowKey = (r: any, idx: number) => String(r.code || r.sr_no || idx);

  const toggleSelectRow = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allFilteredSelected = useMemo(() => {
    return filteredRows.length > 0 && filteredRows.every((r, idx) => selectedKeys.has(getRowKey(r, idx)));
  }, [filteredRows, selectedKeys]);

  const toggleSelectAll = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredRows.forEach((r, idx) => next.delete(getRowKey(r, idx)));
      } else {
        filteredRows.forEach((r, idx) => next.add(getRowKey(r, idx)));
      }
      return next;
    });
  };

  // Selected dataset for report generation
  const printableData = useMemo(() => {
    if (selectedKeys.size === 0) return reportData; // If none selected, generate all
    if (Array.isArray(reportData)) {
      return reportData.filter((r, idx) => selectedKeys.has(getRowKey(r, idx)));
    }
    if (reportData?.ledger) {
      return {
        ...reportData,
        ledger: reportData.ledger.filter((r: any, idx: number) => selectedKeys.has(getRowKey(r, idx))),
      };
    }
    return reportData;
  }, [reportData, selectedKeys]);

  // Guard for HR access
  if (!user?.hr_admin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900">Access Denied</h2>
          <p className="text-gray-500 mt-2">You don&apos;t have HR admin privileges.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6 pb-12">
      {/* Printable Report PDF Overlay Sheet */}
      {showPrintSheet && (
        <ReportPrintSheet
          reportType={selectedReportId}
          reportTitle={activeReportMeta.title}
          data={printableData}
          subCategory={subCategory}
          onClose={() => setShowPrintSheet(false)}
        />
      )}

      <PageHeader
        title="HR & Payroll Reports"
        subtitle="Consolidated monetary and general administrative reports with pixel-perfect PDF export"
      />

      {/* Primary Category Tabs: Payroll Reports vs General Reports */}
      <div className="flex items-center gap-4 border-b border-gray-200 pb-1">
        <button
          onClick={() => setActiveCategory("payroll")}
          className={`flex items-center gap-2 px-4 py-2.5 font-medium text-sm rounded-t-lg transition-all ${
            activeCategory === "payroll"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
          }`}
        >
          <DollarSign className="h-4 w-4" /> Payroll Reports (Monetary)
        </button>
        <button
          onClick={() => setActiveCategory("general")}
          className={`flex items-center gap-2 px-4 py-2.5 font-medium text-sm rounded-t-lg transition-all ${
            activeCategory === "general"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
          }`}
        >
          <Users className="h-4 w-4" /> General Reports (Non-Monetary)
        </button>
      </div>

      {/* Secondary Report Selector (Pills) */}
      <div className="flex flex-wrap gap-2 bg-gray-50 p-2 rounded-xl border border-gray-200">
        {categoryReports.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelectedReportId(r.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all text-left ${
              selectedReportId === r.id
                ? "bg-white text-indigo-700 shadow-sm border border-indigo-200 font-semibold"
                : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/60"
            }`}
          >
            {r.title}
          </button>
        ))}
      </div>

      {/* Active Report Header Card & Filter Options */}
      <Card className="border border-gray-200 shadow-sm">
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-gray-900">{activeReportMeta.title}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{activeReportMeta.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => setShowPrintSheet(true)}
                disabled={loading || !reportData}
                className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
              >
                <Printer className="h-4 w-4" /> Generate Report ({selectedKeys.size > 0 ? selectedKeys.size : "All"})
              </Button>
            </div>
          </div>

          {/* Dynamic Filter Controls Bar */}
          <div className="flex flex-wrap items-center gap-4 pt-1 bg-gray-50/80 p-3 rounded-lg border border-gray-100 text-xs">
            <div className="flex items-center gap-1.5 text-gray-700 font-medium">
              <Filter className="h-3.5 w-3.5 text-indigo-600" /> Filters:
            </div>

            {/* Period Selector */}
            <div className="flex items-center gap-1.5">
              <label className="text-gray-500">Period:</label>
              <select
                className="bg-white border border-gray-300 rounded px-2 py-1 outline-none text-xs font-medium"
                value={period}
                onChange={(e) => setPeriod(Number(e.target.value))}
              >
                <option value={202607}>Jul-2026</option>
                <option value={202606}>Jun-2026</option>
                <option value={202605}>May-2026</option>
                <option value={202604}>Apr-2026</option>
              </select>
            </div>

            {/* Sub-Category / Allowance / Deduction Selector */}
            {(selectedReportId === "allowance-recon" || selectedReportId === "deduction-recon") && (
              <div className="flex items-center gap-1.5">
                <label className="text-gray-500">Type:</label>
                <select
                  className="bg-white border border-gray-300 rounded px-2 py-1 outline-none text-xs font-medium"
                  value={subCategory}
                  onChange={(e) => setSubCategory(e.target.value)}
                >
                  {selectedReportId === "allowance-recon" ? (
                    <>
                      <option value="L.F.A">L.F.A</option>
                      <option value="MEDICAL">MEDICAL</option>
                      <option value="EXPENSES REIMBURS">EXPENSES REIMBURS</option>
                      <option value="OVER TIME">OVER TIME</option>
                    </>
                  ) : (
                    <>
                      <option value="ADVANCE LOAN">ADVANCE LOAN</option>
                      <option value="ADVANCE SALARY">ADVANCE SALARY</option>
                      <option value="CABLE CHARGES">CABLE CHARGES</option>
                      <option value="CELL PHONE">CELL PHONE</option>
                      <option value="ELECTRIC CHARGES">ELECTRIC CHARGES</option>
                    </>
                  )}
                </select>
              </div>
            )}

            {/* Quick Search Input */}
            <div className="ml-auto flex items-center gap-2 bg-white border border-gray-300 rounded-lg px-2.5 py-1 w-full max-w-xs">
              <Search className="h-3.5 w-3.5 text-gray-400 shrink-0" />
              <input
                className="bg-transparent text-xs outline-none w-full placeholder:text-gray-400"
                placeholder="Search code or name..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Interactive Table Card */}
      <Card className="border border-gray-200 shadow-sm overflow-hidden">
        {/* Table Action Bar (Select All / Action Buttons) */}
        <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-1.5 font-medium text-gray-700 hover:text-indigo-700 transition-colors"
            >
              {allFilteredSelected ? (
                <CheckSquare className="h-4 w-4 text-indigo-600" />
              ) : (
                <Square className="h-4 w-4 text-gray-400" />
              )}
              Select All Visible ({filteredRows.length})
            </button>
            {selectedKeys.size > 0 && (
              <span className="bg-indigo-100 text-indigo-800 text-[11px] px-2 py-0.5 rounded-full font-semibold">
                {selectedKeys.size} selected
              </span>
            )}
          </div>
        </div>

        {/* Table Content */}
        {loading ? (
          <div className="flex items-center justify-center p-12 text-gray-500 gap-3">
            <Spinner className="h-5 w-5 text-indigo-600" />
            <span className="text-sm font-medium">Loading report records...</span>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <FileText className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-medium">No records found matching your filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100/80 text-gray-700 font-bold border-b border-gray-200">
                  <th className="p-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </th>
                  {/* Dynamic Column Headers depending on selected report */}
                  {selectedReportId === "absent-supp" && (
                    <>
                      <th className="p-3 w-16">Sr.#</th>
                      <th className="p-3 w-24">Code</th>
                      <th className="p-3">Employee Name</th>
                      <th className="p-3">Designation</th>
                      <th className="p-3 text-center">Absent Days</th>
                      <th className="p-3 text-center">S.Days</th>
                    </>
                  )}
                  {selectedReportId === "allowance-detail" && (
                    <>
                      <th className="p-3 w-24">Code</th>
                      <th className="p-3">Employee Name</th>
                      <th className="p-3 text-center">OT Hours</th>
                      <th className="p-3 text-right">Expenses Reimburs</th>
                      <th className="p-3 text-right">L.F.A</th>
                      <th className="p-3 text-right">Medical</th>
                      <th className="p-3 text-right">Over Time</th>
                      <th className="p-3 text-right font-extrabold text-indigo-900">Total</th>
                    </>
                  )}
                  {selectedReportId === "allowance-recon" && (
                    <>
                      <th className="p-3 w-24">Code</th>
                      <th className="p-3">Employee Name</th>
                      <th className="p-3 text-right">Month 1 (Jun)</th>
                      <th className="p-3 text-right">Month 2 (Jul)</th>
                      <th className="p-3 text-right font-bold">Variance</th>
                    </>
                  )}
                  {selectedReportId === "deduction-detail" && (
                    <>
                      <th className="p-3 w-24">Code</th>
                      <th className="p-3">Employee Name</th>
                      <th className="p-3 text-right">Advance Loan</th>
                      <th className="p-3 text-right">Advance Salary</th>
                      <th className="p-3 text-right">Cable Charges</th>
                      <th className="p-3 text-right">Cell Phone</th>
                      <th className="p-3 text-right">Electric Charges</th>
                      <th className="p-3 text-right font-extrabold text-indigo-900">Total</th>
                    </>
                  )}
                  {selectedReportId === "deduction-recon" && (
                    <>
                      <th className="p-3 w-24">Code</th>
                      <th className="p-3">Employee Name</th>
                      <th className="p-3 text-right">Month 1 (Jun)</th>
                      <th className="p-3 text-right">Month 2 (Jul)</th>
                      <th className="p-3 text-right font-bold">Variance</th>
                    </>
                  )}
                  {selectedReportId === "month-wise-deduction" && (
                    <>
                      <th className="p-3 w-24">Code</th>
                      <th className="p-3">Employee Name</th>
                      <th className="p-3 text-right">Apr-2026</th>
                      <th className="p-3 text-right">May-2026</th>
                      <th className="p-3 text-right">Jun-2026</th>
                      <th className="p-3 text-right font-bold">Total</th>
                    </>
                  )}
                  {selectedReportId === "bank-advice" && (
                    <>
                      <th className="p-3 w-16 text-center">SR.#</th>
                      <th className="p-3 w-24">Code</th>
                      <th className="p-3">Employee Name</th>
                      <th className="p-3">Account Number</th>
                      <th className="p-3 text-right font-bold">Salary Payable</th>
                    </>
                  )}
                  {selectedReportId === "active-employees" && (
                    <>
                      <th className="p-3 w-12 text-center">S.#</th>
                      <th className="p-3 w-20">Code</th>
                      <th className="p-3">Employee Name</th>
                      <th className="p-3">Grade</th>
                      <th className="p-3">Designation</th>
                      <th className="p-3">Department</th>
                      <th className="p-3">Type</th>
                      <th className="p-3 text-right font-bold">Gross</th>
                    </>
                  )}
                  {selectedReportId === "pf-detail" && (
                    <>
                      <th className="p-3 w-16 text-center">S.No</th>
                      <th className="p-3">Month / Year</th>
                      <th className="p-3 text-right">Actual Basic</th>
                      <th className="p-3 text-right">Earned Basic</th>
                      <th className="p-3 text-right">Earned Gross</th>
                      <th className="p-3 text-right">P.F Contribution</th>
                      <th className="p-3 text-right font-bold">Balance</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredRows.map((r: any, idx: number) => {
                  const key = getRowKey(r, idx);
                  const isChecked = selectedKeys.has(key);
                  return (
                    <tr
                      key={key}
                      onClick={() => toggleSelectRow(key)}
                      className={`cursor-pointer transition-colors ${
                        isChecked ? "bg-indigo-50/70" : "hover:bg-gray-50"
                      }`}
                    >
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectRow(key)}
                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>

                      {selectedReportId === "absent-supp" && (
                        <>
                          <td className="p-3 font-mono">{r.sr_no || idx + 1}</td>
                          <td className="p-3 font-mono font-bold text-gray-900">{r.code}</td>
                          <td className="p-3 font-medium text-gray-900">{r.employee_name}</td>
                          <td className="p-3 text-gray-600">{r.designation}</td>
                          <td className="p-3 text-center font-mono">{r.absent}</td>
                          <td className="p-3 text-center font-mono">{r.s_days}</td>
                        </>
                      )}

                      {selectedReportId === "allowance-detail" && (
                        <>
                          <td className="p-3 font-mono font-bold text-gray-900">{r.code}</td>
                          <td className="p-3 font-medium text-gray-900">{r.employee_name}</td>
                          <td className="p-3 text-center font-mono bg-amber-50/50">{r.ot_hours || 0}</td>
                          <td className="p-3 text-right font-mono">{r.expenses_reimburs != null ? r.expenses_reimburs.toLocaleString() : "-"}</td>
                          <td className="p-3 text-right font-mono">{r.lfa != null ? r.lfa.toLocaleString() : "-"}</td>
                          <td className="p-3 text-right font-mono">{r.medical != null ? r.medical.toLocaleString() : "-"}</td>
                          <td className="p-3 text-right font-mono">{r.over_time != null ? r.over_time.toLocaleString() : "-"}</td>
                          <td className="p-3 text-right font-mono font-bold text-indigo-900 bg-indigo-50/30">{r.total != null ? r.total.toLocaleString() : "-"}</td>
                        </>
                      )}

                      {selectedReportId === "allowance-recon" && (
                        <>
                          <td className="p-3 font-mono font-bold text-gray-900">{r.code}</td>
                          <td className="p-3 font-medium text-gray-900">{r.employee_name}</td>
                          <td className="p-3 text-right font-mono">{r.month1_amount != null ? r.month1_amount.toLocaleString() : "-"}</td>
                          <td className="p-3 text-right font-mono">{r.month2_amount != null ? r.month2_amount.toLocaleString() : "-"}</td>
                          <td className="p-3 text-right font-mono font-bold">{r.variance != null ? r.variance.toLocaleString() : "-"}</td>
                        </>
                      )}

                      {selectedReportId === "deduction-detail" && (
                        <>
                          <td className="p-3 font-mono font-bold text-gray-900">{r.code}</td>
                          <td className="p-3 font-medium text-gray-900">{r.employee_name}</td>
                          <td className="p-3 text-right font-mono">{r.advance_loan != null ? r.advance_loan.toLocaleString() : "-"}</td>
                          <td className="p-3 text-right font-mono">{r.advance_salary != null ? r.advance_salary.toLocaleString() : "-"}</td>
                          <td className="p-3 text-right font-mono">{r.cable_charges != null ? r.cable_charges.toLocaleString() : "-"}</td>
                          <td className="p-3 text-right font-mono">{r.cell_phone != null ? r.cell_phone.toLocaleString() : "-"}</td>
                          <td className="p-3 text-right font-mono">{r.electric_charges != null ? r.electric_charges.toLocaleString() : "-"}</td>
                          <td className="p-3 text-right font-mono font-bold text-indigo-900 bg-indigo-50/30">{r.total != null ? r.total.toLocaleString() : "-"}</td>
                        </>
                      )}

                      {selectedReportId === "deduction-recon" && (
                        <>
                          <td className="p-3 font-mono font-bold text-gray-900">{r.code}</td>
                          <td className="p-3 font-medium text-gray-900">{r.employee_name}</td>
                          <td className="p-3 text-right font-mono">{r.month1_amount != null ? r.month1_amount.toLocaleString() : "-"}</td>
                          <td className="p-3 text-right font-mono">{r.month2_amount != null ? r.month2_amount.toLocaleString() : "-"}</td>
                          <td className="p-3 text-right font-mono font-bold">{r.variance != null ? r.variance.toLocaleString() : "-"}</td>
                        </>
                      )}

                      {selectedReportId === "month-wise-deduction" && (
                        <>
                          <td className="p-3 font-mono font-bold text-gray-900">{r.code}</td>
                          <td className="p-3 font-medium text-gray-900">{r.employee_name}</td>
                          <td className="p-3 text-right font-mono">{r.month1_amount != null ? r.month1_amount.toLocaleString() : "-"}</td>
                          <td className="p-3 text-right font-mono">{r.month2_amount != null ? r.month2_amount.toLocaleString() : "-"}</td>
                          <td className="p-3 text-right font-mono">{r.month3_amount != null ? r.month3_amount.toLocaleString() : "-"}</td>
                          <td className="p-3 text-right font-mono font-bold">{r.total != null ? r.total.toLocaleString() : "-"}</td>
                        </>
                      )}

                      {selectedReportId === "bank-advice" && (
                        <>
                          <td className="p-3 text-center font-mono">{r.sr_no || idx + 1}</td>
                          <td className="p-3 font-mono font-bold text-gray-900">{r.code}</td>
                          <td className="p-3 font-medium text-gray-900">{r.employee_name}</td>
                          <td className="p-3 font-mono">{r.account_number}</td>
                          <td className="p-3 text-right font-mono font-bold text-emerald-700">{r.salary_payable != null ? r.salary_payable.toLocaleString() : "-"}</td>
                        </>
                      )}

                      {selectedReportId === "active-employees" && (
                        <>
                          <td className="p-3 text-center font-mono">{r.sr_no || idx + 1}</td>
                          <td className="p-3 font-mono font-bold text-gray-900">{r.code}</td>
                          <td className="p-3 font-medium text-gray-900">{r.employee_name}</td>
                          <td className="p-3 text-gray-600">{r.grade}</td>
                          <td className="p-3 text-gray-600">{r.designation}</td>
                          <td className="p-3 text-gray-600">{r.department}</td>
                          <td className="p-3 text-gray-600">{r.type}</td>
                          <td className="p-3 text-right font-mono font-bold">{r.gross != null ? r.gross.toLocaleString() : "-"}</td>
                        </>
                      )}

                      {selectedReportId === "pf-detail" && (
                        <>
                          <td className="p-3 text-center font-mono">{r.sr_no || idx + 1}</td>
                          <td className="p-3 font-medium text-gray-900">{r.month_year}</td>
                          <td className="p-3 text-right font-mono">{r.actual_basic?.toLocaleString() || "-"}</td>
                          <td className="p-3 text-right font-mono">{r.earned_basic?.toLocaleString() || "-"}</td>
                          <td className="p-3 text-right font-mono">{r.earned_gross?.toLocaleString() || "-"}</td>
                          <td className="p-3 text-right font-mono">{r.pf_contribution ? r.pf_contribution.toLocaleString() : "-"}</td>
                          <td className="p-3 text-right font-mono font-bold">{r.balance ? r.balance.toLocaleString() : "-"}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
