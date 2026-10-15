"use client";

import { useEffect, useState } from "react";
import { Play, Printer, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { printTablePdf } from "@/lib/printTable";
import type { Department } from "@/services/trainingService";
import { apprHrApi, type Hr, type Cycle, type Report } from "@/services/appraisalService";
import { ErrorBox, Empty } from "@/components/training/TrainingUi";

const REPORTS: { id: string; label: string; desc: string; dept?: boolean; noCycle?: boolean }[] = [
  { id: "employees", label: "Employee performance", desc: "Every task sheet of the cycle: self total, agreed Total \"A\", HOD grade, HR grade, final grade, sign-off", dept: true },
  { id: "departments", label: "Department performance", desc: "Average, lowest and highest Total \"A\" per department, ranked" },
  { id: "distribution", label: "Bell curve", desc: "Grade distribution against the company standard, with the HODs' grades", dept: true },
  { id: "promotion_cases", label: "Promotion evaluations", desc: "Eligibility, competency %, performance %, overall %, decision band and status" },
  { id: "promotions", label: "Promotion recommendations", desc: "Proposed designations and their status" },
  { id: "increments", label: "Increment summary", desc: "Recommended increments, new gross and status" },
  { id: "top", label: "Top performers", desc: "Highest Total \"A\"" },
  { id: "low", label: "Low performers", desc: "Lowest Total \"A\"" },
  { id: "trend", label: "Performance trend", desc: "Each employee's grades across all completed cycles", dept: true, noCycle: true },
];

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const fmt = (v: unknown) => (v == null || v === "" ? "—" : typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v));

export function ReportsPanel({ h }: { h: Hr }) {
  const { user } = useAuth();
  const [type, setType] = useState("employees");
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [depts, setDepts] = useState<Department[]>([]);
  const [dept, setDept] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apprHrApi.cycles(h).then((r) => {
      const usable = r.items.filter((c) => c.status !== "DRAFT");
      setCycles(usable);
      if (usable[0]) setCycleId(String((usable.find((c) => c.status === "ACTIVE") ?? usable[0]).cycle_id));
    }).catch(() => {});
    apprHrApi.lookups(h).then((l) => setDepts(l.departments)).catch(() => {});
  }, [h]);

  const def = REPORTS.find((r) => r.id === type)!;

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setReport(await apprHrApi.report(h, type, { cycle_id: def.noCycle ? undefined : cycleId, dept: def.dept ? dept : undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  const numericCol = (key: string) => (report?.rows ?? []).some((r) => typeof r[key] === "number");

  function print() {
    if (!report) return;
    printTablePdf({
      companyName: user?.selected_company?.name, title: report.title,
      meta: [report.cycle?.name, dept ? depts.find((d) => String(d.dept_no) === dept)?.dept_name : ""].filter(Boolean).join(" · ") || undefined,
      landscape: report.columns.length > 7,
      columns: report.columns.map((c) => ({ header: c.label, align: numericCol(c.key) ? "right" as const : "left" as const })),
      rows: report.rows.map((r) => report.columns.map((c) => fmt(r[c.key]))),
    });
  }

  function csv() {
    if (!report) return;
    const text = [report.columns.map((c) => c.label), ...report.rows.map((r) => report.columns.map((c) => r[c.key] ?? ""))]
      .map((r) => r.map(csvCell).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" }));
    a.download = `${report.title.replace(/[^\w]+/g, "_")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  return (
    <div className="space-y-4">
      <Card><CardContent className="py-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {REPORTS.map((r) => (
            <button key={r.id} onClick={() => { setType(r.id); setReport(null); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${type === r.id ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
              {r.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">{def.desc}</p>
        <div className="flex flex-wrap gap-3 items-end">
          {!def.noCycle && (
            <div className="space-y-1.5"><label className="block text-sm font-medium text-gray-700">Cycle</label>
              <select className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm min-w-56" value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
                {cycles.map((c) => <option key={c.cycle_id} value={c.cycle_id}>{c.name}</option>)}
              </select></div>
          )}
          {def.dept && (
            <div className="space-y-1.5"><label className="block text-sm font-medium text-gray-700">Department</label>
              <select className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm" value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">All departments</option>{depts.map((d) => <option key={d.dept_no} value={d.dept_no}>{d.dept_name}</option>)}
              </select></div>
          )}
          <Button onClick={run} loading={loading} disabled={!def.noCycle && !cycleId}><Play className="h-4 w-4 mr-1" />Run report</Button>
        </div>
      </CardContent></Card>

      <ErrorBox error={error} />
      {loading && !report ? <Spinner /> : report && (
        <Card><CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <p className="font-semibold text-ink">{report.title}</p>
            {report.cycle && <span className="text-xs text-gray-400">{report.cycle.name}</span>}
            <span className="text-xs text-gray-400">{report.rows.length} row(s)</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" onClick={csv} disabled={!report.rows.length}><Download className="h-4 w-4 mr-1" />CSV</Button>
              <Button size="sm" variant="secondary" onClick={print} disabled={!report.rows.length}><Printer className="h-4 w-4 mr-1" />Print / PDF</Button>
            </div>
          </div>
          {!!report.warnings?.length && (
            <div className="mb-3 p-2.5 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800">{report.warnings.map((w) => <p key={w}>▲ {w}</p>)}</div>
          )}
          {report.rows.length === 0 ? <Empty>No data.</Empty> : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>{report.columns.map((c) => <th key={c.key} className={`px-3 py-2 whitespace-nowrap ${numericCol(c.key) ? "text-right" : "text-left"}`}>{c.label}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {report.rows.map((r, ri) => (
                    <tr key={ri} className="hover:bg-gray-50/60">
                      {report.columns.map((c) => <td key={c.key} className={`px-3 py-2 ${numericCol(c.key) ? "text-right tabular-nums" : "text-gray-700"}`}>{fmt(r[c.key])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent></Card>
      )}
    </div>
  );
}
