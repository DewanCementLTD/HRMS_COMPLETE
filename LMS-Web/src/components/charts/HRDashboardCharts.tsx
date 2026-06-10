"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from "recharts";
import {
  HRAnalytics, HRDashboardStats,
  UpcomingBirthday, UpcomingAnniversary, UpcomingLeave, ShiftStat,
} from "@/models/hrms";
import { Card, CardContent } from "@/components/ui/Card";
import {
  Users, UserCheck, UserX, TreePalm, Clock, Zap, Timer, UserPlus,
  TrendingUp, TrendingDown, AlertTriangle, Activity,
  CalendarDays, BarChart2, FileText, ClipboardList, Download,
  Brain, ToggleRight, ChevronRight, UserMinus, Info,
  ClipboardCheck, UserCog, AlarmClock, FileDown,
} from "lucide-react";

// ─── Colour tokens ─────────────────────────────────────────
const G = "#10b981";  // green
const R = "#ef4444";  // red
const A = "#f59e0b";  // amber
const B = "#3b82f6";  // blue
const P = "#8b5cf6";  // purple
const PIE_COLORS = ["#10b981", "#f97316", "#3b82f6", "#f59e0b", "#8b5cf6"];

// ─── Avatar ────────────────────────────────────────────────
const AV_COLORS = [
  "bg-purple-500","bg-indigo-500","bg-blue-500","bg-cyan-500",
  "bg-teal-500","bg-emerald-500","bg-amber-500","bg-orange-500",
  "bg-rose-500","bg-pink-500","bg-violet-500","bg-sky-500",
];
function Avatar({ name, size = 8 }: { name: string; size?: number }) {
  const parts = (name || "?").trim().split(" ");
  const initials = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  const idx = (name.charCodeAt(0) + (name.charCodeAt(1) || 0)) % AV_COLORS.length;
  return (
    <div className={`h-${size} w-${size} rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0 ${AV_COLORS[idx]}`}>
      {initials.toUpperCase()}
    </div>
  );
}

// ─── Half-gauge (health score & absenteeism) ───────────────
function HalfGauge({
  value, max = 100, color, centerLabel, subLabel,
}: {
  value: number; max?: number; color: string; centerLabel: string; subLabel?: string;
}) {
  const r = 72;
  const cx = 110, cy = 108;
  const halfCirc = Math.PI * r;          // πr
  const filled   = (Math.min(value, max) / max) * halfCirc;
  // rotate(180) puts the stroke start at 9-o'clock; going clockwise → upper arc
  const rot = `rotate(180 ${cx} ${cy})`;
  return (
    <svg viewBox="0 0 220 118" className="w-full" style={{ overflow: "visible" }}>
      {/* grey background arc */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth="13"
        strokeLinecap="round"
        strokeDasharray={`${halfCirc} ${halfCirc * 2}`}
        transform={rot} />
      {/* coloured fill arc */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="13"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${halfCirc * 2}`}
        transform={rot}
        style={{ transition: "stroke-dasharray 0.8s ease" }} />
      {/* value */}
      <text x={cx} y={cy - 16} textAnchor="middle" fontSize="30" fontWeight="800" fill="#111827">
        {centerLabel}
      </text>
      {subLabel && (
        <text x={cx} y={cy + 6} textAnchor="middle" fontSize="12" fontWeight="600" fill={color}>
          {subLabel}
        </text>
      )}
    </svg>
  );
}

// ─── Shift circle ──────────────────────────────────────────
function ShiftRing({ label, pct, present, total, color }: {
  label: string; pct: number; present: number; total: number; color: string;
}) {
  const r = 34, circ = 2 * Math.PI * r;
  const filled = (pct / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <p className="text-xs font-semibold text-gray-600">{label}</p>
      <div className="relative h-20 w-20">
        <svg className="h-20 w-20 -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={r} fill="none" stroke="#e5e7eb" strokeWidth="7" />
          <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circ}`}
            style={{ transition: "stroke-dasharray 0.8s ease" }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold text-gray-900">{pct}%</span>
        </div>
      </div>
      <p className="text-xs font-semibold text-emerald-600">{present}/{total}</p>
      <p className="text-[10px] text-gray-400">Present</p>
    </div>
  );
}

// ─── Delta chip ────────────────────────────────────────────
function Delta({ today, yesterday, invert = false, suffix = "%" }: {
  today: number; yesterday: number; invert?: boolean; suffix?: string;
}) {
  if (!yesterday) return <span className="text-xs text-gray-400">--</span>;
  const diff = today - yesterday;
  const pct  = Math.abs(Math.round((diff / yesterday) * 100));
  const up   = diff >= 0;
  const good = invert ? !up : up;            // for absenteeism, "down" is good
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${good ? "text-emerald-500" : "text-red-500"}`}>
      <Icon className="h-3 w-3" />
      {pct}{suffix} vs Yesterday
    </span>
  );
}

// ─── Recharts custom tooltip ───────────────────────────────
function ChartTip({ active, payload, label }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 py-0.5">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-500 capitalize">{p.name.replace(/_/g, " ")}:</span>
          <span className="font-bold text-gray-900 ml-auto pl-2">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── AI Insights generator ─────────────────────────────────
function buildInsights(stats: HRDashboardStats, kpis: HRAnalytics["kpis"]) {
  const pct = stats.total_employees > 0
    ? (stats.present_today / stats.total_employees) * 100 : 0;
  const items: { level: "info" | "warn" | "alert"; text: string; ago: string }[] = [];

  if (pct >= 75)
    items.push({ level: "info", text: `Overall attendance is Good (${pct.toFixed(0)}%). Production departments are performing well.`, ago: "10 mins ago" });
  else if (pct >= 50)
    items.push({ level: "warn", text: `Attendance at ${pct.toFixed(1)}% — below the 75% target. Review absenteeism triggers.`, ago: "10 mins ago" });
  else
    items.push({ level: "alert", text: `Critical: Only ${pct.toFixed(0)}% attendance today. Immediate follow-up required.`, ago: "10 mins ago" });

  const highAbsent = stats.department_breakdown?.filter(d => d.total > 0 && (d.total - d.present) / d.total > 0.3);
  if (highAbsent?.length)
    items.push({ level: "warn", text: `${highAbsent.slice(0,2).map(d=>d.department).join(" and ")} highest absenteeism (${highAbsent.map(d=>Math.round((d.total-d.present)/d.total*100)).join("%, ")}%).`, ago: "20 mins ago" });

  if (kpis.late_logins > 0)
    items.push({ level: "info", text: `${kpis.late_logins} employees were late today. Encourage on-time check-ins.`, ago: "30 mins ago" });

  if (stats.recent_hires > 0)
    items.push({ level: "info", text: `${stats.recent_hires} new hire${stats.recent_hires > 1 ? "s" : ""} onboarded in the last 30 days.`, ago: "1 hr ago" });

  return items.slice(0, 4);
}

// ─── Quick Actions ─────────────────────────────────────────
const QUICK = [
  { label: "Mark Attendance\nManually",    Icon: ClipboardCheck, bg: "bg-indigo-50",  ic: "text-indigo-600",  href: "/hrms" },
  { label: "Apply Leave\nfor Employee",    Icon: UserCog,        bg: "bg-emerald-50", ic: "text-emerald-600", href: "/leave" },
  { label: "Regularization\nRequest",     Icon: ClipboardList,  bg: "bg-purple-50",  ic: "text-purple-600",  href: "/hrms" },
  { label: "Attendance\nReport",           Icon: BarChart2,      bg: "bg-blue-50",    ic: "text-blue-600",    href: "/hrms" },
  { label: "Absence\nReport",             Icon: UserMinus,      bg: "bg-amber-50",   ic: "text-amber-600",   href: "/hrms" },
  { label: "Overtime\nReport",            Icon: AlarmClock,     bg: "bg-violet-50",  ic: "text-violet-600",  href: "/hrms" },
  { label: "Export\nData",               Icon: FileDown,       bg: "bg-teal-50",    ic: "text-teal-600",    href: "/hrms" },
];

// ─── Status badge ──────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const s = (status || "").toUpperCase();
  const map: Record<string, string> = {
    APPROVED: "bg-emerald-100 text-emerald-700",
    PENDING:  "bg-amber-100 text-amber-700",
    REJECTED: "bg-red-100 text-red-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${map[s] ?? "bg-gray-100 text-gray-600"}`}>
      {s.charAt(0) + s.slice(1).toLowerCase()}
    </span>
  );
}

// ══════════════════════════════════════════════════════════
// MAIN HR DASHBOARD
// ══════════════════════════════════════════════════════════
export function HRDashboard({
  stats, analytics, onSwitch, selectedDate, onDateChange, refreshing = false,
}: {
  stats: HRDashboardStats;
  analytics: HRAnalytics | null;
  onSwitch?: () => void;
  selectedDate?: string;
  onDateChange?: (date: string) => void;
  refreshing?: boolean;
}) {
  const router  = useRouter();
  const kpis    = analytics?.kpis;
  const daily14 = (analytics?.daily_attendance ?? []).slice(-14);
  const monthly = analytics?.monthly_attendance ?? [];
  const insights = kpis ? buildInsights(stats, kpis) : [];

  const totalEmp = stats.total_employees || 1;
  const presentPct  = parseFloat(((stats.present_today / totalEmp) * 100).toFixed(2));
  const absentPct   = parseFloat(((stats.absent_today  / totalEmp) * 100).toFixed(2));
  const onLeavePct  = parseFloat(((stats.on_leave_today / totalEmp) * 100).toFixed(2));
  const healthScore = Math.round(presentPct);
  const healthLabel = healthScore >= 75 ? "Good" : healthScore >= 50 ? "Average" : "Poor";
  const healthColor = healthScore >= 75 ? G : healthScore >= 50 ? A : R;

  // Shift data — fallback when DB has no SHIFT column (single "Day" row)
  const rawShift: ShiftStat[] = stats.shift_wise?.length
    ? stats.shift_wise
    : [{ shift: "Overall", present: stats.present_today, total: totalEmp, pct: presentPct }];
  const shiftLabels = ["Morning Shift", "Evening Shift", "Night Shift"];
  const shiftColors = [G, B, P];
  const shiftRows: { label: string; present: number; total: number; pct: number; color: string }[] =
    rawShift.slice(0, 3).map((s, i) => ({
      label:   shiftLabels[i] ?? s.shift,
      present: s.present,
      total:   s.total,
      pct:     s.pct,
      color:   shiftColors[i] ?? G,
    }));

  // Top absence reasons — live data only, no fallback
  const reasons = stats.top_reasons ?? [];
  const reasonTotal = reasons.reduce((s, r) => s + r.count, 0) || 1;

  // Dept totals
  const deptPresentTotal = stats.department_breakdown?.reduce((s, d) => s + d.present, 0) ?? 0;
  const deptTotal        = stats.department_breakdown?.reduce((s, d) => s + d.total, 0) ?? 0;
  const deptAbsentTotal  = deptTotal - deptPresentTotal;

  const displayDate = selectedDate
    ? new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  const kpiCards = [
    { label: "Total Employees",     sub: "All Employees",  value: stats.total_employees,                                icon: Users,    bg: "bg-indigo-50",  ic: "text-indigo-500",  today: stats.total_employees,  yest: 0, inv: false },
    { label: "Present Today",       sub: `${presentPct.toFixed(1)}% of total`, value: stats.present_today,             icon: UserCheck,bg: "bg-emerald-50", ic: "text-emerald-500", today: stats.present_today,    yest: stats.yesterday_present ?? 0, inv: false },
    { label: "Absent Today",        sub: `${absentPct.toFixed(1)}% of total`,  value: stats.absent_today,              icon: UserX,    bg: "bg-red-50",     ic: "text-red-500",     today: stats.absent_today,     yest: stats.yesterday_absent ?? 0, inv: true },
    { label: "On Leave",            sub: `${onLeavePct.toFixed(1)}% of total`, value: stats.on_leave_today,            icon: CalendarDays, bg: "bg-purple-50", ic: "text-purple-500", today: stats.on_leave_today,  yest: stats.yesterday_on_leave ?? 0, inv: false },
    { label: "Late Logins",         sub: "Today",          value: kpis?.late_logins ?? stats.late_today,               icon: Clock,    bg: "bg-amber-50",   ic: "text-amber-500",   today: kpis?.late_logins ?? 0, yest: 0, inv: true },
    { label: "On-Time Logins",      sub: "Today",          value: kpis?.early_logins ?? (stats.present_today - stats.late_today), icon: Zap, bg: "bg-teal-50", ic: "text-teal-500", today: kpis?.early_logins ?? 0, yest: stats.yesterday_present ?? 0, inv: false },
    { label: "Overtime Hours",      sub: "Today",          value: `${kpis?.overtime_hours ?? 0}h`,                     icon: Timer,    bg: "bg-violet-50",  ic: "text-violet-500",  today: kpis?.overtime_hours ?? 0, yest: 0, inv: false },
    { label: "New Joiners",         sub: "Last 30 days",   value: stats.recent_hires,                                  icon: UserPlus, bg: "bg-cyan-50",    ic: "text-cyan-500",    today: stats.recent_hires,     yest: 0, inv: false },
  ];

  return (
    <div className="space-y-4 animate-fade-in">

      {/* ══ HEADER ════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white">HR Dashboard</h1>
            {refreshing && (
              <svg className="animate-spin h-4 w-4 text-indigo-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
          </div>
          <p className="text-xs text-gray-400">Organization-wide overview</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Date picker */}
          <label className="relative flex items-center gap-1.5 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-gray-100 transition-colors overflow-hidden">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            <span>{displayDate}</span>
            <input
              type="date"
              value={selectedDate ?? new Date().toISOString().split("T")[0]}
              max={new Date().toISOString().split("T")[0]}
              onChange={(e) => onDateChange?.(e.target.value)}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
            />
          </label>
          {onSwitch && (
            <button
              onClick={onSwitch}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors text-xs font-medium whitespace-nowrap"
            >
              <ToggleRight className="h-4 w-4" />
              <span className="hidden sm:inline">Switch to Personal</span>
              <span className="sm:hidden">Personal</span>
            </button>
          )}
        </div>
      </div>

      {/* ══ KPI SECTION: Health Score spans 2 rows + 8 equal cards ══ */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4" style={{ gridTemplateRows: "auto auto" }}>

        {/* Health Score — full width on mobile, spans both rows on desktop */}
        <Card className="col-span-2 lg:col-span-1 lg:row-span-2">
          <CardContent className="h-full flex flex-col justify-center pt-3 pb-4 px-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-gray-700">Attendance Health Score</p>
              <Info className="h-3.5 w-3.5 text-gray-400" />
            </div>
            <HalfGauge value={presentPct} color={healthColor} centerLabel={String(healthScore)} subLabel={healthLabel} />
            <div className="text-center mt-2 space-y-1">
              {stats.yesterday_present !== undefined && stats.yesterday_present > 0 && (
                <Delta today={stats.present_today} yesterday={stats.yesterday_present} />
              )}
              <p className="text-[10px] text-gray-400 leading-tight px-1">
                {healthScore >= 75 ? "Great! Attendance is on track." : "Action needed to improve attendance."}
              </p>
            </div>
            {/* Mini legend */}
            <div className="mt-4 space-y-1.5 text-[10px]">
              <div className="flex justify-between text-gray-500">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400 inline-block"/>Present</span>
                <span className="font-bold text-gray-700">{stats.present_today}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400 inline-block"/>Absent</span>
                <span className="font-bold text-gray-700">{stats.absent_today}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-purple-400 inline-block"/>On Leave</span>
                <span className="font-bold text-gray-700">{stats.on_leave_today}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 8 KPI cards — 4 per row, filling remaining 4 cols × 2 rows */}
        {kpiCards.map(({ label, sub, value, icon: Icon, bg, ic, today, yest, inv }) => (
          <Card key={label}>
            <CardContent className="py-4 px-4 h-full min-h-[100px]">
              <div className="flex items-start gap-3 h-full">
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${bg}`}>
                  <Icon className={`h-5 w-5 ${ic}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-extrabold text-gray-900 leading-tight">{value}</p>
                  <p className="text-xs text-gray-500 leading-tight">{label}</p>
                  <p className="text-[10px] text-gray-400">{sub}</p>
                  <div className="h-4 flex items-center">
                    {yest > 0 ? <Delta today={Number(today)} yesterday={Number(yest)} invert={inv} /> : null}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ══ ROW 3: Dept | Trend | Monthly | AI Insights ══════ */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">

        {/* Department Breakdown */}
        <Card>
          <CardContent className="py-3 px-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-800">Department Breakdown</p>
              <div className="flex gap-2 text-[10px] text-gray-500">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500 inline-block" />Present</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-400 inline-block" />Absent</span>
              </div>
            </div>
            <div className="space-y-1.5">
              {(stats.department_breakdown ?? []).slice(0, 10).map((d, i) => {
                const pPct = d.total > 0 ? Math.round((d.present / d.total) * 100) : 0;
                const aPct = 100 - pPct;
                const absent = d.total - d.present;
                return (
                  <div key={i} className="flex items-center gap-1.5">
                    <p className="w-24 text-[10px] text-gray-600 truncate shrink-0">{d.department}</p>
                    <div className="flex-1 flex h-4 rounded overflow-hidden text-[9px] font-bold">
                      {pPct > 0 && (
                        <div className="bg-emerald-500 flex items-center justify-center text-white leading-none"
                          style={{ width: `${pPct}%`, minWidth: pPct > 0 ? "32px" : "0" }}>
                          {pPct > 12 ? `${d.present} (${pPct}%)` : ""}
                        </div>
                      )}
                      {aPct > 0 && (
                        <div className="bg-red-400 flex items-center justify-center text-white leading-none"
                          style={{ width: `${aPct}%`, minWidth: aPct > 0 ? "24px" : "0" }}>
                          {aPct > 8 ? `${absent} (${aPct}%)` : ""}
                        </div>
                      )}
                    </div>
                    <p className="w-6 text-[10px] text-gray-400 text-right shrink-0">{d.total}</p>
                  </div>
                );
              })}
            </div>
            {/* Total row */}
            {deptTotal > 0 && (
              <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-100">
                <p className="w-24 text-[10px] font-bold text-gray-700 shrink-0">Total</p>
                <div className="flex-1 flex text-[9px] font-bold gap-2">
                  <span className="text-emerald-600">{deptPresentTotal} ({Math.round(deptPresentTotal/deptTotal*100)}%)</span>
                  <span className="text-red-500">{deptAbsentTotal} ({Math.round(deptAbsentTotal/deptTotal*100)}%)</span>
                </div>
                <p className="w-6 text-[10px] font-bold text-gray-700 text-right shrink-0">{deptTotal}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Attendance Trend — 14 days */}
        <Card>
          <CardContent className="py-3 px-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-800">
                Attendance Trend <span className="text-amber-500">(Last 14 Days)</span>
              </p>
            </div>
            {daily14.length === 0 ? (
              <p className="text-xs text-gray-400 py-8 text-center">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={daily14} margin={{ top: 14, right: 8, left: -28, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="day" tick={{ fontSize: 8 }} interval={2} />
                  <YAxis tick={{ fontSize: 8 }} />
                  <Tooltip content={<ChartTip />} />
                  <Line type="monotone" dataKey="on_time" name="Present" stroke={G} strokeWidth={2}
                    dot={{ r: 3, fill: G }} activeDot={{ r: 5 }}>
                    <LabelList dataKey="on_time" position="top" style={{ fontSize: 7, fill: G }} />
                  </Line>
                  <Line type="monotone" dataKey="absent" name="Absent" stroke={R} strokeWidth={1.5}
                    strokeDasharray="4 2" dot={{ r: 2, fill: R }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Monthly Overview — grouped bars */}
        <Card>
          <CardContent className="py-3 px-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-800">Monthly Overview</p>
              <div className="flex gap-2 text-[10px] text-gray-500">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" />Present</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-400" />Absent</span>
              </div>
            </div>
            {monthly.length === 0 ? (
              <p className="text-xs text-gray-400 py-8 text-center">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={monthly} barCategoryGap="25%" barGap={3} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="available" name="Present" fill={G} radius={[3, 3, 0, 0]} maxBarSize={18} />
                  <Bar dataKey="absent"    name="Absent"  fill={R} radius={[3, 3, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* HR AI Insights */}
        <Card>
          <CardContent className="py-3 px-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Brain className="h-4 w-4 text-indigo-500" />
                <p className="text-xs font-semibold text-gray-800">HR AI Insights</p>
              </div>
              <span className="text-[9px] font-bold bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded">AI</span>
            </div>
            <div className="space-y-2">
              {insights.length === 0 ? (
                <p className="text-xs text-gray-400">No insights yet.</p>
              ) : (
                insights.map((ins, i) => {
                  const cfg = {
                    alert: { bg: "bg-red-50",    border: "border-red-400",    Icon: AlertTriangle, ic: "text-red-500" },
                    warn:  { bg: "bg-amber-50",  border: "border-amber-400",  Icon: AlertTriangle, ic: "text-amber-500" },
                    info:  { bg: "bg-blue-50",   border: "border-blue-400",   Icon: Info,          ic: "text-blue-500" },
                  }[ins.level];
                  return (
                    <div key={i} className={`flex gap-2 border-l-4 rounded-r-lg px-2.5 py-2 ${cfg.bg} ${cfg.border}`}>
                      <cfg.Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${cfg.ic}`} />
                      <div className="min-w-0">
                        <p className="text-[10px] text-gray-700 leading-snug">{ins.text}</p>
                        <p className="text-[9px] text-gray-400 mt-0.5">{ins.ago}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <button className="mt-3 flex items-center gap-1 text-[10px] text-indigo-600 font-semibold hover:underline">
              View All Alerts <ChevronRight className="h-3 w-3" />
            </button>
          </CardContent>
        </Card>
      </div>

      {/* ══ ROW 4: Absenteeism | Reasons | Shift | Turnover | Birthdays ══ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">

        {/* Absenteeism Rate */}
        <Card>
          <CardContent className="py-3 px-3">
            <p className="text-xs font-semibold text-gray-800 mb-1">Absenteeism Rate</p>
            <HalfGauge value={absentPct} color={R} centerLabel={`${absentPct.toFixed(2)}%`} subLabel="Today" />
            <div className="text-center mt-1 space-y-0.5">
              {stats.yesterday_absent !== undefined && stats.yesterday_absent > 0 && (
                <Delta today={stats.absent_today} yesterday={stats.yesterday_absent} invert />
              )}
              <p className="text-[10px] text-gray-400">Target: &lt; 10%</p>
            </div>
          </CardContent>
        </Card>

        {/* Top Reasons for Absence */}
        <Card>
          <CardContent className="py-3 px-3">
            <p className="text-xs font-semibold text-gray-800 mb-1">Top Reasons for Absence</p>
            {reasons.length === 0 ? (
              <p className="text-[10px] text-gray-400 py-8 text-center">No leave data this year</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={110}>
                  <PieChart>
                    <Pie data={reasons} cx="50%" cy="50%" innerRadius={28} outerRadius={46}
                      dataKey="count" nameKey="reason" paddingAngle={2}>
                      {reasons.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => [`${Math.round(Number(v) / reasonTotal * 100)}%`]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-0.5 mt-1">
                  {reasons.slice(0, 5).map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                      <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="text-gray-600 truncate flex-1">{r.reason}</span>
                      <span className="font-bold text-gray-700">{Math.round(r.count / reasonTotal * 100)}%</span>
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-gray-400 mt-1.5">Total Records: {reasonTotal}</p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Shift Wise Attendance */}
        <Card>
          <CardContent className="py-3 px-3">
            <p className="text-xs font-semibold text-gray-800 mb-2">Shift Wise Attendance</p>
            <div className="flex justify-around">
              {shiftRows.map((s, i) => (
                <ShiftRing key={i} label={s.label} pct={s.pct} present={s.present} total={s.total} color={s.color} />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Employee Turnover YTD */}
        <Card>
          <CardContent className="py-3 px-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-gray-800">Employee Turnover (YTD)</p>
            </div>
            <div className="flex flex-col items-center py-2">
              <p className="text-3xl font-extrabold text-rose-500">{stats.turnover_ytd ?? 0}%</p>
              <p className="text-[10px] text-gray-500 mt-0.5">Turnover Rate</p>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1 mb-3">
              <div className="h-full bg-rose-400 rounded-full"
                style={{ width: `${Math.min(stats.turnover_ytd ?? 0, 100)}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="bg-red-50 rounded-lg py-2">
                <p className="text-sm font-extrabold text-gray-500 text-[10px]">Inactive/Left</p>
                <p className="text-[9px] text-gray-400">See HR Records</p>
              </div>
              <div className="bg-emerald-50 rounded-lg py-2">
                <p className="text-sm font-extrabold text-emerald-500">{stats.recent_hires}</p>
                <p className="text-[9px] text-gray-400">Hired (30d)</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Upcoming Birthdays */}
        <Card>
          <CardContent className="py-3 px-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-800">Upcoming Birthdays</p>
            </div>
            {!(stats.upcoming_birthdays?.length) ? (
              <p className="text-[10px] text-gray-400 py-4 text-center">No birthdays in next 14 days</p>
            ) : (
              <div className="space-y-2">
                {(stats.upcoming_birthdays ?? []).slice(0, 4).map((b: UpcomingBirthday, i: number) => (
                  <div key={i} className="flex items-center gap-2">
                    <Avatar name={b.name} size={8} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold text-gray-800 truncate">{b.name}</p>
                      <p className="text-[9px] text-gray-400 truncate">{b.dept}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] font-bold text-pink-500">{b.date}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button className="mt-2 flex items-center gap-1 text-[10px] text-indigo-600 font-semibold hover:underline">
              View All <ChevronRight className="h-3 w-3" />
            </button>
          </CardContent>
        </Card>
      </div>

      {/* ══ ROW 5: Quick Actions | Leave Requests | Work Anniversary ══ */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">

        {/* Quick Actions */}
        <Card>
          <CardContent className="py-3 px-3">
            <p className="text-xs font-semibold text-gray-800 mb-3">Quick Actions</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {QUICK.map(({ label, Icon, bg, ic, href }) => (
                <button key={label}
                  onClick={() => router.push(href)}
                  className={`flex flex-col items-center gap-1.5 p-2 rounded-xl ${bg} hover:scale-105 active:scale-95 transition-transform cursor-pointer`}>
                  <Icon className={`h-5 w-5 ${ic}`} />
                  <span className="text-[9px] font-medium text-gray-600 text-center leading-tight whitespace-pre-line">{label}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Upcoming Leave Requests */}
        <Card className="lg:col-span-2">
          <CardContent className="py-3 px-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-800">Upcoming Leave Requests</p>
              <span className="text-[10px] text-gray-400">Next 30 days</span>
            </div>
            {!(stats.upcoming_leaves?.length) ? (
              <p className="text-[10px] text-gray-400 py-4 text-center">No upcoming leave requests</p>
            ) : (
              <>
                {/* Mobile card view */}
                <div className="sm:hidden space-y-2">
                  {(stats.upcoming_leaves ?? []).map((lv: UpcomingLeave, i: number) => (
                    <div key={i} className="bg-gray-50 rounded-lg p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[11px] font-semibold text-gray-800">{lv.name}</p>
                        <StatusBadge status={lv.status} />
                      </div>
                      <p className="text-[10px] text-gray-500 mb-1">{lv.dept} · Type {lv.leave_type}</p>
                      <p className="text-[10px] text-gray-500">{lv.from_date} → {lv.to_date} · <span className="font-semibold text-gray-700">{lv.days}d</span></p>
                    </div>
                  ))}
                </div>
                {/* Desktop table view */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {["Employee","Department","Leave Type","From","To","Days","Status"].map(h => (
                          <th key={h} className="py-1.5 px-1.5 text-left font-semibold text-gray-400 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(stats.upcoming_leaves ?? []).map((lv: UpcomingLeave, i: number) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="py-1.5 px-1.5 font-medium text-gray-800 whitespace-nowrap">{lv.name}</td>
                          <td className="py-1.5 px-1.5 text-gray-500">{lv.dept}</td>
                          <td className="py-1.5 px-1.5 text-gray-600 whitespace-nowrap">Type {lv.leave_type}</td>
                          <td className="py-1.5 px-1.5 text-gray-600 whitespace-nowrap">{lv.from_date}</td>
                          <td className="py-1.5 px-1.5 text-gray-600 whitespace-nowrap">{lv.to_date}</td>
                          <td className="py-1.5 px-1.5 text-center font-semibold text-gray-700">{lv.days}</td>
                          <td className="py-1.5 px-1.5 text-center"><StatusBadge status={lv.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <button className="mt-2 flex items-center gap-1 text-[10px] text-indigo-600 font-semibold hover:underline">
              View All Requests <ChevronRight className="h-3 w-3" />
            </button>
          </CardContent>
        </Card>

        {/* Work Anniversary */}
        <Card>
          <CardContent className="py-3 px-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-800">Work Anniversary</p>
            </div>
            {!(stats.upcoming_anniversaries?.length) ? (
              <p className="text-[10px] text-gray-400 py-4 text-center">No anniversaries in next 14 days</p>
            ) : (
              <div className="space-y-2">
                {(stats.upcoming_anniversaries ?? []).slice(0, 4).map((a: UpcomingAnniversary, i: number) => (
                  <div key={i} className="flex items-center gap-2">
                    <Avatar name={a.name} size={8} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold text-gray-800 truncate">{a.name}</p>
                      <p className="text-[9px] font-bold text-amber-500">{a.years} Year{a.years > 1 ? "s" : ""}</p>
                    </div>
                    <p className="text-[10px] font-medium text-gray-400 shrink-0">{a.date}</p>
                  </div>
                ))}
              </div>
            )}
            <button className="mt-2 flex items-center gap-1 text-[10px] text-indigo-600 font-semibold hover:underline">
              View All <ChevronRight className="h-3 w-3" />
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Backward-compat export (analytics-only view) ─────────
export function HRDashboardCharts({ data }: { data: HRAnalytics }) {
  const kpis   = data.kpis;
  const daily14 = data.daily_attendance.slice(-14);
  const monthly = data.monthly_attendance;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Late Logins",       value: kpis.late_logins,       icon: Clock,        color: "bg-amber-50 text-amber-600" },
          { label: "On-Time Logins",    value: kpis.early_logins,      icon: Zap,          color: "bg-emerald-50 text-emerald-600" },
          { label: "Overtime (h)",      value: kpis.overtime_hours,    icon: Timer,        color: "bg-purple-50 text-purple-600" },
          { label: "Pending Leaves",    value: kpis.unapproved_leaves, icon: AlertTriangle,color: "bg-red-50 text-red-600" },
          { label: "Avg Work Hrs",      value: kpis.avg_work_hrs,      icon: Activity,     color: "bg-cyan-50 text-cyan-600" },
          { label: "Attendance %",      value: `${kpis.attendance_pct}%`, icon: TrendingUp, color: "bg-indigo-50 text-indigo-600" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="py-4 flex items-center gap-3">
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}><Icon className="h-5 w-5" /></div>
              <div><p className="text-xl font-bold text-gray-900">{value}</p><p className="text-xs text-gray-500">{label}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm font-semibold text-gray-900 mb-2">Attendance Status — Last 14 days</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={daily14} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={1} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="on_time" name="On Time" fill={G} radius={[3,3,0,0]} />
                <Bar dataKey="late"    name="Late"    fill={A} radius={[3,3,0,0]} />
                <Bar dataKey="absent"  name="Absent"  fill={B} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm font-semibold text-gray-900 mb-2">Overall Attendance % — Last 6 months</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                <Tooltip content={<ChartTip />} />
                <Line type="monotone" dataKey="attendance_pct" name="Attendance %" stroke={G} strokeWidth={2.5} dot={{ r: 5, fill: G }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
