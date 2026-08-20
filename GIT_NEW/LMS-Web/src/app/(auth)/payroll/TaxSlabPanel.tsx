"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, RefreshCw, Trash2, Percent, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import {
  fetchTaxMasters, createTaxMaster, setTaxMasterStatus, deleteTaxMaster,
  fetchTaxDetails, addTaxDetail, deleteTaxDetail,
  type TaxMaster, type TaxDetail,
} from "@/services/payrollService";

const money = (v?: number) => (v == null ? "—" : Number(v).toLocaleString());

export function TaxSlabPanel({ adminCardNo }: { adminCardNo: string }) {
  const [masters, setMasters] = useState<TaxMaster[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [details, setDetails] = useState<TaxDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [dLoading, setDLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [showAddMaster, setShowAddMaster] = useState(false);
  const [mForm, setMForm] = useState({ tax_desc: "", fyear: "" });
  const [showAddSlab, setShowAddSlab] = useState(false);
  const [sForm, setSForm] = useState({ slab_from: "", slab_to: "", slab_rate: "", fixed_tax: "", slab_ded: "", date_from: "", date_to: "" });
  const [saving, setSaving] = useState(false);

  const loadMasters = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchTaxMasters(adminCardNo);
      setMasters(r.items || []);
      if (r.items?.length && selected == null) setSelected(r.items[0].tax_id);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo]);

  const loadDetails = useCallback(async (taxId: number) => {
    setDLoading(true);
    try { const r = await fetchTaxDetails(adminCardNo, taxId); setDetails(r.items || []); }
    catch (e) { console.error(e); }
    finally { setDLoading(false); }
  }, [adminCardNo]);

  useEffect(() => { loadMasters(); }, [loadMasters]);
  useEffect(() => { if (selected != null) loadDetails(selected); }, [selected, loadDetails]);

  async function saveMaster() {
    if (!mForm.tax_desc.trim()) { setError("Description is required"); return; }
    setSaving(true); setError(null);
    try {
      await createTaxMaster(adminCardNo, { tax_desc: mForm.tax_desc, fyear: mForm.fyear || undefined });
      setShowAddMaster(false); setMForm({ tax_desc: "", fyear: "" }); await loadMasters();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  }

  async function toggleMaster(m: TaxMaster) {
    setBusy(`m${m.tax_id}`);
    try { await setTaxMasterStatus(adminCardNo, m.tax_id, m.status === "O" ? "C" : "O"); await loadMasters(); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); }
  }
  async function removeMaster(m: TaxMaster) {
    if (!confirm(`Delete "${m.tax_desc}" and its ${m.slabs} slab(s)?`)) return;
    setBusy(`md${m.tax_id}`);
    try { await deleteTaxMaster(adminCardNo, m.tax_id); if (selected === m.tax_id) setSelected(null); await loadMasters(); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); }
  }

  async function saveSlab() {
    if (selected == null) return;
    setSaving(true); setError(null);
    try {
      await addTaxDetail(adminCardNo, selected, {
        slab_from: sForm.slab_from || undefined, slab_to: sForm.slab_to || undefined,
        slab_rate: sForm.slab_rate || undefined, fixed_tax: sForm.fixed_tax || undefined,
        slab_ded: sForm.slab_ded || undefined, date_from: sForm.date_from || undefined, date_to: sForm.date_to || undefined,
      });
      setShowAddSlab(false);
      setSForm({ slab_from: "", slab_to: "", slab_rate: "", fixed_tax: "", slab_ded: "", date_from: "", date_to: "" });
      await loadDetails(selected); await loadMasters();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  }
  async function removeSlab(d: TaxDetail) {
    if (selected == null) return;
    setBusy(`s${d.srno}`);
    try { await deleteTaxDetail(adminCardNo, selected, d.srno); await loadDetails(selected); await loadMasters(); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-5">
      {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}

      {/* Tax masters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Percent className="h-4 w-4 text-indigo-600" /> Tax Slabs (by financial year)</h3>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={loadMasters} disabled={loading}><RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
              <Button size="sm" onClick={() => setShowAddMaster((v) => !v)}><Plus className="h-4 w-4 mr-1" /> Add</Button>
            </div>
          </div>
          {showAddMaster && (
            <div className="flex flex-wrap gap-3 items-end mb-4 p-3 bg-indigo-50/50 rounded-xl">
              <div className="flex-1 min-w-[16rem]"><Input label="Description" value={mForm.tax_desc} onChange={(e) => setMForm((f) => ({ ...f, tax_desc: e.target.value }))} placeholder="e.g. Tax Slab July 2025 - June 2026" /></div>
              <Input label="FYear code" value={mForm.fyear} onChange={(e) => setMForm((f) => ({ ...f, fyear: e.target.value }))} placeholder="e.g. 2025" />
              <Button size="sm" onClick={saveMaster} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Save</Button>
            </div>
          )}
          {loading ? <Spinner /> : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr><th className="px-3 py-2 text-left">Description</th><th className="px-3 py-2 text-left">FYear</th><th className="px-3 py-2 text-right">Slabs</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">Actions</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {masters.length === 0 ? (
                    <tr><td colSpan={5} className="py-6 text-center text-gray-400">No tax slabs yet.</td></tr>
                  ) : masters.map((m) => (
                    <tr key={m.tax_id} className={`hover:bg-gray-50 cursor-pointer ${selected === m.tax_id ? "bg-indigo-50/60" : ""}`} onClick={() => setSelected(m.tax_id)}>
                      <td className="px-3 py-2 font-medium text-gray-900">{m.tax_desc}</td>
                      <td className="px-3 py-2 text-gray-500">{m.fyear || "—"}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{m.slabs}</td>
                      <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.status === "O" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{m.status === "O" ? "Open" : "Closed"}</span></td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-3">
                          <button onClick={(e) => { e.stopPropagation(); toggleMaster(m); }} disabled={busy === `m${m.tax_id}`} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">{m.status === "O" ? "Close" : "Open"}</button>
                          <button onClick={(e) => { e.stopPropagation(); removeMaster(m); }} disabled={busy === `md${m.tax_id}`} className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
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

      {/* Slab details */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Slab Details</h3>
            {selected != null && <Button size="sm" onClick={() => setShowAddSlab((v) => !v)}><Plus className="h-4 w-4 mr-1" /> Add Slab</Button>}
          </div>
          {showAddSlab && selected != null && (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 items-end mb-4 p-3 bg-indigo-50/50 rounded-xl">
              <Input label="Slab From" type="number" value={sForm.slab_from} onChange={(e) => setSForm((f) => ({ ...f, slab_from: e.target.value }))} />
              <Input label="Slab To" type="number" value={sForm.slab_to} onChange={(e) => setSForm((f) => ({ ...f, slab_to: e.target.value }))} />
              <Input label="Rate %" type="number" value={sForm.slab_rate} onChange={(e) => setSForm((f) => ({ ...f, slab_rate: e.target.value }))} />
              <Input label="Fixed Tax" type="number" value={sForm.fixed_tax} onChange={(e) => setSForm((f) => ({ ...f, fixed_tax: e.target.value }))} />
              <Input label="Deduction" type="number" value={sForm.slab_ded} onChange={(e) => setSForm((f) => ({ ...f, slab_ded: e.target.value }))} />
              <Input label="Date From" type="date" value={sForm.date_from} onChange={(e) => setSForm((f) => ({ ...f, date_from: e.target.value }))} />
              <div className="flex gap-2 items-end">
                <Input label="Date To" type="date" value={sForm.date_to} onChange={(e) => setSForm((f) => ({ ...f, date_to: e.target.value }))} />
              </div>
              <div className="col-span-2 sm:col-span-4 lg:col-span-7"><Button size="sm" onClick={saveSlab} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Save Slab</Button></div>
            </div>
          )}
          {selected == null ? (
            <p className="py-6 text-center text-sm text-gray-400">Select a tax slab above to view its details.</p>
          ) : dLoading ? <Spinner /> : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr><th className="px-3 py-2 text-left">Sr</th><th className="px-3 py-2 text-right">From</th><th className="px-3 py-2 text-right">To</th><th className="px-3 py-2 text-right">Rate %</th><th className="px-3 py-2 text-right">Fixed Tax</th><th className="px-3 py-2 text-right">Deduction</th><th className="px-3 py-2 text-left">Date From</th><th className="px-3 py-2 text-left">Date To</th><th className="px-3 py-2 text-right"></th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {details.length === 0 ? (
                    <tr><td colSpan={9} className="py-6 text-center text-gray-400">No slabs.</td></tr>
                  ) : details.map((d) => (
                    <tr key={d.srno} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400">{d.srno}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{money(d.slab_from)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{money(d.slab_to)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-indigo-600">{d.slab_rate ?? 0}%</td>
                      <td className="px-3 py-2 text-right text-gray-700">{money(d.fixed_tax)}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{money(d.slab_ded)}</td>
                      <td className="px-3 py-2 text-gray-500">{d.date_from || "—"}</td>
                      <td className="px-3 py-2 text-gray-500">{d.date_to || "—"}</td>
                      <td className="px-3 py-2 text-right"><button onClick={() => removeSlab(d)} disabled={busy === `s${d.srno}`} className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4" /></button></td>
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
