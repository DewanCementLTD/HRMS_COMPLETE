"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, RefreshCw, Trash2, Pencil, X, Loader2, Download, Search, Landmark } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { listHRMSEmployees } from "@/services/hrmsService";
import type { HRMSSearchResult } from "@/models/hrms";
import {
  fetchPfOpenings, savePfOpening, deletePfOpening, importPfOpenings, pfMoney, type PfOpening,
} from "@/services/pfLedgerService";

function fyOptions() {
  const now = new Date();
  const cur = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const out = [];
  for (let y = cur; y >= cur - 6; y--) out.push({ value: `${y}-07-01`, label: `Start of ${y}-${String(y + 1).slice(2)} (1 Jul ${y})` });
  return out;
}

const EMPTY = { empcode: "", as_of_fy: fyOptions()[0].value, emp_contrib: "", emp_profit: "", emp_deductions: "", co_contrib: "", co_profit: "", co_deductions: "", remarks: "" };

export function PfOpeningPanel({ adminCardNo }: { adminCardNo: string }) {
  const { activeCompany, activeBranch } = useAuth();
  const compc = activeCompany || undefined;

  const [rows, setRows] = useState<PfOpening[]>([]);
  const [emps, setEmps] = useState<HRMSSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [imp, setImp] = useState({ as_of_fy: fyOptions()[0].value, overwrite: false });
  const [skipped, setSkipped] = useState<{ old_empcode: string; reason: string }[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, e] = await Promise.all([
        fetchPfOpenings(adminCardNo, compc),
        listHRMSEmployees(adminCardNo, undefined, compc, activeBranch || undefined),
      ]);
      setRows(o.items || []); setEmps(e.items || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, [adminCardNo, compc, activeBranch]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => r.name?.toLowerCase().includes(q) || r.old_empcode.toLowerCase().includes(q));
  }, [rows, query]);

  async function runImport() {
    if (!confirm(`Import opening balances from HR_PF_BALANCES as at ${imp.as_of_fy}?${imp.overwrite ? "\n\nExisting take-on balances will be REPLACED." : ""}`)) return;
    setBusy("import"); setError(null); setNotice(null); setSkipped([]);
    try {
      const r = await importPfOpenings(adminCardNo, compc, imp.as_of_fy, imp.overwrite);
      setNotice(`Imported ${r.imported} opening balance(s); ${r.skipped.length} skipped.`);
      setSkipped(r.skipped);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Import failed"); }
    finally { setBusy(null); }
  }

  function openAdd() { setEditing(false); setForm({ ...EMPTY }); setShowForm(true); }
  function openEdit(r: PfOpening) {
    setEditing(true);
    setForm({
      empcode: r.old_empcode, as_of_fy: r.as_of_fy,
      emp_contrib: String(r.emp_contrib), emp_profit: String(r.emp_profit), emp_deductions: String(r.emp_deductions),
      co_contrib: String(r.co_contrib), co_profit: String(r.co_profit), co_deductions: String(r.co_deductions),
      remarks: r.remarks || "",
    });
    setShowForm(true);
  }

  async function save() {
    if (!form.empcode) { setError("Select an employee"); return; }
    setBusy("save"); setError(null); setNotice(null);
    try {
      const n = (v: string) => (v === "" ? 0 : Number(v));
      await savePfOpening(adminCardNo, compc, form.empcode, {
        as_of_fy: form.as_of_fy,
        emp_contrib: n(form.emp_contrib), emp_profit: n(form.emp_profit), emp_deductions: n(form.emp_deductions),
        co_contrib: n(form.co_contrib), co_profit: n(form.co_profit), co_deductions: n(form.co_deductions),
        remarks: form.remarks || undefined,
      });
      setShowForm(false); setNotice("Opening balance saved."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to save"); }
    finally { setBusy(null); }
  }

  async function remove(r: PfOpening) {
    if (!confirm(`Delete the opening balance of ${r.name || r.old_empcode}?`)) return;
    setBusy(`d${r.old_empcode}`);
    try { await deletePfOpening(adminCardNo, compc, r.old_empcode); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-5">
      {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}
      {notice && <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-100 text-sm text-emerald-700">{notice}</div>}

      <Card>
        <CardContent className="py-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-1"><Download className="h-4 w-4 text-indigo-600" /> Import from ERP (HR_PF_BALANCES)</h3>
          <p className="text-xs text-gray-400 mb-3">
            Takes each employee&apos;s latest PF balance and profit from the ERP. The company part is set equal to the employee part.
            Members with posted years are never changed.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <Select label="Balances are as at" value={imp.as_of_fy} options={fyOptions()}
              onChange={(e) => setImp((s) => ({ ...s, as_of_fy: e.target.value }))} />
            <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
              <input type="checkbox" checked={imp.overwrite} onChange={(e) => setImp((s) => ({ ...s, overwrite: e.target.checked }))} />
              Replace existing opening balances
            </label>
            <Button size="sm" onClick={runImport} disabled={busy === "import"}>
              {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />} Import Balances
            </Button>
          </div>
          {skipped.length > 0 && (
            <details className="mt-3 text-xs text-gray-600">
              <summary className="cursor-pointer text-amber-700">{skipped.length} skipped — show details</summary>
              <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-gray-100">
                <table className="w-full">
                  <tbody className="divide-y divide-gray-100">
                    {skipped.map((s) => (
                      <tr key={s.old_empcode}><td className="px-2 py-1 font-mono">{s.old_empcode}</td><td className="px-2 py-1">{s.reason}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Landmark className="h-4 w-4 text-indigo-600" /> Opening Balances</h3>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 w-56">
              <Search className="h-4 w-4 text-gray-400" />
              <input className="bg-transparent text-sm outline-none w-full" placeholder="Filter name / code…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
              <Button size="sm" onClick={openAdd}><Plus className="h-4 w-4 mr-1" /> Add Manually</Button>
            </div>
          </div>

          {showForm && (
            <div className="mb-4 p-4 bg-indigo-50/50 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <p className="font-medium text-gray-800">{editing ? `Edit opening — ${form.empcode}` : "New opening balance (from the Excel statement)"}</p>
                <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700"><X className="h-4 w-4" /></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <SearchableSelect label="Employee" value={form.empcode} disabled={editing}
                  onChange={(v) => setForm((f) => ({ ...f, empcode: v }))} placeholder="Type a name or code…"
                  options={emps.map((e) => ({ value: e.empcode, label: `${e.name} (${e.empcode})` }))} />
                <Select label="Balances are as at" value={form.as_of_fy} options={fyOptions()}
                  onChange={(e) => setForm((f) => ({ ...f, as_of_fy: e.target.value }))} />
                <Input label="Remarks" value={form.remarks} onChange={set("remarks")} />
                <div />
                <Input label="Employee — Contribution B/F" amount value={form.emp_contrib} onChange={set("emp_contrib")} />
                <Input label="Employee — Profit B/F" amount value={form.emp_profit} onChange={set("emp_profit")} />
                <Input label="Employee — Deductions" amount value={form.emp_deductions} onChange={set("emp_deductions")} />
                <div />
                <Input label="Company — Contribution B/F" amount value={form.co_contrib} onChange={set("co_contrib")} />
                <Input label="Company — Profit B/F" amount value={form.co_profit} onChange={set("co_profit")} />
                <Input label="Company — Deductions" amount value={form.co_deductions} onChange={set("co_deductions")} />
              </div>
              <p className="mt-2 text-xs text-gray-400">Deductions = permanent withdrawals already taken (plus their profit) and PF loan interest already charged in Excel.</p>
              <div className="mt-3"><Button size="sm" onClick={save} disabled={busy === "save"}>{busy === "save" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Save</Button></div>
            </div>
          )}

          {loading ? <Spinner /> : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Employee</th><th className="px-3 py-2 text-left">As at</th>
                    <th className="px-3 py-2 text-right">Emp. Contribution</th><th className="px-3 py-2 text-right">Emp. Profit</th>
                    <th className="px-3 py-2 text-right">Emp. Balance</th><th className="px-3 py-2 text-right">Co. Balance</th>
                    <th className="px-3 py-2 text-left">Remarks</th><th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.length === 0 ? (
                    <tr><td colSpan={8} className="py-8 text-center text-gray-400">No opening balances yet — import them above.</td></tr>
                  ) : filtered.map((r) => (
                    <tr key={r.old_empcode} className="hover:bg-gray-50">
                      <td className="px-3 py-2"><p className="font-medium text-gray-900">{r.name || "—"}</p><p className="text-xs text-gray-400 font-mono">{r.old_empcode}</p></td>
                      <td className="px-3 py-2 text-gray-600">{r.as_of_fy_label}</td>
                      <td className="px-3 py-2 text-right">{pfMoney(r.emp_contrib)}</td>
                      <td className="px-3 py-2 text-right">{pfMoney(r.emp_profit)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-indigo-600">{pfMoney(r.emp_balance)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-indigo-600">{pfMoney(r.co_balance)}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{r.remarks || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-3">
                          <button onClick={() => openEdit(r)} className="text-indigo-600 hover:text-indigo-800"><Pencil className="h-4 w-4" /></button>
                          <button onClick={() => remove(r)} disabled={busy === `d${r.old_empcode}`} className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
