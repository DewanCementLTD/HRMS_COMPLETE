"use client";

/**
 * The HR department's attendance report formats (HR_Report_Format.xlsx):
 *
 *   monthly-attendance  Monthly Attendance Report — a code per day + DED / E Days
 *   monthly-absent      Monthly Absent Report     — only A / HD days, DED
 *   monthly-late        Monthly Late Report       — only PL days, count as DED
 *   monthly-late-times  Monthly Late Report       — in / out times, Late count
 *   late-arrival        Monthly Late Arrival      — in time on late days only
 *   time-sheet          Time Sheet                — one page per employee
 *
 * All six read the same /reports/monthly-attendance response; they differ only
 * in which rows and cells they keep and how they print. Colours follow the
 * originals so a large sheet can be scanned by colour alone.
 */

import { Fragment } from "react";
import type { CSSProperties } from "react";
import { CompanyLogo } from "@/components/ui/CompanyLogo";
import type {
  MonthlyAttendanceReport, MonthlyAttendanceRow, MonthlyAttendanceCell, MonthlyAttendanceDay, ReportMetaData,
} from "@/services/reportService";
import { downloadTableCsv } from "@/lib/printTable";

export const ATT_FORMATS = [
  "monthly-attendance", "monthly-absent", "monthly-late", "monthly-late-times", "late-arrival", "time-sheet",
] as const;
export type AttFormat = (typeof ATT_FORMATS)[number];
export const isAttFormat = (t: string | null | undefined): t is AttFormat =>
  !!t && (ATT_FORMATS as readonly string[]).includes(t);

export const ATT_TITLES: Record<AttFormat, string> = {
  "monthly-attendance": "MONTHLY ATTENDANCE REPORT",
  "monthly-absent": "Monthly Absent Report",
  "monthly-late": "Monthly Late Report",
  "monthly-late-times": "MONTHLY LATE REPORT",
  "late-arrival": "Monthly Late Arrival Report",
  "time-sheet": "Time Sheet",
};

// ── colours (from the screenshots) ───────────────────────────────────

const GREY = "#9a9a9a";
const CODE_BG: Record<string, string> = {
  R: "#7fb7dd",    // rest day — blue
  H: "#e5ddb5",    // holiday — khaki
  A: GREY,         // absent — grey
  HD: "#f4511e",   // half day — orange-red
  EL: "#4fd1c5",   // earned leave — teal
  HP: "#22c55e",   // green
};
/** Present codes and out-door duty print on white. */
const PLAIN = new Set(["PO", "PL", "OD", ""]);
const LEAVE_BG = "#a7e8e0"; // any other leave type — light teal

export function codeStyle(code: string | undefined | null): CSSProperties {
  const c = String(code ?? "");
  if (PLAIN.has(c)) return {};
  return { backgroundColor: CODE_BG[c] ?? LEAVE_BG, color: "#000" };
}

export const DED_STYLE: CSSProperties = { color: "#dc2626", fontWeight: 700 };
export const EDAYS_STYLE: CSSProperties = { color: "#c026d3", fontWeight: 700 };

/** What a cell shows in each grid format ("" = blank cell). */
export function cellCode(type: AttFormat, c?: MonthlyAttendanceCell): string {
  if (!c) return "";
  if (type === "monthly-absent") return c.code === "A" || c.code === "HD" ? c.code : "";
  if (type === "monthly-late") return c.code === "PL" ? "PL" : "";
  return c.code ?? "";
}
// Column naming follows the ERP EMPLOYEE view the originals print from:
// "Card No" = CARD_NO (= EMPCODE, the roster card) and "Emp No" = EMP_NO
// (= HR_EMP_MASTER.ATDTCARD#, e.g. A-483) — row.code and row.card_no here.

/** Absent / late grids shade their marks grey, as the originals do. */
function gridCellStyle(type: AttFormat, code: string): CSSProperties {
  if (!code) return {};
  if (type === "monthly-absent" || type === "monthly-late") return { backgroundColor: GREY, color: "#000" };
  return codeStyle(code);
}

/** Rows each format keeps: absent sheet = employees with deductions, late sheets = with a late day. */
export function keepRow(type: AttFormat, r: MonthlyAttendanceRow): boolean {
  if (type === "monthly-absent") return (r.ded_days ?? 0) > 0;
  if (type === "monthly-late" || type === "monthly-late-times" || type === "late-arrival") return (r.pl_days ?? 0) > 0;
  return true;
}

/** The summary figure of a row in a format. */
const dedOf = (type: AttFormat, r: MonthlyAttendanceRow) =>
  type === "monthly-late" ? r.pl_days : r.ded_days;

/** Late-arrival columns: only the days someone was late. */
export function lateDates(days: MonthlyAttendanceDay[], rows: MonthlyAttendanceRow[]): MonthlyAttendanceDay[] {
  return days.filter((d) => rows.some((r) => r.days?.[d.date]?.code === "PL"));
}

/** Data narrowed to the rows a format keeps (empty groups dropped). */
export function narrowReport(type: AttFormat, data: MonthlyAttendanceReport | null): MonthlyAttendanceReport | null {
  if (!data) return data;
  return {
    ...data,
    groups: (data.groups ?? [])
      .map((g) => ({ ...g, rows: g.rows.filter((r) => keepRow(type, r)) }))
      .filter((g) => g.rows.length > 0),
  };
}

// ── formatting ───────────────────────────────────────────────────────

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "2026-10-21" → "21-OCT-26" */
export const dmy = (ymd?: string | number | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? ""));
  return m ? `${m[3]}-${MON[Number(m[2]) - 1]}-${m[1].slice(2)}` : "";
};
/** Name as printed, with "(Left 18-Aug-26)" for someone who left in the range. */
const nameOf = (r: MonthlyAttendanceRow) =>
  r.left_on ? `${r.employee_name} (Left ${dmy(r.left_on)})` : r.employee_name;

const dayName = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return DAY_LONG[new Date(y, m - 1, d).getDay()] ?? "";
};
/** "00:26" → "0:26", the way the time sheet prints durations. */
const dur = (hhmm?: string | null) => (hhmm ? hhmm.replace(/^0(\d):/, "$1:") : "");
const runStamp = (iso?: string) => {
  const t = iso ? new Date(iso) : new Date();
  return `${t.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).replace(/,/g, "")} ` +
    t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};
const runOn = (iso?: string) => {
  const t = iso ? new Date(iso) : new Date();
  return `${t.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} ${t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
};
const monthOf = (ymd?: string | number | null) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(ymd ?? ""));
  return m ? `${MONTH_LONG[Number(m[2]) - 1]},${m[1]}` : "";
};

/** Rows of a branch group split by department, in order. */
function byDepartment(rows: MonthlyAttendanceRow[]): [string, MonthlyAttendanceRow[]][] {
  const m = new Map<string, MonthlyAttendanceRow[]>();
  for (const r of rows) {
    const k = r.department || "—";
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return [...m.entries()];
}

// ── CSV ──────────────────────────────────────────────────────────────

export function downloadAttCsv(type: AttFormat, data: MonthlyAttendanceReport, companyName: string) {
  const narrowed = narrowReport(type, data)!;
  const rows = narrowed.groups.flatMap((g) => g.rows);
  const multi = rows.some((r) => r.company);
  const days = type === "late-arrival" ? lateDates(data.days, rows) : data.days;
  const cell = (r: MonthlyAttendanceRow, d: string) => {
    const c = r.days?.[d];
    if (!c) return "";
    if (type === "monthly-late-times") return [c.in_time, c.out_time].filter(Boolean).join(" - ");
    if (type === "late-arrival") return c.code === "PL" ? c.in_time ?? "" : "";
    return cellCode(type, c);
  };
  const summary = type === "monthly-attendance" || type === "time-sheet" ? ["DED", "E Days"]
    : type === "monthly-late-times" || type === "late-arrival" ? ["Late"] : ["DED"];
  downloadTableCsv({
    title: `${ATT_TITLES[type]} ${dmy(data.meta?.filters?.from_date)} TO ${dmy(data.meta?.filters?.to_date)}`,
    companyName,
    columns: [
      "Sr.#", ...(multi ? ["Company"] : []), "Branch", "Department", "Card No", "Emp No", "Emp Name", "Designation",
      ...days.map((d) => d.date.slice(8, 10)), ...summary,
    ],
    rows: rows.map((r, i) => [
      String(i + 1), ...(multi ? [r.company ?? ""] : []), r.branch, r.department, r.code, r.card_no, nameOf(r), r.designation,
      ...days.map((d) => cell(r, d.date)),
      ...(summary.length === 2 ? [String(r.ded_days), String(r.e_days)]
        : summary[0] === "Late" ? [String(r.pl_days)] : [String(dedOf(type, r))]),
    ]),
  });
}

// ── on-screen table cells (used by the reports page) ─────────────────

const STH = "px-3 py-2.5 text-left font-bold text-gray-700 whitespace-nowrap";
const STD = "px-3 py-2 whitespace-nowrap";

export function AttScreenHead({ type, columns, stickyId }: { type: AttFormat; columns: string[]; stickyId: string }) {
  const summary = type === "monthly-attendance" || type === "time-sheet" ? ["DED", "E Days"]
    : type === "monthly-late-times" || type === "late-arrival" ? ["Late"] : ["DED"];
  return (
    <>
      <th className={`${STH} w-14`}>Sr.#</th>
      <th className={STH}>Card No</th>
      <th className={`${STH} ${stickyId}`}>Emp No</th>
      <th className={STH}>Emp Name</th>
      <th className={STH}>Designation</th>
      <th className={STH}>Department</th>
      {columns.map((d) => (
        <th key={d} className={`${STH} text-center px-1`} title={d}>{d.slice(8, 10)}</th>
      ))}
      {summary.map((s) => <th key={s} className={`${STH} text-center`}>{s}</th>)}
    </>
  );
}

export function AttScreenRow({ type, columns, row: r, idx, stickyId }: {
  type: AttFormat; columns: string[]; row: MonthlyAttendanceRow; idx: number; stickyId: string;
}) {
  return (
    <>
      <td className={`${STD} font-mono`}>{idx + 1}</td>
      <td className={`${STD} font-mono text-gray-700`}>{r.code}</td>
      <td className={`${STD} font-mono font-bold text-gray-900 ${stickyId}`}>{r.card_no}</td>
      <td className={`${STD} font-medium text-gray-900`}>
        {r.employee_name}
        {r.left_on && (
          <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 whitespace-nowrap">
            Left {dmy(r.left_on)}
          </span>
        )}
      </td>
      <td className={`${STD} text-gray-600`}>{r.designation}</td>
      <td className={`${STD} text-gray-600`}>{r.department}</td>
      {columns.map((d) => {
        const c = r.days?.[d];
        if (type === "monthly-late-times") {
          const late = c?.code === "PL";
          return (
            <td key={d} className="px-1 py-1 text-center text-[10px] leading-tight font-mono whitespace-nowrap"
              style={late ? { backgroundColor: "#fde68a" } : codeStyle(c && !c.in_time ? c.code : "")}
              title={c?.remarks ?? undefined}>
              {c?.in_time || c?.out_time ? <>{c.in_time ?? "—"}<br />{c.out_time ?? "—"}</> : c && !c.in_time ? c.code : ""}
            </td>
          );
        }
        if (type === "late-arrival") {
          return (
            <td key={d} className="px-1.5 py-1 text-center text-[11px] font-mono">
              {c?.code === "PL" ? c.in_time : ""}
            </td>
          );
        }
        const code = cellCode(type, c);
        return (
          <td key={d} className="px-1 py-1 text-center text-[11px] font-bold" style={gridCellStyle(type, code)}
            title={c?.remarks ?? undefined}>
            {code}
          </td>
        );
      })}
      {type === "monthly-attendance" || type === "time-sheet" ? (
        <>
          <td className={`${STD} text-center`} style={DED_STYLE}>{r.ded_days.toFixed(1)}</td>
          <td className={`${STD} text-center`} style={EDAYS_STYLE}>{r.e_days}</td>
        </>
      ) : type === "monthly-late-times" || type === "late-arrival" ? (
        <td className={`${STD} text-center`} style={EDAYS_STYLE}>{r.pl_days}</td>
      ) : (
        <td className={`${STD} text-center`} style={DED_STYLE}>{dedOf(type, r)}</td>
      )}
    </>
  );
}

/** Colour key shown above the on-screen grid. */
export function AttLegend({ type }: { type: AttFormat }) {
  if (type === "late-arrival") return null;
  const items: [string, string, CSSProperties][] =
    type === "monthly-absent" ? [["A", "Absent (1 day)", { backgroundColor: GREY }], ["HD", "Half day (0.5)", { backgroundColor: GREY }]]
    : type === "monthly-late" ? [["PL", "Present late", { backgroundColor: GREY }]]
    : type === "monthly-late-times" ? [["09:45", "Late day (in / out)", { backgroundColor: "#fde68a" }]]
    : [
        ["PO", "Present on time", {}], ["PL", "Present late", {}], ["OD", "Out-door duty", {}],
        ["HD", "Half day", codeStyle("HD")], ["A", "Absent", codeStyle("A")], ["R", "Rest day", codeStyle("R")],
        ["H", "Holiday", codeStyle("H")], ["EL", "Earned leave", codeStyle("EL")], ["CL", "Other leave", codeStyle("CL")],
      ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-2 text-[11px] text-gray-600 border-b border-gray-200 bg-white">
      {items.map(([c, label, st]) => (
        <span key={c} className="inline-flex items-center gap-1.5">
          <span className="inline-flex min-w-[26px] justify-center rounded border border-gray-300 px-1 font-bold text-black" style={st}>{c}</span>
          {label}
        </span>
      ))}
      {(type === "monthly-attendance" || type === "time-sheet") && (
        <span>· <b style={DED_STYLE}>DED</b> = absent + ½ half days · <b style={EDAYS_STYLE}>E Days</b> = days − DED</span>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Print sheets
// ══════════════════════════════════════════════════════════════════

const B = "border border-black";
const PTH = `${B} py-[2px] font-bold text-center align-middle`;
const PTD = `${B} py-[1px] align-middle`;

/** Boxed header of the Dewan formats: company + branch left, title centre, range right. */
function BoxHeader({ companyName, compc, branch, meta, title, titleStyle, subtitle }: {
  companyName: string; compc?: string; branch: string; meta?: ReportMetaData;
  title: string; titleStyle?: CSSProperties; subtitle?: string;
}) {
  return (
    <div className={`${B} border-2 px-3 py-2 mb-3 flex items-stretch gap-4`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <CompanyLogo compc={compc} className="h-7 max-w-[70px]" />
          <div className="font-mono text-[17px] leading-tight">{companyName}</div>
        </div>
        {branch && <div className="font-mono text-[14px] leading-tight mt-1">{branch}</div>}
        <div className="text-[9px] mt-1.5">{runStamp(meta?.generated_at)}</div>
      </div>
      <div className="flex-1 flex flex-col items-center justify-end text-center pb-0.5">
        <div className="font-mono text-[16px]" style={titleStyle}>{title}</div>
        {subtitle && <div className="font-mono text-[11px] mt-0.5">{subtitle}</div>}
      </div>
      <div className="flex-1 flex flex-col items-end justify-center font-mono text-[12px] leading-snug">
        <div>From :{dmy(meta?.filters?.from_date)}</div>
        <div>To &nbsp;&nbsp;:{dmy(meta?.filters?.to_date)}</div>
      </div>
    </div>
  );
}

const branchLine = (data: MonthlyAttendanceReport) => {
  const names = [...new Set((data.groups ?? []).map((g) => g.branch))];
  return names.length === 1 ? names[0] : (data.meta?.location_name ?? "");
};

/** Attendance / Absent / Late (PL) grids — same layout, different cells. */
function GridSheet({ type, data, companyName, compc }: {
  type: "monthly-attendance" | "monthly-absent" | "monthly-late"; data: MonthlyAttendanceReport; companyName: string; compc?: string;
}) {
  const days = data.days ?? [];
  const groups = data.groups ?? [];
  const full = type === "monthly-attendance";
  const summaryCols = full ? 3 : 2;   // DED, (E Days), Remarks
  const multiBranch = groups.length > 1;
  const dayW = `${(full ? 66 : 68) / Math.max(days.length, 1)}%`;

  return (
    <>
      <BoxHeader
        companyName={companyName} compc={compc} branch={branchLine(data)} meta={data.meta}
        title={ATT_TITLES[type]}
        titleStyle={full ? { color: "#1d4ed8" } : undefined}
      />
      {groups.map((g) => (
        <Fragment key={g.branch}>
          {multiBranch && <div className="font-bold text-[12px] mt-2 mb-1 font-serif">Branch : {g.branch}</div>}
          {byDepartment(g.rows).map(([dept, rows]) => (
            <div key={dept} className="mb-1" style={{ breakInside: "avoid-page" }}>
              <div className="font-bold text-[12px] font-serif">Department :&nbsp; {dept}</div>
              <table className={`w-full table-fixed border-collapse ${B} text-[7px] leading-tight`}>
                <colgroup>
                  <col style={{ width: "2.4%" }} />
                  <col style={{ width: "5%" }} />
                  <col style={{ width: "4.2%" }} />
                  <col style={{ width: "9.5%" }} />
                  <col style={{ width: "8%" }} />
                  {days.map((d) => <col key={d.date} style={{ width: dayW }} />)}
                  <col style={{ width: "2.6%" }} />
                  {full && <col style={{ width: "2.6%" }} />}
                  <col style={{ width: full ? "4.5%" : "7%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th colSpan={5} className={`${PTH} text-[8px] font-serif`}>Employee Information</th>
                    {days.map((d) => <th key={d.date} className={`${PTH} px-0`}>{d.date.slice(8, 10)}</th>)}
                    <th colSpan={summaryCols} className={`${PTH} text-[9px] font-serif`}>Summary</th>
                  </tr>
                  <tr>
                    <th className={`${PTH} px-0.5 font-serif`}>Sr. #</th>
                    <th className={`${PTH} px-0.5 font-serif`}>Card No</th>
                    <th className={`${PTH} px-0.5 font-serif`}>Emp No</th>
                    <th className={`${PTH} px-0.5 font-serif`}>Emp Name</th>
                    <th className={`${PTH} px-0.5 font-serif`}>Designation</th>
                    {days.map((d) => <th key={d.date} className={`${PTH} px-0 text-[8px]`}>{d.dow}</th>)}
                    <th className={`${PTH} px-0 font-serif`}>DED</th>
                    {full && <th className={`${PTH} px-0 font-serif`}>E Days</th>}
                    <th className={`${PTH} px-0 font-serif`}>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.unit_id ?? ""}-${r.code}-${i}`}>
                      <td className={`${PTD} text-center`}>{i + 1}</td>
                      <td className={`${PTD} text-center`}>{r.code}</td>
                      <td className={`${PTD} text-center`}>{r.card_no}</td>
                      <td className={`${PTD} px-0.5 uppercase`}>{nameOf(r)}</td>
                      <td className={`${PTD} px-0.5 uppercase`}>{r.designation}</td>
                      {days.map((d) => {
                        const code = cellCode(type, r.days?.[d.date]);
                        return (
                          <td key={d.date} className={`${PTD} text-center px-0 font-bold text-[7.5px]`} style={gridCellStyle(type, code)}>
                            {code}
                          </td>
                        );
                      })}
                      <td className={`${PTD} text-center text-[9px]`} style={DED_STYLE}>
                        {full ? r.ded_days.toFixed(1) : String(dedOf(type, r)).replace(/^0\./, ".")}
                      </td>
                      {full && <td className={`${PTD} text-center text-[9px]`} style={EDAYS_STYLE}>{r.e_days}</td>}
                      <td className={PTD}></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Fragment>
      ))}
      {!groups.length && <p className="text-center text-gray-500 py-6">No records for this range.</p>}
    </>
  );
}

/** Monthly Late Report with the in / out punch of every day. */
function LateTimesSheet({ data, companyName, compc }: { data: MonthlyAttendanceReport; companyName: string; compc?: string }) {
  const days = data.days ?? [];
  const groups = data.groups ?? [];
  const dayW = `${71 / Math.max(days.length, 1)}%`;
  return (
    <>
      <BoxHeader
        companyName={companyName} compc={compc} branch={branchLine(data)} meta={data.meta}
        title={ATT_TITLES["monthly-late-times"]} titleStyle={{ textDecoration: "underline", fontSize: 13 }}
        subtitle={`For the Month of  ${monthOf(data.meta?.filters?.to_date)}`}
      />
      {groups.map((g) => (
        <Fragment key={g.branch}>
          {groups.length > 1 && <div className="font-bold text-[12px] mt-2 mb-1 font-serif">Branch : {g.branch}</div>}
          {byDepartment(g.rows).map(([dept, rows]) => (
            <div key={dept} className="mb-1" style={{ breakInside: "avoid-page" }}>
              <div className="font-bold text-[12px] font-serif">Department :&nbsp; {dept}</div>
              <table className={`w-full table-fixed border-collapse ${B} text-[7px] leading-tight`}>
                <colgroup>
                  <col style={{ width: "2.2%" }} />
                  <col style={{ width: "5%" }} />
                  <col style={{ width: "3.8%" }} />
                  <col style={{ width: "8.5%" }} />
                  <col style={{ width: "7%" }} />
                  {days.map((d) => <col key={d.date} style={{ width: dayW }} />)}
                  <col style={{ width: "2.5%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th colSpan={5} className={`${PTH} text-[8px] font-serif`}>Employee Information</th>
                    {days.map((d) => <th key={d.date} className={`${PTH} px-0 font-serif`}>{d.date.slice(8, 10)}</th>)}
                    <th className={PTH}></th>
                  </tr>
                  <tr>
                    <th className={`${PTH} px-0.5 font-serif`}>Sr. #</th>
                    <th className={`${PTH} px-0.5 font-serif`}>Card No</th>
                    <th className={`${PTH} px-0.5 font-serif`}>Emp No</th>
                    <th className={`${PTH} px-0.5 font-serif`}>Emp Name</th>
                    <th className={`${PTH} px-0.5 font-serif`}>Designation</th>
                    {days.map((d) => <th key={d.date} className={`${PTH} px-0 font-serif text-[8px]`}>{d.dow}</th>)}
                    <th className={`${PTH} px-0 font-serif`}>Late</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.unit_id ?? ""}-${r.code}-${i}`}>
                      <td className={`${PTD} text-center`}>{i + 1}</td>
                      <td className={`${PTD} text-center`}>{r.code}</td>
                      <td className={`${PTD} text-center`}>{r.card_no}</td>
                      <td className={`${PTD} px-0.5 text-center uppercase`}>{nameOf(r)}</td>
                      <td className={`${PTD} px-0.5 text-center uppercase`}>{r.designation}</td>
                      {days.map((d) => {
                        const c = r.days?.[d.date];
                        const late = c?.code === "PL";
                        return (
                          <td key={d.date} className={`${PTD} px-0 text-left font-bold text-[6px] leading-[1.15] align-top`}
                            style={late ? { backgroundColor: "#fde68a" } : undefined}>
                            {c?.in_time && <div>{c.in_time}</div>}
                            {c?.out_time && <div>{c.out_time}</div>}
                          </td>
                        );
                      })}
                      <td className={`${PTD} text-center text-[9px]`} style={EDAYS_STYLE}>{r.pl_days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Fragment>
      ))}
      {!groups.length && <p className="text-center text-gray-500 py-6">No late arrivals in this range.</p>}
    </>
  );
}

/** Flat list: late in-time on each late day, total on the right. */
function LateArrivalSheet({ data, companyName }: { data: MonthlyAttendanceReport; companyName: string }) {
  const rows = (data.groups ?? []).flatMap((g) => g.rows);
  const cols = lateDates(data.days ?? [], rows);
  return (
    <>
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="text-[18px] font-bold italic leading-tight uppercase">{companyName}</div>
          <div className="text-[16px] font-bold italic mt-1">{ATT_TITLES["late-arrival"]}</div>
        </div>
        <div className="text-right text-[11px] pt-6 italic">Report run on: {runOn(data.meta?.generated_at)}</div>
      </div>
      <div className="text-[12px] font-bold mb-1.5">
        From Date : {dmy(data.meta?.filters?.from_date)}&nbsp; and To Date :&nbsp; {dmy(data.meta?.filters?.to_date)}
      </div>
      <table className={`border-collapse ${B} text-[8px] leading-tight`} style={{ borderColor: "#1e3a8a" }}>
        <thead>
          <tr>
            <th className={`${PTH} px-1`}>Sno</th>
            <th className={`${PTH} px-1`}>EMP No</th>
            <th className={`${PTH} px-1 w-[110px]`}>Employee Name</th>
            <th className={`${PTH} px-1 w-[60px]`}>Dept.</th>
            {cols.map((d) => <th key={d.date} className={`${PTH} px-1 w-[34px]`}>{Number(d.date.slice(8, 10))}</th>)}
            <th className={`${PTH} px-2`}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.unit_id ?? ""}-${r.code}-${i}`}>
              <td className={`${PTD} text-center`}>{i + 1}</td>
              <td className={`${PTD} text-center font-bold`}>{r.card_no || r.code}</td>
              <td className={`${PTD} px-1 font-bold uppercase`}>{nameOf(r)}</td>
              <td className={`${PTD} px-1 font-bold uppercase text-[7px]`}>{r.department}</td>
              {cols.map((d) => {
                const c = r.days?.[d.date];
                return <td key={d.date} className={`${PTD} text-center`}>{c?.code === "PL" ? c.in_time : ""}</td>;
              })}
              <td className={`${PTD} text-center font-bold text-[10px]`} style={{ backgroundColor: "#d9d9d9" }}>{r.pl_days}</td>
            </tr>
          ))}
          {!rows.length && <tr><td className={`${PTD} text-center py-4`} colSpan={5 + cols.length}>No late arrivals in this range.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

/** One page per employee: every day with punches, work hours and late time. */
function TimeSheetSheet({ data, companyName }: { data: MonthlyAttendanceReport; companyName: string }) {
  const rows = (data.groups ?? []).flatMap((g) => g.rows);
  const days = data.days ?? [];
  const meta = data.meta;
  return (
    <>
      {rows.map((r, i) => (
        <div key={`${r.unit_id ?? ""}-${r.code}-${i}`} style={i < rows.length - 1 ? { breakAfter: "page" } : undefined}
          className={i < rows.length - 1 ? "mb-10 print:mb-0" : ""}>
          <div className="text-[18px] font-bold italic uppercase leading-tight">{r.company || companyName}</div>
          <div className="flex items-end justify-between">
            <div className="text-[16px] font-bold italic">Time Sheet</div>
            <div className="text-[11px] pr-24">Report run on:&nbsp;&nbsp; {runOn(meta?.generated_at)}</div>
          </div>
          <div className="h-[6px] border border-black bg-gray-300 mt-1 mb-3" />
          <div className="border border-black rounded-[18px] px-8 py-2 mb-4 grid grid-cols-2 gap-x-8 text-[11px] font-bold leading-[1.9]">
            <div>Name :&nbsp; {nameOf(r).toUpperCase()}</div>
            <div>Card No :&nbsp; {r.code}</div>
            <div>EMP # :&nbsp; {r.card_no}</div>
            <div>Cadre :&nbsp; {r.grade}</div>
            <div>Date of Join :&nbsp; {dmy(r.doj)}</div>
            <div>Designation :&nbsp; {r.designation.toUpperCase()}</div>
            <div>From :&nbsp; {dmy(meta?.filters?.from_date)}&nbsp;&nbsp;&nbsp; To :&nbsp; {dmy(meta?.filters?.to_date)}</div>
            <div>Department :&nbsp; {r.department.toUpperCase()}</div>
            <div>Type : {r.emp_type}</div>
            <div>Company :&nbsp; {(r.company || companyName).toUpperCase()}</div>
          </div>
          <table className={`w-full border-collapse ${B} text-[9px] leading-tight`}>
            <thead>
              <tr style={{ backgroundColor: "#d9d9d9" }}>
                {["Date", "Shift", "Day", "Time In", "Time Out", "Date Out", "Work Hours", "Late Arrival", "Approved Hours"].map((h) => (
                  <th key={h} className={`${PTH} px-1 py-1 text-[10px]`}>{h}</th>
                ))}
                <th className={`${PTH} px-1 py-1 text-[10px] w-[34%]`}>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const c = r.days?.[d.date];
                if (!c) return null;
                const half = c.code === "HD";
                const late = c.code === "PL";
                const rest = c.code === "R";
                const rowBg: CSSProperties = half ? { backgroundColor: "#ffff00" } : {};
                const remark = c.code === "PO" || c.code === "PL" || c.code === "R" ? "" : (c.remarks ?? "");
                return (
                  <tr key={d.date} style={rowBg}>
                    <td className={`${PTD} px-1 text-center`}>{dmy(d.date)}</td>
                    <td className={`${PTD} text-center font-bold`}
                      style={rest ? { backgroundColor: "#000", color: "#fff" } : c.code === "H" ? codeStyle("H") : undefined}>
                      {rest ? "R" : c.code === "H" ? "H" : c.shift}
                    </td>
                    <td className={`${PTD} px-1 text-center`}>{dayName(d.date)}</td>
                    <td className={`${PTD} text-center`} style={late ? { backgroundColor: "#ff8c1a" } : undefined}>{c.in_time ?? ""}</td>
                    <td className={`${PTD} text-center`}>{c.out_time ?? ""}</td>
                    <td className={`${PTD} text-center`}>{c.out_date ? dmy(c.out_date) : ""}</td>
                    <td className={`${PTD} text-center`}>{dur(c.work_hours)}</td>
                    <td className={`${PTD} text-center`}>{late ? dur(c.late_by) : ""}</td>
                    <td className={PTD}></td>
                    <td className={`${PTD} px-1`} style={c.code === "A" ? { color: "#b91c1c", fontWeight: 600 } : undefined}>{remark}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-2 text-[10px] font-bold flex gap-6">
            <span>Late : {r.pl_days}</span>
            <span>Half Days : {r.half_days}</span>
            <span style={DED_STYLE}>Deduction Days : {r.ded_days}</span>
            <span style={EDAYS_STYLE}>Earned Days : {r.e_days}</span>
          </div>
        </div>
      ))}
      {!rows.length && <p className="text-center text-gray-500 py-6">No employees for these filters.</p>}
    </>
  );
}

export function AttendanceFormatSheet({ type, data, companyName, compc }: {
  type: AttFormat; data: MonthlyAttendanceReport; companyName: string; compc?: string;
}) {
  const d = narrowReport(type, data)!;
  if (type === "monthly-late-times") return <LateTimesSheet data={d} companyName={companyName} compc={compc} />;
  if (type === "late-arrival") return <LateArrivalSheet data={d} companyName={companyName} />;
  if (type === "time-sheet") return <TimeSheetSheet data={d} companyName={companyName} />;
  return <GridSheet type={type} data={d} companyName={companyName} compc={compc} />;
}
