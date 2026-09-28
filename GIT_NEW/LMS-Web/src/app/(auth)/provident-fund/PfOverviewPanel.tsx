"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Info, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { PfStatTile, pfMoney } from "@/components/pf/PfStatementView";
import { fetchPfSummary, type PfSummary } from "@/services/pfService";

export function PfOverviewPanel({ adminCardNo, onOpenMembers }: { adminCardNo: string; onOpenMembers: () => void }) {
  const { activeCompany, activeBranch } = useAuth();
  const [data, setData] = useState<PfSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchPfSummary(adminCardNo, activeCompany || undefined, activeBranch || undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [adminCardNo, activeCompany, activeBranch]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <Spinner />;
  if (error) return <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const t = data.totals;
  const c = data.counts;

  // Things HR should know about this company's PF data, derived from the figures.
  const notes: string[] = [];
  if (c.not_on_master > 0) {
    notes.push(`${c.not_on_master} PF balance record(s) belong to employee codes that are not on the employee master. They are counted in the fund total.`);
  }
  if (c.pf_flagged > 0 && c.with_balance === 0) {
    notes.push(`${c.pf_flagged} employee(s) are enrolled in PF but no balance has been posted yet.`);
  }
  if (c.members > 0 && c.pf_flagged === 0) {
    notes.push("Nobody in this company is enrolled in PF (PF flag), so the salary process deducts no PF. Enrol members from Members & Balances.");
  }
  if (t.pending > 0) {
    notes.push(`${pfMoney(t.pending)} of PF has been deducted in a salary run that is not finalised yet. It is added to balances when that month is finalised.`);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <p className="text-sm text-slate-500">
          {data.last_posted ? <>Contributions posted up to <b className="text-ink">{data.last_posted.label}</b></> : "No PF contribution has been posted from a finalised salary yet."}
        </p>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <PfStatTile label="Total fund balance" value={pfMoney(t.balance)} tone="brand" />
        <PfStatTile label="PF members" value={String(c.members)} hint={`${c.pf_flagged} enrolled · ${c.with_balance} with balance`} />
        <PfStatTile label="Opening balances" value={pfMoney(t.opening)} />
        <PfStatTile label="Contributions (posted)" value={pfMoney(t.contributions)} tone="good" />
        <PfStatTile label="Permanent withdrawals" value={pfMoney(t.withdrawals)} tone={t.withdrawals ? "bad" : "default"} />
        <PfStatTile label="Loans outstanding" value={pfMoney(t.loan_outstanding)} tone={t.loan_outstanding ? "warn" : "default"}
          hint={`${c.active_loans} active loan(s)`} />
        <PfStatTile label="Available (net of loans)" value={pfMoney(t.available)} />
        <PfStatTile label="Pending (not finalised)" value={pfMoney(t.pending)} tone={t.pending ? "warn" : "default"} />
      </div>

      {notes.length > 0 && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-900 space-y-1.5">
          {notes.map((n) => (
            <p key={n} className="flex gap-2"><Info className="h-4 w-4 shrink-0 mt-0.5" /> <span>{n}</span></p>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="py-4">
          <div className="flex items-center mb-3">
            <h3 className="font-semibold text-ink">Posted contributions by month</h3>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={onOpenMembers}>
              Member balances <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
          {data.monthly.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">No finalised month has a PF deduction yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Month</th>
                    <th className="px-3 py-2 text-right">Employees</th>
                    <th className="px-3 py-2 text-right">PF contribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...data.monthly].reverse().map((m) => (
                    <tr key={m.period}>
                      <td className="px-3 py-2">{m.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.employees}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{pfMoney(m.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-slate-400">
        Figures come from opening balances (HR_PF_BALANCES), PF deductions in finalised salaries, and PF
        loans / withdrawals entered in Payroll → Loans. Employer contribution, profit and investments are not
        recorded in the system yet.
      </p>
    </div>
  );
}
