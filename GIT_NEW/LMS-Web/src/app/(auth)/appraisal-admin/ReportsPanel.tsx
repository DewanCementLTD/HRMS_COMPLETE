"use client";

import { useEffect, useMemo, useState } from "react";
import { Play, Printer, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { printTablePdf } from "@/lib/printTable";
import type { Department } from "@/services/trainingService";
import { apprHrApi, type Hr, type Cycle, type Report } from "@/services/appraisalService";
import { ErrorBox, Empty } from "@/components/training/TrainingUi";
import { CompanyPicker, ALL_COMPANIES } from "../reports/ReportFilterBar";

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

const deptKey = (name: string) => name.trim().toUpperCase();

export function ReportsPanel({ h }: { h: Hr }) {
  const { user } = useAuth();
  const companies = useMemo(() => user?.company_list ?? [], [user?.company_list]);
  // Report scope: one company code, a comma list, or ALL_COMPANIES. Starts on the top-bar company.
  const [company, setCompany] = useState(() => h.compc || String(companies[0]?.code ?? ""));
  const picked = useMemo(() => {
    const codes = companies.map((c) => String(c.code));
    if (company === ALL_COMPANIES) return codes;
    const list = company.split(",").filter((c) => codes.includes(c));
    if (list.length) return list;
    return h.compc ? [h.compc] : codes.slice(0, 1);
  }, [company, companies, h.compc]);
  const multi = picked.length > 1;
  const companyName = (code: string) => companies.find((c) => String(c.code) === code)?.name ?? code;

  const [type, setType] = useState("employees");
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [cycleId, setCycleId] = useState("");
  // Departments per company: codes differ between companies, so the filter works by department name.
  const [deptsBy, setDeptsBy] = useState<Record<string, Department[]>>({});
  const [dept, setDept] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickedKey = picked.join(",");
  useEffect(() => {
    let live = true;
    const codes = pickedKey.split(",").filter(Boolean);
    Promise.all(codes.map((code) => apprHrApi.cycles({ ...h, compc: code }).then((r) => r.items).catch(() => [] as Cycle[])))
      .then((lists) => {
        if (!live) return;
        // The same CYCLE_ID in several companies is one cycle (copied by trigger), so list it once.
        const byId = new Map<number, Cycle>();
        for (const c of lists.flat()) if (c.status !== "DRAFT" && !byId.has(c.cycle_id)) byId.set(c.cycle_id, c);
        const usable = [...byId.values()].sort((a, b) => (b.period_to ?? "").localeCompare(a.period_to ?? "") || b.cycle_id - a.cycle_id);
        setCycles(usable);
        setCycleId((cur) => {
          if (usable.some((c) => String(c.cycle_id) === cur)) return cur;
          const first = usable.find((c) => c.status === "ACTIVE") ?? usable[0];
          return first ? String(first.cycle_id) : "";
        });
      });
    Promise.all(codes.map((code) => apprHrApi.lookups({ ...h, compc: code })
      .then((l): [string, Department[]] => [code, l.departments])
      .catch((): [string, Department[]] => [code, []])))
      .then((pairs) => { if (live) setDeptsBy(Object.fromEntries(pairs)); });
    return () => { live = false; };
  }, [h, pickedKey]);

  const deptOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const list of Object.values(deptsBy)) {
      for (const d of list) if (!names.has(deptKey(d.dept_name))) names.set(deptKey(d.dept_name), d.dept_name);
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [deptsBy]);
  const deptValue = deptOptions.some((n) => deptKey(n) === deptKey(dept)) ? dept : "";

  const def = REPORTS.find((r) => r.id === type)!;

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const parts = await Promise.all(picked.map(async (code) => {
        let deptNo: string | undefined;
        if (def.dept && deptValue) {
          const d = (deptsBy[code] ?? []).find((x) => deptKey(x.dept_name) === deptKey(deptValue));
          if (!d) return null; // this company has no such department
          deptNo = String(d.dept_no);
        }
        const r = await apprHrApi.report({ ...h, compc: code }, type, { cycle_id: def.noCycle ? undefined : cycleId, dept: deptNo });
        return { code, r };
      }));
      const got = parts.filter((p): p is { code: string; r: Report } => !!p);
      if (!multi) {
        setReport(got[0]?.r ?? { title: def.label, cycle: null, columns: [], rows: [] });
        return;
      }
      const base = got.find((p) => p.r.columns.length) ?? got[0];
      setReport({
        title: base?.r.title ?? def.label,
        cycle: got.find((p) => p.r.cycle)?.r.cycle ?? null,
        columns: base?.r.columns.length ? [{ key: "company", label: "Company" }, ...base.r.columns] : [],
        rows: got.flatMap((p) => p.r.rows.map((row) => ({ company: companyName(p.code), ...row }))),
        warnings: got.flatMap((p) => (p.r.warnings ?? []).map((w) => `${companyName(p.code)}: ${w}`)),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  const scopeName = company === ALL_COMPANIES && multi ? "All Companies" : picked.map(companyName).join(", ");

  const numericCol = (key: string) => (report?.rows ?? []).some((r) => typeof r[key] === "number");

  function print() {
    if (!report) return;
    printTablePdf({
      companyName: scopeName || user?.selected_company?.name, title: report.title,
      meta: [report.cycle?.name, def.dept ? deptValue : ""].filter(Boolean).join(" · ") || undefined,
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
          {companies.length > 1 && (
            <div className="space-y-1.5"><label className="block text-sm font-medium text-gray-700">Company</label>
              <div className="px-3 py-2 rounded-xl border border-gray-300 text-sm min-w-56 bg-white">
                <CompanyPicker companies={companies} value={multi ? company : picked[0] ?? ""}
                  onChange={(v) => { setCompany(v); setReport(null); }} />
              </div></div>
          )}
          {!def.noCycle && (
            <div className="space-y-1.5"><label className="block text-sm font-medium text-gray-700">Cycle</label>
              <select className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm min-w-56" value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
                {cycles.map((c) => <option key={c.cycle_id} value={c.cycle_id}>{c.name}</option>)}
              </select></div>
          )}
          {def.dept && (
            <div className="space-y-1.5"><label className="block text-sm font-medium text-gray-700">Department</label>
              <select className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm" value={deptValue} onChange={(e) => setDept(e.target.value)}>
                <option value="">All departments</option>{deptOptions.map((n) => <option key={n} value={n}>{n}</option>)}
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
            {multi && <span className="text-xs text-indigo-600">{scopeName}</span>}
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
