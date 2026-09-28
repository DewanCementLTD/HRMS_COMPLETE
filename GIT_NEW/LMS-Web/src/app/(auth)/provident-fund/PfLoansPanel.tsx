"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, Info, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { pfMoney } from "@/components/pf/PfStatementView";
import { fetchPfLoans, type PfLoanRow } from "@/services/pfService";

export function PfLoansPanel({ adminCardNo }: { adminCardNo: string }) {
  const { activeCompany, activeBranch } = useAuth();
  const [items, setItems] = useState<PfLoanRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"all" | "loan" | "withdrawal">("all");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPfLoans(adminCardNo, activeCompany || undefined, activeBranch || undefined);
      setItems(res.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [adminCardNo, activeCompany, activeBranch]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((l) =>
      (kind === "all" || l.kind === kind) &&
      (!q || `${l.old_empcode} ${l.name} ${l.dept_name} ${l.doc}`.toLowerCase().includes(q)));
  }, [items, kind, query]);

  const outstanding = filtered.reduce((s, l) => s + l.outstanding, 0);

  return (
    <div className="space-y-4">
      {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}

      <div className="flex gap-2 p-3 rounded-xl bg-slate-50 border border-line text-sm text-slate-600">
        <Info className="h-4 w-4 shrink-0 mt-0.5 text-brand" />
        <span>
          PF loans and withdrawals are entered in{" "}
          <Link href="/payroll" className="text-brand font-medium hover:underline">Payroll → Loans</Link>{" "}
          with the type <b>Loan against P.F</b> (recovered through salary; reduces the available amount) or{" "}
          <b>Permanent withdrawal-PF</b> (paid out; reduces the balance).
        </span>
      </div>

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
              {([["all", "All"], ["loan", "Loans"], ["withdrawal", "Withdrawals"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setKind(k)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium ${kind === k ? "bg-white text-indigo-700 shadow-sm" : "text-gray-600"}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 w-full sm:w-64">
              <Search className="h-4 w-4 text-gray-400" />
              <input className="bg-transparent text-sm outline-none w-full" placeholder="Search name / code / doc…"
                value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <Button variant="secondary" size="sm" className="ml-auto" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>

          {outstanding > 0 && (
            <p className="text-xs text-slate-500 mb-3">Outstanding on the loans shown: <b className="text-amber-700">{pfMoney(outstanding)}</b></p>
          )}

          {loading && !items.length ? <Spinner /> : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Doc</th>
                    <th className="px-3 py-2 text-left">Employee</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-right">Instalment</th>
                    <th className="px-3 py-2 text-right">Recovered</th>
                    <th className="px-3 py-2 text-right">Outstanding</th>
                    <th className="px-3 py-2 text-right">PF balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">No PF loans or withdrawals in this company.</td></tr>
                  )}
                  {filtered.map((l) => {
                    // A loan bigger than what the employee has in PF is worth flagging.
                    const overdrawn = l.kind === "loan" && l.outstanding > 0 && l.outstanding > l.pf_balance;
                    return (
                      <tr key={l.doc} className="hover:bg-gray-50/60">
                        <td className="px-3 py-2">#{l.doc}</td>
                        <td className="px-3 py-2">
                          <p className="font-medium text-gray-900">{l.name || l.old_empcode}</p>
                          <p className="text-xs text-gray-400">{l.old_empcode}{l.dept_name ? ` · ${l.dept_name}` : ""}</p>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full text-[11px] font-semibold px-2 py-0.5 ${l.kind === "loan" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>
                            {l.kind === "loan" ? "Loan" : "Withdrawal"}
                          </span>
                          {l.kind === "loan" && !l.deduct_from_salary && l.outstanding > 0 && (
                            <p className="text-[11px] text-gray-400 mt-0.5">Not deducted from salary</p>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{l.loan_date || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pfMoney(l.amount)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{l.kind === "loan" ? pfMoney(l.instalment_amt) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{l.kind === "loan" ? pfMoney(l.recovered) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{l.kind === "loan" ? pfMoney(l.outstanding) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {pfMoney(l.pf_balance)}
                          {overdrawn && (
                            <p className="text-[11px] text-red-600 flex items-center justify-end gap-1">
                              <AlertTriangle className="h-3 w-3" /> Loan exceeds balance
                            </p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
