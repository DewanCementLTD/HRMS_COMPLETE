"use client";

import { Printer, Info } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { printTablePdf } from "@/lib/printTable";
import type { PfStatement } from "@/services/pfService";

export const pfMoney = (v?: number | null) =>
  v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });

const TYPE_STYLE: Record<string, string> = {
  opening: "bg-slate-100 text-slate-700",
  contribution: "bg-emerald-50 text-emerald-700",
  withdrawal: "bg-red-50 text-red-700",
  loan: "bg-amber-50 text-amber-700",
};
const TYPE_LABEL: Record<string, string> = {
  opening: "Opening", contribution: "Contribution", withdrawal: "Withdrawal", loan: "Loan",
};

export function PfStatTile({ label, value, hint, tone = "default" }: {
  label: string; value: string; hint?: string; tone?: "default" | "brand" | "good" | "warn" | "bad";
}) {
  const tones = {
    default: "text-ink",
    brand: "text-brand",
    good: "text-emerald-700",
    warn: "text-amber-700",
    bad: "text-red-700",
  };
  return (
    <div className="rounded-2xl border border-line bg-white p-4 min-w-0">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-bold mt-1 truncate tabular-nums ${tones[tone]}`}>{value}</p>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

/**
 * One employee's PF: summary tiles, the running-balance ledger, PF loans /
 * withdrawals and any contribution that is processed but not yet posted.
 * Shared by the HR statement dialog and the employee's own "My PF" page.
 */
export function PfStatementView({ data, companyName }: { data: PfStatement; companyName?: string }) {
  const m = data.member;

  function print() {
    printTablePdf({
      companyName: companyName || data.unit_name,
      title: "Provident Fund Statement",
      meta: `${m.name || "—"} (${m.empcode})${m.dept_name ? ` · ${m.dept_name}` : ""} · Balance ${pfMoney(m.balance)}`
        + (m.loan_outstanding ? ` · Loan outstanding ${pfMoney(m.loan_outstanding)} · Available ${pfMoney(m.available)}` : ""),
      columns: [
        { header: "#", align: "right" }, "Month", "Description",
        { header: "Credit", align: "right" }, { header: "Debit", align: "right" }, { header: "Balance", align: "right" },
      ],
      rows: data.lines.map((l) => [
        l.sr, l.month || (l.type === "opening" ? "Opening" : ""), l.description,
        l.credit ? pfMoney(l.credit) : "", l.debit ? pfMoney(l.debit) : (l.memo_amount ? `(${pfMoney(l.memo_amount)})` : ""),
        pfMoney(l.balance),
      ]),
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <PfStatTile label="PF balance" value={pfMoney(m.balance)} tone="brand"
          hint={m.last_period_label ? `Posted up to ${m.last_period_label}` : "Opening balance only"} />
        <PfStatTile label="Opening balance" value={pfMoney(m.opening)} />
        <PfStatTile label="Contributions (posted)" value={pfMoney(m.contributions)} tone="good" />
        <PfStatTile label="Withdrawn" value={pfMoney(m.withdrawals)} tone={m.withdrawals ? "bad" : "default"} />
        <PfStatTile label="Loan against PF — outstanding" value={pfMoney(m.loan_outstanding)}
          tone={m.loan_outstanding ? "warn" : "default"} hint={m.loan_taken ? `of ${pfMoney(m.loan_taken)} taken` : undefined} />
        <PfStatTile label="Available" value={pfMoney(m.available)} hint="Balance minus outstanding loan" />
        {m.pending > 0 && (
          <PfStatTile label="Pending (not posted)" value={pfMoney(m.pending)} tone="warn" hint="Added once salary is finalised" />
        )}
      </div>

      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-ink">Statement</h3>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={print} disabled={!data.lines.length}>
          <Printer className="h-4 w-4 mr-1" /> Print / PDF
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-right w-10">#</th>
              <th className="px-3 py-2 text-left">Month</th>
              <th className="px-3 py-2 text-left">Entry</th>
              <th className="px-3 py-2 text-right">Basic</th>
              <th className="px-3 py-2 text-right">Credit</th>
              <th className="px-3 py-2 text-right">Debit</th>
              <th className="px-3 py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.lines.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">No PF entries yet.</td></tr>
            )}
            {data.lines.map((l) => (
              <tr key={`${l.type}-${l.sr}`} className="hover:bg-slate-50/60">
                <td className="px-3 py-2 text-right text-slate-400 tabular-nums">{l.sr}</td>
                <td className="px-3 py-2 whitespace-nowrap">{l.month || (l.type === "opening" ? "—" : "")}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold mr-2 ${TYPE_STYLE[l.type]}`}>
                    {TYPE_LABEL[l.type]}
                  </span>
                  <span className="text-slate-700">{l.description}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{l.basic != null ? pfMoney(l.basic) : ""}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{l.credit ? pfMoney(l.credit) : ""}</td>
                <td className="px-3 py-2 text-right tabular-nums text-red-700">
                  {l.debit ? pfMoney(l.debit) : l.memo_amount ? <span className="text-amber-600">({pfMoney(l.memo_amount)})</span> : ""}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{pfMoney(l.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.loans.length > 0 && (
        <div>
          <h3 className="font-semibold text-ink mb-2">Loans &amp; withdrawals against PF</h3>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Doc</th><th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-right">Instalment</th><th className="px-3 py-2 text-right">Recovered</th>
                  <th className="px-3 py-2 text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.loans.map((l) => (
                  <tr key={l.doc}>
                    <td className="px-3 py-2">#{l.doc}</td>
                    <td className="px-3 py-2">{l.kind === "withdrawal" ? "Permanent withdrawal" : "Loan against PF"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{l.loan_date || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pfMoney(l.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.kind === "loan" ? pfMoney(l.instalment_amt) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.kind === "loan" ? pfMoney(l.recovered) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{l.kind === "loan" ? pfMoney(l.outstanding) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.pending.length > 0 && (
        <div className="flex gap-2 p-3 rounded-xl bg-amber-50 border border-amber-100 text-sm text-amber-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Processed but not yet finalised:{" "}
            {data.pending.map((p) => `${p.label} ${pfMoney(p.amount)}`).join(", ")}. This is added to the balance
            once the month&apos;s salary is finalised.
          </span>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Only the employee&apos;s own PF deduction is recorded. Employer contribution and profit are not
        recorded in the system yet, so they are not shown.
      </p>
    </div>
  );
}
