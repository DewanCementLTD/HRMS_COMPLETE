import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, Printer, Search, Loader2, FileSpreadsheet, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { CompanyLogo } from "@/components/ui/CompanyLogo";
import {
  fetchPayRegister, fetchPayRegisterPeriods, fetchFinancialYears,
  type PayRegister, type PayRegisterEmployee, type PayRegisterPeriod, type FinancialYear,
} from "@/services/payrollService";

// Employee cells: blank when empty/zero (matches the ERP form). Totals: always numeric.
const cell = (v?: number) => (v == null || v === 0 ? "" : Math.round(v).toLocaleString());
const tot = (v?: number) => Math.round(v || 0).toLocaleString();

interface Totals {
  actual_gross: number; earned_basic: number; earned_gross: number;
  tot_all: number; tot_ded: number; net: number;
  allows: Record<string, number>; deds: Record<string, number>;
}

function sumTotals(list: PayRegisterEmployee[], allow: string[], ded: string[]): Totals {
  const t: Totals = {
    actual_gross: 0, earned_basic: 0, earned_gross: 0, tot_all: 0, tot_ded: 0, net: 0,
    allows: Object.fromEntries(allow.map((c) => [c, 0])),
    deds: Object.fromEntries(ded.map((c) => [c, 0])),
  };
  for (const e of list) {
    t.actual_gross += e.actual_gross || 0;
    t.earned_basic += e.earned_basic || 0;
    t.earned_gross += e.earned_gross || 0;
    t.tot_all += e.tot_all || 0;
    t.tot_ded += e.tot_ded || 0;
    t.net += e.net || 0;
    for (const c of allow) t.allows[c] += e.allows[c] || 0;
    for (const c of ded) t.deds[c] += e.deds[c] || 0;
  }
  return t;
}

// ── Export helpers ────────────────────────────────────────────
// CSV and PDF both flow from the same column list as the on-screen table, so an
// exported register always matches what HR is looking at.

function csvEscape(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

function downloadBlob(content: string, mime: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 150);
}

function num(v?: number) {
  return v == null ? "" : Math.round(v);
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function PayRegisterPanel({ adminCardNo, initialPeriod }: { adminCardNo: string; initialPeriod?: number | null }) {
  const { activeCompany, user } = useAuth();
  const compc = activeCompany || undefined;
  const companyName = user?.selected_company?.name || "";

  const [years, setYears] = useState<FinancialYear[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [periods, setPeriods] = useState<PayRegisterPeriod[]>([]);
  const [period, setPeriod] = useState<number | null>(initialPeriod ?? null);
  const [data, setData] = useState<PayRegister | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadYears = useCallback(async () => {
    try {
      const r = await fetchFinancialYears(adminCardNo, compc);
      const items = r.items || [];
      setYears(items);
      if (items.length && selectedYear == null) {
        setSelectedYear(items[0].rule_id);
      }
    } catch (e) {
      console.error("Failed to load financial years", e);
    }
  }, [adminCardNo, compc, selectedYear]);

  const loadPeriods = useCallback(async (ruleId: number | null) => {
    try {
      const r = await fetchPayRegisterPeriods(adminCardNo, compc, ruleId ?? undefined);
      const items = r.items || [];
      setPeriods(items);
      setPeriod((cur) => (cur != null && items.some((p) => p.period === cur) ? cur : (items[0]?.period ?? null)));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load periods"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, compc]);

  const load = useCallback(async (p: number) => {
    setLoading(true); setError(null);
    try { setData(await fetchPayRegister(adminCardNo, p, compc)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load pay register"); setData(null); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, compc]);

  useEffect(() => { loadYears(); }, [loadYears]);
  useEffect(() => { loadPeriods(selectedYear); }, [selectedYear, loadPeriods]);
  useEffect(() => { if (period != null) load(period); }, [period, load]);

  const allow = data?.allow_cols ?? [];
  const ded = data?.ded_cols ?? [];

  const employees = useMemo(() => {
    const list = data?.employees ?? [];
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((e) =>
      e.name?.toLowerCase().includes(q) || e.old_empcode?.toLowerCase().includes(q) ||
      e.department?.toLowerCase().includes(q) || e.designation?.toLowerCase().includes(q));
  }, [data, query]);

  // Group employees by location → department, preserving the backend order.
  const grouped = useMemo(() => {
    const locs: { location: string; depts: { department: string; rows: PayRegisterEmployee[] }[] }[] = [];
    for (const e of employees) {
      const loc = e.location || "—";
      const dep = e.department || "—";
      let L = locs.find((x) => x.location === loc);
      if (!L) { L = { location: loc, depts: [] }; locs.push(L); }
      let D = L.depts.find((x) => x.department === dep);
      if (!D) { D = { department: dep, rows: [] }; L.depts.push(D); }
      D.rows.push(e);
    }
    return locs;
  }, [employees]);

  // Column count for full-width header rows.
  const colCount = 7 + allow.length + 1 + ded.length + 1 + 2;

  // Printing has to fit the page regardless of how many allowance/deduction
  // columns this unit uses: a wide register moves to A3 and steps the font down.
  const printPage = colCount <= 18 ? "A4" : "A3";
  const printFont = colCount <= 16 ? 9 : colCount <= 22 ? 8 : colCount <= 30 ? 7 : 6;

  const fileStem = `pay-register_${(companyName || data?.unit_name || "company").replace(/[^\w]+/g, "-")}_${(data?.period_name || period || "").toString().replace(/[^\w]+/g, "-")}`;

  /** Flat, Excel-friendly export: location/department as columns, one row per
   *  employee, grand total last. */
  function exportCsv() {
    const headers = [
      "Location", "Department", "Designation", "Emp Code", "Name", "W.Day",
      "Actual Gross", "Earned Basic", "Earned Gross",
      ...allow, "Total Allow", ...ded, "Total Ded", "Net Pay", "Hold",
    ];
    const rows = employees.map((e) => [
      e.location, e.department, e.designation, e.old_empcode, e.name, e.w_day ?? "",
      num(e.actual_gross), num(e.earned_basic), num(e.earned_gross),
      ...allow.map((c) => num(e.allows[c])), num(e.tot_all),
      ...ded.map((c) => num(e.deds[c])), num(e.tot_ded), num(e.net),
      (e.hold_sal || "").toUpperCase() === "N" ? "" : (e.hold_sal || ""),
    ]);
    const t = sumTotals(employees, allow, ded);
    rows.push([
      "", "", "", "", `Grand Total (${employees.length})`, "",
      num(t.actual_gross), num(t.earned_basic), num(t.earned_gross),
      ...allow.map((c) => num(t.allows[c])), num(t.tot_all),
      ...ded.map((c) => num(t.deds[c])), num(t.tot_ded), num(t.net), "",
    ]);
    const meta = [
      [`${companyName || data?.unit_name || "Company"} — Payroll Register`],
      [`Period: ${data?.period_name || ""}`, `Employees: ${employees.length}`],
      [],
    ];
    const csv = [...meta, headers, ...rows]
      .map((r) => r.map(csvEscape).join(","))
      .join("\n");
    downloadBlob("\ufeff" + csv, "text/csv;charset=utf-8", `${fileStem}.csv`);
  }

  /** PDF keeps the printed register's shape — location/department groups with
   *  their subtotals — and scales itself to the page width. */
  function exportPdf() {
    const head = [
      "S#", "Emp Code", "Name", "W.Day", "Actual Gross", "Earned Basic", "Earned Gross",
      ...allow, "Total Allow", ...ded, "Total Ded", "Net Pay", "Hold",
    ];
    const rightFrom = 3;   // everything after Name is numeric

    const cellsFor = (e: PayRegisterEmployee, i: number) => [
      i, e.old_empcode, e.name, e.w_day ?? "",
      cell(e.actual_gross), cell(e.earned_basic), cell(e.earned_gross),
      ...allow.map((c) => cell(e.allows[c])), cell(e.tot_all),
      ...ded.map((c) => cell(e.deds[c])), cell(e.tot_ded), cell(e.net),
      (e.hold_sal || "").toUpperCase() === "N" ? "" : (e.hold_sal || ""),
    ];
    const totalCells = (label: string, list: PayRegisterEmployee[]) => {
      const t = sumTotals(list, allow, ded);
      return ["", "", `${label} (${list.length})`, "",
        tot(t.actual_gross), tot(t.earned_basic), tot(t.earned_gross),
        ...allow.map((c) => tot(t.allows[c])), tot(t.tot_all),
        ...ded.map((c) => tot(t.deds[c])), tot(t.tot_ded), tot(t.net), ""];
    };
    const tr = (cells: (string | number)[], cls = "") =>
      `<tr class="${cls}">${cells.map((v, i) =>
        `<td class="${i >= rightFrom ? "r" : ""}">${esc(v)}</td>`).join("")}</tr>`;

    const body: string[] = [];
    for (const L of grouped) {
      body.push(`<tr class="loc"><td colspan="${colCount}">Location: ${esc(L.location)}</td></tr>`);
      for (const D of L.depts) {
        body.push(`<tr class="dep"><td colspan="${colCount}">Department: ${esc(D.department)}</td></tr>`);
        D.rows.forEach((e, i) => body.push(tr(cellsFor(e, i + 1))));
        body.push(tr(totalCells(`Total of ${D.department}`, D.rows), "sub"));
      }
      body.push(tr(totalCells(`Total of ${L.location}`, L.depts.flatMap((d) => d.rows)), "loctot"));
    }
    body.push(tr(totalCells("Grand Total", employees), "grand"));

    const title = `${companyName || data?.unit_name || "Company"} — Payroll Register`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)} ${esc(data?.period_name || "")}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{font-family:Arial,sans-serif;color:#000;background:#fff}
  @page{size:${printPage} landscape;margin:8mm}
  .hdr{border-bottom:2px solid #333;padding-bottom:6px;margin-bottom:8px}
  .hdr h1{font-size:15px;text-transform:uppercase;letter-spacing:.4px}
  .hdr h2{font-size:11px;color:#333;margin-top:1px}
  .hdr .meta{font-size:9px;color:#555;margin-top:3px}
  table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:${printFont}px}
  th,td{border:1px solid #b0b0b0;padding:1.5px 3px;word-break:break-word;overflow:hidden}
  th{background:#4338ca;color:#fff;font-weight:600;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  td.r{text-align:right;white-space:nowrap}
  tr.loc td{background:#e5e7eb;font-weight:bold}
  tr.dep td{background:#f3f4f6;font-weight:600;color:#3730a3}
  tr.sub td{background:#eef2ff;font-weight:600}
  tr.loctot td{background:#e0e7ff;font-weight:bold}
  tr.grand td{background:#1f2937;color:#fff;font-weight:bold;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  tr{page-break-inside:avoid}
  thead{display:table-header-group}
</style></head><body>
  <div class="hdr">
    <h1>${esc(companyName || data?.unit_name || "Company")}</h1>
    <h2>Payroll Register</h2>
    <div class="meta">Period: ${esc(data?.period_name || "—")} &nbsp;|&nbsp; Unit: ${esc(data?.unit_name || "—")} &nbsp;|&nbsp; Employees: ${employees.length} &nbsp;|&nbsp; Printed: ${esc(new Date().toLocaleString())}</div>
  </div>
  <table><thead><tr>${head.map((h, i) => `<th class="${i >= rightFrom ? "r" : ""}">${esc(h)}</th>`).join("")}</tr></thead>
  <tbody>${body.join("")}</tbody></table>
  <script>window.onload=function(){window.print();setTimeout(function(){window.close()},1000)}</script>
</body></html>`;

    const win = window.open("", "_blank", "width=1400,height=900");
    if (!win) { alert("Please allow pop-ups to download the PDF."); return; }
    win.document.write(html);
    win.document.close();
  }

  function TotalRow({ label, list, cls }: { label: string; list: PayRegisterEmployee[]; cls: string }) {
    const t = sumTotals(list, allow, ded);
    return (
      <tr className={cls}>
        <td className="px-2 py-1 border border-gray-300" />
        <td className="px-2 py-1 border border-gray-300" />
        <td className="px-2 py-1 border border-gray-300 font-semibold whitespace-nowrap">{label} ({list.length})</td>
        <td className="px-2 py-1 border border-gray-300" />
        <td className="px-2 py-1 border border-gray-300 text-right">{tot(t.actual_gross)}</td>
        <td className="px-2 py-1 border border-gray-300 text-right">{tot(t.earned_basic)}</td>
        <td className="px-2 py-1 border border-gray-300 text-right">{tot(t.earned_gross)}</td>
        {allow.map((c) => <td key={c} className="px-2 py-1 border border-gray-300 text-right">{tot(t.allows[c])}</td>)}
        <td className="px-2 py-1 border border-gray-300 text-right font-semibold">{tot(t.tot_all)}</td>
        {ded.map((c) => <td key={c} className="px-2 py-1 border border-gray-300 text-right">{tot(t.deds[c])}</td>)}
        <td className="px-2 py-1 border border-gray-300 text-right font-semibold">{tot(t.tot_ded)}</td>
        <td className="px-2 py-1 border border-gray-300 text-right font-bold">{tot(t.net)}</td>
        <td className="px-2 py-1 border border-gray-300" />
      </tr>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar — not printed */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-indigo-600" /> Pay Register
        </h3>

        {/* Financial Year Selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-gray-500">Financial Year:</span>
          <select
            value={selectedYear ?? ""}
            onChange={(e) => setSelectedYear(e.target.value ? Number(e.target.value) : null)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white font-medium"
          >
            {years.length === 0 && <option value="">All Years</option>}
            {years.map((y) => (
              <option key={y.rule_id} value={y.rule_id}>
                {y.from_date && y.to_date ? `${y.from_date.slice(0, 4)} - ${y.to_date.slice(0, 4)}${y.scode ? ` (${y.scode})` : ""}` : (y.scode || `FY ${y.rule_id}`)}
              </option>
            ))}
          </select>
        </div>

        {/* Monthly Period Selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-gray-500">Period:</span>
          <select
            value={period ?? ""}
            onChange={(e) => setPeriod(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white font-medium"
          >
            {periods.length === 0 && <option value="">No periods</option>}
            {periods.map((p) => <option key={p.period} value={p.period}>{p.label}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 w-56">
          <Search className="h-4 w-4 text-gray-400" />
          <input className="bg-transparent text-sm outline-none w-full" placeholder="Filter name / code / dept…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Button variant="secondary" size="sm" onClick={() => period != null && load(period)} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={employees.length === 0}>
            <Download className="h-4 w-4 mr-1.5" /> CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={exportPdf} disabled={employees.length === 0}>
            <FileText className="h-4 w-4 mr-1.5" /> PDF
          </Button>
          <Button size="sm" onClick={() => window.print()} disabled={employees.length === 0}>
            <Printer className="h-4 w-4 mr-1.5" /> Print
          </Button>
        </div>
      </div>

      {error && <div className="p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600 print:hidden">{error}</div>}

      {/* Printable report */}
      <div id="payreg-report" className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm overflow-x-auto">
        {/* Company header */}
        <div className="flex items-start gap-4 border-b-2 border-gray-300 pb-3 mb-3">
          <CompanyLogo compc={compc} className="h-16 max-w-[120px]" />
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-extrabold text-gray-900 uppercase tracking-wide">{companyName || data?.unit_name || "Company"}</h2>
            <p className="text-sm font-semibold text-gray-700">Payroll Register</p>
            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-0.5 text-xs text-gray-600">
              <span><span className="font-semibold">Period:</span> {data?.period_name || "—"}</span>
              <span><span className="font-semibold">Unit:</span> {data?.unit_name || "—"}</span>
              <span><span className="font-semibold">No. of Employees:</span> {employees.length}</span>
            </div>
          </div>
        </div>

        {loading ? <Spinner /> : employees.length === 0 ? (
          <div className="py-12 text-center text-gray-400">No pay register data for this period.</div>
        ) : (
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr className="bg-indigo-600 text-white">
                <th className="px-2 py-1.5 border border-indigo-500 text-left">S#</th>
                <th className="px-2 py-1.5 border border-indigo-500 text-left">Emp Code</th>
                <th className="px-2 py-1.5 border border-indigo-500 text-left">Name</th>
                <th className="px-2 py-1.5 border border-indigo-500 text-right">W.Day</th>
                <th className="px-2 py-1.5 border border-indigo-500 text-right">Actual Gross</th>
                <th className="px-2 py-1.5 border border-indigo-500 text-right">Earned Basic</th>
                <th className="px-2 py-1.5 border border-indigo-500 text-right">Earned Gross</th>
                {allow.map((c) => <th key={c} className="px-2 py-1.5 border border-indigo-500 text-right whitespace-nowrap">{c}</th>)}
                <th className="px-2 py-1.5 border border-indigo-500 text-right">Total Allow</th>
                {ded.map((c) => <th key={c} className="px-2 py-1.5 border border-indigo-500 text-right whitespace-nowrap">{c}</th>)}
                <th className="px-2 py-1.5 border border-indigo-500 text-right">Total Ded</th>
                <th className="px-2 py-1.5 border border-indigo-500 text-right">Net Pay</th>
                <th className="px-2 py-1.5 border border-indigo-500 text-center">Hold</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((L) => (
                <FragmentLoc key={L.location}>
                  <tr className="bg-gray-100">
                    <td colSpan={colCount} className="px-2 py-1 border border-gray-300 font-bold text-gray-800">Location: {L.location}</td>
                  </tr>
                  {L.depts.map((D) => {
                    let s = 0;
                    return (
                      <FragmentLoc key={D.department}>
                        <tr className="bg-gray-50">
                          <td colSpan={colCount} className="px-2 py-1 border border-gray-300 font-semibold text-indigo-700">Department: {D.department}</td>
                        </tr>
                        {D.rows.map((e) => {
                          s += 1;
                          const hold = (e.hold_sal || "").toUpperCase();
                          const onHold = hold && hold !== "N";
                          return (
                            <tr key={e.old_empcode} className="hover:bg-gray-50">
                              <td className="px-2 py-1 border border-gray-300 text-gray-500">{s}</td>
                              <td className="px-2 py-1 border border-gray-300 font-mono text-gray-700 whitespace-nowrap">{e.old_empcode}</td>
                              <td className="px-2 py-1 border border-gray-300 text-gray-900 whitespace-nowrap">{e.name}</td>
                              <td className="px-2 py-1 border border-gray-300 text-right text-gray-600">{e.w_day ?? ""}</td>
                              <td className="px-2 py-1 border border-gray-300 text-right">{cell(e.actual_gross)}</td>
                              <td className="px-2 py-1 border border-gray-300 text-right">{cell(e.earned_basic)}</td>
                              <td className="px-2 py-1 border border-gray-300 text-right font-medium">{cell(e.earned_gross)}</td>
                              {allow.map((c) => <td key={c} className="px-2 py-1 border border-gray-300 text-right">{cell(e.allows[c])}</td>)}
                              <td className="px-2 py-1 border border-gray-300 text-right font-semibold">{cell(e.tot_all)}</td>
                              {ded.map((c) => <td key={c} className="px-2 py-1 border border-gray-300 text-right">{cell(e.deds[c])}</td>)}
                              <td className="px-2 py-1 border border-gray-300 text-right font-semibold text-red-600">{cell(e.tot_ded)}</td>
                              <td className="px-2 py-1 border border-gray-300 text-right font-bold text-indigo-700">{cell(e.net)}</td>
                              <td className={`px-2 py-1 border border-gray-300 text-center ${onHold ? "bg-yellow-200 font-semibold" : ""}`}>{onHold ? hold : ""}</td>
                            </tr>
                          );
                        })}
                        <TotalRow label={`Total of ${D.department}`} list={D.rows} cls="bg-indigo-50 text-indigo-900" />
                      </FragmentLoc>
                    );
                  })}
                  <TotalRow label={`Total of ${L.location}`} list={L.depts.flatMap((d) => d.rows)} cls="bg-indigo-100 text-indigo-900 font-semibold" />
                </FragmentLoc>
              ))}
              <TotalRow label="Grand Total" list={employees} cls="bg-gray-800 text-white" />
            </tbody>
          </table>
        )}
      </div>

      {/* Print isolation: print only the report */}
      {/* Print isolation + fit-to-page. Page size and font step down as the unit's
          allowance/deduction column count grows, and fixed layout with wrapping
          headers keeps a wide register inside the printable width. */}
      <style>{`
        @media print {
          @page { size: ${printPage} landscape; margin: 8mm; }
          body * { visibility: hidden !important; }
          #payreg-report, #payreg-report * { visibility: visible !important; }
          #payreg-report {
            position: absolute; left: 0; top: 0; width: 100%;
            padding: 0 !important; border: none !important; box-shadow: none !important;
            overflow: visible !important;
          }
          #payreg-report table {
            width: 100% !important; table-layout: fixed;
            font-size: ${printFont}px;
          }
          #payreg-report th, #payreg-report td {
            padding: 1px 2px !important;
            word-break: break-word; overflow: hidden;
          }
          /* Headers wrap instead of forcing the table wider than the page… */
          #payreg-report th { white-space: normal !important; }
          /* …while figures stay on one line. */
          #payreg-report td.text-right, #payreg-report th.text-right { white-space: nowrap; }
          #payreg-report thead { display: table-header-group; }
          #payreg-report tr { page-break-inside: avoid; }
          #payreg-report .bg-indigo-600, #payreg-report .bg-gray-800 {
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
        }
      `}</style>
    </div>
  );
}

// Tiny fragment helper so we can give keyed groups without extra DOM nodes.
function FragmentLoc({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
