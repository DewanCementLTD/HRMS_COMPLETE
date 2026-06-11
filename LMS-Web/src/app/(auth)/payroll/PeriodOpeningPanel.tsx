"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, RefreshCw, Calendar, Lock, Unlock, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import {
  fetchFinancialYears, createFinancialYear, setFinancialYearStatus,
  fetchPeriods, createPeriod, setPeriodStatus,
  type FinancialYear, type PayrollPeriod,
} from "@/services/payrollService";

function StatusPill({ s }: { s: string }) {
  const open = s === "O";
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${open ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
      {open ? "Open" : "Closed"}
    </span>
  );
}

export function PeriodOpeningPanel({ adminCardNo }: { adminCardNo: string }) {
  const { activeCompany } = useAuth();
  const compc = activeCompany || undefined;

  const [years, setYears] = useState<FinancialYear[]>([]);
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [pLoading, setPLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ from_date: "", to_date: "", scode: "", descr: "", auto: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadYears = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchFinancialYears(adminCardNo, compc);
      setYears(r.items || []);
      if (r.items?.length && selectedYear == null) setSelectedYear(r.items[0].rule_id);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, compc]);

  const loadPeriods = useCallback(async (ruleId: number | null) => {
    setPLoading(true);
    try {
      const r = await fetchPeriods(adminCardNo, compc, ruleId ?? undefined);
      setPeriods(r.items || []);
    } catch (e) { console.error(e); }
    finally { setPLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, compc]);

  useEffect(() => { loadYears(); }, [loadYears]);
  useEffect(() => { if (selectedYear != null) loadPeriods(selectedYear); }, [selectedYear, loadPeriods]);

  async function saveYear() {
    setError(null);
    if (!form.from_date || !form.to_date) { setError("From and To dates are required"); return; }
    setSaving(true);
    try {
      await createFinancialYear(adminCardNo, compc, {
        from_date: form.from_date, to_date: form.to_date, scode: form.scode,
        descr: form.descr, auto_periods: form.auto,
      });
      setShowAdd(false);
      setForm({ from_date: "", to_date: "", scode: "", descr: "", auto: true });
      await loadYears();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to save"); }
    finally { setSaving(false); }
  }

  async function toggleYear(y: FinancialYear) {
    setBusy(`y${y.rule_id}`);
    try { await setFinancialYearStatus(adminCardNo, y.rule_id, y.status === "O" ? "C" : "O"); await loadYears(); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  async function togglePeriod(p: PayrollPeriod, field: "status" | "block") {
    setBusy(`p${p.period}-${field}`);
    try {
      if (field === "status") await setPeriodStatus(adminCardNo, p.period, { status: p.status === "O" ? "C" : "O" });
      else await setPeriodStatus(adminCardNo, p.period, { block: p.block_flag === "Y" ? "N" : "Y" });
      await loadPeriods(selectedYear);
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-5">
      {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}

      {/* Financial years */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Calendar className="h-4 w-4 text-indigo-600" /> Financial Years</h3>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={loadYears} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
              <Button size="sm" onClick={() => setShowAdd((v) => !v)}><Plus className="h-4 w-4 mr-1" /> Add Year</Button>
            </div>
          </div>

          {showAdd && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end mb-4 p-3 bg-indigo-50/50 rounded-xl">
              <Input label="From Date" type="date" value={form.from_date} onChange={(e) => setForm((f) => ({ ...f, from_date: e.target.value }))} />
              <Input label="To Date" type="date" value={form.to_date} onChange={(e) => setForm((f) => ({ ...f, to_date: e.target.value }))} />
              <Input label="Code" value={form.scode} onChange={(e) => setForm((f) => ({ ...f, scode: e.target.value }))} placeholder="e.g. 2025" />
              <Input label="Description" value={form.descr} onChange={(e) => setForm((f) => ({ ...f, descr: e.target.value }))} placeholder="optional" />
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={form.auto} onChange={(e) => setForm((f) => ({ ...f, auto: e.target.checked }))} className="accent-indigo-600" />
                  Auto-generate 12 periods
                </label>
                <Button size="sm" onClick={saveYear} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Save
                </Button>
              </div>
            </div>
          )}

          {loading ? <Spinner /> : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Code</th><th className="px-3 py-2 text-left">From</th>
                    <th className="px-3 py-2 text-left">To</th><th className="px-3 py-2 text-left">Description</th>
                    <th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {years.length === 0 ? (
                    <tr><td colSpan={6} className="py-6 text-center text-gray-400">No financial years yet.</td></tr>
                  ) : years.map((y) => (
                    <tr key={y.rule_id} className={`hover:bg-gray-50 cursor-pointer ${selectedYear === y.rule_id ? "bg-indigo-50/60" : ""}`} onClick={() => setSelectedYear(y.rule_id)}>
                      <td className="px-3 py-2 font-medium text-gray-900">{y.scode || y.rule_id}</td>
                      <td className="px-3 py-2 text-gray-600">{y.from_date}</td>
                      <td className="px-3 py-2 text-gray-600">{y.to_date}</td>
                      <td className="px-3 py-2 text-gray-500">{y.descr || "—"}</td>
                      <td className="px-3 py-2"><StatusPill s={y.status} /></td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={(e) => { e.stopPropagation(); toggleYear(y); }} disabled={busy === `y${y.rule_id}`}
                          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium inline-flex items-center gap-1">
                          {y.status === "O" ? <><Lock className="h-3.5 w-3.5" /> Close</> : <><Unlock className="h-3.5 w-3.5" /> Open</>}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Monthly periods of selected year */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-indigo-600" /> Monthly Periods
              {selectedYear != null && <span className="text-xs text-gray-400">(year {years.find((y) => y.rule_id === selectedYear)?.scode || selectedYear})</span>}
            </h3>
          </div>
          {pLoading ? <Spinner /> : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Period #</th><th className="px-3 py-2 text-left">From</th>
                    <th className="px-3 py-2 text-left">To</th><th className="px-3 py-2 text-right">Days</th>
                    <th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Blocked</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {periods.length === 0 ? (
                    <tr><td colSpan={7} className="py-6 text-center text-gray-400">No periods for this year.</td></tr>
                  ) : periods.map((p) => (
                    <tr key={p.period} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-gray-700">{p.period}</td>
                      <td className="px-3 py-2 text-gray-600">{p.period_frm}</td>
                      <td className="px-3 py-2 text-gray-600">{p.period_to}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{p.p_days ?? "—"}</td>
                      <td className="px-3 py-2"><StatusPill s={p.status} /></td>
                      <td className="px-3 py-2">{p.block_flag === "Y" ? <span className="text-red-500 text-xs font-semibold">Blocked</span> : <span className="text-gray-300 text-xs">No</span>}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-3">
                          <button onClick={() => togglePeriod(p, "status")} disabled={busy === `p${p.period}-status`}
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                            {p.status === "O" ? "Close" : "Open"}
                          </button>
                          <button onClick={() => togglePeriod(p, "block")} disabled={busy === `p${p.period}-block`}
                            className="text-xs text-gray-500 hover:text-gray-800 font-medium">
                            {p.block_flag === "Y" ? "Unblock" : "Block"}
                          </button>
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
