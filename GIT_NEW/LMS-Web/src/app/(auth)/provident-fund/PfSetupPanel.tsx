"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, RefreshCw, Trash2, Lock, Loader2, Settings, Percent, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import {
  fetchPfSettings, savePfSettings, fetchPfRates, savePfRate, deletePfRate, postPfYear,
  pfMoney, pfPct, type PfRate,
} from "@/services/pfLedgerService";

// Financial years Jul→Jun, a few back and one ahead of the current one.
function fyOptions() {
  const now = new Date();
  const cur = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const out = [];
  for (let y = cur + 1; y >= cur - 6; y--) out.push({ value: `${y}-07-01`, label: `${y}-${String(y + 1).slice(2)}` });
  return out;
}

export function PfSetupPanel({ adminCardNo }: { adminCardNo: string }) {
  const { activeCompany } = useAuth();
  const compc = activeCompany || undefined;

  const [rates, setRates] = useState<PfRate[]>([]);
  const [settings, setSettings] = useState({ pf_ded_code: "", loan_codes: "", loan_spread: "", zakat_rate: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rateForm, setRateForm] = useState({ fy_from: fyOptions()[1].value, rate: "", remarks: "" });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [s, r] = await Promise.all([fetchPfSettings(adminCardNo, compc), fetchPfRates(adminCardNo, compc)]);
      setSettings({
        pf_ded_code: s.pf_ded_code, loan_codes: s.loan_codes.join(", "),
        loan_spread: String(s.loan_spread * 100), zakat_rate: String(s.zakat_rate * 100),
      });
      setRates(r.items || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, [adminCardNo, compc]);

  useEffect(() => { load(); }, [load]);

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key); setError(null); setNotice(null);
    try { await fn(); if (ok) setNotice(ok); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  const saveSettings = () => run("settings", () => savePfSettings(adminCardNo, compc, {
    pf_ded_code: settings.pf_ded_code || undefined,
    loan_codes: settings.loan_codes.split(",").map((s) => s.trim()).filter(Boolean),
    loan_spread: settings.loan_spread === "" ? undefined : Number(settings.loan_spread) / 100,
    zakat_rate: settings.zakat_rate === "" ? undefined : Number(settings.zakat_rate) / 100,
  }), "Settings saved.");

  function saveRate() {
    if (rateForm.rate === "") { setError("Enter the profit rate in %"); return; }
    run("rate", () => savePfRate(adminCardNo, compc, {
      fy_from: rateForm.fy_from, profit_rate: Number(rateForm.rate) / 100, remarks: rateForm.remarks || undefined,
    }), "Profit rate saved.");
  }

  function post(r: PfRate) {
    const again = r.status === "P";
    if (!confirm(`${again ? "Re-post" : "Post"} ${r.fy_label} at ${pfPct(r.profit_rate)}?\n\nThis freezes every member's ${r.fy_label} statement and carries the closing balance into the next year.`)) return;
    setBusy(`post${r.fy_from}`); setError(null); setNotice(null);
    postPfYear(adminCardNo, compc, r.fy_from)
      .then((res) => {
        setNotice(`${res.fy_label} posted: ${res.members_posted} members, total profit ${pfMoney(res.total_profit)}`
          + (res.skipped.length ? ` — ${res.skipped.length} skipped (${res.skipped.slice(0, 3).map((s) => `${s.old_empcode}: ${s.reason}`).join("; ")})` : ""));
        return load();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setBusy(null));
  }

  return (
    <div className="space-y-5">
      {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}
      {notice && <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-100 text-sm text-emerald-700">{notice}</div>}

      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-3 mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Percent className="h-4 w-4 text-indigo-600" /> Yearly Profit Rate</h3>
            <span className="text-xs text-gray-400">Declared by the PF trustees — the only figure HR enters.</span>
            <Button variant="secondary" size="sm" className="ml-auto" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end mb-4 p-3 bg-indigo-50/50 rounded-xl">
            <Select label="Financial Year" value={rateForm.fy_from} options={fyOptions()}
              onChange={(e) => setRateForm((f) => ({ ...f, fy_from: e.target.value }))} />
            <Input label="Profit Rate %" type="number" step="any" placeholder="e.g. 6.9" value={rateForm.rate}
              onChange={(e) => setRateForm((f) => ({ ...f, rate: e.target.value }))} />
            <Input label="Remarks" value={rateForm.remarks} placeholder="e.g. Trustees meeting 12-Aug"
              onChange={(e) => setRateForm((f) => ({ ...f, remarks: e.target.value }))} />
            <Button size="sm" onClick={saveRate} disabled={busy === "rate"}>
              {busy === "rate" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />} Save Rate
            </Button>
          </div>

          {loading ? <Spinner /> : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Year</th><th className="px-3 py-2 text-right">Profit Rate</th>
                    <th className="px-3 py-2 text-right">PF Loan Markup</th><th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right">Members Posted</th><th className="px-3 py-2 text-right">Profit Credited</th>
                    <th className="px-3 py-2 text-left">Remarks</th><th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rates.length === 0 ? (
                    <tr><td colSpan={8} className="py-8 text-center text-gray-400">No rate declared yet.</td></tr>
                  ) : rates.map((r) => (
                    <tr key={r.fy_from} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">{r.fy_label}</td>
                      <td className="px-3 py-2 text-right">{pfPct(r.profit_rate)}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{pfPct(r.profit_rate + Number(settings.loan_spread || 0) / 100)}</td>
                      <td className="px-3 py-2">
                        {r.status === "P"
                          ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5"><Lock className="h-3 w-3" /> Posted {r.posted_on ?? ""}</span>
                          : <span className="text-xs font-medium text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">Declared</span>}
                      </td>
                      <td className="px-3 py-2 text-right">{r.posted_members || "—"}</td>
                      <td className="px-3 py-2 text-right">{r.posted_members ? pfMoney(r.posted_profit) : "—"}</td>
                      <td className="px-3 py-2 text-gray-500">{r.remarks || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-3">
                          <Button size="sm" variant={r.status === "P" ? "secondary" : "primary"} onClick={() => post(r)} disabled={!!busy}>
                            {busy === `post${r.fy_from}` ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Lock className="h-4 w-4 mr-1" />}
                            {r.status === "P" ? "Re-post" : "Post Year"}
                          </Button>
                          {r.status !== "P" && (
                            <button onClick={() => confirm(`Delete the ${r.fy_label} rate?`) && run(`del${r.fy_from}`, () => deletePfRate(adminCardNo, compc, r.fy_from), "Rate deleted.")}
                              className="text-red-500 hover:text-red-700" title="Delete rate"><Trash2 className="h-4 w-4" /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-gray-400 flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            Profit = Σ(amount × days to 30 June) × rate ÷ 365. Until a year&apos;s rate is declared, statements use the latest earlier rate and show it as provisional.
            Post years in order once salaries for June are finalised.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3"><Settings className="h-4 w-4 text-indigo-600" /> PF Settings</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            <Input label="PF Deduction Code (payroll)" value={settings.pf_ded_code}
              onChange={(e) => setSettings((s) => ({ ...s, pf_ded_code: e.target.value }))} />
            <Input label="PF Loan Type Codes" value={settings.loan_codes} placeholder="e.g. 5"
              onChange={(e) => setSettings((s) => ({ ...s, loan_codes: e.target.value }))} />
            <Input label="Loan Markup above Profit Rate %" type="number" step="any" value={settings.loan_spread}
              onChange={(e) => setSettings((s) => ({ ...s, loan_spread: e.target.value }))} />
            <Input label="Zakat Rate %" type="number" step="any" value={settings.zakat_rate}
              onChange={(e) => setSettings((s) => ({ ...s, zakat_rate: e.target.value }))} />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" onClick={saveSettings} disabled={busy === "settings"}>
              {busy === "settings" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Save Settings
            </Button>
            <span className="text-xs text-gray-400">
              Contribution = (earned gross − designation FPO) ÷ 1.55 × 8.33%, company share equal. PF loans and permanent withdrawals
              (loan type 16) are entered in Payroll → Loans.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
