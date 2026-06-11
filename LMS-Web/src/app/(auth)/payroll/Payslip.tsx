"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import type { Payslip as PayslipData, PayslipLine } from "@/services/payrollService";

const money = (v?: number) => (v == null ? "" : Math.round(v).toLocaleString());

function sumBy(lines: PayslipLine[], key: "this" | "fiscal" | "cal", pred: (l: PayslipLine) => boolean) {
  return lines.filter(pred).reduce((a, l) => a + (l[key] || 0), 0);
}

function Cell({ v, bold }: { v: number; bold?: boolean }) {
  return <td className={`px-2 py-[3px] text-right tabular-nums ${bold ? "font-bold" : ""}`}>{money(v)}</td>;
}

function HdrField({ label, value, accent }: { label: string; value?: string; accent?: boolean }) {
  return (
    <div className="flex gap-1 text-[11px]">
      <span className="text-gray-500 whitespace-nowrap">{label} :</span>
      <span className={`font-semibold ${accent ? "text-blue-700" : "text-gray-900"}`}>{value || ""}</span>
    </div>
  );
}

export function Payslip({ data, onClose }: { data: PayslipData; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const h = data.header;
  const E = data.earnings;
  const type1 = E.filter((e) => e.atype === 1);
  const adjustments = E.filter((e) => e.atype === 2 || e.atype === 3);
  const leave = E.filter((e) => e.atype === 4);

  const actualGross = { this: data.master.actual_gross, fiscal: sumBy(E, "fiscal", (e) => e.atype === 1), cal: sumBy(E, "cal", (e) => e.atype === 1) };
  const daysAdj = { this: sumBy(adjustments, "this", () => true), fiscal: sumBy(adjustments, "fiscal", () => true), cal: sumBy(adjustments, "cal", () => true) };
  const leaveSum = { this: sumBy(leave, "this", () => true), fiscal: sumBy(leave, "fiscal", () => true), cal: sumBy(leave, "cal", () => true) };
  const earnedGross = {
    this: data.master.earned_gross,
    fiscal: actualGross.fiscal + daysAdj.fiscal + leaveSum.fiscal,
    cal: actualGross.cal + daysAdj.cal + leaveSum.cal,
  };
  const totalEarning = { this: data.master.total_earning, fiscal: earnedGross.fiscal, cal: earnedGross.cal };
  const ded = data.totals;

  const SUB = "bg-cyan-50 font-bold";
  const EG = "bg-blue-50 font-bold";

  const sheet = (
    <div className="fixed inset-0 z-[1000] bg-slate-900/70 overflow-auto payslip-modal" onClick={onClose}>
      <div className="payslip-toolbar sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-white shadow">
        <Printer className="h-5 w-5 text-indigo-600" />
        <span className="font-semibold text-gray-900">Pay Slip — {h.name}</span>
        <span className="text-xs text-gray-400">{h.period_label}</span>
        <div className="ml-auto flex gap-2">
          <button onClick={(e) => { e.stopPropagation(); window.print(); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"><Printer className="h-4 w-4" /> Print</button>
          <button onClick={onClose} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200"><X className="h-4 w-4" /> Close</button>
        </div>
      </div>

      <div className="flex justify-center p-6">
        <div className="payslip-page bg-white p-6 shadow-lg" style={{ width: "210mm", minHeight: "auto" }} onClick={(e) => e.stopPropagation()}>
          {/* Title */}
          <div className="border-b-2 border-gray-300 pb-2 mb-3">
            <h1 className="text-[18px] font-extrabold text-red-700">{h.company_name || "Company"}</h1>
            <p className="text-[12px] font-bold text-blue-700">Pay Slip For the Month of {h.period_label}</p>
          </div>

          {/* Header grid */}
          <div className="grid grid-cols-3 gap-x-6 gap-y-1 mb-4">
            <div className="space-y-1">
              <HdrField label="Department" value={h.dept_name} />
              <HdrField label="Grade" value={h.grade} />
              <HdrField label="Working Days" value={String(h.w_day ?? "")} />
              <HdrField label="Total Absent" value={String(h.absent_days ?? "")} />
              <HdrField label="Total Earning Days" value={String(h.earning_days ?? "")} />
            </div>
            <div className="space-y-1">
              <HdrField label="Name" value={h.name} />
              <HdrField label="Code" value={h.code} />
              <HdrField label="Location" value={h.location} accent />
              <HdrField label="Designation" value={h.designation} />
            </div>
            <div className="space-y-1">
              <HdrField label="Bank Account # / Cash" value={h.bank_acct} />
              <HdrField label="Bank Branch" value="" />
              <HdrField label="Employee Type" value={h.emp_type} />
              <HdrField label="Joining Date" value={h.joining_date} />
            </div>
          </div>

          {/* Two tables */}
          <div className="grid grid-cols-2 gap-4">
            {/* Earnings */}
            <table className="w-full text-[11px] border border-gray-300">
              <thead className="bg-gray-100 text-gray-600">
                <tr>
                  <th className="px-2 py-1 text-left border-b border-gray-300">Description</th>
                  <th className="px-2 py-1 text-right border-b border-gray-300">This Month</th>
                  <th className="px-2 py-1 text-right border-b border-gray-300">Jul to Jun</th>
                  <th className="px-2 py-1 text-right border-b border-gray-300">Jan to Dec</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {type1.map((e, i) => (
                  <tr key={`t1-${i}`}><td className="px-2 py-[3px]">{e.desc}</td><Cell v={e.this} /><Cell v={e.fiscal} /><Cell v={e.cal} /></tr>
                ))}
                <tr className={SUB}><td className="px-2 py-[3px]">Actual Gross :-</td><Cell v={actualGross.this} bold /><Cell v={actualGross.fiscal} bold /><Cell v={actualGross.cal} bold /></tr>
                {adjustments.map((e, i) => (
                  <tr key={`adj-${i}`}><td className="px-2 py-[3px]">{e.desc}</td><Cell v={e.this} /><Cell v={e.fiscal} /><Cell v={e.cal} /></tr>
                ))}
                {adjustments.length > 0 && (
                  <tr className={SUB}><td className="px-2 py-[3px]">Days Adjustment :-</td><Cell v={daysAdj.this} bold /><Cell v={daysAdj.fiscal} bold /><Cell v={daysAdj.cal} bold /></tr>
                )}
                {leave.map((e, i) => (
                  <tr key={`lv-${i}`}><td className="px-2 py-[3px]">{e.desc}</td><Cell v={e.this} /><Cell v={e.fiscal} /><Cell v={e.cal} /></tr>
                ))}
                {leave.length > 0 && (
                  <tr className={SUB}><td className="px-2 py-[3px]">Leave Without Pay :-</td><Cell v={leaveSum.this} bold /><Cell v={leaveSum.fiscal} bold /><Cell v={leaveSum.cal} bold /></tr>
                )}
                <tr className={EG}><td className="px-2 py-[3px]">Earned Gross :-</td><Cell v={earnedGross.this} bold /><Cell v={earnedGross.fiscal} bold /><Cell v={earnedGross.cal} bold /></tr>
                <tr className={EG}><td className="px-2 py-[3px]">Total Earning</td><Cell v={totalEarning.this} bold /><Cell v={totalEarning.fiscal} bold /><Cell v={totalEarning.cal} bold /></tr>
              </tbody>
            </table>

            {/* Deductions */}
            <div>
              <table className="w-full text-[11px] border border-gray-300">
                <thead className="bg-gray-100 text-gray-600">
                  <tr>
                    <th className="px-2 py-1 text-left border-b border-gray-300">Deductions</th>
                    <th className="px-2 py-1 text-right border-b border-gray-300">This Month</th>
                    <th className="px-2 py-1 text-right border-b border-gray-300">Jul to Jun</th>
                    <th className="px-2 py-1 text-right border-b border-gray-300">Jan to Dec</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.deductions.length === 0 ? (
                    <tr><td colSpan={4} className="px-2 py-2 text-center text-gray-400">No deductions</td></tr>
                  ) : data.deductions.map((d, i) => (
                    <tr key={`d-${i}`}><td className="px-2 py-[3px]">{d.desc}</td><Cell v={d.this} /><Cell v={d.fiscal} /><Cell v={d.cal} /></tr>
                  ))}
                  <tr className={SUB}><td className="px-2 py-[3px]">Total Deductions</td><Cell v={ded.deduction_this} bold /><Cell v={ded.deduction_fiscal} bold /><Cell v={ded.deduction_cal} bold /></tr>
                </tbody>
              </table>

              <p className="text-[12px] font-bold text-emerald-700 mt-4 mb-1">Outstanding Loan Balances..</p>
              {data.loans.length === 0 ? (
                <p className="text-[11px] text-gray-400">None</p>
              ) : (
                <table className="w-full text-[11px] border border-gray-200">
                  <tbody>
                    {data.loans.map((l, i) => (
                      <tr key={`ln-${i}`} className="border-b border-gray-100"><td className="px-2 py-[3px]">{l.loan_desc}</td><Cell v={l.balance} /></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Summary box */}
          <div className="mt-5 w-[280px] border-2 border-blue-200 rounded-xl p-3">
            <div className="flex justify-between text-[12px] py-0.5"><span className="font-bold">Total Earning</span><span className="font-bold tabular-nums">{money(totalEarning.this)}</span></div>
            <div className="flex justify-between text-[12px] py-0.5"><span className="font-bold">Total Deduction</span><span className="font-bold tabular-nums">{money(ded.deduction_this)}</span></div>
            <div className="flex justify-between text-[12px] py-0.5"><span className="font-bold">Less Amount</span><span className="font-bold tabular-nums">0</span></div>
            <div className="flex justify-between text-[13px] py-1 border-t border-blue-200 mt-1"><span className="font-extrabold text-red-700">Net Payable</span><span className="font-extrabold text-red-700 tabular-nums">{money(ded.net_payable)}</span></div>
          </div>

          {/* Footer */}
          <div className="mt-8 pt-2 border-t border-gray-300 flex justify-between text-[10px] text-gray-500">
            <span>This is computer generated document no signature required.</span>
          </div>
          <p className="text-[10px] text-gray-400 mt-1">
            Powered by{" "}
            <a href="https://hrms.sysnovix.com" target="_blank" rel="noreferrer"
              className="font-semibold text-indigo-600 hover:underline">HRMS.sysnovix.com</a>
          </p>
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          body > *:not(.payslip-modal) { display: none !important; }
          .payslip-modal { position: static !important; inset: auto !important; display: block !important; background: none !important; overflow: visible !important; }
          .payslip-toolbar { display: none !important; }
          .payslip-modal > div { padding: 0 !important; }
          .payslip-page { width: auto !important; box-shadow: none !important; padding: 0 !important; }
        }
      `}</style>
    </div>
  );

  return createPortal(sheet, document.body);
}
