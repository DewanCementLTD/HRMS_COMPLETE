"use client";

import { Fragment } from "react";
import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CompanyLogo } from "@/components/ui/CompanyLogo";
import type {
  MonthlyAttendanceReport,
  ReportMetaData, PivotReport, ReconReport, BankAdviceReport,
  AbsentSuppReport, ActiveEmployeesReport, PfDetailReport,
} from "@/services/reportService";

export type ReportType =
  | "absent-supp"
  | "allowance-detail"
  | "allowance-recon"
  | "deduction-detail"
  | "deduction-recon"
  | "month-wise-deduction"
  | "bank-advice"
  | "active-employees"
  | "pf-detail"
  | "monthly-attendance";

/** Reports whose column count needs a landscape page. */
const LANDSCAPE: ReportType[] = [
  "active-employees", "deduction-detail", "allowance-detail", "month-wise-deduction",
  // 31 day columns — portrait cannot hold it.
  "monthly-attendance",
];

// ── formatting ────────────────────────────────────────────────────

/** Money cells are blank when zero, matching the printed reports. */
const n = (v?: number | null) => (v == null || v === 0 ? "" : Math.round(v).toLocaleString());
const n0 = (v?: number | null) => Math.round(v || 0).toLocaleString();
/** Day counts keep their halves (1.5 absent days). */
const d = (v?: number | null) => (v == null ? "" : String(v));

/** "JUL-27-26 02:55 PM" — the timestamp format in the top-right of the originals. */
const stamp = (iso?: string) => {
  const t = iso ? new Date(iso) : new Date();
  const M = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][t.getMonth()];
  const dd = String(t.getDate()).padStart(2, "0");
  const yy = String(t.getFullYear()).slice(2);
  let h = t.getHours();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${M}-${dd}-${yy} ${String(h).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")} ${ap}`;
};

/** "July 27, 2026 2:54 PM" — used by the reconciliation reports. */
const longStamp = (iso?: string) => {
  const t = iso ? new Date(iso) : new Date();
  return `${t.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} ` +
    `${t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
};

const periodLine = (meta?: ReportMetaData) => {
  const p = meta?.period_labels?.filter(Boolean) ?? [];
  if (!p.length) return "";
  if (p.length === 1 || p[0] === p[1]) return `For the Month of ${p[0]}`;
  return `For the Month of ${p[0]} to ${p[1]}`;
};

// ── shared chrome ─────────────────────────────────────────────────

const TD = "border border-black px-1.5 py-[3px]";
const TH = "border border-black px-1.5 py-[3px] font-bold text-center";

/**
 * The header block shared by most reports: green filter badges on the left,
 * centred company + title, page counter and run timestamp on the right.
 */
/**
 * Scope labels repeat the company name (meta.unit_name IS the company), which
 * then prints twice — once in the scope block and once as the sheet's title.
 * Blank it in the scope block and let the title carry it.
 */
const scopeLabel = (value: string | null | undefined, companyName: string, fallback = "") => {
  const v = String(value ?? "").trim();
  if (!v) return fallback;
  return v.toLowerCase() === companyName.trim().toLowerCase() ? fallback : v;
};

function StandardHeader({
  companyName, compc, title, meta, titleClass = "text-black", badges, pages = 1,
}: {
  companyName: string; compc?: string; title: string; meta?: ReportMetaData;
  titleClass?: string; badges: string[]; pages?: number;
}) {
  return (
    <div className="relative mb-4 min-h-[74px]">
      <div className="absolute left-0 top-0 text-left font-bold text-[11px] leading-snug text-green-700">
        {/* The company already headlines the sheet beside the logo, so drop it
            from the scope badges rather than printing the name twice. */}
        {badges
          .map((b) => scopeLabel(b, companyName))
          .filter(Boolean)
          .map((b, i) => <div key={i}>{b}</div>)}
      </div>
      <div className="absolute right-0 top-0 text-right text-[10px] leading-snug text-gray-800">
        <div>Page 1 of {pages}</div>
        <div>{stamp(meta?.generated_at)}</div>
      </div>
      <div className="text-center pt-0.5">
        <div className="flex items-center justify-center gap-2">
          <CompanyLogo compc={compc} className="h-7 max-w-[70px]" />
          <h1 className="text-xl font-bold text-blue-700 tracking-wide">{companyName}</h1>
        </div>
        <h2 className={`text-sm font-bold mt-0.5 ${titleClass}`}>{title}</h2>
        {periodLine(meta) && (
          <div className="text-[11px] font-bold text-black mt-0.5">{periodLine(meta)}</div>
        )}
      </div>
    </div>
  );
}

// ── props ─────────────────────────────────────────────────────────

interface ReportPrintSheetProps {
  reportType: ReportType;
  reportTitle: string;
  // Shape depends on reportType; each branch narrows it before use.
  data: unknown;
  companyName: string;
  compc?: string;
  onClose: () => void;
}

export function ReportPrintSheet({
  reportType, reportTitle, data, companyName, compc, onClose,
}: ReportPrintSheetProps) {
  const meta = (data as { meta?: ReportMetaData } | null)?.meta;
  const landscape = LANDSCAPE.includes(reportType);

  const badges = [
    meta?.location_name || "",
    meta?.unit_name || "",
    meta?.filters?.employee ? String(meta.filters.employee) : "ALL Employee",
  ];

  const recordCount = countRecords(reportType, data);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 flex flex-col items-center p-4 print:p-0 print:bg-white print:static print:overflow-visible">
      {/* Toolbar — never printed */}
      <div className="w-full max-w-6xl bg-gray-900 text-white px-6 py-3 rounded-t-xl flex items-center justify-between shadow-lg print:hidden mb-2">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm">{reportTitle}</span>
          <span className="text-xs bg-indigo-600 px-2 py-0.5 rounded text-indigo-100 font-mono">
            {recordCount} record(s)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
            <Printer className="h-4 w-4" /> Print / Save as PDF
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} className="text-gray-300 hover:text-white">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="w-full max-w-6xl bg-white p-8 text-black shadow-2xl rounded-b-xl print:shadow-none print:rounded-none print:w-full print:max-w-none print:p-0 print:m-0 min-h-[900px] font-sans text-xs">
        <style jsx global>{`
          @media print {
            body * { visibility: hidden; }
            #printable-report-area, #printable-report-area * { visibility: visible; }
            /* The sheet occupies exactly the printable width, so the page's own
               margins are the only margins — equal on both sides by definition,
               and no column can fall off the right edge. Tables size themselves
               to this width rather than being scaled down after the fact. */
            #printable-report-area {
              position: absolute;
              top: 0; left: 0; right: 0;
              width: 100%;
              margin: 0; padding: 0;
            }
            #printable-report-area > .print-scaler { width: 100%; }
            /* An on-screen scroll wrapper must not clip the printed sheet. */
            #printable-report-area, #printable-report-area .print-scaler {
              overflow: visible !important;
            }
            /* Tinted header/total cells are meaningful here, so keep them. */
            #printable-report-area * {
              -webkit-print-color-adjust: exact; print-color-adjust: exact;
            }
            @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 10mm; }
          }
        `}</style>

        <div id="printable-report-area" className="w-full">
          {/* Wide reports still need to scroll on screen; print lays them out fully. */}
          <div className="print-scaler overflow-x-auto print:overflow-visible">
            {reportType === "absent-supp" && (
              <AbsentSuppSheet data={data as AbsentSuppReport} {...{ companyName, compc, meta, badges }} />
            )}
            {(reportType === "allowance-detail" || reportType === "deduction-detail") && (
              <PivotSheet
                data={data as PivotReport} title={reportTitle}
                {...{ companyName, compc, meta, badges }}
              />
            )}
            {reportType === "month-wise-deduction" && (
              <MonthWiseSheet data={data as PivotReport} {...{ companyName, compc, meta }} />
            )}
            {(reportType === "allowance-recon" || reportType === "deduction-recon") && (
              <ReconSheet
                data={data as ReconReport} title={reportTitle}
                {...{ companyName, meta }}
              />
            )}
            {reportType === "bank-advice" && (
              <BankAdviceSheet data={data as BankAdviceReport} {...{ companyName, compc, meta }} />
            )}
            {reportType === "active-employees" && (
              <ActiveEmployeesSheet data={data as ActiveEmployeesReport} {...{ companyName, compc, meta, badges }} />
            )}
            {reportType === "pf-detail" && (
              <PfDetailSheet data={data as PfDetailReport} {...{ companyName, compc }} />
            )}
            {reportType === "monthly-attendance" && (
              <MonthlyAttendanceSheet
                data={data as MonthlyAttendanceReport}
                {...{ companyName, compc, meta, badges }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function countRecords(t: ReportType, data: unknown): number {
  if (!data) return 0;
  const dd = data as Record<string, unknown>;
  if (Array.isArray(dd.rows)) return dd.rows.length;
  if (Array.isArray(dd.ledger)) return dd.ledger.length;
  if (Array.isArray(dd.groups)) {
    return (dd.groups as { rows: unknown[] }[]).reduce((s, g) => s + g.rows.length, 0);
  }
  return 0;
}

// ══════════════════════════════════════════════════════════════════
// 1. Employee Absent and Supplementary Days Report
// ══════════════════════════════════════════════════════════════════

function AbsentSuppSheet({ data, companyName, compc, meta, badges }: {
  data: AbsentSuppReport; companyName: string; compc?: string;
  meta?: ReportMetaData; badges: string[];
}) {
  const rows = data?.rows ?? [];
  // The original groups rows under a red department/location caption.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.location_name || "—";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  return (
    <>
      <StandardHeader
        title="Employee Absent and Supplimentary Days Report"
        {...{ companyName, compc, meta, badges }}
      />
      <table className="w-full border-collapse border border-black text-[11px]">
        <thead>
          <tr className="bg-gray-100">
            <th className={`${TH} w-12`}>Sr.#</th>
            <th className={`${TH} w-20`}>Code</th>
            <th className={TH}>Employee Name</th>
            <th className={TH}>Designation</th>
            <th className={`${TH} w-20`}>Absent</th>
            <th className={`${TH} w-20`}>S.Days</th>
          </tr>
        </thead>
        <tbody>
          {[...groups.entries()].map(([loc, list]) => (
            <>
              <tr key={loc}>
                <td className={`${TD} font-bold text-red-700`} colSpan={6}>{loc}</td>
              </tr>
              {list.map((r, i) => (
                <tr key={`${loc}-${r.code}-${i}`}>
                  <td className={`${TD} text-center`}>{r.sr_no}</td>
                  <td className={`${TD} font-mono`}>{r.code}</td>
                  <td className={`${TD} font-mono`}>{r.employee_name}</td>
                  <td className={`${TD} font-mono`}>{r.designation}</td>
                  <td className={`${TD} text-center bg-cyan-50`}>{d(r.absent)}</td>
                  <td className={`${TD} text-center bg-cyan-50`}>{d(r.s_days)}</td>
                </tr>
              ))}
            </>
          ))}
          {!rows.length && (
            <tr><td className={`${TD} text-center text-gray-500 py-4`} colSpan={6}>No records.</td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════
// 2/3. Employee Allowances & Deduction Detail (cross-tab)
// ══════════════════════════════════════════════════════════════════

function PivotSheet({ data, title, companyName, compc, meta, badges }: {
  data: PivotReport; title: string; companyName: string; compc?: string;
  meta?: ReportMetaData; badges: string[];
}) {
  const cols = data?.columns ?? [];
  const rows = data?.rows ?? [];
  // The allowance report prints an OT Hours column (orange, between the name
  // and the allowance columns); the deduction report has no equivalent.
  const ot = Boolean(data?.has_ot_hours);
  const span = cols.length + 3 + (ot ? 1 : 0);

  return (
    <>
      <StandardHeader title={title} {...{ companyName, compc, meta, badges }} />
      <table className="w-full border-collapse border border-black text-[10px]">
        <thead>
          <tr>
            <th className={`${TH} bg-cyan-50 w-16`}>Code</th>
            <th className={`${TH} bg-cyan-50 text-left`}>Employee Name</th>
            {ot && <th className={`${TH} bg-orange-100 whitespace-nowrap`}>OT HOURS</th>}
            {cols.map((c) => (
              <th key={c} className={`${TH} bg-cyan-100 whitespace-nowrap`}>{c}</th>
            ))}
            <th className={`${TH} bg-purple-200`}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              <td className={`${TD} font-mono font-bold`}>{r.code}</td>
              <td className={`${TD} font-medium whitespace-nowrap`}>{r.employee_name}</td>
              {ot && (
                <td className={`${TD} text-center font-mono bg-orange-50`}>
                  {r.ot_hours == null ? "" : r.ot_hours}
                </td>
              )}
              {cols.map((c) => (
                <td key={c} className={`${TD} text-right font-mono`}>{n(r.values[c])}</td>
              ))}
              <td className={`${TD} text-right font-mono font-bold bg-purple-50`}>{n(r.total)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td className={`${TD} text-center text-gray-500 py-4`} colSpan={span}>No records.</td></tr>
          )}
          {rows.length > 0 && (
            <tr className="bg-gray-100 font-bold">
              <td className={TD} colSpan={2}>Grand Total</td>
              {ot && (
                <td className={`${TD} text-center font-mono bg-orange-100`}>
                  {n0(rows.reduce((t, r) => t + (r.ot_hours || 0), 0))}
                </td>
              )}
              {cols.map((c) => (
                <td key={c} className={`${TD} text-right font-mono`}>{n0(data.column_totals?.[c])}</td>
              ))}
              <td className={`${TD} text-right font-mono bg-purple-100`}>{n0(data.grand_total)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════
// 4. Month Wise Deduction Report
// ══════════════════════════════════════════════════════════════════

function MonthWiseSheet({ data, companyName, compc, meta }: {
  data: PivotReport; companyName: string; compc?: string; meta?: ReportMetaData;
}) {
  const cols = data?.columns ?? [];
  const rows = data?.rows ?? [];
  const p = meta?.period_labels?.filter(Boolean) ?? [];

  // This one is left-aligned with a boxed green parameter block on the right.
  return (
    <>
      <div className="flex items-start justify-between mb-4 gap-6">
        <div>
          <div className="flex items-center gap-2">
            <CompanyLogo compc={compc} className="h-7 max-w-[70px]" />
            <h1 className="text-lg font-bold text-blue-700">{companyName}</h1>
          </div>
          <h2 className="text-sm font-bold text-red-700 mt-0.5">Month Wise Deduction Report</h2>
          {p.length > 0 && (
            <div className="text-[11px] font-bold text-black">From {p[0]} to {p[p.length - 1]}</div>
          )}
        </div>
        <div className="text-[11px] font-bold text-green-700 space-y-0.5 min-w-[240px]">
          <div className="border-b border-gray-400 pb-0.5">
            Unit :- {scopeLabel(meta?.unit_name, companyName, "A L L")}
          </div>
          <div className="border-b border-gray-400 pb-0.5">Location :- {meta?.location_name || "A L L"}</div>
          <div className="border-b border-gray-400 pb-0.5">
            Department :- {meta?.filters?.department ? String(meta.filters.department) : "A L L"}
          </div>
          <div className="border-b border-gray-400 pb-0.5">
            Report Type :- {meta?.filters?.deduction ? String(meta.filters.deduction) : ""} (Recovery)
          </div>
        </div>
        <div className="text-right text-[10px] whitespace-nowrap">
          <div>{stamp(meta?.generated_at)}</div>
          <div className="font-bold">Page 1 of 1</div>
        </div>
      </div>

      <table className="w-full border-collapse border border-black text-[10px]">
        <thead>
          <tr className="bg-cyan-100">
            <th className={`${TH} w-16`}>Code</th>
            <th className={`${TH} text-left`}>Employee Name</th>
            {cols.map((c) => <th key={c} className={`${TH} whitespace-nowrap`}>{c}</th>)}
            <th className={TH}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              <td className={`${TD} font-mono font-bold`}>{r.code}</td>
              <td className={`${TD} whitespace-nowrap`}>{r.employee_name}</td>
              {cols.map((c) => <td key={c} className={`${TD} text-right font-mono`}>{n(r.values[c])}</td>)}
              <td className={`${TD} text-right font-mono font-bold`}>{n(r.total)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td className={`${TD} text-center text-gray-500 py-4`} colSpan={cols.length + 3}>No records.</td></tr>
          )}
          {rows.length > 0 && (
            <tr className="bg-gray-100 font-bold">
              <td className={TD} colSpan={2}>Grand Total</td>
              {cols.map((c) => <td key={c} className={`${TD} text-right font-mono`}>{n0(data.column_totals?.[c])}</td>)}
              <td className={`${TD} text-right font-mono`}>{n0(data.grand_total)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════
// 5/6. Payroll Reconciliation Detail (Allowance / Deduction)
// ══════════════════════════════════════════════════════════════════

function ReconSheet({ data, title, companyName, meta }: {
  data: ReconReport; title: string; companyName: string; meta?: ReportMetaData;
}) {
  const groups = data?.groups ?? [];
  const p = meta?.period_labels?.filter(Boolean) ?? [];
  const [from, to] = [p[0] ?? "", p[1] ?? p[0] ?? ""];

  return (
    <>
      <div className="mb-3">
        <div className="flex items-start justify-between">
          <h1 className="text-lg font-bold text-black uppercase">{companyName}</h1>
          <div className="font-bold underline text-sm">{meta?.location_name}</div>
        </div>
        <h2 className="text-sm font-bold text-black">{title}</h2>
        <div className="text-[11px] font-bold underline mt-1">
          For the Month Of {from.toUpperCase()} And {to.toUpperCase()}
        </div>
        <div className="text-right text-[10px] mt-1">
          Report run on:&nbsp;&nbsp;&nbsp;{longStamp(meta?.generated_at)}
        </div>
      </div>

      {groups.map((g) => (
        <table key={g.trans_id} className="w-full border-collapse border border-black text-[11px] mb-4">
          <thead>
            <tr>
              <th className={`${TH} text-blue-700`} colSpan={4}>{g.descr}</th>
            </tr>
            <tr>
              <th className={`${TH} text-left`} colSpan={2}>Employee Code And Name</th>
              <th className={`${TH} w-28`}>{from.toUpperCase()}</th>
              <th className={`${TH} w-28`}>{to.toUpperCase()}</th>
              <th className={`${TH} w-24`}>Variance</th>
            </tr>
          </thead>
          <tbody>
            {g.rows.map((r, i) => (
              <tr key={`${r.code}-${i}`}>
                <td className={`${TD} font-mono w-16 text-center`}>{r.code}</td>
                <td className={TD}>{r.employee_name}</td>
                <td className={`${TD} text-right font-mono`}>{n(r.from_amount)}</td>
                <td className={`${TD} text-right font-mono`}>{n(r.to_amount)}</td>
                <td className={`${TD} text-right font-mono`}>{n(r.variance)}</td>
              </tr>
            ))}
            <tr className="font-bold text-blue-700">
              <td className={TD} colSpan={2}>Total Of {g.descr}</td>
              <td className={`${TD} text-right font-mono`}>{n0(g.totals.from_amount)}</td>
              <td className={`${TD} text-right font-mono`}>{n0(g.totals.to_amount)}</td>
              <td className={`${TD} text-right font-mono`}>{n0(g.totals.variance)}</td>
            </tr>
          </tbody>
        </table>
      ))}
      {!groups.length && <div className="text-center text-gray-500 py-6">No records.</div>}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════
// 7. Bank Advice
// ══════════════════════════════════════════════════════════════════

function BankAdviceSheet({ data, companyName, compc, meta }: {
  data: BankAdviceReport; companyName: string; compc?: string; meta?: ReportMetaData;
}) {
  const groups = data?.groups ?? [];
  const grp = meta?.filters?.desg_grp;

  return (
    <>
      <div className="relative mb-4 min-h-[70px]">
        <div className="absolute left-6 top-0 text-[11px] font-bold leading-snug">
          <div className="text-red-700">{grp ? `Designation Group ${grp}` : "ALL Designations"}</div>
          <div className="text-green-700 text-center">{scopeLabel(meta?.unit_name, companyName)}</div>
        </div>
        <div className="absolute right-0 top-0 text-[10px]">{stamp(meta?.generated_at)}</div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-2">
            <CompanyLogo compc={compc} className="h-7 max-w-[70px]" />
            <h1 className="text-xl font-bold text-blue-700">{companyName}</h1>
          </div>
          <h2 className="text-sm font-bold text-red-700 mt-0.5">Bank Advice</h2>
          {periodLine(meta) && <div className="text-[11px] font-bold mt-0.5">{periodLine(meta)}</div>}
        </div>
      </div>

      {groups.map((g) => (
        <table key={`${g.bank_code}-${g.branch_code}`} className="w-full border-collapse border border-black text-[11px] mb-4">
          <thead>
            <tr className="bg-lime-200">
              <th className={`${TH} text-red-700`} colSpan={2}>{g.location_name}</th>
              <th className={`${TH} text-blue-700`} colSpan={2}>{g.bank_name}</th>
              <th className={`${TH} text-red-700`}>{g.branch_name}</th>
            </tr>
            <tr>
              <th className={`${TH} w-12`}>SR.#</th>
              <th className={`${TH} w-20`}>Code</th>
              <th className={TH}>Employee Name</th>
              <th className={TH}>Account Number</th>
              <th className={`${TH} w-32`}>Salary Payable</th>
            </tr>
          </thead>
          <tbody>
            {g.rows.map((r, i) => (
              <tr key={r.code}>
                <td className={`${TD} text-center`}>{i + 1}</td>
                <td className={`${TD} font-mono`}>{r.code}</td>
                <td className={TD}>{r.employee_name}</td>
                <td className={`${TD} text-center font-mono`}>{r.account_number}</td>
                <td className={`${TD} text-right font-mono`}>{n0(r.salary_payable)}</td>
              </tr>
            ))}
            <tr className="bg-lime-200 font-bold">
              <td className={`${TD} text-center`} colSpan={4}>Total:</td>
              <td className={`${TD} text-right font-mono`}>{n0(g.total)}</td>
            </tr>
          </tbody>
        </table>
      ))}
      {!groups.length && <div className="text-center text-gray-500 py-6">No records.</div>}

      <div className="mt-16 ml-8">
        <div className="border-t border-black w-56" />
        <div className="font-bold text-sm mt-1">Authorizg Signatory</div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════
// 8. ALL Active Employee Detail Report
// ══════════════════════════════════════════════════════════════════

function ActiveEmployeesSheet({ data, companyName, compc, meta, badges }: {
  data: ActiveEmployeesReport; companyName: string; compc?: string;
  meta?: ReportMetaData; badges: string[];
}) {
  const rows = data?.rows ?? [];
  const label = { A: "ALL Active", C: "Confirmed", U: "Un-Confirmed" }[
    String(meta?.filters?.rtype ?? "A") as "A" | "C" | "U"
  ];

  return (
    <>
      <div className="relative mb-3 min-h-[62px]">
        <div className="absolute left-0 top-0 text-[11px] font-bold leading-snug">
          <div className="text-red-700">
            {meta?.filters?.department ? String(meta.filters.department) : "ALL Department"}
          </div>
          <div className="text-green-700">{scopeLabel(badges[1], companyName)}</div>
          <div className="text-green-700">{scopeLabel(badges[0], companyName)}</div>
        </div>
        <div className="absolute right-0 top-0 text-right text-[10px] leading-snug">
          <div>Page 1 of 1</div>
          <div>{stamp(meta?.generated_at)}</div>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-2">
            <CompanyLogo compc={compc} className="h-7 max-w-[70px]" />
            <h1 className="text-lg font-bold text-blue-700">{companyName}</h1>
          </div>
          <h2 className="text-sm font-bold text-red-700 mt-0.5">{label} Employee Detail Report</h2>
        </div>
      </div>

      <table className="w-full border-collapse border border-black text-[9px]">
        <thead>
          <tr className="bg-gray-100">
            {["S. #", "Unit", "Location", "Code", "Employee Name", "Grade", "Designation",
              "Department", "Section", "Qualification", "Type", "Date Of Birth",
              "Date Of Joining", "Date Of Confirm", "Gross"].map((h) => (
              <th key={h} className={`${TH} whitespace-nowrap`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              <td className={`${TD} text-center`}>{r.sr_no}</td>
              <td className={`${TD} whitespace-nowrap`}>{r.unit}</td>
              <td className={`${TD} whitespace-nowrap`}>{r.location}</td>
              <td className={`${TD} font-mono text-center`}>{r.code}</td>
              <td className={`${TD} whitespace-nowrap`}>{r.employee_name}</td>
              <td className={`${TD} text-center`}>{r.grade}</td>
              <td className={`${TD} whitespace-nowrap`}>{r.designation}</td>
              <td className={`${TD} whitespace-nowrap`}>{r.department}</td>
              <td className={`${TD} whitespace-nowrap`}>{r.section}</td>
              <td className={`${TD} whitespace-nowrap`}>{r.qualification}</td>
              <td className={`${TD} whitespace-nowrap`}>{r.emp_type}</td>
              <td className={`${TD} whitespace-nowrap text-center`}>{r.date_of_birth}</td>
              <td className={`${TD} whitespace-nowrap text-center`}>{r.date_of_joining}</td>
              <td className={`${TD} whitespace-nowrap text-center text-red-700`}>{r.date_of_confirm}</td>
              <td className={`${TD} text-right font-mono`}>{n(r.gross)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td className={`${TD} text-center text-gray-500 py-4`} colSpan={15}>No records.</td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════
// 9. P.F Detail Report
// ══════════════════════════════════════════════════════════════════

function PfDetailSheet({ data, companyName, compc }: {
  data: PfDetailReport; companyName: string; compc?: string;
}) {
  const h = data?.employee_header;
  const ledger = data?.ledger ?? [];
  const t = data?.totals;
  const a = data?.account_summary;

  const SUM_TD = "border border-gray-500 px-2 py-1";

  return (
    <>
      <div className="mb-3">
        <div className="flex items-center gap-2">
          <CompanyLogo compc={compc} className="h-8 max-w-[80px]" />
          <h1 className="text-xl font-bold text-blue-700">{companyName}</h1>
        </div>
        <h2 className="text-sm font-bold text-red-700 underline mt-1">P.F Detail Report</h2>
        <div className="grid grid-cols-2 gap-x-8 mt-2 text-[11px] font-bold">
          <div>Employee Code / Name :- {h?.code}{h?.name ? ` - ${h.name}` : ""}</div>
          <div>Department :- {h?.department}</div>
          <div className="pl-8">Unit Name :- {h?.unit}</div>
          <div>Designation :- {h?.designation}</div>
        </div>
      </div>

      <table className="w-full border-collapse text-[11px] mb-6">
        <thead>
          <tr className="bg-gray-200">
            {["S.No", "Month / Year", "Actual Basic", "Earned Basic", "Actual Gross",
              "Earned Gross", "P.F Contribution", "Balance"].map((c) => (
              <th key={c} className="border border-gray-500 px-2 py-1.5 font-bold text-center">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ledger.map((r) => (
            <tr key={r.period}>
              <td className={`${SUM_TD} text-center`}>{r.sr_no}</td>
              <td className={`${SUM_TD} text-center`}>{r.month_year}</td>
              <td className={`${SUM_TD} text-right font-mono`}>{n(r.actual_basic)}</td>
              <td className={`${SUM_TD} text-right font-mono`}>{n(r.earned_basic)}</td>
              <td className={`${SUM_TD} text-right font-mono`}>{n(r.actual_gross)}</td>
              <td className={`${SUM_TD} text-right font-mono`}>{n(r.earned_gross)}</td>
              <td className={`${SUM_TD} text-right font-mono`}>{n(r.pf_contribution)}</td>
              <td className={`${SUM_TD} text-right font-mono`}>{n(r.balance)}</td>
            </tr>
          ))}
          {!ledger.length && (
            <tr><td className={`${SUM_TD} text-center text-gray-500 py-4`} colSpan={8}>No records.</td></tr>
          )}
          {ledger.length > 0 && (
            <tr className="bg-gray-200 font-bold">
              <td className={`${SUM_TD} text-center`} colSpan={2}>Total</td>
              <td className={`${SUM_TD} text-right font-mono`}>{n0(t?.actual_basic)}</td>
              <td className={`${SUM_TD} text-right font-mono`}>{n0(t?.earned_basic)}</td>
              <td className={`${SUM_TD} text-right font-mono`}>{n0(t?.actual_gross)}</td>
              <td className={`${SUM_TD} text-right font-mono`}>{n0(t?.earned_gross)}</td>
              <td className={`${SUM_TD} text-right font-mono`}>{n0(t?.pf_contribution)}</td>
              <td className={SUM_TD} />
            </tr>
          )}
        </tbody>
      </table>

      <table className="border-collapse text-[12px] mb-6 w-[520px]">
        <thead>
          <tr className="bg-gray-200">
            <th className="border border-gray-500 px-2 py-2 font-bold text-center text-base" colSpan={2}>
              FOR ACCOUNT DEPARTMENT
            </th>
          </tr>
        </thead>
        <tbody>
          {[
            ["Employee Contribution", a?.employee_contribution],
            ["Employe Contribution", a?.employer_contribution],
            ["Less Loan Aginst P.F", a?.loan_against_pf],
            ["Less Permanent Withdrawal P.F", a?.permanent_withdrawal_pf],
          ].map(([lbl, val]) => (
            <tr key={String(lbl)}>
              <td className={`${SUM_TD} font-bold`}>{lbl}</td>
              <td className={`${SUM_TD} text-right font-mono font-bold w-40`}>{n(val as number)}</td>
            </tr>
          ))}
          <tr className="bg-indigo-300">
            <td className={`${SUM_TD} font-bold text-white`}>Toat P.F</td>
            <td className={`${SUM_TD} text-right font-mono font-bold`}>{n0(a?.total_pf)}</td>
          </tr>
        </tbody>
      </table>

      <table className="border-collapse text-[12px] w-[380px]">
        <thead>
          <tr className="bg-gray-200">
            <th className="border border-gray-500 px-2 py-1.5 font-bold text-center">P.W Date</th>
            <th className="border border-gray-500 px-2 py-1.5 font-bold text-center">P.W Amount</th>
          </tr>
        </thead>
        <tbody>
          {(data?.pw_withdrawals ?? []).map((w, i) => (
            <tr key={i}>
              <td className={`${SUM_TD} text-center`}>{w.date}</td>
              <td className={`${SUM_TD} text-right font-mono`}>{n(w.amount)}</td>
            </tr>
          ))}
          {!data?.pw_withdrawals?.length && (
            <tr><td className={SUM_TD}>&nbsp;</td><td className={SUM_TD} /></tr>
          )}
          <tr className="bg-gray-200 font-bold">
            <td className={`${SUM_TD} text-right`}>Total :</td>
            <td className={`${SUM_TD} text-right font-mono`}>
              {n((data?.pw_withdrawals ?? []).reduce((s, w) => s + w.amount, 0))}
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

/**
 * Monthly attendance grid — the wide day-by-day sheet HR prints each cycle.
 *
 * Laid out like the ERP original: a branch caption, then a department caption,
 * then one row per employee with the punch pair stacked in each day column and
 * the cycle totals on the right. Cells are tinted the way the attendance
 * screens tint them, so late / half day / absent / leave read at a glance.
 */
/** Grid cells carry their own padding: the shared TH/TD set px-1.5, which is
 *  far too wide once 31 day columns have to share the page. */
const MTH = "border border-black py-[2px] font-bold text-center align-middle";
const MTD = "border border-black py-[1px] align-middle";

function MonthlyAttendanceSheet({ data, companyName, compc, meta, badges }: {
  data: MonthlyAttendanceReport; companyName: string; compc?: string;
  meta?: ReportMetaData; badges: string[];
}) {
  const days = data?.days ?? [];
  const groups = data?.groups ?? [];
  const colCount = 4 + days.length + 4;

  return (
    <>
      <StandardHeader
        title="Monthly Attendance Report"
        {...{ companyName, compc, meta, badges }}
      />
      {groups.map((g) => {
        // Rows arrive sorted by department, so a caption is emitted whenever it
        // changes rather than nesting another loop.
        let lastDept: string | null = null;
        let sr = 0;
        // table-fixed so every branch's table lines up: with automatic layout
        // each table sizes its own columns and the branches print at different
        // widths, which is what made the sheet look ragged.
        return (
          <table key={g.branch} className="w-full table-fixed border-collapse border border-black text-[7px] leading-tight mb-4">
            {/* Percentage widths that add up to 100%: the table then fits the
                printable width exactly, whatever the day count, so no column can
                be pushed off the page and every branch table lines up. */}
            <colgroup>
              <col style={{ width: "2.2%" }} />
              <col style={{ width: "5.5%" }} />
              <col style={{ width: "5.5%" }} />
              <col style={{ width: "13%" }} />
              {days.map((d0) => (
                <col key={d0.date} style={{ width: `${63.8 / Math.max(days.length, 1)}%` }} />
              ))}
              <col style={{ width: "2.5%" }} />
              <col style={{ width: "2.5%" }} />
              <col style={{ width: "2.5%" }} />
              <col style={{ width: "2.5%" }} />
            </colgroup>
            <thead>
              <tr>
                <th className={`${MTH} text-left bg-gray-200`} colSpan={colCount}>
                  Branch : {g.branch}
                </th>
              </tr>
              {/* Two header rows so the four count columns sit under a single
                  "Total" caption, the way the ERP original prints it. The
                  identity and day columns span both rows. */}
              <tr className="bg-gray-100">
                <th rowSpan={2} className={`${MTH} px-0.5`}>Sr</th>
                <th rowSpan={2} className={`${MTH} px-0.5`}>Card No</th>
                <th rowSpan={2} className={`${MTH} px-0.5`}>Emp No</th>
                <th rowSpan={2} className={`${MTH} px-1 text-left`}>Employee Name</th>
                {days.map((d0) => (
                  <th key={d0.date} rowSpan={2} className={`${MTH} text-center px-0`}>
                    <div>{d0.date.slice(8, 10)}</div>
                    <div className="font-normal">{d0.dow}</div>
                  </th>
                ))}
                <th colSpan={4} className={`${MTH} text-center`}>Total</th>
              </tr>
              <tr className="bg-gray-100">
                <th className={`${MTH} text-center px-0`}>Pre</th>
                <th className={`${MTH} text-center px-0`}>Abs</th>
                <th className={`${MTH} text-center px-0`}>Late</th>
                <th className={`${MTH} text-center px-0`}>Lv</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r, i) => {
                const deptCaption = r.department !== lastDept ? r.department : null;
                if (deptCaption !== null) { lastDept = r.department; sr = 0; }
                sr += 1;
                return (
                  <Fragment key={`${g.branch}-${r.department}-${r.card_no}-${i}`}>
                    {deptCaption !== null && (
                      <tr>
                        <td className={`${MTD} font-bold text-red-700`} colSpan={colCount}>
                          Department : {deptCaption}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className={`${MTD} text-center px-0.5`}>{sr}</td>
                      <td className={`${MTD} font-mono px-0.5 text-center break-all`}>{r.card_no}</td>
                      <td className={`${MTD} font-mono px-0.5 text-center break-all`}>{r.emp_no}</td>
                      <td className={`${MTD} px-1 break-words`}>{r.employee_name}</td>
                      {days.map((d0) => {
                        const c = r.days?.[d0.date];
                        const tint = !c ? ""
                          : c.is_leave ? "bg-indigo-100"
                          : c.is_absent ? "bg-red-100"
                          : c.is_half_day ? "bg-orange-100"
                          : c.is_late ? "bg-yellow-100"
                          : c.is_rest ? "bg-sky-100"
                          : "";
                        return (
                          <td key={d0.date} className={`${MTD} text-center px-0 leading-tight ${tint}`}>
                            {!c ? "" : c.is_leave ? (c.leave_type || "L")
                              : c.is_absent ? "A"
                              : c.is_rest && !c.in_time ? "R"
                              : c.in_time || c.out_time
                                ? <>{c.in_time ?? "—"}<br />{c.out_time ?? "—"}</>
                                : ""}
                          </td>
                        );
                      })}
                      <td className={`${MTD} text-center px-0 bg-cyan-50`}>{r.present_days}</td>
                      <td className={`${MTD} text-center px-0 bg-cyan-50`}>{r.absent_days}</td>
                      <td className={`${MTD} text-center px-0 bg-cyan-50`}>{r.late_days}</td>
                      <td className={`${MTD} text-center px-0 bg-cyan-50`}>{r.leave_days}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        );
      })}
    </>
  );
}
