"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, Search, Loader2, ShieldCheck, ShieldOff, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { fetchPfZakat, savePfZakat, type PfZakatRow } from "@/services/pfLedgerService";

export function PfZakatPanel({ adminCardNo }: { adminCardNo: string }) {
  const { activeCompany } = useAuth();
  const compc = activeCompany || undefined;

  const [rows, setRows] = useState<PfZakatRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"all" | "pf" | "exempt">("pf");
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ decl_date: "", decl_ref: "", remarks: "" });
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows((await fetchPfZakat(adminCardNo, compc)).items || []); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, [adminCardNo, compc]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let out = rows;
    if (show === "pf") out = out.filter((r) => r.pf_ind === "Y");
    if (show === "exempt") out = out.filter((r) => r.zakat_exempt);
    if (query.trim()) {
      const q = query.toLowerCase();
      out = out.filter((r) => r.name?.toLowerCase().includes(q) || r.old_empcode.toLowerCase().includes(q));
    }
    return out;
  }, [rows, query, show]);

  function openExempt(r: PfZakatRow) {
    setEditing(r.old_empcode);
    setForm({ decl_date: r.decl_date || "", decl_ref: r.decl_ref || "", remarks: r.remarks || "" });
  }

  async function save(r: PfZakatRow, exempt: boolean) {
    if (exempt && !form.decl_date) { setError("Enter the date the exemption declaration was submitted"); return; }
    if (!exempt && !confirm(`Remove the zakat exemption of ${r.name}? 2.5% zakat will be deducted at settlement.`)) return;
    setBusy(r.old_empcode); setError(null);
    try {
      await savePfZakat(adminCardNo, compc, r.old_empcode, exempt
        ? { zakat_exempt: true, decl_date: form.decl_date, decl_ref: form.decl_ref || undefined, remarks: form.remarks || undefined }
        : { zakat_exempt: false });
      setEditing(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to save"); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-5">
      {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3 mb-1">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-indigo-600" /> Zakat Exemption</h3>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 w-56">
              <Search className="h-4 w-4 text-gray-400" />
              <input className="bg-transparent text-sm outline-none w-full" placeholder="Filter name / code…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="w-44">
              <Select value={show} onChange={(e) => setShow(e.target.value as typeof show)}
                options={[{ value: "pf", label: "PF members" }, { value: "exempt", label: "Exempt only" }, { value: "all", label: "All employees" }]} />
            </div>
            <Button variant="secondary" size="sm" className="ml-auto" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            Zakat is deducted at final settlement unless the employee has submitted the exemption declaration (CZ-50 / affidavit).
          </p>

          {loading ? <Spinner /> : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Employee</th><th className="px-3 py-2 text-left">PF Member</th>
                    <th className="px-3 py-2 text-left">Zakat</th><th className="px-3 py-2 text-left">Declaration</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.length === 0 ? (
                    <tr><td colSpan={5} className="py-8 text-center text-gray-400">No employees.</td></tr>
                  ) : filtered.map((r) => (
                    <tr key={r.old_empcode} className="hover:bg-gray-50 align-top">
                      <td className="px-3 py-2"><p className="font-medium text-gray-900">{r.name}</p><p className="text-xs text-gray-400 font-mono">{r.old_empcode}</p></td>
                      <td className="px-3 py-2 text-gray-600">{r.pf_ind === "Y" ? "Yes" : "No"}</td>
                      <td className="px-3 py-2">
                        {r.zakat_exempt
                          ? <span className="text-xs font-medium text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">Exempt</span>
                          : <span className="text-xs font-medium text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">Deducted (2.5%)</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {editing === r.old_empcode ? (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 min-w-[28rem]">
                            <Input label="Submitted on" type="date" value={form.decl_date} onChange={(e) => setForm((f) => ({ ...f, decl_date: e.target.value }))} />
                            <Input label="Reference" placeholder="CZ-50 / affidavit no." value={form.decl_ref} onChange={(e) => setForm((f) => ({ ...f, decl_ref: e.target.value }))} />
                            <Input label="Remarks" value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
                          </div>
                        ) : r.zakat_exempt ? `${r.decl_date ?? ""}${r.decl_ref ? ` · ${r.decl_ref}` : ""}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {editing === r.old_empcode ? (
                          <div className="inline-flex items-center gap-2">
                            <Button size="sm" onClick={() => save(r, true)} disabled={busy === r.old_empcode}>
                              {busy === r.old_empcode ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Save
                            </Button>
                            <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-700"><X className="h-4 w-4" /></button>
                          </div>
                        ) : r.zakat_exempt ? (
                          <div className="inline-flex items-center gap-2">
                            <Button size="sm" variant="secondary" onClick={() => openExempt(r)}>Edit</Button>
                            <Button size="sm" variant="secondary" onClick={() => save(r, false)} disabled={busy === r.old_empcode}>
                              <ShieldOff className="h-4 w-4 mr-1" /> Remove
                            </Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => openExempt(r)}><ShieldCheck className="h-4 w-4 mr-1" /> Mark Exempt</Button>
                        )}
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
