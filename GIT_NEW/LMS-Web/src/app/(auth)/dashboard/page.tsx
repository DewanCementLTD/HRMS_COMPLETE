"use client";

import Link from "next/link";
import { useDashboardController } from "@/controllers/useDashboardController";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/Card";
import { WelcomeHero } from "@/components/layout/WelcomeHero";
import { Spinner } from "@/components/ui/Spinner";
import { LeaveBalanceChart, LEAVE_CHART_COLORS } from "@/components/charts/LeaveBalanceChart";
import { AttendanceChart } from "@/components/charts/AttendanceChart";
import { HRDashboard } from "@/components/charts/HRDashboardCharts";
import { formatDate } from "@/lib/utils";
import {
  User,
  Network,
  Briefcase,
  CalendarDays,
  CalendarPlus,
  Clock,
  FileText,
  BarChart3,
  PieChart as PieIcon,
  Zap,
  AlertCircle,
  ToggleLeft,
  ArrowRight,
  ChevronRight,
  Sprout,
} from "lucide-react";

/** Card title row used across the dashboard: icon + title, optional link on the right. */
function SectionTitle({
  icon: Icon,
  title,
  href,
  linkLabel,
}: {
  icon: React.ElementType;
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon className="h-5 w-5 text-brand shrink-0" />
        <h2 className="text-base sm:text-lg font-bold text-ink truncate">{title}</h2>
      </div>
      {href && linkLabel && (
        <Link
          href={href}
          className="flex items-center gap-1 text-xs sm:text-sm font-medium text-brand hover:underline shrink-0"
        >
          {linkLabel} <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

const QUICK_ACTIONS = [
  { href: "/leave/apply", title: "Apply Leave", sub: "Submit a new leave request", Icon: CalendarPlus },
  { href: "/leave/status", title: "Leave Status", sub: "Track your leave requests", Icon: FileText },
  { href: "/attendance", title: "View Attendance", sub: "Check your attendance records", Icon: Clock },
  { href: "/profile", title: "My Profile", sub: "View & update your information", Icon: User },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const {
    dashboard,
    leaveBalances,
    attendanceSummary,
    hrStats,
    hrAnalytics,
    hrView,
    setHrView,
    loading,
    refreshing,
    error,
    selectedDate,
    setSelectedDate,
  } = useDashboardController();

  if (loading) return <Spinner />;

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <p className="text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  // SEC_USERNAME-only HR admins have no personal employee record — they only ever
  // see the HR dashboard. Don't render the personal view (which would show empty cards).
  const secOnlyAdmin = user?.has_employee_features === false && !!user?.hr_admin;

  // ==================== HR DASHBOARD VIEW ====================
  if ((hrView && hrStats) || secOnlyAdmin) {
    if (!hrStats) {
      return (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <AlertCircle className="h-12 w-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-600">HR dashboard data not available.</p>
          </div>
        </div>
      );
    }
    return (
      <HRDashboard
        stats={hrStats}
        analytics={hrAnalytics}
        onSwitch={secOnlyAdmin ? undefined : () => setHrView(false)}
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        refreshing={refreshing}
      />
    );
  }

  // ==================== PERSONAL DASHBOARD VIEW ====================
  const infoItems = [
    {
      label: "Employee",
      value: dashboard?.emp_name,
      sub: `ID: ${dashboard?.card_no ?? ""}`,
      Icon: User,
    },
    {
      // Show the department NAME; the code is only a fallback for a record
      // whose code has no matching HR_DEPT row.
      label: "Department",
      value: dashboard?.department_name || dashboard?.department || "-",
      Icon: Network,
    },
    {
      label: "Designation",
      value: dashboard?.designation_name || dashboard?.designation || "-",
      Icon: Briefcase,
    },
    {
      label: "Joined On",
      value: formatDate(dashboard?.date_of_join || ""),
      Icon: CalendarDays,
    },
  ];

  const attendanceTiles = attendanceSummary
    ? [
        { label: "Present", value: attendanceSummary.present, tile: "bg-emerald-50", text: "text-emerald-600" },
        { label: "Absent", value: attendanceSummary.absent_days, tile: "bg-red-50", text: "text-red-500" },
        { label: "Late", value: attendanceSummary.late_days ?? 0, tile: "bg-amber-50", text: "text-amber-500" },
        { label: "Total Days", value: attendanceSummary.total_days, tile: "bg-brand-soft", text: "text-brand" },
      ]
    : [];

  const positiveBalances = leaveBalances.filter((b) => b.balance > 0);

  return (
    <div className="animate-fade-in space-y-5">
      <WelcomeHero
        title={`Welcome back, ${dashboard?.emp_name || "User"}!`}
        subtitle="Here's your HRMS overview for today."
        actions={
          user?.hr_admin && hrStats ? (
            <button
              onClick={() => setHrView(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-white hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm"
            >
              <ToggleLeft className="h-5 w-5" />
              Switch to HR View
            </button>
          ) : undefined
        }
      />

      {/* Employee info strip */}
      <Card className="p-4 sm:p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-0 lg:divide-x divide-line">
          {infoItems.map(({ label, value, sub, Icon }) => (
            <div key={label} className="flex items-center gap-4 lg:px-5 first:lg:pl-0 min-w-0">
              <div className="h-12 w-12 rounded-xl bg-brand-soft flex items-center justify-center shrink-0">
                <Icon className="h-6 w-6 text-brand" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-slate-500 uppercase tracking-wide">{label}</p>
                <p className="text-sm font-bold text-ink truncate" title={value ?? ""}>{value}</p>
                {sub && <p className="text-xs text-slate-500 truncate">{sub}</p>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Leave balance + attendance this month */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <Card className={`p-5 ${attendanceSummary ? "lg:col-span-7" : "lg:col-span-12"}`}>
          <SectionTitle icon={FileText} title="Leave Balance" href="/leave/status" linkLabel="View Details" />
          {leaveBalances.length === 0 ? (
            <p className="text-slate-400 text-sm py-4">No leave balance data available</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              {leaveBalances.map((lb, i) => {
                const displayBalance = Math.max(0, lb.balance);
                // Days on requests still awaiting approval are already held
                // back from the figure above; saying so stops the drop from
                // looking like the leave was approved behind their back.
                const pending = lb.pending_days ?? 0;
                return (
                  <div
                    key={i}
                    className="bg-slate-50 rounded-xl px-3 py-4 text-center hover:bg-brand-soft/60 transition-colors"
                  >
                    <p className={`text-2xl sm:text-3xl font-extrabold ${displayBalance > 0 ? "text-brand" : "text-slate-400"}`}>
                      {displayBalance}
                    </p>
                    <p className="text-xs sm:text-sm text-slate-600 mt-1">{lb.leave_desc || `Type ${lb.leave_type}`}</p>
                    {pending > 0 && (
                      <p className="text-[11px] text-amber-600 mt-0.5">{pending} awaiting approval</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {attendanceSummary && (
          <Card className="p-5 lg:col-span-5">
            <SectionTitle icon={CalendarDays} title="Attendance This Month" href="/attendance" linkLabel="View Attendance" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {attendanceTiles.map((t) => (
                <div key={t.label} className={`${t.tile} rounded-xl px-2 py-4 text-center`}>
                  <p className={`text-2xl sm:text-3xl font-extrabold ${t.text}`}>{t.value}</p>
                  <p className="text-xs sm:text-sm text-slate-600 mt-1">{t.label}</p>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Attendance overview chart + quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {attendanceSummary && (
          <Card className="p-5 lg:col-span-7">
            <SectionTitle icon={BarChart3} title="Attendance Overview" />
            <div className="flex flex-col md:flex-row gap-5">
              <div className="flex-1 min-w-0">
                <AttendanceChart summary={attendanceSummary} />
              </div>
              <div className="md:w-52 shrink-0 bg-slate-50 rounded-xl p-4 space-y-3 self-start w-full">
                {[
                  { label: "Present", value: attendanceSummary.present, dot: "bg-emerald-500" },
                  { label: "Absent", value: attendanceSummary.absent_days, dot: "bg-red-500" },
                  { label: "Late", value: attendanceSummary.late_days ?? 0, dot: "bg-amber-400" },
                  { label: "Incomplete", value: attendanceSummary.incomplete, dot: "bg-brand" },
                ].map((r) => (
                  <div key={r.label} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-slate-600">
                      <span className={`h-2.5 w-2.5 rounded-full ${r.dot}`} />
                      {r.label}
                    </span>
                    <span className="font-bold text-ink">{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        <Card className={`p-5 ${attendanceSummary ? "lg:col-span-5" : "lg:col-span-12"}`}>
          <SectionTitle icon={Zap} title="Quick Actions" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {QUICK_ACTIONS.map(({ href, title, sub, Icon }) => (
              <Link
                key={href}
                href={href}
                className="group flex items-center gap-3 rounded-xl border border-line p-3.5 hover:border-brand/40 hover:bg-brand-soft/40 transition-colors"
              >
                <span className="h-11 w-11 rounded-xl bg-brand-soft flex items-center justify-center shrink-0">
                  <Icon className="h-5 w-5 text-brand" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{title}</span>
                  <span className="block text-xs text-slate-500 leading-snug">{sub}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-brand shrink-0" />
              </Link>
            ))}
          </div>
        </Card>
      </div>

      {/* Leave balance chart + motivational card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <Card className="p-5 lg:col-span-7">
          <SectionTitle icon={PieIcon} title="Balance Chart" href="/leave/apply" linkLabel="Apply Leave" />
          <div className="flex flex-col md:flex-row md:items-center gap-5">
            <div className="flex-1 min-w-0">
              <LeaveBalanceChart balances={leaveBalances} />
            </div>
            {positiveBalances.length > 0 && (
              <div className="md:w-56 shrink-0 space-y-2.5">
                {positiveBalances.map((b, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2 text-slate-600 min-w-0">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ background: LEAVE_CHART_COLORS[i % LEAVE_CHART_COLORS.length] }}
                      />
                      <span className="truncate">{b.leave_desc || `Type ${b.leave_type}`}</span>
                    </span>
                    <span className="font-bold text-ink">{b.balance}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card className="p-6 lg:col-span-5 flex items-center gap-6 overflow-hidden">
          <div className="hidden sm:flex h-32 w-28 shrink-0 items-end justify-center rounded-2xl bg-linear-to-b from-slate-50 to-brand-soft">
            <Sprout className="h-20 w-20 text-slate-300 mb-3" strokeWidth={1.2} />
          </div>
          <div className="min-w-0">
            <p className="font-serif text-2xl text-ink leading-snug">&ldquo;Great work builds great teams.&rdquo;</p>
            <span className="block my-3 h-0.5 w-10 bg-brand rounded-full" />
            <p className="text-sm text-slate-500">Your contribution makes a difference.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
