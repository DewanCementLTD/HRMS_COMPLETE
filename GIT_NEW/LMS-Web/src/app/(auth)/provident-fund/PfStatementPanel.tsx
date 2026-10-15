"use client";

import { useState, useEffect, useCallback } from "react";
import { FileText, Calculator, Loader2, AlertTriangle, Lock, Printer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useAuth } from "@/context/AuthContext";
import { listHRMSEmployees } from "@/services/hrmsService";
import type { HRMSSearchResult } from "@/models/hrms";
import {
  fetchPfStatement, fetchPfSettlement, pfMoney, pfPct,
  type PfStatement, type PfSettlement, type PfYear,
} from "@/services/pfLedgerService";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (d: string) => `${MONTHS[Number(d.slice(5, 7))]}-${d.slice(2, 4)}`;
const LINE_LABEL: Record<string, string> = { OPEN: "Opening balance", WITHDRAW: "Permanent withdrawal" };

function Stat({ label, value, tone = "gray" }: { label: string; value: string; tone?: "gray" | "indigo" | "emerald" | "amber" }) {
  const tones = { gray: "text-gray-900", indigo: "text-indigo-700", emerald: "text-emerald-700", amber: "text-amber-700" };
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-base font-semibold ${tones[tone]}`}>{value}</p>
    </div>
  );
}

function YearCard({ y }: { y: PfYear }) {
  const loanLines = y.loan.lines.filter((l) => l.line_type !== "LOAN_OPEN" || l.amount !== 0);
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h4 className="font-semibold text-gray-900">Statement {y.fy_label}</h4>
          <span className="text-xs text-gray-500">up to {y.cutoff} · profit rate {pfPct(y.profit_rate)} · loan markup {pfPct(y.loan_rate)}</span>
          {y.status === "posted"
            ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5"><Lock className="h-3 w-3" /> Posted</span>
            : <span className="text-xs font-medium text-sky-700 bg-sky-50 rounded-full px-2 py-0.5">Live</span>}
          {y.provisional && <span className="text-xs font-medium text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">Provisional rate — not declared yet</span>}
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-100 mb-3">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Month</th>
                <th className="px-3 py-2 text-right">Earned Gross</th><th className="px-3 py-2 text-right">FPO</th>
                <th className="px-3 py-2 text-right">Basic</th>
                <th className="px-3 py-2 text-right">P.F (Part I = Part II)</th>
                <th className="px-3 py-2 text-right">Payroll Deducted</th>
                <th className="px-3 py-2 text-right">Days</th><th className="px-3 py-2 text-right">Product</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {y.lines.map((l, i) => {
                const mismatch = l.line_type === "CONTRIB" && (l.payroll_deducted ?? 0) !== l.emp_amt;
                return (
                  <tr key={i} className={l.line_type === "WITHDRAW" ? "bg-rose-50/40" : l.line_type === "OPEN" ? "bg-gray-50/60" : ""}>
                    <td className="px-3 py-1.5 text-gray-700">{LINE_LABEL[l.line_type] ?? monthLabel(l.value_date)}{l.line_type === "WITHDRAW" ? ` (${l.value_date})` : ""}</td>
                    <td className="px-3 py-1.5 text-right text-gray-500">{pfMoney(l.earned_gross)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-500">{pfMoney(l.fpo)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-500">{pfMoney(l.basic)}</td>
                    <td className="px-3 py-1.5 text-right font-medium text-gray-900">
                      {l.line_type === "WITHDRAW" ? `${pfMoney(l.emp_amt)} / ${pfMoney(l.co_amt)}` : pfMoney(l.emp_amt)}
                    </td>
                    <td className={`px-3 py-1.5 text-right ${mismatch ? "text-amber-600" : "text-gray-400"}`}
                      title={mismatch ? "Payroll deducted a different amount — recover / refund the difference" : undefined}>
                      {l.line_type === "CONTRIB" ? (l.payroll_deducted == null ? "not deducted" : pfMoney(l.payroll_deducted)) : ""}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-600">{l.days}</td>
                    <td className="px-3 py-1.5 text-right text-gray-600">{pfMoney(l.emp_product)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {(["emp", "co"] as const).map((k) => {
            const p = y[k];
            return (
              <div key={k} className="rounded-xl border border-gray-100 p-3">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{k === "emp" ? "Part I — Employee's contribution" : "Part II — Company's contribution"}</p>
                <dl className="grid grid-cols-2 gap-y-1 text-sm">
                  <dt className="text-gray-500">Opening balance</dt><dd className="text-right">{pfMoney(p.opening)}</dd>
                  <dt className="text-gray-500">Contribution</dt><dd className="text-right">{pfMoney(p.contribution)}</dd>
                  <dt className="text-gray-500">Product</dt><dd className="text-right text-gray-500">{pfMoney(p.product)}</dd>
                  <dt className="text-gray-500">Profit ({pfPct(y.profit_rate)} ÷ 365)</dt><dd className="text-right text-emerald-700">{pfMoney(p.profit)}</dd>
                  {p.withdrawn ? <><dt className="text-gray-500">Permanent withdrawal</dt><dd className="text-right text-rose-600">−{pfMoney(p.withdrawn)}</dd></> : null}
                  {k === "emp" && p.loan_interest ? <><dt className="text-gray-500">PF loan markup</dt><dd className="text-right text-rose-600">−{pfMoney(p.loan_interest)}</dd></> : null}
                  <dt className="font-semibold text-gray-800 border-t border-gray-100 pt-1">Closing balance</dt>
                  <dd className="text-right font-semibold text-indigo-700 border-t border-gray-100 pt-1">{pfMoney(p.closing)}</dd>
                </dl>
              </div>
            );
          })}
        </div>

        {loanLines.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-xl border border-gray-100">
            <p className="px-3 pt-2 text-xs font-semibold text-gray-500 uppercase">PF Loan — markup {pfPct(y.loan_rate)}</p>
            <table className="w-full text-sm">
              <thead className="text-gray-500 text-xs uppercase">
                <tr><th className="px-3 py-1.5 text-left">Date</th><th className="px-3 py-1.5 text-left">Entry</th><th className="px-3 py-1.5 text-right">Amount</th><th className="px-3 py-1.5 text-right">Days</th><th className="px-3 py-1.5 text-right">Product</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loanLines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 text-gray-600">{l.value_date}</td>
                    <td className="px-3 py-1.5 text-gray-600">{l.line_type === "LOAN_OPEN" ? "Opening balance" : l.line_type === "LOAN_DISB" ? "Loan issued" : "Recovery"}</td>
                    <td className="px-3 py-1.5 text-right">{pfMoney(l.amount)}</td>
                    <td className="px-3 py-1.5 text-right">{l.days}</td>
                    <td className="px-3 py-1.5 text-right">{pfMoney(l.product)}</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="px-3 py-1.5" colSpan={2}>Closing loan {pfMoney(y.loan.closing)}</td>
                  <td className="px-3 py-1.5 text-right" colSpan={3}>Markup charged {pfMoney(y.loan.interest)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SettlementView({ s }: { s: PfSettlement }) {
  return (
    <Card>
      <CardContent className="py-4">
        <h4 className="font-semibold text-gray-900 mb-3">Provident Fund Statement — up to {s.settlement_date}</h4>
        <div className="overflow-x-auto rounded-xl border border-gray-100 mb-4">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Year</th>
                <th className="px-3 py-2 text-right">Contribution</th><th className="px-3 py-2 text-right">Profit</th>
                <th className="px-3 py-2 text-right">Loan Markup</th><th className="px-3 py-2 text-right">Withdrawn</th>
                <th className="px-3 py-2 text-right">Co. Contribution</th><th className="px-3 py-2 text-right">Co. Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {s.years.map((y) => (
                <tr key={y.fy_from}>
                  <td className="px-3 py-1.5">{y.fy_label}{y.provisional ? " *" : ""}</td>
                  <td className="px-3 py-1.5 text-right">{pfMoney(y.emp.contribution)}</td>
                  <td className="px-3 py-1.5 text-right">{pfMoney(y.emp.profit)}</td>
                  <td className="px-3 py-1.5 text-right">{pfMoney(y.emp.loan_interest)}</td>
                  <td className="px-3 py-1.5 text-right">{pfMoney(y.emp.withdrawn + y.co.withdrawn)}</td>
                  <td className="px-3 py-1.5 text-right">{pfMoney(y.co.contribution)}</td>
                  <td className="px-3 py-1.5 text-right">{pfMoney(y.co.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="max-w-md ml-auto grid grid-cols-2 gap-y-1.5 text-sm">
          <dt className="text-gray-600">Employee&apos;s part</dt><dd className="text-right">{pfMoney(s.employee_part)}</dd>
          <dt className="text-gray-600">Less: Zakat {s.zakat_exempt ? "(exempt — declaration on file)" : "(2.5%)"}</dt><dd className="text-right text-rose-600">−{pfMoney(s.zakat)}</dd>
          <dt className="text-gray-600">Add: Company&apos;s contribution 100%</dt><dd className="text-right">{pfMoney(s.company_part)}</dd>
          <dt className="text-gray-600">Less: PF loan outstanding</dt><dd className="text-right text-rose-600">−{pfMoney(s.less_loan_outstanding)}</dd>
          <dt className="font-semibold text-gray-900 border-t border-gray-200 pt-1.5">Amount Payable</dt>
          <dd className="text-right font-bold text-indigo-700 text-base border-t border-gray-200 pt-1.5">{pfMoney(s.amount_payable)}</dd>
        </dl>
        {s.permanent_withdrawals.length > 0 && (
          <p className="mt-3 text-xs text-gray-500">
            Permanent withdrawals ({s.permanent_withdrawals.map((w) => `${w.date}: ${pfMoney(w.amount)}`).join(", ")}) are already deducted inside the yearly balances.
          </p>
        )}
        {s.years.some((y) => y.provisional) && <p className="mt-1 text-xs text-amber-600">* Profit at the latest declared rate — this year&apos;s rate is not declared yet.</p>}
      </CardContent>
    </Card>
  );
}

export function PfStatementPanel({ adminCardNo }: { adminCardNo: string }) {
  const { activeCompany, activeBranch } = useAuth();
  const compc = activeCompany || undefined;

  const [emps, setEmps] = useState<HRMSSearchResult[]>([]);
  const [empcode, setEmpcode] = useState("");
  const [upto, setUpto] = useState("");
  const [mode, setMode] = useState<"statement" | "settlement" | null>(null);
  const [statement, setStatement] = useState<PfStatement | null>(null);
  const [settlement, setSettlement] = useState<PfSettlement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEmps = useCallback(async () => {
    try { setEmps((await listHRMSEmployees(adminCardNo, undefined, compc, activeBranch || undefined)).items || []); }
    catch { /* the selector simply stays empty */ }
  }, [adminCardNo, compc, activeBranch]);

  useEffect(() => { loadEmps(); }, [loadEmps]);

  async function show(m: "statement" | "settlement") {
    if (!empcode) { setError("Select an employee"); return; }
    setMode(m); setLoading(true); setError(null); setStatement(null); setSettlement(null);
    try {
      if (m === "statement") setStatement(await fetchPfStatement(adminCardNo, compc, empcode, upto || undefined));
      else setSettlement(await fetchPfSettlement(adminCardNo, compc, empcode, upto || undefined));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }

  const member = statement?.member ?? settlement?.member;

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <div className="lg:col-span-2">
              <SearchableSelect label="Employee" value={empcode} onChange={setEmpcode} placeholder="Type a name or code…"
                options={emps.map((e) => ({ value: e.empcode, label: `${e.name} (${e.empcode})` }))} />
            </div>
            <Input label="Up to (optional)" type="date" value={upto} onChange={(e) => setUpto(e.target.value)} />
            <Button size="sm" onClick={() => show("statement")} disabled={loading}>
              {loading && mode === "statement" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileText className="h-4 w-4 mr-1" />} PF Statement
            </Button>
            <Button size="sm" variant="secondary" onClick={() => show("settlement")} disabled={loading}>
              {loading && mode === "settlement" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Calculator className="h-4 w-4 mr-1" />} Final Settlement
            </Button>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Statement runs to today (or the date given); settlement runs to the resignation date when there is one.
            Permanent withdrawals and PF loans come from Payroll → Loans (loan types 16 and 5).
          </p>
        </CardContent>
      </Card>

      {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}

      {member && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600 px-1">
          <span className="font-semibold text-gray-900 text-base">{member.name}</span>
          <span>Code <b className="font-mono">{member.old_empcode}</b></span>
          {member.designation && <span>{member.designation}</span>}
          {member.department && <span>{member.department}</span>}
          <span>DOJ {member.joining_date ?? "—"}</span>
          <span>DOL {member.exit_date ?? "—"}</span>
          <span>PF member {member.pf_ind === "Y" ? `since ${member.pf_member_since ?? "—"}` : "No"}</span>
          <span>Zakat {member.zakat_exempt ? "exempt" : "deducted"}</span>
          <button onClick={() => window.print()} className="ml-auto inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 print:hidden">
            <Printer className="h-4 w-4" /> Print
          </button>
        </div>
      )}

      {statement && (
        <>
          {statement.warnings.map((w) => (
            <div key={w} className="p-2.5 rounded-lg bg-amber-50 border border-amber-100 text-sm text-amber-700 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {w}
            </div>
          ))}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Employee part" value={pfMoney(statement.balances.employee)} tone="indigo" />
            <Stat label="Company part" value={pfMoney(statement.balances.company)} tone="indigo" />
            <Stat label="Total PF" value={pfMoney(statement.balances.employee + statement.balances.company)} tone="emerald" />
            <Stat label="PF loan outstanding" value={pfMoney(statement.balances.loan_outstanding)} tone="amber" />
          </div>
          {statement.years.length === 0
            ? <p className="text-sm text-gray-500 px-1">No PF history yet — no opening balance and no finalised salary month as a PF member.</p>
            : [...statement.years].reverse().map((y) => <YearCard key={y.fy_from} y={y} />)}
        </>
      )}

      {settlement && <SettlementView s={settlement} />}
    </div>
  );
}
