"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, RefreshCw, Trash2, Coins, Loader2, Search, CalendarRange } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { listHRMSEmployees } from "@/services/hrmsService";
import type { HRMSSearchResult } from "@/models/hrms";
import {
  fetchAllowanceTypes, fetchMonthlyAllowances, saveMonthlyAllowance, deleteMonthlyAllowance,
  fetchOpenPeriods,
  type AllowanceType, type MonthlyAllowance, type OpenPeriod,
} from "@/services/payrollEntryService";

const money = (v?: number) => (v == null ? "—" : Math.round(v).toLocaleString());

export function MonthlyAllowancePanel({ adminCardNo }: { adminCardNo: string }) {
  const { activeCompany, activeBranch } = useAuth();
  const compc = activeCompany || undefined;
  const brnch = activeBranch || undefined;

  const [types, setTypes] = useState<AllowanceType[]>([]);
  const [rows, setRows] = useState<MonthlyAllowance[]>([]);
  const [emps, setEmps] = useState<HRMSSearchResult[]>([]);
  const [periods, setPeriods] = useState<OpenPeriod[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [empFilter, setEmpFilter] = useState("");           // "view for the specific user"
  const [form, setForm] = useState({ empcode: "", allowance_id: "", amount: "", ot_hour: "", remarks: "" });
  const [saving, setSaving] = useState(false);

  const loadStatic = useCallback(async () => {
    try {
      const [t, e, p] = await Promise.all([
        fetchAllowanceTypes(adminCardNo),
        listHRMSEmployees(adminCardNo, undefined, compc, brnch),
        fetchOpenPeriods(adminCardNo, compc),
      ]);
      setTypes(t.items || []); setEmps(e.items || []); setPeriods(p.items || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, compc, brnch]);

  const loadRows = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchMonthlyAllowances(adminCardNo, compc, brnch, empFilter || undefined);
      setRows(r.items || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, compc, brnch, empFilter]);

  useEffect(() => { loadStatic(); }, [loadStatic]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const openPeriod = periods[0];
  const empOptions = useMemo(() => emps.map((e) => ({ value: e.empcode, label: `${e.name} (${e.empcode})` })), [emps]);

  async function save() {
    setError(null);
    if (!form.empcode) { setError("Select an employee"); return; }
    if (!form.allowance_id) { setError("Select an allowance"); return; }
    if (form.amount === "" || Number(form.amount) < 0) { setError("Enter a valid amount"); return; }
    setSaving(true);
    try {
      await saveMonthlyAllowance(adminCardNo, compc, {
        empcode: form.empcode, allowance_id: form.allowance_id, amount: Number(form.amount),
        ot_hour: form.ot_hour ? Number(form.ot_hour) : undefined, remarks: form.remarks || undefined,
      });
      setForm({ empcode: "", allowance_id: "", amount: "", ot_hour: "", remarks: "" });
      await loadRows();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to save"); }
    finally { setSaving(false); }
  }

  async function remove(r: MonthlyAllowance) {
    if (!confirm(`Remove ${r.allowance_desc} for ${r.name}?`)) return;
    const key = `${r.old_empcode}-${r.allowance_id}`;
    setBusy(key);
    try { await deleteMonthlyAllowance(adminCardNo, r.empcode || r.old_empcode, r.allowance_id, compc); await loadRows(); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); }
  }

  const total = useMemo(() => rows.reduce((a, r) => a + (r.amount || 0), 0), [rows]);

  return (
    <div className="space-y-4">
      {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Coins className="h-4 w-4 text-indigo-600" /> Monthly Allowances</h3>
            {openPeriod ? (
              <span className="inline-flex items-center gap-1.5 text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full px-2.5 py-1">
                <CalendarRange className="h-3.5 w-3.5" /> Open Period: {openPeriod.label}
              </span>
            ) : (
              <span className="text-xs bg-amber-50 text-amber-700 border border-amber-100 rounded-full px-2.5 py-1">No open period — open one in Period Opening</span>
            )}
            <Button variant="secondary" size="sm" onClick={() => { loadStatic(); loadRows(); }} disabled={loading} className="ml-auto">
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>

          {/* Entry form */}
          <div className="p-4 bg-indigo-50/50 rounded-xl mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <SearchableSelect label="Employee" value={form.empcode} onChange={(v) => setForm((f) => ({ ...f, empcode: v }))}
                placeholder="Type a name or code…" options={empOptions} />
              <SearchableSelect label="Allowance" value={form.allowance_id} onChange={(v) => setForm((f) => ({ ...f, allowance_id: v }))}
                placeholder="Search allowance…" options={types.map((t) => ({ value: t.allowance_id, label: t.allowance_desc }))} />
              <Input label="Amount" type="number" min="0" inputMode="decimal" value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^0-9.]/g, "") }))} placeholder="0" />
              <Input label="OT Hours (optional)" type="number" min="0" value={form.ot_hour}
                onChange={(e) => setForm((f) => ({ ...f, ot_hour: e.target.value.replace(/[^0-9.]/g, "") }))} placeholder="—" />
              <Input label="Remarks" value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} placeholder="Optional" />
            </div>
            <div className="mt-3">
              <Button size="sm" onClick={save} disabled={saving || !openPeriod}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />} Save Allowance
              </Button>
            </div>
          </div>

          {/* View filter */}
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-sm font-medium text-gray-700">Allowances in this period</span>
            <div className="w-72 ml-auto flex items-center gap-2">
              <Search className="h-4 w-4 text-gray-400" />
              <SearchableSelect value={empFilter} onChange={setEmpFilter} placeholder="View a specific employee…"
                options={empOptions} className="flex-1" />
            </div>
          </div>

          {loading ? <Spinner /> : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Employee</th><th className="px-3 py-2 text-left">Code</th>
                    <th className="px-3 py-2 text-left">Designation</th><th className="px-3 py-2 text-left">Department</th>
                    <th className="px-3 py-2 text-left">Allowance</th><th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-right">OT Hrs</th><th className="px-3 py-2 text-left">Remarks</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.length === 0 ? (
                    <tr><td colSpan={9} className="py-8 text-center text-gray-400">No allowances for this period.</td></tr>
                  ) : rows.map((r) => (
                    <tr key={`${r.old_empcode}-${r.allowance_id}`} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">{r.name || r.old_empcode}</td>
                      <td className="px-3 py-2 font-mono text-gray-500">{r.empcode}</td>
                      <td className="px-3 py-2 text-gray-600">{r.designation || "—"}</td>
                      <td className="px-3 py-2 text-gray-600">{r.department || "—"}</td>
                      <td className="px-3 py-2 text-gray-700">{r.allowance_desc || r.allowance_id}</td>
                      <td className="px-3 py-2 text-right text-gray-800 font-semibold">{money(r.amount)}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{r.ot_hour ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-500">{r.remarks || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => remove(r)} disabled={busy === `${r.old_empcode}-${r.allowance_id}`} className="text-red-500 hover:text-red-700 disabled:opacity-40">
                          {busy === `${r.old_empcode}-${r.allowance_id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && (
                  <tfoot className="bg-gray-50 text-xs font-semibold text-gray-600">
                    <tr><td className="px-3 py-2" colSpan={5}>Total ({rows.length})</td>
                      <td className="px-3 py-2 text-right">{money(total)}</td><td colSpan={3}></td></tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
