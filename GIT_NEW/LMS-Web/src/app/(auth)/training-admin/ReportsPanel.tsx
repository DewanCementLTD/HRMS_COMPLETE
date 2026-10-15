"use client";

import { useEffect, useState } from "react";
import { Play, Printer, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useAuth } from "@/context/AuthContext";
import { printTablePdf } from "@/lib/printTable";
import { hrApi, currentFy, type Hr, type Report, type ReportType, type Department, type EmployeeLite } from "@/services/trainingService";
import { ErrorBox, Empty } from "@/components/training/TrainingUi";

const REPORTS: { id: ReportType; label: string; desc: string; dept: boolean }[] = [
  { id: "conducted", label: "Programs conducted", desc: "Every session with participants, completion, cost and rating", dept: true },
  { id: "employees", label: "Employees trained & hours", desc: "Per employee: trainings, completions, hours, certificates", dept: true },
  { id: "cost", label: "Cost summary", desc: "Cost by department and cost head, with cost per participant", dept: false },
  { id: "assessment", label: "Assessment & impact", desc: "Pre vs post test scores and improvement", dept: true },
  { id: "certificates", label: "Certifications", desc: "Certificates issued", dept: true },
  { id: "trainers", label: "Trainer performance", desc: "Sessions, hours, rating and pass rate per trainer", dept: false },
  { id: "history", label: "Employee training history", desc: "All trainings of one employee", dept: false },
];

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function ReportsPanel({ h }: { h: Hr }) {
  const { user } = useAuth();
  const fy = currentFy();
  const [type, setType] = useState<ReportType>("conducted");
  const [from, setFrom] = useState(`${fy}-07-01`);
  const [to, setTo] = useState(`${fy + 1}-06-30`);
  const [dept, setDept] = useState("");
  const [empcode, setEmpcode] = useState("");
  const [depts, setDepts] = useState<Department[]>([]);
  const [emps, setEmps] = useState<EmployeeLite[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    hrApi.departments(h).then((d) => setDepts(d.items)).catch(() => {});
    hrApi.employees(h).then((e) => setEmps(e.items)).catch(() => {});
  }, [h]);

  const def = REPORTS.find((r) => r.id === type)!;

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setReport(await hrApi.report(h, type, {
        from: type === "history" ? undefined : from, to: type === "history" ? undefined : to,
        dept: def.dept ? dept : undefined, empcode: type === "history" ? empcode : undefined,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  const fmt = (v: string | number | null, i: number) =>
    v == null || v === "" ? "—" : typeof v === "number" && report?.numeric.includes(i) ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v);

  function print() {
    if (!report) return;
    printTablePdf({
      companyName: user?.selected_company?.name, title: report.title,
      meta: type === "history" ? undefined : `${from} to ${to}${dept ? ` · ${depts.find((d) => String(d.dept_no) === dept)?.dept_name ?? ""}` : ""}`,
      landscape: report.columns.length > 7,
      columns: report.columns.map((c, i) => ({ header: c, align: report.numeric.includes(i) ? "right" as const : "left" as const })),
      rows: report.rows.map((r) => r.map((v, i) => fmt(v, i))),
    });
  }

  function csv() {
    if (!report) return;
    const text = [report.columns, ...report.rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" }));
    a.download = `${report.title.replace(/[^\w]+/g, "_")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {REPORTS.map((r) => (
              <button key={r.id} onClick={() => { setType(r.id); setReport(null); }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${type === r.id ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                {r.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500">{def.desc}</p>
          <div className="grid gap-3 sm:grid-cols-4 items-end">
            {type === "history" ? (
              <div className="sm:col-span-2">
                <SearchableSelect label="Employee" value={empcode} onChange={setEmpcode} placeholder="Search employee…"
                  options={emps.map((e) => ({ value: e.empcode, label: `${e.name} (${e.empcode})` }))} />
              </div>
            ) : (
              <>
                <Input label="From (session start)" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </>
            )}
            {def.dept && (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">Department</label>
                <select className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm" value={dept} onChange={(e) => setDept(e.target.value)}>
                  <option value="">All departments</option>
                  {depts.map((d) => <option key={d.dept_no} value={d.dept_no}>{d.dept_name}</option>)}
                </select>
              </div>
            )}
            <Button onClick={run} loading={loading} disabled={type === "history" && !empcode}><Play className="h-4 w-4 mr-1" />Run report</Button>
          </div>
        </CardContent>
      </Card>

      <ErrorBox error={error} />
      {loading && !report ? <Spinner /> : report && (
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <p className="font-semibold text-ink">{report.title}</p>
              <span className="text-xs text-gray-400">{report.rows.length} row(s)</span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="secondary" onClick={csv} disabled={!report.rows.length}><Download className="h-4 w-4 mr-1" />CSV</Button>
                <Button size="sm" variant="secondary" onClick={print} disabled={!report.rows.length}><Printer className="h-4 w-4 mr-1" />Print / PDF</Button>
              </div>
            </div>
            {report.rows.length === 0 ? <Empty>No data for these filters.</Empty> : (
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>{report.columns.map((c, i) => <th key={c} className={`px-3 py-2 whitespace-nowrap ${report.numeric.includes(i) ? "text-right" : "text-left"}`}>{c}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {report.rows.map((r, ri) => (
                      <tr key={ri} className="hover:bg-gray-50/60">
                        {r.map((v, i) => <td key={i} className={`px-3 py-2 ${report.numeric.includes(i) ? "text-right tabular-nums" : "text-gray-700"}`}>{fmt(v, i)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
