"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, FileText, Pencil, UserPlus, UserMinus, Printer, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { printTablePdf } from "@/lib/printTable";
import { PfStatementView, pfMoney } from "@/components/pf/PfStatementView";
import {
  fetchPfMembers, fetchPfStatement, setPfOpening, setPfMembership,
  type PfMember, type PfStatement,
} from "@/services/pfService";

const STATUS_LABEL: Record<string, string> = { A: "Active", L: "Left", D: "Left", R: "Resigned", T: "Terminated" };

export function PfMembersPanel({ adminCardNo }: { adminCardNo: string }) {
  const { user, activeCompany, activeBranch } = useAuth();
  const compc = activeCompany || undefined;

  const [scope, setScope] = useState<"members" | "all">("members");
  const [items, setItems] = useState<PfMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [statementFor, setStatementFor] = useState<PfMember | null>(null);
  const [statement, setStatement] = useState<PfStatement | null>(null);
  const [statementErr, setStatementErr] = useState<string | null>(null);

  const [openingFor, setOpeningFor] = useState<PfMember | null>(null);
  const [openingAmt, setOpeningAmt] = useState("");
  const [saving, setSaving] = useState(false);

  const [enrolFor, setEnrolFor] = useState<PfMember | null>(null);
  const [enrolDate, setEnrolDate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPfMembers(adminCardNo, compc, activeBranch || undefined, scope);
      setItems(res.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [adminCardNo, compc, activeBranch, scope]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((m) => `${m.empcode} ${m.name} ${m.dept_name} ${m.desg_desc}`.toLowerCase().includes(q));
  }, [items, query]);

  const totals = useMemo(() => filtered.reduce(
    (t, m) => ({ balance: t.balance + m.balance, loan_outstanding: t.loan_outstanding + m.loan_outstanding }),
    { balance: 0, loan_outstanding: 0 },
  ), [filtered]);

  async function openStatement(m: PfMember) {
    setStatementFor(m);
    setStatement(null);
    setStatementErr(null);
    try {
      setStatement(await fetchPfStatement(adminCardNo, m.old_empcode, compc));
    } catch (e) {
      setStatementErr(e instanceof Error ? e.message : "Failed to load statement");
    }
  }

  function openOpening(m: PfMember) {
    setOpeningFor(m);
    setOpeningAmt(m.opening ? String(m.opening) : "");
  }

  async function saveOpening() {
    if (!openingFor) return;
    const amt = Number(openingAmt || 0);
    if (!Number.isFinite(amt) || amt < 0) { alert("Enter a valid amount (0 or more)"); return; }
    setSaving(true);
    try {
      await setPfOpening(adminCardNo, openingFor.old_empcode, amt, compc);
      setOpeningFor(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function saveEnrol() {
    if (!enrolFor) return;
    setSaving(true);
    try {
      await setPfMembership(adminCardNo, enrolFor.old_empcode, "Y", compc, enrolDate || undefined);
      setEnrolFor(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to enrol");
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(m: PfMember) {
    if (!confirm(`Stop PF for ${m.name} (${m.empcode})?\n\nThe salary process will no longer deduct PF from this employee. Their existing balance is kept.`)) return;
    setBusy(m.old_empcode);
    try {
      await setPfMembership(adminCardNo, m.old_empcode, "N", compc);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  function printList() {
    printTablePdf({
      companyName: user?.selected_company?.name,
      title: "Provident Fund Balances",
      meta: `${filtered.length} employee(s) · Total balance ${pfMoney(totals.balance)}`,
      landscape: true,
      columns: [
        "Code", "Name", "Department", "PF",
        { header: "Opening", align: "right" }, { header: "Contributions", align: "right" },
        { header: "Withdrawn", align: "right" }, { header: "Balance", align: "right" },
        { header: "Loan O/S", align: "right" }, { header: "Available", align: "right" },
      ],
      rows: filtered.map((m) => [
        m.empcode, m.name || "(not on employee master)", m.dept_name, m.pf_ind === "Y" ? "Yes" : "No",
        pfMoney(m.opening), pfMoney(m.contributions), pfMoney(m.withdrawals),
        pfMoney(m.balance), pfMoney(m.loan_outstanding), pfMoney(m.available),
      ]),
    });
  }

  return (
    <div className="space-y-4">
      {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
              {(["members", "all"] as const).map((s) => (
                <button key={s} onClick={() => setScope(s)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium ${scope === s ? "bg-white text-indigo-700 shadow-sm" : "text-gray-600"}`}>
                  {s === "members" ? "PF members" : "All employees"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 w-full sm:w-64">
              <Search className="h-4 w-4 text-gray-400" />
              <input className="bg-transparent text-sm outline-none w-full" placeholder="Search code / name / dept…"
                value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" size="sm" onClick={printList} disabled={!filtered.length}>
                <Printer className="h-4 w-4 mr-1" /> Print
              </Button>
              <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
          </div>

          <p className="text-xs text-slate-500 mb-3">
            {filtered.length} employee(s) · total balance <b className="text-ink">{pfMoney(totals.balance)}</b>
            {totals.loan_outstanding > 0 && <> · loans outstanding <b className="text-amber-700">{pfMoney(totals.loan_outstanding)}</b></>}
          </p>

          {loading && !items.length ? <Spinner /> : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Employee</th>
                    <th className="px-3 py-2 text-left">Department</th>
                    <th className="px-3 py-2 text-center">PF</th>
                    <th className="px-3 py-2 text-right">Opening</th>
                    <th className="px-3 py-2 text-right">Contrib.</th>
                    <th className="px-3 py-2 text-right">Withdrawn</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                    <th className="px-3 py-2 text-right">Loan O/S</th>
                    <th className="px-3 py-2 text-right">Available</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.length === 0 && (
                    <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">
                      {scope === "members" ? "No PF members in this company. Switch to “All employees” to enrol someone." : "No employees found."}
                    </td></tr>
                  )}
                  {filtered.map((m) => (
                    <tr key={m.old_empcode} className="hover:bg-gray-50/60">
                      <td className="px-3 py-2">
                        <p className="font-medium text-gray-900">{m.name || <span className="text-gray-400 italic">Not on employee master</span>}</p>
                        <p className="text-xs text-gray-400">
                          {m.empcode}
                          {m.status && m.status !== "A" && <span className="ml-1.5 text-red-500">· {STATUS_LABEL[m.status] || m.status}</span>}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {m.dept_name}
                        {m.desg_desc && <p className="text-xs text-gray-400">{m.desg_desc}</p>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {m.pf_ind === "Y"
                          ? <span className="rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold px-2 py-0.5" title={m.pf_mem_dt ? `Since ${m.pf_mem_dt}` : undefined}>Enrolled</span>
                          : <span className="rounded-full bg-gray-100 text-gray-500 text-[11px] font-semibold px-2 py-0.5">No</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{pfMoney(m.opening)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pfMoney(m.contributions)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.withdrawals ? pfMoney(m.withdrawals) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{pfMoney(m.balance)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-700">{m.loan_outstanding ? pfMoney(m.loan_outstanding) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pfMoney(m.available)}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button title="Statement" onClick={() => openStatement(m)} className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50">
                            <FileText className="h-4 w-4" />
                          </button>
                          <button title="Edit opening balance" onClick={() => openOpening(m)} className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100">
                            <Pencil className="h-4 w-4" />
                          </button>
                          {m.on_master && (m.pf_ind === "Y" ? (
                            <button title="Stop PF deduction" onClick={() => removeMember(m)} disabled={busy === m.old_empcode}
                              className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-50">
                              {busy === m.old_empcode ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />}
                            </button>
                          ) : (
                            <button title="Enrol in PF" onClick={() => { setEnrolFor(m); setEnrolDate(""); }}
                              className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50">
                              <UserPlus className="h-4 w-4" />
                            </button>
                          ))}
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

      {statementFor && (
        <Modal title="PF Statement" size="xl" onClose={() => setStatementFor(null)}
          subtitle={`${statementFor.name || "Not on employee master"} · ${statementFor.empcode}${statementFor.dept_name ? ` · ${statementFor.dept_name}` : ""}`}>
          {statementErr ? <p className="text-sm text-red-600">{statementErr}</p>
            : !statement ? <Spinner />
            : <PfStatementView data={statement} companyName={user?.selected_company?.name} />}
        </Modal>
      )}

      {openingFor && (
        <Modal title="Opening balance" size="sm" onClose={() => setOpeningFor(null)}
          subtitle={`${openingFor.name || openingFor.empcode} · ${openingFor.empcode}`}
          footer={<>
            <Button variant="secondary" onClick={() => setOpeningFor(null)}>Cancel</Button>
            <Button onClick={saveOpening} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Save</Button>
          </>}>
          <div className="space-y-3">
            <Input label="Opening PF balance" amount value={openingAmt} onChange={(e) => setOpeningAmt(e.target.value)} />
            <p className="text-xs text-gray-500">
              The balance carried in from before this system. It replaces the current opening
              ({pfMoney(openingFor.opening)}). Enter 0 to remove it. Monthly contributions are not affected.
            </p>
          </div>
        </Modal>
      )}

      {enrolFor && (
        <Modal title="Enrol in Provident Fund" size="sm" onClose={() => setEnrolFor(null)}
          subtitle={`${enrolFor.name} · ${enrolFor.empcode}`}
          footer={<>
            <Button variant="secondary" onClick={() => setEnrolFor(null)}>Cancel</Button>
            <Button onClick={saveEnrol} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Enrol</Button>
          </>}>
          <div className="space-y-3">
            <Input label="Member since (optional)" type="date" value={enrolDate} onChange={(e) => setEnrolDate(e.target.value)} />
            <p className="text-xs text-gray-500">
              From the next salary process, PF (8.33% of basic) is deducted from this employee. The salary
              process deducts PF only from permanent, confirmed employees.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
