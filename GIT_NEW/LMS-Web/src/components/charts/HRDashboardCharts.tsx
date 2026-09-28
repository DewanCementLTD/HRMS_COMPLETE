"use client";

import { toLocalYmd } from "@/lib/utils";
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
import { WelcomeHero } from "@/components/layout/WelcomeHero";
import {
  Users, UserCheck, UserX, TreePalm, Clock, Zap, Timer, UserPlus,
  TrendingUp, TrendingDown, AlertTriangle, Activity,
  CalendarDays, BarChart2, FileText, ClipboardList, Download,
  Brain, ToggleRight, UserMinus, Info,
  ClipboardCheck, UserCog, AlarmClock, FileDown, ChevronDown,
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
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eef2f7" strokeWidth="13"
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
      <text x={cx} y={cy - 16} textAnchor="middle" fontSize="30" fontWeight="800" fill="#0f1e46">
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
  { label: "Mark Attendance\nManually",    Icon: ClipboardCheck, bg: "bg-indigo-50",  ic: "text-indigo-600",  href: "/hrms?section=attendance" },
  { label: "Apply Leave\nfor Employee",    Icon: UserCog,        bg: "bg-emerald-50", ic: "text-emerald-600", href: "/leave/apply" },
  { label: "Regularization\nRequest",     Icon: ClipboardList,  bg: "bg-purple-50",  ic: "text-purple-600",  href: "/hrms?section=attendance" },
  { label: "Attendance\nReport",           Icon: BarChart2,      bg: "bg-blue-50",    ic: "text-blue-600",    href: "/hrms?section=attendance" },
  { label: "Absence\nReport",             Icon: UserMinus,      bg: "bg-amber-50",   ic: "text-amber-600",   href: "/hrms?section=attendance" },
  { label: "Overtime\nReport",            Icon: AlarmClock,     bg: "bg-violet-50",  ic: "text-violet-600",  href: "/hrms?section=attendance" },
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

// ─── Full ring (absenteeism / turnover) ────────────────────
function RingGauge({ pct, color, center, sub }: {
  pct: number; color: string; center: string; sub?: React.ReactNode;
}) {
  const r = 54, circ = 2 * Math.PI * r;
  const filled = (Math.min(Math.max(pct, 0), 100) / 100) * circ;
  return (
    <div className="relative h-40 w-40 mx-auto">
      <svg className="h-40 w-40 -rotate-90" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#eef2f7" strokeWidth="14" />
        <circle cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth="14"
          strokeLinecap="round" strokeDasharray={`${filled} ${circ}`}
          style={{ transition: "stroke-dasharray 0.8s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
        <span className="text-2xl font-extrabold text-ink leading-none">{center}</span>
        {sub && <span className="mt-1">{sub}</span>}
      </div>
    </div>
  );
}

// ─── Multi-segment donut (shift split) ─────────────────────
function SegmentDonut({ segments, center, caption }: {
  segments: { value: number; color: string }[]; center: string | number; caption: string;
}) {
  const r = 50, circ = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0);
  let offset = 0;
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg className="h-36 w-36 -rotate-90" viewBox="0 0 130 130">
        <circle cx="65" cy="65" r={r} fill="none" stroke="#eef2f7" strokeWidth="16" />
        {total > 0 && segments.map((s, i) => {
          const len = (s.value / total) * circ;
          const el = (
            <circle key={i} cx="65" cy="65" r={r} fill="none" stroke={s.color} strokeWidth="16"
              strokeDasharray={`${len} ${circ}`} strokeDashoffset={-offset} />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-extrabold text-ink leading-none">{center}</span>
        <span className="text-[11px] text-slate-500 mt-1">{caption}</span>
      </div>
    </div>
  );
}

// ─── Date pill ─────────────────────────────────────────────
// A transparent <input type="date"> laid over a button only opens its picker
// from the tiny calendar glyph in Chrome, so the whole pill is a button that
// opens the (visually hidden) input's picker itself.
function DatePill({ value, label, onChange }: {
  value: string; label: string; onChange: (v: string) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const open = () => {
    const el = inputRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      // Older browsers without showPicker(): focusing + clicking opens it there.
      el.focus();
      el.click();
    }
  };
  return (
    <button
      type="button"
      onClick={open}
      className="relative flex items-center gap-2 text-sm font-medium text-slate-700 bg-white/90 backdrop-blur border border-white rounded-xl px-3.5 py-2 cursor-pointer hover:bg-white transition-colors shadow-sm"
    >
      <CalendarDays className="h-4 w-4 text-brand shrink-0" />
      <span>{label}</span>
      <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      <input
        ref={inputRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        max={toLocalYmd(new Date())}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="absolute left-0 bottom-0 w-full h-0 opacity-0 pointer-events-none"
      />
    </button>
  );
}

// ─── Card title row ────────────────────────────────────────
function PanelTitle({ icon: Icon, title, right }: {
  icon: React.ElementType; title: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="h-5 w-5 text-brand shrink-0" />
        <p className="text-sm sm:text-base font-bold text-ink truncate">{title}</p>
      </div>
      {right}
    </div>
  );
}

const DEPT_PREVIEW = 5;

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
  const [showAllDepts, setShowAllDepts] = React.useState(false);
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
  const shiftPresentTotal = shiftRows.reduce((s, x) => s + x.present, 0);

  // Top absence reasons — live data only, no fallback
  const reasons = stats.top_reasons ?? [];
  const reasonTotal = reasons.reduce((s, r) => s + r.count, 0) || 1;

  // Dept totals
  const depts = stats.department_breakdown ?? [];
  const deptPresentTotal = depts.reduce((s, d) => s + d.present, 0);
  const deptTotal        = depts.reduce((s, d) => s + d.total, 0);
  const deptAbsentTotal  = deptTotal - deptPresentTotal;
  const visibleDepts = showAllDepts ? depts : depts.slice(0, DEPT_PREVIEW);
  const hiddenDepts  = depts.length - DEPT_PREVIEW;

  const displayDate = selectedDate
    ? new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  const kpiCards = [
    { label: "Total Employees",     sub: "All Employees",  value: stats.total_employees,                                icon: Users,    bg: "bg-blue-50",    ic: "text-blue-600",    today: stats.total_employees,  yest: 0, inv: false },
    { label: "Present Today",       sub: `${presentPct.toFixed(1)}% of total`, value: stats.present_today,             icon: UserCheck,bg: "bg-emerald-50", ic: "text-emerald-500", today: stats.present_today,    yest: stats.yesterday_present ?? 0, inv: false },
    { label: "Absent Today",        sub: `${absentPct.toFixed(1)}% of total`,  value: stats.absent_today,              icon: UserX,    bg: "bg-red-50",     ic: "text-red-500",     today: stats.absent_today,     yest: stats.yesterday_absent ?? 0, inv: true },
    { label: "On Leave",            sub: `${onLeavePct.toFixed(1)}% of total`, value: stats.on_leave_today,            icon: CalendarDays, bg: "bg-purple-50", ic: "text-purple-500", today: stats.on_leave_today,  yest: stats.yesterday_on_leave ?? 0, inv: false },
    { label: "Late Logins",         sub: "Today",          value: kpis?.late_logins ?? stats.late_today,               icon: Clock,    bg: "bg-amber-50",   ic: "text-amber-500",   today: kpis?.late_logins ?? 0, yest: 0, inv: true },
    { label: "On-Time Logins",      sub: "Today",          value: kpis?.early_logins ?? (stats.present_today - stats.late_today), icon: Zap, bg: "bg-emerald-50", ic: "text-emerald-500", today: kpis?.early_logins ?? 0, yest: stats.yesterday_present ?? 0, inv: false },
    { label: "Overtime Hours",      sub: "Today",          value: `${kpis?.overtime_hours ?? 0}h`,                     icon: Timer,    bg: "bg-violet-50",  ic: "text-violet-500",  today: kpis?.overtime_hours ?? 0, yest: 0, inv: false },
    { label: "New Joiners",         sub: "Last 30 days",   value: stats.recent_hires,                                  icon: UserPlus, bg: "bg-cyan-50",    ic: "text-cyan-500",    today: stats.recent_hires,     yest: 0, inv: false },
  ];

  const axisTick = { fontSize: 10, fill: "#94a3b8" };

  return (
    <div className="space-y-5 animate-fade-in">

      {/* ══ HERO ═════════════════════════════════════════════ */}
      <WelcomeHero
        title="Welcome to HR Dashboard"
        subtitle="Here's what's happening across your organization today."
        busy={refreshing}
        actions={
          <>
            {/* Date picker */}
            <DatePill
              value={selectedDate ?? toLocalYmd(new Date())}
              label={displayDate}
              onChange={(v) => onDateChange?.(v)}
            />
            {onSwitch && (
              <button
                onClick={onSwitch}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-white hover:bg-blue-700 transition-colors text-sm font-medium whitespace-nowrap shadow-sm"
              >
                <ToggleRight className="h-4 w-4" />
                Switch to Personal
              </button>
            )}
          </>
        }
      />

      {/* ══ KPI TILES ════════════════════════════════════════ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 2xl:grid-cols-8 gap-3">
        {kpiCards.map(({ label, sub, value, icon: Icon, bg, ic, today, yest, inv }) => (
          <Card key={label} className="p-3.5">
            <div className="flex items-start gap-3">
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${bg}`}>
                <Icon className={`h-5 w-5 ${ic}`} />
              </div>
              <div className="min-w-0">
                <p className="text-xl sm:text-2xl font-extrabold text-ink leading-tight">{value}</p>
                <p className="text-xs text-slate-600 leading-tight">{label}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>
                <div className="min-h-4 flex items-center">
                  {yest > 0 ? <Delta today={Number(today)} yesterday={Number(yest)} invert={inv} /> : null}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* ══ ROW: Trend | Monthly | Department ════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">

        {/* Attendance Trend — 14 days */}
        <Card className="p-4 sm:p-5">
          <PanelTitle icon={BarChart2} title="Attendance Trend" right={
            <span className="text-[11px] font-medium text-slate-500 border border-line rounded-lg px-2 py-1 whitespace-nowrap">Last 14 Days</span>
          } />
          <div className="flex gap-3 text-[11px] text-slate-500 mb-1">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />Present</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" />Absent</span>
          </div>
          {daily14.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={daily14} margin={{ top: 14, right: 8, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="day" tick={axisTick} interval={2} tickLine={false} axisLine={{ stroke: "#e6ebf3" }} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip />} />
                <Line type="monotone" dataKey="on_time" name="Present" stroke={G} strokeWidth={2}
                  dot={{ r: 3, fill: G }} activeDot={{ r: 5 }}>
                  <LabelList dataKey="on_time" position="top" style={{ fontSize: 8, fill: G }} />
                </Line>
                <Line type="monotone" dataKey="absent" name="Absent" stroke={R} strokeWidth={1.5}
                  strokeDasharray="4 2" dot={{ r: 2, fill: R }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Monthly Overview — grouped bars */}
        <Card className="p-4 sm:p-5">
          <PanelTitle icon={BarChart2} title="Monthly Overview" />
          <div className="flex gap-3 text-[11px] text-slate-500 mb-1">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />Present</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" />Absent</span>
          </div>
          {monthly.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={monthly} barCategoryGap="25%" barGap={3} margin={{ top: 14, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={{ stroke: "#e6ebf3" }} />
                <YAxis tick={axisTick} allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: "#f4f7fc" }} />
                <Bar dataKey="available" name="Present" fill={G} radius={[3, 3, 0, 0]} maxBarSize={16} />
                <Bar dataKey="absent"    name="Absent"  fill={R} radius={[3, 3, 0, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Department Attendance */}
        <Card className="p-4 sm:p-5 lg:col-span-2 xl:col-span-1">
          <PanelTitle icon={ClipboardList} title="Department Attendance" />
          {depts.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">No data</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500">
                    <th className="py-2 px-2.5 text-left font-semibold rounded-l-lg">Department</th>
                    <th className="py-2 px-2 text-right font-semibold">Present</th>
                    <th className="py-2 px-2 text-right font-semibold">Absent</th>
                    <th className="py-2 px-2.5 text-right font-semibold rounded-r-lg">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDepts.map((d, i) => (
                    <tr key={i} className="border-b border-line/70 last:border-0">
                      <td className="py-2 px-2.5 text-slate-700 max-w-[140px] truncate" title={d.department}>{d.department}</td>
                      <td className="py-2 px-2 text-right font-semibold text-emerald-600">{d.present}</td>
                      <td className="py-2 px-2 text-right font-semibold text-red-500">{d.total - d.present}</td>
                      <td className="py-2 px-2.5 text-right text-slate-700">{d.total}</td>
                    </tr>
                  ))}
                  {deptTotal > 0 && (
                    <tr className="border-t border-line font-bold">
                      <td className="py-2 px-2.5 text-ink">Total</td>
                      <td className="py-2 px-2 text-right text-emerald-600">{deptPresentTotal} <span className="font-medium text-[10px]">({Math.round(deptPresentTotal/deptTotal*100)}%)</span></td>
                      <td className="py-2 px-2 text-right text-red-500">{deptAbsentTotal} <span className="font-medium text-[10px]">({Math.round(deptAbsentTotal/deptTotal*100)}%)</span></td>
                      <td className="py-2 px-2.5 text-right text-ink">{deptTotal}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {hiddenDepts > 0 && (
                <button
                  onClick={() => setShowAllDepts(!showAllDepts)}
                  className="mt-2 flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                >
                  {showAllDepts ? "Show fewer departments" : `Show ${hiddenDepts} more department${hiddenDepts > 1 ? "s" : ""}`}
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAllDepts ? "rotate-180" : ""}`} />
                </button>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* ══ ROW: Insights | Health | Absenteeism | Shift ═════ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">

        {/* HR Insights */}
        <Card className="p-4 sm:p-5">
          <PanelTitle icon={Brain} title="HR Insights" right={
            <span className="text-[9px] font-bold bg-brand-soft text-brand px-1.5 py-0.5 rounded">AI</span>
          } />
          <div className="space-y-2">
            {insights.length === 0 ? (
              <p className="text-xs text-slate-400">No insights yet.</p>
            ) : (
              insights.map((ins, i) => {
                const cfg = {
                  alert: { bg: "bg-red-50",   Icon: AlertTriangle, ic: "text-red-500" },
                  warn:  { bg: "bg-amber-50", Icon: AlertTriangle, ic: "text-amber-500" },
                  info:  { bg: "bg-blue-50",  Icon: Info,          ic: "text-blue-500" },
                }[ins.level];
                return (
                  <div key={i} className={`flex gap-2.5 rounded-xl px-3 py-2.5 ${cfg.bg}`}>
                    <cfg.Icon className={`h-4 w-4 mt-0.5 shrink-0 ${cfg.ic}`} />
                    <div className="min-w-0">
                      <p className="text-[11px] text-slate-700 leading-snug">{ins.text}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{ins.ago}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* Attendance Health Score */}
        <Card className="p-4 sm:p-5">
          <PanelTitle icon={Activity} title="Attendance Health Score" />
          <div className="max-w-[240px] mx-auto">
            <HalfGauge value={presentPct} color={healthColor} centerLabel={String(healthScore)} subLabel={healthLabel} />
          </div>
          <div className="text-center mt-2 space-y-1">
            {stats.yesterday_present !== undefined && stats.yesterday_present > 0 && (
              <Delta today={stats.present_today} yesterday={stats.yesterday_present} />
            )}
            <p className="text-[11px] text-slate-400 leading-tight px-1">
              {healthScore >= 75 ? "Great! Attendance is on track." : "Action needed to improve attendance."}
            </p>
          </div>
          <div className="mt-3 space-y-1.5 text-xs">
            {[
              { label: "Present",  value: stats.present_today,  dot: "bg-emerald-500" },
              { label: "Absent",   value: stats.absent_today,   dot: "bg-red-500" },
              { label: "On Leave", value: stats.on_leave_today, dot: "bg-purple-500" },
            ].map((r) => (
              <div key={r.label} className="flex justify-between text-slate-500">
                <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${r.dot}`} />{r.label}</span>
                <span className="font-bold text-ink">{r.value}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Absenteeism Rate */}
        <Card className="p-4 sm:p-5">
          <PanelTitle icon={UserX} title="Absenteeism Rate" />
          <RingGauge
            pct={absentPct}
            color={R}
            center={`${absentPct.toFixed(2)}%`}
            sub={
              stats.yesterday_absent !== undefined && stats.yesterday_absent > 0
                ? <Delta today={stats.absent_today} yesterday={stats.yesterday_absent} invert />
                : <span className="text-[11px] text-slate-400">Today</span>
            }
          />
          <p className="text-[11px] text-slate-400 text-center mt-3">Target: &lt; 10%</p>
        </Card>

        {/* Shift Wise Attendance */}
        <Card className="p-4 sm:p-5">
          <PanelTitle icon={BarChart2} title="Shift-wise Attendance" />
          <div className="flex flex-col items-center gap-4">
            <SegmentDonut
              segments={shiftRows.map((s) => ({ value: s.present, color: s.color }))}
              center={shiftPresentTotal}
              caption="Present"
            />
            <div className="w-full space-y-2">
              {shiftRows.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="text-slate-600 flex-1 truncate">{s.label}</span>
                  <span className="text-slate-400">{s.present}/{s.total}</span>
                  <span className="font-bold text-ink w-10 text-right">{s.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* ══ ROW: Reasons | Turnover | Birthdays | Anniversary ═ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">

        {/* Top Reasons for Absence */}
        <Card className="p-4 sm:p-5">
          <PanelTitle icon={FileText} title="Top Reasons for Absence" />
          {reasons.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">No leave data this year</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={130}>
                <PieChart>
                  <Pie data={reasons} cx="50%" cy="50%" innerRadius={36} outerRadius={56}
                    dataKey="count" nameKey="reason" paddingAngle={2}>
                    {reasons.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => [`${Math.round(Number(v) / reasonTotal * 100)}%`]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 mt-2">
                {reasons.slice(0, 5).map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-slate-600 truncate flex-1">{r.reason}</span>
                    <span className="font-bold text-ink">{Math.round(r.count / reasonTotal * 100)}%</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-400 mt-2">Total Records: {reasonTotal}</p>
            </>
          )}
        </Card>

        {/* Employee Turnover YTD */}
        <Card className="p-4 sm:p-5">
          <PanelTitle icon={UserMinus} title="Employee Turnover (YTD)" />
          <RingGauge
            pct={stats.turnover_ytd ?? 0}
            color="#f43f5e"
            center={`${stats.turnover_ytd ?? 0}%`}
            sub={<span className="text-[11px] text-slate-400">Turnover Rate</span>}
          />
          <div className="grid grid-cols-2 gap-2 text-center mt-4">
            <div className="bg-red-50 rounded-xl py-2.5">
              <p className="text-xs font-bold text-red-500">Left</p>
              <p className="text-[10px] text-slate-400">See HR Records</p>
            </div>
            <div className="bg-emerald-50 rounded-xl py-2.5">
              <p className="text-lg font-extrabold text-emerald-600 leading-none">{stats.recent_hires}</p>
              <p className="text-[10px] text-slate-400 mt-1">Hired (30d)</p>
            </div>
          </div>
        </Card>

        {/* Upcoming Birthdays */}
        <Card className="p-4 sm:p-5">
          <PanelTitle icon={CalendarDays} title="Upcoming Birthdays" />
          {!(stats.upcoming_birthdays?.length) ? (
            <p className="text-xs text-slate-400 py-6 text-center">No birthdays in next 14 days</p>
          ) : (
            <div className="space-y-3">
              {(stats.upcoming_birthdays ?? []).slice(0, 4).map((b: UpcomingBirthday, i: number) => (
                <div key={i} className="flex items-center gap-2.5">
                  <Avatar name={b.name} size={8} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-ink truncate">{b.name}</p>
                    <p className="text-[10px] text-slate-400 truncate">{b.dept}</p>
                  </div>
                  <p className="text-xs font-bold text-pink-500 shrink-0">{b.date}</p>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Work Anniversary */}
        <Card className="p-4 sm:p-5">
          <PanelTitle icon={CalendarDays} title="Work Anniversary" />
          {!(stats.upcoming_anniversaries?.length) ? (
            <p className="text-xs text-slate-400 py-6 text-center">No anniversaries in next 14 days</p>
          ) : (
            <div className="space-y-3">
              {(stats.upcoming_anniversaries ?? []).slice(0, 4).map((a: UpcomingAnniversary, i: number) => (
                <div key={i} className="flex items-center gap-2.5">
                  <Avatar name={a.name} size={8} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-ink truncate">{a.name}</p>
                    <p className="text-[10px] font-bold text-amber-500">{a.years} Year{a.years > 1 ? "s" : ""}</p>
                  </div>
                  <p className="text-xs font-medium text-slate-400 shrink-0">{a.date}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ══ ROW: Quick Actions | Leave Requests ══════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Quick Actions */}
        <Card className="p-4 sm:p-5">
          <PanelTitle icon={Zap} title="Quick Actions" />
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {QUICK.map(({ label, Icon, bg, ic, href }) => (
              <button key={label}
                onClick={() => router.push(href)}
                className={`flex flex-col items-center gap-2 px-2 py-3 rounded-xl ${bg} hover:-translate-y-0.5 hover:shadow-sm active:scale-95 transition-all cursor-pointer`}>
                <Icon className={`h-5 w-5 ${ic}`} />
                <span className="text-[10px] font-semibold text-slate-700 text-center leading-tight whitespace-pre-line">{label}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* Upcoming Leave Requests */}
        <Card className="p-4 sm:p-5 lg:col-span-2">
          <PanelTitle icon={FileText} title="Upcoming Leave Requests" right={
            <span className="text-[11px] text-slate-400 whitespace-nowrap">Next 30 days</span>
          } />
          {!(stats.upcoming_leaves?.length) ? (
            <p className="text-xs text-slate-400 py-6 text-center">No upcoming leave requests</p>
          ) : (
            <>
              {/* Mobile card view */}
              <div className="sm:hidden space-y-2">
                {(stats.upcoming_leaves ?? []).map((lv: UpcomingLeave, i: number) => (
                  <div key={i} className="bg-slate-50 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-xs font-semibold text-ink truncate">{lv.name}</p>
                      <StatusBadge status={lv.status} />
                    </div>
                    <p className="text-[11px] text-slate-500 mb-1">{lv.dept} · Type {lv.leave_type}</p>
                    <p className="text-[11px] text-slate-500">{lv.from_date} → {lv.to_date} · <span className="font-semibold text-slate-700">{lv.days}d</span></p>
                  </div>
                ))}
              </div>
              {/* Desktop table view */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500">
                      {["Employee","Department","Leave Type","From","To","Days","Status"].map((h, i, arr) => (
                        <th key={h} className={`py-2 px-2.5 text-left font-semibold whitespace-nowrap ${i === 0 ? "rounded-l-lg" : ""} ${i === arr.length - 1 ? "rounded-r-lg" : ""}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(stats.upcoming_leaves ?? []).map((lv: UpcomingLeave, i: number) => (
                      <tr key={i} className="border-b border-line/70 last:border-0 hover:bg-slate-50 transition-colors">
                        <td className="py-2 px-2.5 font-medium text-ink whitespace-nowrap">{lv.name}</td>
                        <td className="py-2 px-2.5 text-slate-500">{lv.dept}</td>
                        <td className="py-2 px-2.5 text-slate-600 whitespace-nowrap">Type {lv.leave_type}</td>
                        <td className="py-2 px-2.5 text-slate-600 whitespace-nowrap">{lv.from_date}</td>
                        <td className="py-2 px-2.5 text-slate-600 whitespace-nowrap">{lv.to_date}</td>
                        <td className="py-2 px-2.5 font-semibold text-slate-700">{lv.days}</td>
                        <td className="py-2 px-2.5"><StatusBadge status={lv.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
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
