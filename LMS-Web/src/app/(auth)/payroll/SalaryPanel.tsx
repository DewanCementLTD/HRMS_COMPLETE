"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, Search, FileText, Users, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import {
  fetchSalaryPeriods, fetchSalarySheet, fetchPayslip,
  type SalaryPeriod, type SalarySheetRow, type Payslip as PayslipData,
} from "@/services/payrollService";
import { Payslip } from "./Payslip";

const money = (v?: number) => (v == null ? "—" : Math.round(v).toLocaleString());

export function SalaryPanel({ adminCardNo }: { adminCardNo: string }) {
  const { activeCompany, activeBranch } = useAuth();
  const compc = activeCompany || undefined;
  const brnch = activeBranch || undefined;

  const [periods, setPeriods] = useState<SalaryPeriod[]>([]);
  const [period, setPeriod] = useState<number | null>(null);
  const [rows, setRows] = useState<SalarySheetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [slip, setSlip] = useState<PayslipData | null>(null);

  const loadPeriods = useCallback(async () => {
    try {
      const r = await fetchSalaryPeriods(adminCardNo, compc, brnch);
      setPeriods(r.items || []);
      if (r.items?.length) setPeriod((cur) => (cur != null && r.items.some((p) => p.period === cur) ? cur : r.items[0].period));
      else { setPeriod(null); setRows([]); }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load periods"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, compc, brnch]);

  const loadSheet = useCallback(async (p: number) => {
    setLoading(true); setError(null);
    try { const r = await fetchSalarySheet(adminCardNo, p, compc, undefined, brnch); setRows(r.items || []); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load salaries"); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, compc, brnch]);

  useEffect(() => { loadPeriods(); }, [loadPeriods]);
  useEffect(() => { if (period != null) loadSheet(period); }, [period, loadSheet]);

  const filtered = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => r.name?.toLowerCase().includes(q) || r.old_empcode?.toLowerCase().includes(q) || r.atdtcard?.toLowerCase().includes(q) || r.dept_name?.toLowerCase().includes(q));
  }, [rows, query]);

  async function openPayslip(r: SalarySheetRow) {
    if (period == null) return;
    setOpening(r.old_empcode);
    try { setSlip(await fetchPayslip(adminCardNo, r.empcode || r.old_empcode, period, compc)); }
    catch (e) { alert(e instanceof Error ? e.message : "No payslip"); }
    finally { setOpening(null); }
  }

  const totals = useMemo(() => ({
    earn: filtered.reduce((a, r) => a + (r.total_earning || 0), 0),
    ded: filtered.reduce((a, r) => a + (r.total_deduction || 0), 0),
    net: filtered.reduce((a, r) => a + (r.net || 0), 0),
  }), [filtered]);

  return (
    <div className="space-y-4">
      {slip && <Payslip data={slip} onClose={() => setSlip(null)} />}
      {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><FileText className="h-4 w-4 text-indigo-600" /> Processed Salary</h3>
            <div>
              <select value={period ?? ""} onChange={(e) => setPeriod(Number(e.target.value))}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
                {periods.length === 0 && <option value="">No periods</option>}
                {periods.map((p) => <option key={p.period} value={p.period}>{p.label} ({p.emp_count})</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 w-56">
              <Search className="h-4 w-4 text-gray-400" />
              <input className="bg-transparent text-sm outline-none w-full" placeholder="Filter name / code / dept…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <Button variant="secondary" size="sm" onClick={() => period != null && loadSheet(period)} disabled={loading} className="ml-auto">
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>

          {loading ? <Spinner /> : filtered.length === 0 ? (
            <div className="py-12 text-center text-gray-400"><Users className="h-8 w-8 mx-auto mb-2" />No processed salaries for this period.</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">Code</th>
                    <th className="px-3 py-2 text-left">Department</th>{/* code = empcode */}<th className="px-3 py-2 text-right">Actual Gross</th>
                    <th className="px-3 py-2 text-right">Earned Gross</th><th className="px-3 py-2 text-right">Total Earning</th>
                    <th className="px-3 py-2 text-right">Deductions</th><th className="px-3 py-2 text-right">Net</th>
                    <th className="px-3 py-2 text-right">Payslip</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((r) => (
                    <tr key={r.old_empcode} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">{r.name || r.old_empcode}</td>
                      <td className="px-3 py-2 font-mono text-gray-500">{r.empcode || r.old_empcode || "—"}</td>
                      <td className="px-3 py-2 text-gray-500">{r.dept_name || "—"}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{money(r.actual_gross)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{money(r.earned_gross)}</td>
                      <td className="px-3 py-2 text-right text-gray-800">{money(r.total_earning)}</td>
                      <td className="px-3 py-2 text-right text-red-500">{money(r.total_deduction)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-indigo-600">{money(r.net)}</td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="secondary" onClick={() => openPayslip(r)} disabled={opening === r.old_empcode}>
                          {opening === r.old_empcode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 text-xs font-semibold text-gray-600">
                  <tr>
                    <td className="px-3 py-2" colSpan={5}>Totals ({filtered.length})</td>
                    <td className="px-3 py-2 text-right">{money(totals.earn)}</td>
                    <td className="px-3 py-2 text-right text-red-500">{money(totals.ded)}</td>
                    <td className="px-3 py-2 text-right text-indigo-600">{money(totals.net)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
