"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, Search, FileText, Users, Loader2, Cog, CalendarRange, FileSpreadsheet, Lock, Unlock, ShieldCheck, KeyRound, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import {
  fetchSalaryPeriods, fetchSalarySheet, fetchPayslip,
  fetchSalaryOpenPeriod, runSalaryProcess,
  fetchSalaryProcessState, runFinalSalaryProcess,
  type SalaryPeriod, type SalarySheetRow, type Payslip as PayslipData, type SalaryOpenPeriod,
  type SalaryProcessState,
} from "@/services/payrollService";
import { Modal } from "@/components/ui/Modal";
import { Payslip } from "./Payslip";

const money = (v?: number) => (v == null ? "—" : Math.round(v).toLocaleString());

export function SalaryPanel({ adminCardNo, onViewPayRegister }: { adminCardNo: string; onViewPayRegister?: (period: number) => void }) {
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
  const [openPeriod, setOpenPeriod] = useState<SalaryOpenPeriod | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processMsg, setProcessMsg] = useState<string | null>(null);
  const [processedPeriod, setProcessedPeriod] = useState<number | null>(null);

  // Where the selected period stands: processed yet, and posted yet. The server
  // reads the same tables the ERP procedure checks, so the buttons can never
  // offer something the procedure would then refuse.
  const [state, setState] = useState<SalaryProcessState | null>(null);
  const [finalOpen, setFinalOpen] = useState(false);
  const [finalPassword, setFinalPassword] = useState("");
  const [finalizing, setFinalizing] = useState(false);
  const [finalError, setFinalError] = useState<string | null>(null);

  const loadPeriods = useCallback(async () => {
    try {
      const r = await fetchSalaryPeriods(adminCardNo, compc, brnch);
      const items = r.items || [];
      setPeriods(items);
      // Default to the open period rather than merely the newest, so the panel
      // lands on the month you can actually process.
      if (items.length) {
        setPeriod((cur) =>
          cur != null && items.some((p) => p.period === cur)
            ? cur
            : (items.find((p) => p.is_open) ?? items[0]).period
        );
      } else { setPeriod(null); setRows([]); }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load periods"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, compc, brnch]);

  const loadOpenPeriod = useCallback(async () => {
    try { const r = await fetchSalaryOpenPeriod(adminCardNo, compc); setOpenPeriod(r.open_period); }
    catch { setOpenPeriod(null); }
  }, [adminCardNo, compc]);

  const loadState = useCallback(async (p: number) => {
    try { setState(await fetchSalaryProcessState(adminCardNo, p, compc)); }
    catch { setState(null); }
  }, [adminCardNo, compc]);

  const loadSheet = useCallback(async (p: number) => {
    setLoading(true); setError(null);
    try { const r = await fetchSalarySheet(adminCardNo, p, compc, undefined, brnch); setRows(r.items || []); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load salaries"); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, compc, brnch]);

  useEffect(() => { loadPeriods(); }, [loadPeriods]);
  useEffect(() => { loadOpenPeriod(); }, [loadOpenPeriod]);
  useEffect(() => { if (period != null) loadSheet(period); }, [period, loadSheet]);
  useEffect(() => { if (period != null) loadState(period); }, [period, loadState]);

  async function runProcess() {
    if (!openPeriod) return;
    const ok = window.confirm(
      `Run the salary process for the open period ${openPeriod.label}?\n\n` +
      `This recomputes attendance and rebuilds the salary breakdown for this period, ` +
      `replacing any previously processed salary for it. This can take a while.`
    );
    if (!ok) return;
    setProcessing(true); setError(null); setProcessMsg(null);
    try {
      const r = await runSalaryProcess(adminCardNo, compc);
      setProcessMsg(`Salary processed for ${r.label} — ${r.processed} employee${r.processed === 1 ? "" : "s"}.`);
      setProcessedPeriod(r.period);
      await loadPeriods();
      // Jump to the just-processed period so the sheet shows the new results.
      setPeriod(r.period);
      await loadSheet(r.period);
      await loadState(r.period);
    } catch (e) { setError(e instanceof Error ? e.message : "Salary process failed"); }
    finally { setProcessing(false); }
  }

  async function runFinal() {
    if (period == null) return;
    if (!finalPassword.trim()) { setFinalError("Enter the payroll password"); return; }
    setFinalizing(true); setFinalError(null);
    try {
      const r = await runFinalSalaryProcess(adminCardNo, period, finalPassword, compc);
      setProcessMsg(r.message || "Payroll finalised.");
      setFinalOpen(false);
      // Never leave the password sitting in component state once it is spent.
      setFinalPassword("");
      await loadState(period);
      await loadSheet(period);
    } catch (e) {
      // The procedure's own wording — wrong password, not processed, already
      // posted — is shown as-is; it is written for whoever is standing there.
      setFinalError(e instanceof Error ? e.message : "The final process failed");
    } finally {
      setFinalizing(false);
    }
  }

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

  const selected = useMemo(() => periods.find((p) => p.period === period) ?? null, [periods, period]);
  // Only the open period may be processed — the procedure itself only ever
  // targets STATUS='O', so offering it for a closed month would be a lie.
  // Posting is final: once a period is in the FINAL tables neither button may
  // run again for it, whatever else is true.
  const finalized = state?.finalized === true;
  const canProcess = Boolean(openPeriod) && selected?.is_open === true && !finalized;
  // The final step only appears once there is something to post.
  const canFinalize = state?.can_finalize === true;

  return (
    <div className="space-y-4">
      {slip && <Payslip data={slip} onClose={() => setSlip(null)} />}

      {/* Final payroll — the password is checked by the ERP procedure against
          HR_SAL_PASWD, so it is sent straight through and never held here
          beyond the request. */}
      {finalOpen && (
        <Modal
          title="Run Final Payroll"
          subtitle={`${selected?.label ?? "This period"} — posting is permanent`}
          size="sm"
          onClose={() => { if (!finalizing) { setFinalOpen(false); setFinalPassword(""); setFinalError(null); } }}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setFinalOpen(false); setFinalPassword(""); setFinalError(null); }} disabled={finalizing}>
                Cancel
              </Button>
              <Button onClick={runFinal} disabled={finalizing || !finalPassword.trim()}>
                {finalizing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1.5" />}
                {finalizing ? "Finalising…" : "Finalise Payroll"}
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              This posts <span className="font-semibold">{selected?.label ?? "the selected period"}</span> to the
              final payroll tables and records loan recoveries against it. Once posted, this period can no
              longer be processed or finalised again.
            </p>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Payroll password</label>
              <div className="relative">
                <KeyRound className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  autoFocus
                  value={finalPassword}
                  onChange={(e) => { setFinalPassword(e.target.value); setFinalError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && finalPassword.trim() && !finalizing) runFinal(); }}
                  placeholder="Enter the payroll password"
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            </div>
            {finalError && <p className="text-sm text-red-600">{finalError}</p>}
          </div>
        </Modal>
      )}
      {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}
      {processMsg && (
        <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-100 text-sm text-emerald-700 flex flex-wrap items-center justify-between gap-2">
          <span>{processMsg}</span>
          {onViewPayRegister && processedPeriod != null && (
            <Button size="sm" variant="secondary" onClick={() => onViewPayRegister(processedPeriod)}>
              <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" /> View Pay Register
            </Button>
          )}
        </div>
      )}

      {/* Salary process — runs the ERP procedure on the company's open period */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Cog className="h-4 w-4 text-indigo-600" /> Salary Process</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Builds the full salary breakdown for the open period.
              </p>
            </div>
            {openPeriod ? (
              <span className="inline-flex items-center gap-1.5 text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full px-2.5 py-1">
                <CalendarRange className="h-3.5 w-3.5" /> Open Period: {openPeriod.label}
              </span>
            ) : (
              <span className="text-xs bg-amber-50 text-amber-700 border border-amber-100 rounded-full px-2.5 py-1">No open period — open one in Period Opening</span>
            )}
            {openPeriod && selected && !selected.is_open && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-gray-100 text-gray-600 border border-gray-200 rounded-full px-2.5 py-1">
                <Lock className="h-3.5 w-3.5" /> Viewing {selected.label} (closed) — read only
              </span>
            )}
            {finalized && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full px-2.5 py-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> {selected?.label ?? "This period"} is finalised
              </span>
            )}
            <Button
              onClick={runProcess}
              disabled={processing || !canProcess}
              className="ml-auto"
              title={
                finalized ? `${selected?.label ?? "This period"} has been finalised — it can no longer be reprocessed.`
                  : !openPeriod ? "No open period"
                  : !canProcess ? `${selected?.label ?? "This period"} is closed. Only the open period (${openPeriod.label}) can be processed.`
                  : `Run the salary process for ${openPeriod.label}`
              }
            >
              {processing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Cog className="h-4 w-4 mr-1.5" />}
              {processing ? "Processing…" : "Run Salary Process"}
            </Button>

            {/* Only offered once the salary process has produced something to
                post, and never again after it has been posted. */}
            {(canFinalize || finalized) && (
              <Button
                variant="secondary"
                onClick={() => { setFinalError(null); setFinalPassword(""); setFinalOpen(true); }}
                disabled={finalizing || finalized}
                title={
                  finalized
                    ? `${selected?.label ?? "This period"} has already been finalised.`
                    : `Post ${selected?.label ?? "this period"} to the final payroll tables`
                }
              >
                {finalizing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1.5" />}
                {finalized ? "Payroll Finalised" : "Run Final Payroll"}
              </Button>
            )}
          </div>

          {openPeriod && selected && !selected.is_open && (
            <p className="text-xs text-gray-500 mt-2">
              Salary can only be processed for the open period. Switch the Processed Salary selector
              back to <span className="font-semibold">{openPeriod.label}</span>, or reopen{" "}
              {selected.label} under Configuration → Period Opening.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><FileText className="h-4 w-4 text-indigo-600" /> Processed Salary</h3>
            <div className="flex items-center gap-2">
              <select value={period ?? ""} onChange={(e) => setPeriod(Number(e.target.value))}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
                {periods.length === 0 && <option value="">No periods</option>}
                {periods.map((p) => (
                  <option key={p.period} value={p.period}>
                    {p.label} ({p.emp_count}){p.is_open ? " — Open" : ""}
                  </option>
                ))}
              </select>
              {selected && (
                selected.is_open ? (
                  <span className="inline-flex items-center gap-1 text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full px-2 py-0.5">
                    <Unlock className="h-3 w-3" /> Open
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] bg-gray-100 text-gray-600 border border-gray-200 rounded-full px-2 py-0.5">
                    <Lock className="h-3 w-3" /> Closed
                  </span>
                )
              )}
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
            <div className="py-12 text-center text-gray-400">
              <Users className="h-8 w-8 mx-auto mb-2" />
              <p>No processed salaries for {selected?.label ?? "this period"}.</p>
              {/* The working tables are cleared per company on every run, so an
                  older month has data only if it was posted to the history
                  tables. Say so rather than implying the month was never run. */}
              {selected && !selected.is_open && selected.source === "none" && (
                <p className="text-xs text-gray-400 mt-2 max-w-md mx-auto">
                  Salary results for closed months are only kept once a period has been posted to
                  the payroll history tables. Running the process for a newer month replaces the
                  working results for earlier ones.
                </p>
              )}
            </div>
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
