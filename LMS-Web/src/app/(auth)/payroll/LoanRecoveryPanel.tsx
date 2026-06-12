"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, RefreshCw, Trash2, HandCoins, Loader2, Search, CalendarRange } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import {
  fetchRecoverableLoans, fetchLoanRecoveries, fetchRecoveryTypes,
  createLoanRecovery, deleteLoanRecovery, fetchOpenPeriods,
  type RecoverableLoan, type LoanRecovery, type RecoveryType, type OpenPeriod,
} from "@/services/payrollEntryService";

const money = (v?: number) => (v == null ? "—" : Math.round(v).toLocaleString());

export function LoanRecoveryPanel({ adminCardNo }: { adminCardNo: string }) {
  const { activeCompany, activeBranch } = useAuth();
  const compc = activeCompany || undefined;
  const brnch = activeBranch || undefined;

  const [loans, setLoans] = useState<RecoverableLoan[]>([]);
  const [recoveries, setRecoveries] = useState<LoanRecovery[]>([]);
  const [types, setTypes] = useState<RecoveryType[]>([]);
  const [periods, setPeriods] = useState<OpenPeriod[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [doc, setDoc] = useState("");
  const [recType, setRecType] = useState("C");
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [l, r, t, p] = await Promise.all([
        fetchRecoverableLoans(adminCardNo, compc, brnch),
        fetchLoanRecoveries(adminCardNo, compc, brnch),
        fetchRecoveryTypes(adminCardNo),
        fetchOpenPeriods(adminCardNo, compc),
      ]);
      setLoans(l.items || []); setRecoveries(r.items || []);
      setTypes(t.items || []); setPeriods(p.items || []);
      if (t.items?.length && !t.items.some((x) => x.value === recType)) setRecType(t.items[0].value);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, compc, brnch]);

  useEffect(() => { load(); }, [load]);

  const openPeriod = periods[0];
  const selectedLoan = useMemo(() => loans.find((l) => String(l.doc) === doc), [loans, doc]);

  const filtered = useMemo(() => {
    if (!query.trim()) return recoveries;
    const q = query.toLowerCase();
    return recoveries.filter((r) => r.name?.toLowerCase().includes(q) || r.empcode?.toLowerCase().includes(q) || r.loan_desc?.toLowerCase().includes(q));
  }, [recoveries, query]);

  async function save() {
    setError(null);
    if (!doc) { setError("Select a loan"); return; }
    if (!amount || Number(amount) <= 0) { setError("Enter a recovery amount greater than zero"); return; }
    setSaving(true);
    try {
      await createLoanRecovery(adminCardNo, compc, {
        doc: Number(doc), recovery_type: recType, recovered_amt: Number(amount), remarks: remarks || undefined,
      });
      setDoc(""); setAmount(""); setRemarks("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to save"); }
    finally { setSaving(false); }
  }

  async function remove(r: LoanRecovery) {
    if (!confirm(`Delete this recovery of ${money(r.recovered_amt)} for ${r.name}?`)) return;
    setBusy(r.rowid);
    try { await deleteLoanRecovery(adminCardNo, r.rowid, compc); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><HandCoins className="h-4 w-4 text-indigo-600" /> Loan Recovery / Adjustment</h3>
            {openPeriod ? (
              <span className="inline-flex items-center gap-1.5 text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full px-2.5 py-1">
                <CalendarRange className="h-3.5 w-3.5" /> Open Period: {openPeriod.label}
              </span>
            ) : (
              <span className="text-xs bg-amber-50 text-amber-700 border border-amber-100 rounded-full px-2.5 py-1">No open period — open one in Period Opening</span>
            )}
            <Button variant="secondary" size="sm" onClick={load} disabled={loading} className="ml-auto">
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>

          {/* Entry form */}
          <div className="p-4 bg-indigo-50/50 rounded-xl mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <SearchableSelect label="Loan (Document)" value={doc} onChange={setDoc}
                placeholder="Search employee / loan…"
                options={loans.map((l) => ({ value: String(l.doc), label: `#${l.doc} · ${l.name} · ${l.loan_desc} (Bal ${money(l.balance)})` }))} />
              <Select label="Recovery Type" value={recType} onChange={(e) => setRecType(e.target.value)}
                options={types.map((t) => ({ value: t.value, label: t.label }))} />
              <Input label="Recovery Amount" type="number" min="0" inputMode="decimal" value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" />
              <Input label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
            </div>

            {selectedLoan && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-sm">
                <Info label="Employee" value={selectedLoan.name} />
                <Info label="Designation" value={selectedLoan.designation} />
                <Info label="Department" value={selectedLoan.department} />
                <Info label="Code" value={selectedLoan.empcode} mono />
                <Info label="Current Loan Amount" value={money(selectedLoan.loan_amt)} strong />
                <Info label="Outstanding Balance" value={money(selectedLoan.balance)} strong accent />
                <Info label="After This Recovery" value={amount ? money(selectedLoan.balance - Number(amount)) : "—"} accent />
              </div>
            )}

            <div className="mt-3">
              <Button size="sm" onClick={save} disabled={saving || !openPeriod}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />} Record Recovery
              </Button>
            </div>
          </div>

          {/* Existing recoveries */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium text-gray-700">Recorded Recoveries</span>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 w-56 ml-auto">
              <Search className="h-4 w-4 text-gray-400" />
              <input className="bg-transparent text-sm outline-none w-full" placeholder="Filter name / loan…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>

          {loading ? <Spinner /> : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Employee</th><th className="px-3 py-2 text-left">Code</th>
                    <th className="px-3 py-2 text-left">Designation</th><th className="px-3 py-2 text-left">Department</th>
                    <th className="px-3 py-2 text-left">Loan #</th><th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-right">Recovered</th><th className="px-3 py-2 text-right">Balance</th>
                    <th className="px-3 py-2 text-left">Remarks</th><th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.length === 0 ? (
                    <tr><td colSpan={10} className="py-8 text-center text-gray-400">No recoveries recorded.</td></tr>
                  ) : filtered.map((r) => (
                    <tr key={r.rowid} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">{r.name || r.old_empcode}</td>
                      <td className="px-3 py-2 font-mono text-gray-500">{r.empcode}</td>
                      <td className="px-3 py-2 text-gray-600">{r.designation || "—"}</td>
                      <td className="px-3 py-2 text-gray-600">{r.department || "—"}</td>
                      <td className="px-3 py-2 text-gray-600">#{r.doc} {r.loan_desc ? `· ${r.loan_desc}` : ""}</td>
                      <td className="px-3 py-2 text-gray-600">{r.recovery_type_label}</td>
                      <td className="px-3 py-2 text-right text-emerald-600 font-semibold">{money(r.recovered_amt)}</td>
                      <td className="px-3 py-2 text-right text-indigo-600">{money(r.balance_amt)}</td>
                      <td className="px-3 py-2 text-gray-500">{r.remarks || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => remove(r)} disabled={busy === r.rowid} className="text-red-500 hover:text-red-700 disabled:opacity-40">
                          {busy === r.rowid ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
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
    </div>
  );
}

function Info({ label, value, mono, strong, accent }: { label: string; value?: string; mono?: boolean; strong?: boolean; accent?: boolean }) {
  return (
    <div className="bg-white rounded-lg border border-gray-100 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{label}</p>
      <p className={`${mono ? "font-mono " : ""}${strong ? "font-bold " : "font-medium "}${accent ? "text-indigo-600" : "text-gray-800"} text-sm truncate`}>{value || "—"}</p>
    </div>
  );
}
