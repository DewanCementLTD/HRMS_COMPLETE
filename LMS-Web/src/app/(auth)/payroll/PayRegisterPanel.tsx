"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, Printer, Search, Loader2, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { CompanyLogo } from "@/components/ui/CompanyLogo";
import {
  fetchPayRegister, fetchPayRegisterPeriods,
  type PayRegister, type PayRegisterEmployee, type PayRegisterPeriod,
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

export function PayRegisterPanel({ adminCardNo, initialPeriod }: { adminCardNo: string; initialPeriod?: number | null }) {
  const { activeCompany, user } = useAuth();
  const compc = activeCompany || undefined;
  const companyName = user?.selected_company?.name || "";

  const [periods, setPeriods] = useState<PayRegisterPeriod[]>([]);
  const [period, setPeriod] = useState<number | null>(initialPeriod ?? null);
  const [data, setData] = useState<PayRegister | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadPeriods = useCallback(async () => {
    try {
      const r = await fetchPayRegisterPeriods(adminCardNo, compc);
      setPeriods(r.items || []);
      setPeriod((cur) => (cur != null && r.items?.some((p) => p.period === cur) ? cur : (r.items?.[0]?.period ?? null)));
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

  useEffect(() => { loadPeriods(); }, [loadPeriods]);
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
        <select
          value={period ?? ""}
          onChange={(e) => setPeriod(Number(e.target.value))}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          {periods.length === 0 && <option value="">No periods</option>}
          {periods.map((p) => <option key={p.period} value={p.period}>{p.label}</option>)}
        </select>
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 w-56">
          <Search className="h-4 w-4 text-gray-400" />
          <input className="bg-transparent text-sm outline-none w-full" placeholder="Filter name / code / dept…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Button variant="secondary" size="sm" onClick={() => period != null && load(period)} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
        <Button size="sm" onClick={() => window.print()} disabled={employees.length === 0} className="ml-auto">
          <Printer className="h-4 w-4 mr-1.5" /> Print
        </Button>
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
      <style>{`
        @media print {
          @page { size: A3 landscape; margin: 10mm; }
          body * { visibility: hidden !important; }
          #payreg-report, #payreg-report * { visibility: visible !important; }
          #payreg-report { position: absolute; left: 0; top: 0; width: 100%; border: none !important; box-shadow: none !important; }
          #payreg-report table { font-size: 9px; }
          #payreg-report .bg-indigo-600 { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}

// Tiny fragment helper so we can give keyed groups without extra DOM nodes.
function FragmentLoc({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
