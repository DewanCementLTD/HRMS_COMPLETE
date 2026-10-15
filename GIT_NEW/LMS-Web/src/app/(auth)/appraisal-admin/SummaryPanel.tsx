"use client";

import { useCallback, useEffect, useState } from "react";
import { Printer, Download, Pencil } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { printTablePdf } from "@/lib/printTable";
import { ErrorBox, Empty, Pill } from "@/components/training/TrainingUi";
import { GradeBadge } from "@/components/appraisal/AppraisalUi";
import {
  apprHrApi, CATEGORY_LABEL, type Hr, type Cycle, type SummarySheet, type SummaryEmployee, type Category,
} from "@/services/appraisalService";

const COLS: { key: keyof SummaryEmployee; label: string; num?: boolean }[] = [
  { key: "empcode", label: "E.Code" }, { key: "name", label: "Employee name" }, { key: "age", label: "Age", num: true },
  { key: "doa", label: "D.O.A" }, { key: "desg_desc", label: "Designation" }, { key: "grade_title", label: "Grade title" },
  { key: "grade", label: "Grade" }, { key: "dept_name", label: "Department" }, { key: "qualification", label: "Qualification" },
  { key: "exp_dcl", label: "Experience in DCL", num: true }, { key: "prior_exp", label: "Prior experience", num: true },
  { key: "total_exp", label: "Total experience", num: true }, { key: "location", label: "Location" }, { key: "resource_type", label: "Resource type" },
  { key: "rating", label: "Rating this year" }, { key: "promotion", label: "Promotion recommendation" }, { key: "remarks", label: "Remarks" },
];
const CATS: Category[] = ["FULL", "PRORATA", "PROBATION", "TE_MTO"];
const cell = (e: SummaryEmployee, k: keyof SummaryEmployee) => {
  const v = e[k];
  if (k === "rating") return e.rating ?? e.stage_label;
  return v == null || v === "" ? "" : String(v);
};
const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** "Performance Appraisal Summary Sheet" (DCL) — per department and cycle. */
export function SummaryPanel({ h }: { h: Hr }) {
  const { user } = useAuth();
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [dept, setDept] = useState("");
  const [data, setData] = useState<SummarySheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<SummaryEmployee | null>(null);

  useEffect(() => {
    apprHrApi.cycles(h).then((r) => {
      const usable = r.items.filter((c) => c.status !== "DRAFT");
      setCycles(usable);
      const act = usable.find((c) => c.status === "ACTIVE") ?? usable[0];
      if (act) setCycleId(String(act.cycle_id));
    }).catch(() => {});
  }, [h]);
  const load = useCallback(() => {
    if (!cycleId) return;
    apprHrApi.summary(h, cycleId, dept || undefined).then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [h, cycleId, dept]);
  useEffect(() => { load(); }, [load]);

  const title = data?.cycle ? `Performance Appraisal Summary Sheet — ${data.cycle.name}` : "Performance Appraisal Summary Sheet";

  function print() {
    if (!data) return;
    printTablePdf({
      companyName: user?.selected_company?.name, title, landscape: true,
      meta: `${data.dept_name} · strength ${data.totals.strength} · eligible ${data.totals.eligible} · graded ${data.totals.graded}`,
      columns: ["Sr", ...COLS.map((c) => ({ header: c.label, align: c.num ? "right" as const : "left" as const }))],
      rows: CATS.flatMap((k) => [
        [`${CATEGORY_LABEL[k]} (${data.lists[k].length})`, ...COLS.map(() => "")],
        ...data.lists[k].map((e, i) => [i + 1, ...COLS.map((c) => cell(e, c.key))]),
      ]),
    });
  }
  function printBell() {
    if (!data) return;
    printTablePdf({
      companyName: user?.selected_company?.name, title: `${title} — bell curve`, meta: data.dept_name,
      columns: ["Rating", { header: "Total # in rating", align: "right" }, { header: "Bell curve standard", align: "right" },
        { header: "Standard #", align: "right" }, { header: "Actual HOD recommendation", align: "right" }, "Remarks"],
      rows: [
        ...data.bell.map((b) => [`${b.label} ${b.description}`, b.count, `${b.target_pct ?? "—"}%`, b.standard_count ?? "", b.hod_count, b.remark]),
        ["Total employees", data.totals.graded, "100%", data.totals.graded, data.bell.reduce((t, b) => t + b.hod_count, 0), ""],
      ],
    });
  }
  function csv() {
    if (!data) return;
    const lines = [["Category", "Sr", ...COLS.map((c) => c.label)].map(csvCell).join(",")];
    for (const k of CATS) data.lists[k].forEach((e, i) => lines.push([CATEGORY_LABEL[k], i + 1, ...COLS.map((c) => cell(e, c.key))].map(csvCell).join(",")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`﻿${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" }));
    a.download = `${title.replace(/[^\w]+/g, "_")}_${data.dept_name.replace(/[^\w]+/g, "_")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  return (
    <div className="space-y-4">
      <Card><CardContent className="py-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5"><label className="block text-sm font-medium text-gray-700">Cycle</label>
          <select className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm min-w-56" value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
            {cycles.map((c) => <option key={c.cycle_id} value={c.cycle_id}>{c.name}</option>)}
          </select></div>
        <div className="space-y-1.5"><label className="block text-sm font-medium text-gray-700">Department</label>
          <select className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>{(data?.departments ?? []).map((d) => <option key={d.dept_no} value={d.dept_no}>{d.dept_name}</option>)}
          </select></div>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" onClick={printBell} disabled={!data?.cycle}><Printer className="h-4 w-4 mr-1" />Bell curve</Button>
          <Button variant="secondary" size="sm" onClick={print} disabled={!data?.cycle}><Printer className="h-4 w-4 mr-1" />Summary sheet</Button>
          <Button variant="secondary" size="sm" onClick={csv} disabled={!data?.cycle}><Download className="h-4 w-4 mr-1" />CSV</Button>
        </div>
      </CardContent></Card>

      <ErrorBox error={error} />
      {!cycleId ? <Card><Empty>No launched appraisal cycle yet.</Empty></Card> : !data ? <Spinner /> : !data.cycle ? <Card><Empty>No data.</Empty></Card> : (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card><CardContent className="py-4 space-y-2">
              <p className="font-semibold text-ink">{data.dept_name} — performance bell curve distribution</p>
              <p className="text-xs text-gray-500">Eligible staff only (full year + pro-rata). &quot;Actual HOD recommendation&quot; = the grade the HODs gave before HR normalisation.</p>
              <table className="w-full text-sm">
                <thead className="text-[11px] text-gray-500 uppercase"><tr><th className="text-left py-1">Rating</th><th className="text-right">Total # in rating</th>
                  <th className="text-right">Bell curve standard</th><th className="text-right">Standard #</th><th className="text-right">Actual HOD rec.</th><th className="text-left pl-3">Remarks</th></tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {data.bell.map((b) => (
                    <tr key={b.label}>
                      <td className="py-1.5"><span className="inline-flex items-center gap-1.5"><GradeBadge g={b.label} /><span className="text-xs text-gray-600">{b.description}</span></span></td>
                      <td className="text-right tabular-nums">{b.count}</td>
                      <td className="text-right tabular-nums">{b.target_pct ?? "—"}%</td>
                      <td className="text-right tabular-nums">{b.standard_count ?? "—"}</td>
                      <td className="text-right tabular-nums">{b.hod_count}</td>
                      <td className="pl-3"><Pill tone={b.remark === "MATCHED" ? "green" : b.remark.startsWith("ABOVE") ? "amber" : "blue"}>{b.remark}</Pill></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 font-semibold"><tr><td className="py-1.5 px-1">Total employees</td><td className="text-right">{data.totals.graded}</td>
                  <td className="text-right">100%</td><td className="text-right">{data.totals.graded}</td><td className="text-right">{data.bell.reduce((t, b) => t + b.hod_count, 0)}</td><td /></tr></tfoot>
              </table>
            </CardContent></Card>
            <Card><CardContent className="py-4 space-y-2">
              <p className="font-semibold text-ink">Department strength by type</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] text-gray-500 uppercase"><tr><th className="text-left py-1">Type</th><th className="text-right">Count</th>
                    {data.grades.map((g) => <th key={g.label} className="text-right">{g.label}</th>)}<th className="text-right">Not graded</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.categories.map((c) => (
                      <tr key={c.category} className={c.eligible ? "" : "text-gray-500"}>
                        <td className="py-1.5">{c.label}</td><td className="text-right tabular-nums">{c.count}</td>
                        {data.grades.map((g) => <td key={g.label} className="text-right tabular-nums">{c.eligible ? c.by_grade[g.label] ?? 0 : "—"}</td>)}
                        <td className="text-right tabular-nums">{c.not_graded}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-semibold"><tr><td className="py-1.5 px-1">Total department strength</td><td className="text-right">{data.totals.strength}</td>
                    {data.grades.map((g) => <td key={g.label} className="text-right">{data.categories.reduce((t, c) => t + (c.by_grade[g.label] ?? 0), 0)}</td>)}
                    <td className="text-right">{data.categories.reduce((t, c) => t + c.not_graded, 0)}</td></tr></tfoot>
                </table>
              </div>
              <p className="text-xs text-gray-500">Categories: TE/MTO by designation; probation = employment status probationary; pro-rata = joined less than a year before the period end. Override per employee with the ✎ button.</p>
            </CardContent></Card>
          </div>

          {CATS.map((k) => (
            <Card key={k}><CardContent className="py-4 space-y-2">
              <div className="flex items-center gap-2"><p className="font-semibold text-ink">{CATEGORY_LABEL[k]}</p><Pill>{data.lists[k].length}</Pill></div>
              {data.lists[k].length === 0 ? <p className="text-xs text-gray-400">None.</p> : (
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500 uppercase text-[10px]"><tr><th className="px-2 py-1.5 text-left">Sr</th>
                      {COLS.map((c) => <th key={c.key} className={`px-2 py-1.5 whitespace-nowrap ${c.num ? "text-right" : "text-left"}`}>{c.label}</th>)}<th /></tr></thead>
                    <tbody className="divide-y divide-gray-50">
                      {data.lists[k].map((e, i) => (
                        <tr key={e.empcode} className="hover:bg-gray-50/60">
                          <td className="px-2 py-1.5 text-gray-400">{String(i + 1).padStart(2, "0")}</td>
                          {COLS.map((c) => (
                            <td key={c.key} className={`px-2 py-1.5 ${c.num ? "text-right tabular-nums" : "text-gray-700"}`}>
                              {c.key === "rating" ? (e.rating ? <GradeBadge g={e.rating} /> : <span className="text-gray-400">{e.stage_label}</span>) : cell(e, c.key) || "—"}
                            </td>
                          ))}
                          <td className="px-2 py-1.5"><button className="p-1 text-gray-400 hover:text-indigo-600" title="Prior experience, category, remarks" onClick={() => setEdit(e)}><Pencil className="h-3.5 w-3.5" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent></Card>
          ))}
        </>
      )}
      {edit && <ProfileModal h={h} e={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function ProfileModal({ h, e, onClose, onSaved }: { h: Hr; e: SummaryEmployee; onClose: () => void; onSaved: () => void }) {
  const [prior, setPrior] = useState(e.prior_exp == null ? "" : String(e.prior_exp));
  const [cat, setCat] = useState<Category | "">(e.category_override ?? "");
  const [rt, setRt] = useState(e.resource_type);
  const [rm, setRm] = useState(e.remarks);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await apprHrApi.saveProfile(h, e.empcode, { prior_exp_years: prior === "" ? null : Number(prior), category_override: cat || null, resource_type: rt, remarks: rm });
      onSaved();
    } catch (er) {
      setErr(er instanceof Error ? er.message : "Failed");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal size="sm" title={e.name} subtitle={`${e.empcode} · ${e.desg_desc}`} onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>Save</Button></div>}>
      <div className="space-y-3">
        <ErrorBox error={err} />
        <Input label="Prior experience (years, before DCL)" type="number" min={0} step="0.5" value={prior} onChange={(ev) => setPrior(ev.target.value)} />
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">Category</label>
          <select className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm" value={cat} onChange={(ev) => setCat(ev.target.value as Category | "")}>
            <option value="">Automatic ({CATEGORY_LABEL[e.category]})</option>
            {CATS.map((k) => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}
          </select>
        </div>
        <Input label="Resource type" value={rt} onChange={(ev) => setRt(ev.target.value)} />
        <Input label="Remarks" value={rm} onChange={(ev) => setRm(ev.target.value)} />
      </div>
    </Modal>
  );
}
