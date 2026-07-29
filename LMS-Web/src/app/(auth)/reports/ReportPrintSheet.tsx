"use client";

import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

export type ReportType =
  | "absent-supp"
  | "allowance-detail"
  | "allowance-recon"
  | "deduction-detail"
  | "deduction-recon"
  | "month-wise-deduction"
  | "bank-advice"
  | "active-employees"
  | "pf-detail";

interface ReportPrintSheetProps {
  reportType: ReportType;
  reportTitle: string;
  data: any;
  periodLabel?: string;
  unitName?: string;
  locationName?: string;
  subCategory?: string;
  onClose: () => void;
}

export function ReportPrintSheet({
  reportType,
  reportTitle,
  data,
  periodLabel = "Jul-2026",
  unitName = "KARACHI",
  locationName = "Karachi Factory",
  subCategory = "",
  onClose,
}: ReportPrintSheetProps) {
  const handlePrint = () => {
    window.print();
  };

  const rows = Array.isArray(data) ? data : data?.ledger || [];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 flex flex-col items-center p-4 print:p-0 print:bg-white print:static print:overflow-visible">
      {/* Top action toolbar (hidden during print) */}
      <div className="w-full max-w-5xl bg-gray-900 text-white px-6 py-3 rounded-t-xl flex items-center justify-between shadow-lg print:hidden mb-2">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm">{reportTitle}</span>
          <span className="text-xs bg-indigo-600 px-2 py-0.5 rounded text-indigo-100 font-mono">
            {rows.length} record(s)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handlePrint} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
            <Printer className="h-4 w-4" /> Print / Save as PDF
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} className="text-gray-300 hover:text-white">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Printable Paper Document Container */}
      <div className="w-full max-w-5xl bg-white p-8 text-black shadow-2xl rounded-b-xl print:shadow-none print:rounded-none print:w-full print:max-w-none print:p-0 print:m-0 min-h-[1050px] font-sans text-xs">
        {/* Printable CSS standard overrides */}
        <style jsx global>{`
          @media print {
            body * {
              visibility: hidden;
            }
            #printable-report-area, #printable-report-area * {
              visibility: visible;
            }
            #printable-report-area {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
              padding: 0;
              margin: 0;
            }
            @page {
              size: auto;
              margin: 15mm;
            }
          }
        `}</style>

        <div id="printable-report-area" className="w-full">
          {/* Header Layout */}
          <div className="relative mb-6 pb-2 border-b border-gray-300">
            {/* Top Left Badges */}
            <div className="absolute left-0 top-0 text-left font-bold text-[11px] leading-snug">
              {locationName && <div className="text-green-700">{locationName}</div>}
              <div className="text-green-700 uppercase">{unitName}</div>
              <div className="text-green-700">ALL Employee</div>
            </div>

            {/* Top Right Metadata */}
            <div className="absolute right-0 top-0 text-right text-[10px] font-mono text-gray-700">
              <div>Page 1 of 1</div>
              <div className="uppercase">JUL-27-26 02:55 PM</div>
            </div>

            {/* Center Company Title & Report Title */}
            <div className="text-center pt-1">
              <h1 className="text-xl font-bold text-blue-700 tracking-wide">Dewan Cement Limited</h1>
              <h2 className="text-sm font-bold text-black mt-1">{reportTitle}</h2>
              {periodLabel && (
                <div className="text-xs font-semibold text-gray-800 mt-0.5">
                  For the Month of {periodLabel}
                </div>
              )}
              {subCategory && (
                <div className="text-xs font-bold text-blue-800 mt-1 uppercase tracking-wider">
                  {subCategory}
                </div>
              )}
            </div>
          </div>

          {/* REPORT DATA TABLES BASED ON REPORT TYPE */}

          {/* 1. Absent & Supplementary Days Report */}
          {reportType === "absent-supp" && (
            <div>
              <div className="mb-2 font-bold text-red-700 text-xs">{locationName}</div>
              <table className="w-full border-collapse border border-black text-[11px]">
                <thead>
                  <tr className="bg-gray-100 border-b border-black text-center font-bold">
                    <th className="border border-black px-2 py-1 w-12">Sr.#</th>
                    <th className="border border-black px-2 py-1 w-20">Code</th>
                    <th className="border border-black px-3 py-1 text-left">Employee Name</th>
                    <th className="border border-black px-3 py-1 text-left">Designation</th>
                    <th className="border border-black px-2 py-1 w-20">Absent</th>
                    <th className="border border-black px-2 py-1 w-20">S.Days</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any, idx: number) => (
                    <tr key={idx} className="border-b border-black text-center hover:bg-gray-50">
                      <td className="border border-black px-2 py-1">{r.sr_no || idx + 1}</td>
                      <td className="border border-black px-2 py-1 font-mono font-semibold">{r.code}</td>
                      <td className="border border-black px-3 py-1 text-left font-medium">{r.employee_name}</td>
                      <td className="border border-black px-3 py-1 text-left uppercase">{r.designation}</td>
                      <td className="border border-black px-2 py-1 font-mono">{r.absent}</td>
                      <td className="border border-black px-2 py-1 font-mono">{r.s_days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 2. Employee Allowances Detail Report */}
          {reportType === "allowance-detail" && (
            <div>
              <table className="w-full border-collapse border border-black text-[10px]">
                <thead>
                  <tr className="bg-cyan-50 border-b border-black font-bold">
                    <th className="border border-black px-2 py-1.5 text-left" colSpan={2}>
                      EMPLOYEE CODE & NAME
                    </th>
                    <th className="border border-black px-2 py-1.5 text-center bg-orange-100">OT HOURS</th>
                    <th className="border border-black px-2 py-1.5 text-right bg-cyan-100">EXPENSES REIMBURS</th>
                    <th className="border border-black px-2 py-1.5 text-right bg-cyan-100">L.F.A</th>
                    <th className="border border-black px-2 py-1.5 text-right bg-cyan-100">MEDICAL</th>
                    <th className="border border-black px-2 py-1.5 text-right bg-cyan-100">OVER TIME</th>
                    <th className="border border-black px-2 py-1.5 text-right bg-purple-200">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any, idx: number) => (
                    <tr key={idx} className="border-b border-black">
                      <td className="border border-black px-2 py-1 font-mono font-bold w-16">{r.code}</td>
                      <td className="border border-black px-2 py-1 font-medium">{r.employee_name}</td>
                      <td className="border border-black px-2 py-1 text-center font-mono bg-orange-50">{r.ot_hours || 0}</td>
                      <td className="border border-black px-2 py-1 text-right font-mono">{r.expenses_reimburs ? r.expenses_reimburs.toLocaleString() : ""}</td>
                      <td className="border border-black px-2 py-1 text-right font-mono">{r.lfa ? r.lfa.toLocaleString() : ""}</td>
                      <td className="border border-black px-2 py-1 text-right font-mono">{r.medical ? r.medical.toLocaleString() : ""}</td>
                      <td className="border border-black px-2 py-1 text-right font-mono">{r.over_time ? r.over_time.toLocaleString() : ""}</td>
                      <td className="border border-black px-2 py-1 text-right font-mono font-bold bg-purple-50">{r.total != null ? r.total.toLocaleString() : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 3. Payroll Reconciliation (Allowance) */}
          {reportType === "allowance-recon" && (
            <div>
              <div className="bg-gray-100 border border-black p-1 text-center font-bold text-blue-900 mb-2 uppercase">
                {subCategory || "L.F.A"}
              </div>
              <table className="w-full border-collapse border border-black text-[10px]">
                <thead>
                  <tr className="bg-gray-100 border-b border-black font-bold text-center">
                    <th className="border border-black px-3 py-1.5 text-left">Employee Code & Name</th>
                    <th className="border border-black px-3 py-1.5 w-32">JUN-2026</th>
                    <th className="border border-black px-3 py-1.5 w-32">JUL-2026</th>
                    <th className="border border-black px-3 py-1.5 w-32">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any, idx: number) => (
                    <tr key={idx} className="border-b border-black">
                      <td className="border border-black px-3 py-1 font-medium">{r.code} &nbsp; {r.employee_name}</td>
                      <td className="border border-black px-3 py-1 text-right font-mono">{r.month1_amount ? r.month1_amount.toLocaleString() : ""}</td>
                      <td className="border border-black px-3 py-1 text-right font-mono">{r.month2_amount ? r.month2_amount.toLocaleString() : ""}</td>
                      <td className="border border-black px-3 py-1 text-right font-mono font-bold">{r.variance ? r.variance.toLocaleString() : ""}</td>
                    </tr>
                  ))}
                  <tr className="bg-blue-50 font-bold border-t-2 border-black">
                    <td className="border border-black px-3 py-1 text-blue-900">Total Of {subCategory || "L.F.A"}</td>
                    <td className="border border-black px-3 py-1 text-right font-mono text-blue-900">
                      {rows.reduce((acc: number, cur: any) => acc + (cur.month1_amount || 0), 0).toLocaleString()}
                    </td>
                    <td className="border border-black px-3 py-1 text-right font-mono text-blue-900">
                      {rows.reduce((acc: number, cur: any) => acc + (cur.month2_amount || 0), 0).toLocaleString()}
                    </td>
                    <td className="border border-black px-3 py-1 text-right font-mono text-blue-900">
                      {rows.reduce((acc: number, cur: any) => acc + (cur.variance || 0), 0).toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* 4. Employee Deduction Detail Report */}
          {reportType === "deduction-detail" && (
            <div>
              <table className="w-full border-collapse border border-black text-[10px]">
                <thead>
                  <tr className="bg-cyan-50 border-b border-black font-bold">
                    <th className="border border-black px-2 py-1.5 text-left" colSpan={2}>
                      EMPLOYEE CODE & NAME
                    </th>
                    <th className="border border-black px-2 py-1.5 text-right bg-cyan-100">ADVANCE LOAN</th>
                    <th className="border border-black px-2 py-1.5 text-right bg-cyan-100">ADVANCE SALARY</th>
                    <th className="border border-black px-2 py-1.5 text-right bg-cyan-100">CABLE CHARGES</th>
                    <th className="border border-black px-2 py-1.5 text-right bg-cyan-100">CELL PHONE</th>
                    <th className="border border-black px-2 py-1.5 text-right bg-cyan-100">ELECTRIC CHARGES</th>
                    <th className="border border-black px-2 py-1.5 text-right bg-purple-200">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any, idx: number) => (
                    <tr key={idx} className="border-b border-black">
                      <td className="border border-black px-2 py-1 font-mono font-bold w-16">{r.code}</td>
                      <td className="border border-black px-2 py-1 font-medium">{r.employee_name}</td>
                      <td className="border border-black px-2 py-1 text-right font-mono">{r.advance_loan ? r.advance_loan.toLocaleString() : ""}</td>
                      <td className="border border-black px-2 py-1 text-right font-mono">{r.advance_salary ? r.advance_salary.toLocaleString() : ""}</td>
                      <td className="border border-black px-2 py-1 text-right font-mono">{r.cable_charges ? r.cable_charges.toLocaleString() : ""}</td>
                      <td className="border border-black px-2 py-1 text-right font-mono">{r.cell_phone ? r.cell_phone.toLocaleString() : ""}</td>
                      <td className="border border-black px-2 py-1 text-right font-mono">{r.electric_charges ? r.electric_charges.toLocaleString() : ""}</td>
                      <td className="border border-black px-2 py-1 text-right font-mono font-bold bg-purple-50">{r.total != null ? r.total.toLocaleString() : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 5. Payroll Reconciliation (Deduction) */}
          {reportType === "deduction-recon" && (
            <div>
              <div className="bg-gray-100 border border-black p-1 text-center font-bold text-blue-900 mb-2 uppercase">
                {subCategory || "ADVANCE LOAN"}
              </div>
              <table className="w-full border-collapse border border-black text-[10px]">
                <thead>
                  <tr className="bg-gray-100 border-b border-black font-bold text-center">
                    <th className="border border-black px-3 py-1.5 text-left">Employee Code And Name</th>
                    <th className="border border-black px-3 py-1.5 w-32">JUN-2026</th>
                    <th className="border border-black px-3 py-1.5 w-32">JUL-2026</th>
                    <th className="border border-black px-3 py-1.5 w-32">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any, idx: number) => (
                    <tr key={idx} className="border-b border-black">
                      <td className="border border-black px-3 py-1 font-medium">{r.code} &nbsp; {r.employee_name}</td>
                      <td className="border border-black px-3 py-1 text-right font-mono">{r.month1_amount ? r.month1_amount.toLocaleString() : ""}</td>
                      <td className="border border-black px-3 py-1 text-right font-mono">{r.month2_amount ? r.month2_amount.toLocaleString() : ""}</td>
                      <td className="border border-black px-3 py-1 text-right font-mono font-bold">{r.variance ? r.variance.toLocaleString() : ""}</td>
                    </tr>
                  ))}
                  <tr className="bg-blue-50 font-bold border-t-2 border-black">
                    <td className="border border-black px-3 py-1 text-blue-900">Total Of {subCategory || "ADVANCE LOAN"}</td>
                    <td className="border border-black px-3 py-1 text-right font-mono text-blue-900">
                      {rows.reduce((acc: number, cur: any) => acc + (cur.month1_amount || 0), 0).toLocaleString()}
                    </td>
                    <td className="border border-black px-3 py-1 text-right font-mono text-blue-900">
                      {rows.reduce((acc: number, cur: any) => acc + (cur.month2_amount || 0), 0).toLocaleString()}
                    </td>
                    <td className="border border-black px-3 py-1 text-right font-mono text-blue-900">
                      {rows.reduce((acc: number, cur: any) => acc + (cur.variance || 0), 0).toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* 6. Month Wise Deduction Report */}
          {reportType === "month-wise-deduction" && (
            <div>
              <table className="w-full border-collapse border border-black text-[10px]">
                <thead>
                  <tr className="bg-cyan-50 border-b border-black font-bold">
                    <th className="border border-black px-2 py-1.5 text-left w-20">Code</th>
                    <th className="border border-black px-3 py-1.5 text-left">Employee Name</th>
                    <th className="border border-black px-3 py-1.5 text-right w-24">Apr-2026</th>
                    <th className="border border-black px-3 py-1.5 text-right w-24">May-2026</th>
                    <th className="border border-black px-3 py-1.5 text-right w-24">Jun-2026</th>
                    <th className="border border-black px-3 py-1.5 text-right w-28 bg-cyan-200">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any, idx: number) => (
                    <tr key={idx} className="border-b border-black">
                      <td className="border border-black px-2 py-1 font-mono font-bold">{r.code}</td>
                      <td className="border border-black px-3 py-1 font-medium">{r.employee_name}</td>
                      <td className="border border-black px-3 py-1 text-right font-mono">{r.month1_amount ? r.month1_amount.toLocaleString() : ""}</td>
                      <td className="border border-black px-3 py-1 text-right font-mono">{r.month2_amount ? r.month2_amount.toLocaleString() : ""}</td>
                      <td className="border border-black px-3 py-1 text-right font-mono">{r.month3_amount ? r.month3_amount.toLocaleString() : ""}</td>
                      <td className="border border-black px-2 py-1 text-right font-mono font-bold bg-cyan-50">{r.total != null ? r.total.toLocaleString() : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 7. Bank Advice Report */}
          {reportType === "bank-advice" && (
            <div>
              <div className="bg-yellow-200 border border-black p-1.5 font-bold text-xs flex justify-between items-center mb-3">
                <span className="text-red-700">Head Office</span>
                <span className="text-blue-900 text-sm">BANK ALFALAH</span>
                <span className="text-red-700">BAF_SHF</span>
              </div>
              <table className="w-full border-collapse border border-black text-[11px]">
                <thead>
                  <tr className="bg-gray-100 border-b border-black font-bold">
                    <th className="border border-black px-2 py-1.5 text-center w-12">SR.#</th>
                    <th className="border border-black px-2 py-1.5 text-center w-20">Code</th>
                    <th className="border border-black px-3 py-1.5 text-left">Employee Name</th>
                    <th className="border border-black px-3 py-1.5 text-left">Account Number</th>
                    <th className="border border-black px-3 py-1.5 text-right w-36">Salary Payable</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any, idx: number) => (
                    <tr key={idx} className="border-b border-black">
                      <td className="border border-black px-2 py-1 text-center">{r.sr_no || idx + 1}</td>
                      <td className="border border-black px-2 py-1 text-center font-mono font-bold">{r.code}</td>
                      <td className="border border-black px-3 py-1 font-medium">{r.employee_name}</td>
                      <td className="border border-black px-3 py-1 font-mono">{r.account_number}</td>
                      <td className="border border-black px-3 py-1 text-right font-mono font-bold">{r.salary_payable != null ? r.salary_payable.toLocaleString() : "-"}</td>
                    </tr>
                  ))}
                  <tr className="bg-yellow-100 font-bold border-t-2 border-black">
                    <td className="border border-black px-3 py-1.5 text-right" colSpan={4}>Total:</td>
                    <td className="border border-black px-3 py-1.5 text-right font-mono font-bold text-black">
                      {rows.reduce((acc: number, cur: any) => acc + (cur.salary_payable || 0), 0).toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Authorizing Signatory Footer */}
              <div className="mt-16 pt-4 border-t-2 border-black w-64 text-left">
                <span className="font-bold text-xs">Authorizg Signatory</span>
              </div>
            </div>
          )}

          {/* 8. ALL Active Employee Detail Report */}
          {reportType === "active-employees" && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-black text-[9px]">
                <thead>
                  <tr className="bg-gray-200 border-b border-black font-bold">
                    <th className="border border-black px-1 py-1">S. #</th>
                    <th className="border border-black px-1 py-1">Unit</th>
                    <th className="border border-black px-1 py-1">Location</th>
                    <th className="border border-black px-1 py-1">Code</th>
                    <th className="border border-black px-1.5 py-1 text-left">Employee Name</th>
                    <th className="border border-black px-1 py-1">Grade</th>
                    <th className="border border-black px-1 py-1 text-left">Designation</th>
                    <th className="border border-black px-1 py-1 text-left">Department</th>
                    <th className="border border-black px-1 py-1">Section</th>
                    <th className="border border-black px-1 py-1">Qualification</th>
                    <th className="border border-black px-1 py-1">Type</th>
                    <th className="border border-black px-1 py-1">Date Of Birth</th>
                    <th className="border border-black px-1 py-1">Date Of Joining</th>
                    <th className="border border-black px-1 py-1 text-red-700">Date Of Confirm</th>
                    <th className="border border-black px-1 py-1 text-right">Gross</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any, idx: number) => (
                    <tr key={idx} className="border-b border-black hover:bg-gray-50">
                      <td className="border border-black px-1 py-1 text-center">{r.sr_no || idx + 1}</td>
                      <td className="border border-black px-1 py-1 text-center">{r.unit}</td>
                      <td className="border border-black px-1 py-1">{r.location}</td>
                      <td className="border border-black px-1 py-1 font-mono font-bold text-center">{r.code}</td>
                      <td className="border border-black px-1.5 py-1 font-medium">{r.employee_name}</td>
                      <td className="border border-black px-1 py-1 text-center">{r.grade}</td>
                      <td className="border border-black px-1 py-1">{r.designation}</td>
                      <td className="border border-black px-1 py-1">{r.department}</td>
                      <td className="border border-black px-1 py-1 text-center">{r.section || ""}</td>
                      <td className="border border-black px-1 py-1 text-center">{r.qualification}</td>
                      <td className="border border-black px-1 py-1 text-center">{r.type}</td>
                      <td className="border border-black px-1 py-1 text-center font-mono">{r.date_of_birth}</td>
                      <td className="border border-black px-1 py-1 text-center font-mono">{r.date_of_joining}</td>
                      <td className="border border-black px-1 py-1 text-center font-mono text-red-700">{r.date_of_confirm}</td>
                      <td className="border border-black px-1 py-1 text-right font-mono font-bold">{r.gross != null ? r.gross.toLocaleString() : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 9. P.F Detail Report */}
          {reportType === "pf-detail" && (
            <div>
              {/* Employee Detail Block */}
              <div className="mb-4 bg-gray-50 border border-black p-2 font-bold text-xs leading-relaxed">
                <div className="flex justify-between">
                  <span>Employee Code / Name :- <span className="font-mono text-blue-900">{data?.employee_header?.code} - {data?.employee_header?.name}</span></span>
                  <span>Department :- <span className="text-blue-900">{data?.employee_header?.department}</span></span>
                </div>
                <div className="flex justify-between mt-1">
                  <span>Unit Name :- <span className="text-blue-900">{data?.employee_header?.unit}</span></span>
                  <span>Designation :- <span className="text-blue-900">{data?.employee_header?.designation}</span></span>
                </div>
              </div>

              {/* Main Monthly Table */}
              <table className="w-full border-collapse border border-black text-[10px] mb-6">
                <thead>
                  <tr className="bg-gray-200 border-b border-black font-bold text-center">
                    <th className="border border-black px-2 py-1 w-12">S.No</th>
                    <th className="border border-black px-3 py-1">Month / Year</th>
                    <th className="border border-black px-3 py-1 text-right">Actual Basic</th>
                    <th className="border border-black px-3 py-1 text-right">Earned Basic</th>
                    <th className="border border-black px-3 py-1 text-right">Actual Gross</th>
                    <th className="border border-black px-3 py-1 text-right">Earned Gross</th>
                    <th className="border border-black px-3 py-1 text-right">P.F Contribution</th>
                    <th className="border border-black px-3 py-1 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any, idx: number) => (
                    <tr key={idx} className="border-b border-black text-right font-mono">
                      <td className="border border-black px-2 py-1 text-center font-sans">{r.sr_no || idx + 1}</td>
                      <td className="border border-black px-3 py-1 text-center font-sans">{r.month_year}</td>
                      <td className="border border-black px-3 py-1">{r.actual_basic ? r.actual_basic.toLocaleString() : ""}</td>
                      <td className="border border-black px-3 py-1">{r.earned_basic ? r.earned_basic.toLocaleString() : ""}</td>
                      <td className="border border-black px-3 py-1">{r.actual_gross ? r.actual_gross.toLocaleString() : ""}</td>
                      <td className="border border-black px-3 py-1">{r.earned_gross ? r.earned_gross.toLocaleString() : ""}</td>
                      <td className="border border-black px-3 py-1">{r.pf_contribution ? r.pf_contribution.toLocaleString() : ""}</td>
                      <td className="border border-black px-3 py-1 font-bold">{r.balance ? r.balance.toLocaleString() : ""}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-100 font-bold border-t-2 border-black">
                    <td className="border border-black px-3 py-1 text-center font-sans" colSpan={2}>Total</td>
                    <td className="border border-black px-3 py-1 text-right font-mono">
                      {rows.reduce((acc: number, cur: any) => acc + (cur.actual_basic || 0), 0).toLocaleString()}
                    </td>
                    <td className="border border-black px-3 py-1 text-right font-mono">
                      {rows.reduce((acc: number, cur: any) => acc + (cur.earned_basic || 0), 0).toLocaleString()}
                    </td>
                    <td className="border border-black px-3 py-1 text-right font-mono">
                      {rows.reduce((acc: number, cur: any) => acc + (cur.actual_gross || 0), 0).toLocaleString()}
                    </td>
                    <td className="border border-black px-3 py-1 text-right font-mono">
                      {rows.reduce((acc: number, cur: any) => acc + (cur.earned_gross || 0), 0).toLocaleString()}
                    </td>
                    <td className="border border-black px-3 py-1 text-right font-mono">
                      {rows.reduce((acc: number, cur: any) => acc + (cur.pf_contribution || 0), 0).toLocaleString()}
                    </td>
                    <td className="border border-black px-3 py-1 text-right font-mono"></td>
                  </tr>
                </tbody>
              </table>

              {/* Bottom Summary Boxes */}
              <div className="grid grid-cols-2 gap-8 items-start">
                <div className="border border-black text-[11px]">
                  <div className="bg-gray-300 font-bold text-center py-1 border-b border-black uppercase tracking-wider">
                    FOR ACCOUNT DEPARTMENT
                  </div>
                  <div className="divide-y divide-black">
                    <div className="flex justify-between px-3 py-1 font-semibold">
                      <span>Employee Contribution</span>
                      <span className="font-mono">{data?.account_summary?.employee_contribution?.toLocaleString() || 0}</span>
                    </div>
                    <div className="flex justify-between px-3 py-1 font-semibold">
                      <span>Employe Contribution</span>
                      <span className="font-mono">{data?.account_summary?.employer_contribution?.toLocaleString() || 0}</span>
                    </div>
                    <div className="flex justify-between px-3 py-1">
                      <span>Less Loan Against P.F</span>
                      <span className="font-mono">{data?.account_summary?.loan_against_pf ? data.account_summary.loan_against_pf.toLocaleString() : ""}</span>
                    </div>
                    <div className="flex justify-between px-3 py-1">
                      <span>Less Permanent Withdrawal P.F</span>
                      <span className="font-mono">{data?.account_summary?.permanent_withdrawal_pf ? data.account_summary.permanent_withdrawal_pf.toLocaleString() : ""}</span>
                    </div>
                    <div className="flex justify-between px-3 py-1 font-bold bg-indigo-100 text-indigo-900 border-t border-black">
                      <span>Toat P.F</span>
                      <span className="font-mono">{data?.account_summary?.total_pf?.toLocaleString() || 0}</span>
                    </div>
                  </div>
                </div>

                <div className="border border-black text-[11px] w-64">
                  <table className="w-full text-center border-collapse">
                    <thead>
                      <tr className="bg-gray-200 border-b border-black font-bold">
                        <th className="border-r border-black px-2 py-1">P.W Date</th>
                        <th className="px-2 py-1">P.W Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-black h-8">
                        <td className="border-r border-black"></td>
                        <td></td>
                      </tr>
                      <tr className="bg-gray-100 font-bold">
                        <td className="border-r border-black px-2 py-1 text-right">Total :</td>
                        <td className="px-2 py-1"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
