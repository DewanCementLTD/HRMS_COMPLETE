"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Save, RefreshCw, Trash2, CalendarX, Loader2, Search, CalendarRange, Pencil } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { listHRMSEmployees } from "@/services/hrmsService";
import type { HRMSSearchResult } from "@/models/hrms";
import {
  fetchAbsentDays, fetchEmployeeAbsent, saveAbsentDays, deleteAbsentDays, fetchOpenPeriods,
  type AbsentDay, type OpenPeriod,
} from "@/services/payrollEntryService";

export function AbsentDaysPanel({ adminCardNo }: { adminCardNo: string }) {
  const { activeCompany, activeBranch } = useAuth();
  const compc = activeCompany || undefined;
  const brnch = activeBranch || undefined;

  const [rows, setRows] = useState<AbsentDay[]>([]);
  const [emps, setEmps] = useState<HRMSSearchResult[]>([]);
  const [periods, setPeriods] = useState<OpenPeriod[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [empcode, setEmpcode] = useState("");
  const [days, setDays] = useState("");
  const [current, setCurrent] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const loadStatic = useCallback(async () => {
    try {
      const [e, p] = await Promise.all([
        listHRMSEmployees(adminCardNo, undefined, compc, brnch),
        fetchOpenPeriods(adminCardNo, compc),
      ]);
      setEmps(e.items || []); setPeriods(p.items || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, compc, brnch]);

  const loadRows = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchAbsentDays(adminCardNo, compc, brnch);
      setRows(r.items || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, compc, brnch]);

  useEffect(() => { loadStatic(); }, [loadStatic]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const openPeriod = periods[0];
  const empOptions = useMemo(() => emps.map((e) => ({ value: e.empcode, label: `${e.name} (${e.empcode})` })), [emps]);

  // When an employee is picked, show their current absent days for the open period.
  async function pickEmployee(v: string) {
    setEmpcode(v); setCurrent(null); setDays("");
    if (!v) return;
    try {
      const r = await fetchEmployeeAbsent(adminCardNo, v, compc);
      setCurrent(r.absent_days);
      setDays(String(r.absent_days ?? ""));
    } catch { /* no record yet */ }
  }

  function editRow(r: AbsentDay) {
    setEmpcode(r.empcode || r.old_empcode);
    setCurrent(r.absent_days);
    setDays(String(r.absent_days ?? ""));
  }

  async function save() {
    setError(null);
    if (!empcode) { setError("Select an employee"); return; }
    if (days === "" || Number(days) < 0) { setError("Enter absent days (0 or more)"); return; }
    setSaving(true);
    try {
      await saveAbsentDays(adminCardNo, compc, { empcode, absent_days: Number(days) });
      setEmpcode(""); setDays(""); setCurrent(null);
      await loadRows();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to save"); }
    finally { setSaving(false); }
  }

  async function remove(r: AbsentDay) {
    if (!confirm(`Remove absent days for ${r.name}?`)) return;
    setBusy(r.old_empcode);
    try { await deleteAbsentDays(adminCardNo, r.empcode || r.old_empcode, compc); await loadRows(); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); }
  }

  const filtered = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => r.name?.toLowerCase().includes(q) || r.empcode?.toLowerCase().includes(q) || r.department?.toLowerCase().includes(q));
  }, [rows, query]);

  const totalAbsent = useMemo(() => rows.reduce((a, r) => a + (r.absent_days || 0), 0), [rows]);

  return (
    <div className="space-y-4">
      {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><CalendarX className="h-4 w-4 text-indigo-600" /> Absent Days</h3>
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div className="sm:col-span-2">
                <SearchableSelect label="Employee" value={empcode} onChange={pickEmployee}
                  placeholder="Search the employee…" options={empOptions} />
              </div>
              <Input label="Absent Days" type="number" min="0" inputMode="decimal" value={days}
                onChange={(e) => setDays(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Button size="sm" onClick={save} disabled={saving || !openPeriod}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />} Save Absent Days
              </Button>
              {empcode && current != null && (
                <span className="text-xs text-gray-500">Current recorded: <span className="font-semibold text-gray-700">{current}</span> day(s)</span>
              )}
            </div>
          </div>

          {/* Recorded list */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium text-gray-700">Recorded Absences</span>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 w-56 ml-auto">
              <Search className="h-4 w-4 text-gray-400" />
              <input className="bg-transparent text-sm outline-none w-full" placeholder="Filter name / dept…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>

          {loading ? <Spinner /> : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Employee</th><th className="px-3 py-2 text-left">Code</th>
                    <th className="px-3 py-2 text-left">Designation</th><th className="px-3 py-2 text-left">Department</th>
                    <th className="px-3 py-2 text-right">Absent Days</th><th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.length === 0 ? (
                    <tr><td colSpan={6} className="py-8 text-center text-gray-400">No absences recorded for this period.</td></tr>
                  ) : filtered.map((r) => (
                    <tr key={r.old_empcode} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">{r.name || r.old_empcode}</td>
                      <td className="px-3 py-2 font-mono text-gray-500">{r.empcode}</td>
                      <td className="px-3 py-2 text-gray-600">{r.designation || "—"}</td>
                      <td className="px-3 py-2 text-gray-600">{r.department || "—"}</td>
                      <td className="px-3 py-2 text-right font-semibold text-indigo-600">{r.absent_days}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-3">
                          <button onClick={() => editRow(r)} className="text-indigo-600 hover:text-indigo-800" title="Edit"><Pencil className="h-4 w-4" /></button>
                          <button onClick={() => remove(r)} disabled={busy === r.old_empcode} className="text-red-500 hover:text-red-700 disabled:opacity-40" title="Remove">
                            {busy === r.old_empcode ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && (
                  <tfoot className="bg-gray-50 text-xs font-semibold text-gray-600">
                    <tr><td className="px-3 py-2" colSpan={4}>Total ({rows.length})</td>
                      <td className="px-3 py-2 text-right text-indigo-600">{totalAbsent}</td><td></td></tr>
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
