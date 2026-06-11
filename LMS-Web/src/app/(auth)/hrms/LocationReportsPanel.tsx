"use client";

import { useState, useMemo, useCallback } from "react";
import { Navigation, Download, RefreshCw, Search, MapPin, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useAuth } from "@/context/AuthContext";
import {
  fetchLocationTrailReport,
  fetchLocationSummaryReport,
  type TrailRow,
  type SummaryRow,
} from "@/services/locationReportService";

type ReportKind = "trail" | "summary";

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

// recorded_at / first_time / last_time come back as UTC without a zone suffix —
// append "Z" so the browser converts to the viewer's local time.
function fmtLocal(iso: string | null): string {
  if (!iso) return "—";
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadBlob(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function LocationReportsPanel({ adminCardNo }: { adminCardNo: string }) {
  const { user, activeCompany, activeBranch } = useAuth();

  const [kind, setKind] = useState<ReportKind>("trail");
  const [fromDate, setFromDate] = useState(todayStr());
  const [toDate, setToDate] = useState(todayStr());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trail, setTrail] = useState<TrailRow[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [hasRun, setHasRun] = useState(false);

  // A specific branch selected globally → lock to it. "All branches" (empty)
  // → let the user optionally narrow to one branch from their list.
  const branchLocked = !!activeBranch;
  const [branchFilter, setBranchFilter] = useState("");
  const effectiveBranch = branchLocked ? activeBranch : (branchFilter || undefined);
  const lockedBranchName =
    user?.branch_list?.find((b) => b.code === activeBranch)?.name || activeBranch;

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const common = {
        adminCardNo,
        fromDate,
        toDate,
        compc: activeCompany || undefined,
        brnch: effectiveBranch,
      };
      if (kind === "trail") {
        const res = await fetchLocationTrailReport(common);
        setTrail(res.items || []);
        setSummary([]);
      } else {
        const res = await fetchLocationSummaryReport(common);
        setSummary(res.items || []);
        setTrail([]);
      }
      setHasRun(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate report");
    } finally {
      setLoading(false);
    }
  }, [adminCardNo, fromDate, toDate, activeCompany, effectiveBranch, kind]);

  // Client-side text filter over the generated rows.
  const filteredTrail = useMemo(() => {
    if (!query.trim()) return trail;
    const q = query.toLowerCase();
    return trail.filter(
      (r) =>
        r.name?.toLowerCase().includes(q) ||
        r.empcode?.toLowerCase().includes(q) ||
        r.department?.toLowerCase().includes(q) ||
        r.designation?.toLowerCase().includes(q)
    );
  }, [trail, query]);

  const filteredSummary = useMemo(() => {
    if (!query.trim()) return summary;
    const q = query.toLowerCase();
    return summary.filter(
      (r) =>
        r.name?.toLowerCase().includes(q) ||
        r.empcode?.toLowerCase().includes(q) ||
        r.department?.toLowerCase().includes(q) ||
        r.designation?.toLowerCase().includes(q)
    );
  }, [summary, query]);

  const rowCount = kind === "trail" ? filteredTrail.length : filteredSummary.length;

  // ── Exports ───────────────────────────────────────────────
  const buildMatrix = useCallback((): { headers: string[]; rows: string[][] } => {
    if (kind === "trail") {
      const headers = ["Empcode", "Name", "Department", "Designation", "Date", "Time", "Latitude", "Longitude", "Accuracy (m)", "Distance (km)", "Status"];
      const rows = filteredTrail.map((r) => [
        r.empcode, r.name, r.department, r.designation, r.date, fmtLocal(r.recorded_at),
        r.latitude ?? "", r.longitude ?? "", r.accuracy?.toFixed?.(0) ?? "",
        r.distance_km?.toFixed?.(3) ?? "", r.status,
      ].map(String));
      return { headers, rows };
    }
    const headers = ["Empcode", "Name", "Department", "Designation", "Date", "First Time", "Last Time", "Entries", "Total Distance (km)", "Status"];
    const rows = filteredSummary.map((r) => [
      r.empcode, r.name, r.department, r.designation, r.date,
      fmtLocal(r.first_time), fmtLocal(r.last_time),
      String(r.total_entries), r.total_distance_km?.toFixed?.(2) ?? "", r.status,
    ].map(String));
    return { headers, rows };
  }, [kind, filteredTrail, filteredSummary]);

  const exportCsv = () => {
    const { headers, rows } = buildMatrix();
    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    downloadBlob("﻿" + csv, "text/csv;charset=utf-8", `location-${kind}-${fromDate}_to_${toDate}.csv`);
  };

  const exportExcel = () => {
    const { headers, rows } = buildMatrix();
    const th = headers.map((h) => `<th>${h}</th>`).join("");
    const trs = rows
      .map((r) => `<tr>${r.map((c) => `<td>${(c ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</td>`).join("")}</tr>`)
      .join("");
    const html = `<html><head><meta charset="utf-8"></head><body><table border="1">${`<tr>${th}</tr>`}${trs}</table></body></html>`;
    downloadBlob(html, "application/vnd.ms-excel", `location-${kind}-${fromDate}_to_${toDate}.xls`);
  };

  return (
    <div className="space-y-5">
      {/* Header + report-type toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Navigation className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-900">Location Reports</h2>
        </div>
        <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl text-sm ml-auto">
          <button
            onClick={() => setKind("trail")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${kind === "trail" ? "bg-white text-indigo-700 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
          >
            Employee Trail
          </button>
          <button
            onClick={() => setKind("summary")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${kind === "summary" ? "bg-white text-indigo-700 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
          >
            Tracking Summary
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">From</label>
          <input type="date" value={fromDate} max={toDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">To</label>
          <input type="date" value={toDate} min={fromDate} max={todayStr()}
            onChange={(e) => setToDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>

        {/* Branch: dropdown only when "All Branches" is active; otherwise locked */}
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Branch</label>
          {branchLocked ? (
            <div className="border border-gray-200 bg-gray-50 rounded-lg px-3 py-1.5 text-sm text-gray-600 min-w-[10rem]">
              {lockedBranchName}
            </div>
          ) : (
            <SearchableSelect value={branchFilter} onChange={(v) => setBranchFilter(v)}
              placeholder="All Branches" className="min-w-[12rem]"
              options={(user?.branch_list || []).map((b) => ({ value: b.code, label: b.name }))} />
          )}
        </div>

        <Button onClick={run} disabled={loading} size="sm">
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Generate
        </Button>

        {hasRun && rowCount > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="secondary" size="sm" onClick={exportCsv}>
              <Download className="h-4 w-4 mr-1.5" /> CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={exportExcel}>
              <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Excel
            </Button>
          </div>
        )}
      </div>

      {/* Search over generated rows */}
      {hasRun && (
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 w-72">
          <Search className="h-4 w-4 text-gray-400 shrink-0" />
          <input
            className="bg-transparent text-sm outline-none w-full placeholder:text-gray-400"
            placeholder="Filter name / code / dept…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>
      )}

      {/* Results */}
      {!hasRun ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-300">
          <Navigation className="h-10 w-10 mb-2" />
          <p className="text-sm text-gray-400">Choose a date range and click Generate.</p>
        </div>
      ) : rowCount === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-300">
          <MapPin className="h-10 w-10 mb-2" />
          <p className="text-sm text-gray-400">No tracking data for the selected filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              {kind === "trail" ? (
                <tr>
                  <th className="px-3 py-2 text-left">Empcode</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Department</th>
                  <th className="px-3 py-2 text-left">Designation</th>
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-right">Distance (km)</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Map</th>
                </tr>
              ) : (
                <tr>
                  <th className="px-3 py-2 text-left">Empcode</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Department</th>
                  <th className="px-3 py-2 text-left">Designation</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">First</th>
                  <th className="px-3 py-2 text-left">Last</th>
                  <th className="px-3 py-2 text-right">Entries</th>
                  <th className="px-3 py-2 text-right">Total (km)</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-gray-100">
              {kind === "trail"
                ? filteredTrail.map((r, i) => (
                    <tr key={`${r.empcode}-${i}`} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-700">{r.empcode}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">{r.name}</td>
                      <td className="px-3 py-2 text-gray-600">{r.department}</td>
                      <td className="px-3 py-2 text-gray-600">{r.designation}</td>
                      <td className="px-3 py-2 text-gray-600">{fmtLocal(r.recorded_at)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{r.distance_km?.toFixed?.(3) ?? "0"}</td>
                      <td className="px-3 py-2">
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-semibold">{r.status}</span>
                      </td>
                      <td className="px-3 py-2">
                        {r.latitude != null && r.longitude != null ? (
                          <a href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`} target="_blank" rel="noreferrer"
                            className="text-indigo-600 hover:underline text-xs">View</a>
                        ) : "—"}
                      </td>
                    </tr>
                  ))
                : filteredSummary.map((r, i) => (
                    <tr key={`${r.empcode}-${r.date}-${i}`} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-700">{r.empcode}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">{r.name}</td>
                      <td className="px-3 py-2 text-gray-600">{r.department}</td>
                      <td className="px-3 py-2 text-gray-600">{r.designation}</td>
                      <td className="px-3 py-2 text-gray-600">{r.date}</td>
                      <td className="px-3 py-2 text-gray-600">{fmtLocal(r.first_time)}</td>
                      <td className="px-3 py-2 text-gray-600">{fmtLocal(r.last_time)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{r.total_entries}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{r.total_distance_km?.toFixed?.(2) ?? "0"}</td>
                      <td className="px-3 py-2">
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-semibold">{r.status}</span>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {hasRun && rowCount > 0 && (
        <p className="text-xs text-gray-400">{rowCount} row{rowCount > 1 ? "s" : ""}</p>
      )}
    </div>
  );
}
