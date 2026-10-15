"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { hrApi, money, currentFy, fyLabel, type Hr, type Budget, type BudgetLine, type Department } from "@/services/trainingService";
import { ErrorBox, Empty } from "@/components/training/TrainingUi";

export function BudgetPanel({ h }: { h: Hr }) {
  const [fy, setFy] = useState(currentFy());
  const [data, setData] = useState<Budget | null>(null);
  const [depts, setDepts] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ dept: string; amount: string; remarks: string; locked: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [b, d] = await Promise.all([hrApi.budget(h, fy), hrApi.departments(h)]);
      setData(b);
      setDepts(d.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [h, fy]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!edit) return;
    const amount = Number(edit.amount);
    if (!Number.isFinite(amount) || amount < 0) { alert("Enter a valid amount"); return; }
    setSaving(true);
    try {
      await hrApi.saveBudget(h, { fy_year: fy, dept_no: edit.dept === "COMPANY" ? null : Number(edit.dept), amount, remarks: edit.remarks });
      setEdit(null);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(l: BudgetLine) {
    if (!confirm(`Remove the ${l.dept_name} budget for FY ${fyLabel(fy)}?`)) return;
    try { await hrApi.deleteBudget(h, l.budget_id); load(); } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }

  const years = [currentFy() + 1, currentFy(), currentFy() - 1, currentFy() - 2];

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="w-44">
            <select className="w-full px-3 py-2 rounded-xl border border-gray-300 text-sm" value={fy} onChange={(e) => setFy(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>FY {fyLabel(y)} (Jul–Jun)</option>)}
            </select>
          </div>
          {data && <p className="text-sm text-slate-500">Spent this year (all sessions): <b className="text-ink">{money(data.total_used)}</b></p>}
          <Button size="sm" className="ml-auto" onClick={() => setEdit({ dept: "COMPANY", amount: "", remarks: "", locked: false })}>
            <Plus className="h-4 w-4 mr-1" />Set budget</Button>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          A company line covers all training; department lines cover sessions charged to that department. Going over budget shows a warning when a session is saved but does not block it.
        </p>
        <ErrorBox error={error} />
        {!data ? <Spinner /> : data.lines.length === 0 ? <Empty>No budget set for FY {data.fy_label}.</Empty> : (
          <div className="space-y-3">
            {data.lines.map((l) => {
              const pct = l.used_pct ?? 0;
              return (
                <div key={l.budget_id} className="rounded-xl border border-gray-100 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-gray-900">{l.dept_name}</p>
                    {l.remarks && <span className="text-xs text-gray-400">{l.remarks}</span>}
                    <div className="ml-auto flex gap-1">
                      <button title="Edit" className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100"
                        onClick={() => setEdit({ dept: l.dept_no == null ? "COMPANY" : String(l.dept_no), amount: String(l.amount), remarks: l.remarks, locked: true })}>
                        <Pencil className="h-4 w-4" /></button>
                      <button title="Remove" className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" onClick={() => remove(l)}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className={`h-full rounded-full ${pct > 100 ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-4 text-xs text-gray-500">
                    <span>Budget <b className="text-ink">{money(l.amount)}</b></span>
                    <span>Used <b className="text-ink">{money(l.used)}</b> ({l.used_pct ?? 0}%)</span>
                    <span className={l.remaining < 0 ? "text-red-600 font-semibold" : ""}>Remaining {money(l.remaining)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {edit && (
        <Modal size="sm" title={`Training budget — FY ${fyLabel(fy)}`} onClose={() => setEdit(null)}
          footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} loading={saving}>Save</Button></>}>
          <div className="space-y-3">
            <Select label="Applies to" value={edit.dept} disabled={edit.locked} onChange={(e) => setEdit({ ...edit, dept: e.target.value || "COMPANY" })}
              options={[{ value: "COMPANY", label: "Company (all departments)" }, ...depts.map((d) => ({ value: d.dept_no, label: d.dept_name }))]} />
            <Input label="Amount" type="number" min={0} value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} />
            <Input label="Remarks" value={edit.remarks} onChange={(e) => setEdit({ ...edit, remarks: e.target.value })} />
          </div>
        </Modal>
      )}
    </Card>
  );
}
