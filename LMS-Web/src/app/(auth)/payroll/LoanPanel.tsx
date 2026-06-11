"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, RefreshCw, Trash2, Banknote, Loader2, Pencil, X, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { listHRMSEmployees } from "@/services/hrmsService";
import type { HRMSSearchResult } from "@/models/hrms";
import {
  fetchLoans, createLoan, updateLoan, deleteLoan,
  fetchLoanTypes, addLoanType, deleteLoanType,
  type Loan, type LoanType,
} from "@/services/payrollService";

const money = (v?: number) => (v == null ? "—" : Number(v).toLocaleString());
const EMPTY = {
  empcode: "", loan_cd: "", loan_date: "", loan_amt: "", instalment_amt: "",
  nof_instalment: "", start_dt: "", charge_int: "N", int_rate: "", chq_no: "", chq_dt: "", remarks: "",
};

export function LoanPanel({ adminCardNo }: { adminCardNo: string }) {
  const { activeCompany, activeBranch } = useAuth();
  const compc = activeCompany || undefined;

  const [loans, setLoans] = useState<Loan[]>([]);
  const [types, setTypes] = useState<LoanType[]>([]);
  const [emps, setEmps] = useState<HRMSSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editDoc, setEditDoc] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  const [showTypes, setShowTypes] = useState(false);
  const [newType, setNewType] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, t, e] = await Promise.all([
        fetchLoans(adminCardNo, compc),
        fetchLoanTypes(adminCardNo),
        listHRMSEmployees(adminCardNo, undefined, compc, activeBranch || undefined),
      ]);
      setLoans(l.items || []); setTypes(t.items || []); setEmps(e.items || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, compc, activeBranch]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!query.trim()) return loans;
    const q = query.toLowerCase();
    return loans.filter((l) => l.name?.toLowerCase().includes(q) || l.old_empcode?.toLowerCase().includes(q) || l.loan_desc?.toLowerCase().includes(q));
  }, [loans, query]);

  function openAdd() { setEditDoc(null); setForm({ ...EMPTY }); setShowForm(true); }
  function openEdit(l: Loan) {
    setEditDoc(l.doc);
    setForm({
      empcode: l.old_empcode, loan_cd: l.loan_cd, loan_date: l.loan_date || "", loan_amt: String(l.loan_amt ?? ""),
      instalment_amt: String(l.instalment_amt ?? ""), nof_instalment: String(l.nof_instalment ?? ""),
      start_dt: l.start_dt || "", charge_int: l.charge_int || "N", int_rate: String(l.int_rate ?? ""),
      chq_no: l.chq_no || "", chq_dt: l.chq_dt || "", remarks: l.remarks || "",
    });
    setShowForm(true);
  }

  async function save() {
    setError(null);
    if (!editDoc && !form.empcode) { setError("Select an employee"); return; }
    setSaving(true);
    try {
      const body = {
        empcode: form.empcode, loan_cd: form.loan_cd || undefined, loan_date: form.loan_date || undefined,
        loan_amt: form.loan_amt || undefined, instalment_amt: form.instalment_amt || undefined,
        nof_instalment: form.nof_instalment || undefined, start_dt: form.start_dt || undefined,
        charge_int: form.charge_int, int_rate: form.int_rate || undefined,
        chq_no: form.chq_no || undefined, chq_dt: form.chq_dt || undefined, remarks: form.remarks || undefined,
      };
      if (editDoc) await updateLoan(adminCardNo, editDoc, body);
      else await createLoan(adminCardNo, compc, body);
      setShowForm(false); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to save"); }
    finally { setSaving(false); }
  }

  async function remove(l: Loan) {
    if (!confirm(`Delete loan #${l.doc} for ${l.name}?`)) return;
    setBusy(`l${l.doc}`);
    try { await deleteLoan(adminCardNo, l.doc, compc); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); }
  }

  async function saveType() {
    if (!newType.trim()) return;
    try { await addLoanType(adminCardNo, newType.trim()); setNewType(""); const t = await fetchLoanTypes(adminCardNo); setTypes(t.items || []); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }
  async function removeType(cd: string) {
    if (!confirm("Remove this loan type?")) return;
    try { await deleteLoanType(adminCardNo, cd); const t = await fetchLoanTypes(adminCardNo); setTypes(t.items || []); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div className="space-y-5">
      {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Banknote className="h-4 w-4 text-indigo-600" /> Loans</h3>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 w-56">
              <Search className="h-4 w-4 text-gray-400" />
              <input className="bg-transparent text-sm outline-none w-full" placeholder="Filter name / type…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowTypes((v) => !v)}>Loan Types</Button>
              <Button variant="secondary" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
              <Button size="sm" onClick={openAdd}><Plus className="h-4 w-4 mr-1" /> Add Loan</Button>
            </div>
          </div>

          {showTypes && (
            <div className="mb-4 p-3 bg-gray-50 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <Input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="New loan type (e.g. Housing Loan)" />
                <Button size="sm" onClick={saveType}><Plus className="h-4 w-4 mr-1" /> Add</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {types.map((t) => (
                  <span key={t.loan_cd} className="inline-flex items-center gap-1.5 bg-white border border-gray-200 rounded-full px-3 py-1 text-xs text-gray-700">
                    {t.loan_desc}
                    <button onClick={() => removeType(t.loan_cd)} className="text-red-400 hover:text-red-600"><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {showForm && (
            <div className="mb-4 p-4 bg-indigo-50/50 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <p className="font-medium text-gray-800">{editDoc ? `Edit Loan #${editDoc}` : "New Loan"}</p>
                <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700"><X className="h-4 w-4" /></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Select label="Employee" value={form.empcode} onChange={(e) => setForm((f) => ({ ...f, empcode: e.target.value }))}
                  options={[{ value: "", label: "Select employee" }, ...emps.map((e) => ({ value: e.empcode, label: `${e.name} (${e.empcode})` }))]} />
                <Select label="Loan Type" value={form.loan_cd} onChange={(e) => setForm((f) => ({ ...f, loan_cd: e.target.value }))}
                  options={[{ value: "", label: "Select type" }, ...types.map((t) => ({ value: t.loan_cd, label: t.loan_desc }))]} />
                <Input label="Loan Date" type="date" value={form.loan_date} onChange={(e) => setForm((f) => ({ ...f, loan_date: e.target.value }))} />
                <Input label="Loan Amount" type="number" value={form.loan_amt} onChange={(e) => setForm((f) => ({ ...f, loan_amt: e.target.value }))} />
                <Input label="Installment Amount" type="number" value={form.instalment_amt} onChange={(e) => setForm((f) => ({ ...f, instalment_amt: e.target.value }))} />
                <Input label="No. of Installments" type="number" value={form.nof_instalment} onChange={(e) => setForm((f) => ({ ...f, nof_instalment: e.target.value }))} />
                <Input label="Start Date" type="date" value={form.start_dt} onChange={(e) => setForm((f) => ({ ...f, start_dt: e.target.value }))} />
                <Select label="Charge Interest" value={form.charge_int} onChange={(e) => setForm((f) => ({ ...f, charge_int: e.target.value }))}
                  options={[{ value: "N", label: "No" }, { value: "Y", label: "Yes" }]} />
                {form.charge_int === "Y" && (
                  <Input label="Interest Rate %" type="number" value={form.int_rate} onChange={(e) => setForm((f) => ({ ...f, int_rate: e.target.value }))} />
                )}
                <Input label="Cheque No" value={form.chq_no} onChange={(e) => setForm((f) => ({ ...f, chq_no: e.target.value }))} />
                <Input label="Cheque Date" type="date" value={form.chq_dt} onChange={(e) => setForm((f) => ({ ...f, chq_dt: e.target.value }))} />
                <Input label="Remarks" value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
              </div>
              <div className="mt-3"><Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} {editDoc ? "Update" : "Save"} Loan</Button></div>
            </div>
          )}

          {loading ? <Spinner /> : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Employee</th>
                    <th className="px-3 py-2 text-left">Dept</th><th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-right">Instalment</th>
                    <th className="px-3 py-2 text-right"># Inst</th><th className="px-3 py-2 text-right">Recovered</th>
                    <th className="px-3 py-2 text-right">Balance</th><th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.length === 0 ? (
                    <tr><td colSpan={11} className="py-8 text-center text-gray-400">No loans.</td></tr>
                  ) : filtered.map((l) => (
                    <tr key={l.doc} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-gray-500">{l.doc}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">{l.name || l.old_empcode}</td>
                      <td className="px-3 py-2 text-gray-500">{l.dept_name || "—"}</td>
                      <td className="px-3 py-2 text-gray-600">{l.loan_desc || l.loan_cd}</td>
                      <td className="px-3 py-2 text-right text-gray-800">{money(l.loan_amt)}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{money(l.instalment_amt)}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{l.nof_instalment ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-emerald-600">{money(l.loan_recover)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-indigo-600">{money(l.balance)}</td>
                      <td className="px-3 py-2 text-gray-500">{l.loan_date || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-3">
                          <button onClick={() => openEdit(l)} className="text-indigo-600 hover:text-indigo-800"><Pencil className="h-4 w-4" /></button>
                          <button onClick={() => remove(l)} disabled={busy === `l${l.doc}`} className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
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
