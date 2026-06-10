"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Clock, Search, RefreshCw, Download, Calendar, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import {
  fetchBulkAttendance, fetchAttendanceDetails,
  type BulkAttendanceRow, type AttendanceDetailRow,
} from "@/services/attendanceService";

type Mode = "summary" | "details";

function todayStr() { return new Date().toISOString().split("T")[0]; }
function hhmm(min: number) {
  const m = Math.max(0, Math.round(min || 0));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function presetRange(p: string): { from: string; to: string } {
  const t = new Date();
  const iso = (d: Date) => d.toISOString().split("T")[0];
  if (p === "today") return { from: iso(t), to: iso(t) };
  if (p === "week") {
    const s = new Date(t); s.setDate(t.getDate() - t.getDay());
    return { from: iso(s), to: iso(t) };
  }
  if (p === "paycycle") {
    // 26th of prev month → 25th of this month
    const start = new Date(t.getFullYear(), t.getMonth() - (t.getDate() < 26 ? 1 : 0), 26);
    const end = new Date(t.getFullYear(), t.getMonth() + (t.getDate() < 26 ? 0 : 1), 25);
    return { from: iso(start), to: iso(end) };
  }
  // month
  return { from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: iso(t) };
}

function csvEscape(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(headers: string[], rows: string[][], filename: string) {
  const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function AttendancePanel({ adminCardNo }: { adminCardNo: string }) {
  const { activeCompany, activeBranch } = useAuth();
  const [mode, setMode] = useState<Mode>("summary");
  const init = presetRange("month");
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<BulkAttendanceRow[]>([]);
  const [details, setDetails] = useState<AttendanceDetailRow[]>([]);

  const load = useCallback(async (m: Mode, f: string, t: string) => {
    setLoading(true);
    setError(null);
    try {
      const c = activeCompany || undefined;
      const b = activeBranch || undefined;
      if (m === "summary") {
        const r = await fetchBulkAttendance(adminCardNo, f, t, c, b);
        setSummary(r.items || []);
      } else {
        const r = await fetchAttendanceDetails(adminCardNo, f, t, c, b);
        setDetails(r.items || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load attendance");
    } finally {
      setLoading(false);
    }
  }, [adminCardNo, activeCompany, activeBranch]);

  // Load on mount, on mode change, and when company/branch changes.
  useEffect(() => { load(mode, from, to); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mode, activeCompany, activeBranch]);

  function applyPreset(p: string) {
    const r = presetRange(p);
    setFrom(r.from); setTo(r.to);
    load(mode, r.from, r.to);
  }

  const filteredSummary = useMemo(() => {
    if (!query.trim()) return summary;
    const q = query.toLowerCase();
    return summary.filter((r) =>
      r.name?.toLowerCase().includes(q) || r.empcode?.toLowerCase().includes(q) ||
      r.atdtcard?.toLowerCase().includes(q) || r.dept_name?.toLowerCase().includes(q));
  }, [summary, query]);

  const filteredDetails = useMemo(() => {
    if (!query.trim()) return details;
    const q = query.toLowerCase();
    return details.filter((r) =>
      r.name?.toLowerCase().includes(q) || r.atdtcard?.toLowerCase().includes(q) ||
      r.card_no?.toLowerCase().includes(q));
  }, [details, query]);

  function exportCsv() {
    if (mode === "summary") {
      downloadCsv(
        ["Empcode", "Name", "ATDT", "Department", "Present", "Absent", "Total Days", "Late", "Overtime", "Working"],
        filteredSummary.map((r) => [
          r.empcode, r.name ?? "", r.atdtcard ?? "", r.dept_name ?? "",
          String(r.present_days), String(r.absent_days), String(r.total_days),
          hhmm(r.late_minutes), hhmm(r.ot_minutes), hhmm(r.working_minutes),
        ]),
        `attendance-summary-${from}_to_${to}.csv`,
      );
    } else {
      downloadCsv(
        ["Name", "Card", "ATDT", "Date", "Duty In", "Duty Out", "In Time", "Out Time"],
        filteredDetails.map((r) => [
          r.name ?? "", r.card_no ?? "", r.atdtcard ?? "", r.roster_date,
          r.duty_in ?? "", r.duty_out ?? "", r.in_time ?? "", r.out_time ?? "",
        ]),
        `attendance-details-${from}_to_${to}.csv`,
      );
    }
  }

  const count = mode === "summary" ? filteredSummary.length : filteredDetails.length;

  return (
    <div className="bg-white/95 rounded-2xl p-4 sm:p-6 shadow-lg">
      {/* Header + mode toggle */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-900">Attendance</h2>
        </div>
        <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl text-sm ml-auto">
          <button onClick={() => setMode("summary")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${mode === "summary" ? "bg-white text-indigo-700 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
            Summary
          </button>
          <button onClick={() => setMode("details")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${mode === "details" ? "bg-white text-indigo-700 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
            Daily Details
          </button>
        </div>
      </div>

      {/* Presets + date range */}
      <div className="flex flex-wrap gap-2 mb-3">
        {[["Today", "today"], ["This Week", "week"], ["This Month", "month"], ["Pay Cycle (26–25)", "paycycle"]].map(([label, p]) => (
          <button key={p} onClick={() => applyPreset(p)}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:border-indigo-400 hover:text-indigo-700 transition-colors">
            <Calendar className="h-3.5 w-3.5 inline mr-1" />{label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">From</label>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">To</label>
          <input type="date" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <Button size="sm" onClick={() => load(mode, from, to)} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Load
        </Button>
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 w-60">
          <Search className="h-4 w-4 text-gray-400 shrink-0" />
          <input className="bg-transparent text-sm outline-none w-full placeholder:text-gray-400"
            placeholder="Filter name / code…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {count > 0 && (
          <Button variant="secondary" size="sm" onClick={exportCsv} className="ml-auto">
            <Download className="h-4 w-4 mr-1.5" /> CSV
          </Button>
        )}
      </div>

      {error && <div className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="py-12 flex justify-center"><Spinner /></div>
      ) : count === 0 ? (
        <div className="py-12 text-center text-gray-400">
          <Users className="h-8 w-8 mx-auto mb-2" />
          No attendance for the selected period.
        </div>
      ) : mode === "summary" ? (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Empcode</th>
                <th className="px-3 py-2 text-left">Department</th>
                <th className="px-3 py-2 text-right">Present</th>
                <th className="px-3 py-2 text-right">Absent</th>
                <th className="px-3 py-2 text-right">Days</th>
                <th className="px-3 py-2 text-right">Late</th>
                <th className="px-3 py-2 text-right">OT</th>
                <th className="px-3 py-2 text-right">Working</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredSummary.map((r) => (
                <tr key={r.empcode} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">{r.name || "—"}</td>
                  <td className="px-3 py-2 font-mono text-gray-500">{r.empcode}</td>
                  <td className="px-3 py-2 text-gray-600">{r.dept_name || "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold text-emerald-600">{r.present_days}</td>
                  <td className="px-3 py-2 text-right font-semibold text-red-500">{r.absent_days}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{r.total_days}</td>
                  <td className="px-3 py-2 text-right text-amber-600">{hhmm(r.late_minutes)}</td>
                  <td className="px-3 py-2 text-right text-indigo-600">{hhmm(r.ot_minutes)}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{hhmm(r.working_minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Card / ATDT</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Duty In</th>
                <th className="px-3 py-2 text-left">Duty Out</th>
                <th className="px-3 py-2 text-left">Check In</th>
                <th className="px-3 py-2 text-left">Check Out</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredDetails.map((r, i) => {
                const incomplete = r.in_time && !r.out_time;
                return (
                  <tr key={`${r.atdtcard || r.card_no}-${r.roster_date}-${i}`} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900">{r.name || "—"}</td>
                    <td className="px-3 py-2 text-gray-500">{r.atdtcard || r.card_no || "—"}</td>
                    <td className="px-3 py-2 text-gray-600">{r.roster_date}</td>
                    <td className="px-3 py-2 text-gray-400">{r.duty_in || "—"}</td>
                    <td className="px-3 py-2 text-gray-400">{r.duty_out || "—"}</td>
                    <td className="px-3 py-2 font-semibold text-gray-800">{r.in_time || "—"}</td>
                    <td className="px-3 py-2 font-semibold">
                      {r.out_time || (incomplete ? <span className="text-amber-600">Waiting</span> : "—")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {count > 0 && <p className="mt-2 text-xs text-gray-400">{count} row{count > 1 ? "s" : ""}</p>}
    </div>
  );
}
