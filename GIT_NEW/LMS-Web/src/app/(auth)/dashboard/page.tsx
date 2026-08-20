"use client";

import { useDashboardController } from "@/controllers/useDashboardController";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { LeaveBalanceChart } from "@/components/charts/LeaveBalanceChart";
import { AttendanceChart } from "@/components/charts/AttendanceChart";
import { HRDashboard } from "@/components/charts/HRDashboardCharts";
import { formatDate } from "@/lib/utils";
import {
  User,
  Building2,
  MapPin,
  Briefcase,
  CalendarDays,
  TreePalm,
  Clock,
  TrendingUp,
  AlertCircle,
  ToggleLeft,
} from "lucide-react";

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
          <p className="text-gray-600">{error}</p>
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
            <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">HR dashboard data not available.</p>
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
  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`Welcome, ${dashboard?.emp_name || "User"}`}
        subtitle="Here's your overview for today"
        actions={
          user?.hr_admin && hrStats ? (
            <button
              onClick={() => setHrView(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors text-sm font-medium"
            >
              <ToggleLeft className="h-5 w-5" />
              Switch to HR View
            </button>
          ) : undefined
        }
      />

      {/* Employee Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="flex items-center gap-4 py-5">
            <div className="h-12 w-12 rounded-xl bg-indigo-50 flex items-center justify-center">
              <User className="h-6 w-6 text-indigo-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Employee</p>
              <p className="text-sm font-semibold text-gray-900 truncate">{dashboard?.emp_name}</p>
              <p className="text-xs text-gray-400">ID: {dashboard?.card_no}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 py-5">
            <div className="h-12 w-12 rounded-xl bg-purple-50 flex items-center justify-center">
              <Building2 className="h-6 w-6 text-purple-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Department</p>
              <p className="text-sm font-semibold text-gray-900 truncate">{dashboard?.department || "-"}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 py-5">
            <div className="h-12 w-12 rounded-xl bg-emerald-50 flex items-center justify-center">
              <Briefcase className="h-6 w-6 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Designation</p>
              <p className="text-sm font-semibold text-gray-900 truncate">{dashboard?.designation || "-"}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 py-5">
            <div className="h-12 w-12 rounded-xl bg-amber-50 flex items-center justify-center">
              <CalendarDays className="h-6 w-6 text-amber-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Joined</p>
              <p className="text-sm font-semibold text-gray-900">{formatDate(dashboard?.date_of_join || "")}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Leave Balances */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <TreePalm className="h-5 w-5 text-indigo-600" />
                <h2 className="text-lg font-semibold text-gray-900">Leave Balance</h2>
              </div>
            </CardHeader>
            <CardContent>
              {leaveBalances.length === 0 ? (
                <p className="text-gray-400 text-sm py-4">No leave balance data available</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {leaveBalances.map((lb, i) => {
                    const displayBalance = Math.max(0, lb.balance);
                    return (
                      <div
                        key={i}
                        className="bg-gray-50 rounded-xl p-4 text-center hover:bg-gray-100 transition-colors"
                      >
                        <p className={`text-2xl font-bold ${displayBalance > 0 ? "text-indigo-600" : "text-gray-400"}`}>{displayBalance}</p>
                        <p className="text-xs text-gray-500 mt-1">{lb.leave_desc || `Type ${lb.leave_type}`}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-purple-600" />
              <h2 className="text-lg font-semibold text-gray-900">Balance Chart</h2>
            </div>
          </CardHeader>
          <CardContent>
            <LeaveBalanceChart balances={leaveBalances} />
          </CardContent>
        </Card>
      </div>

      {/* Attendance Summary */}
      {attendanceSummary && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-emerald-600" />
                  <h2 className="text-lg font-semibold text-gray-900">Attendance This Month</h2>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="bg-emerald-50 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-emerald-600">{attendanceSummary.present}</p>
                    <p className="text-xs text-gray-500 mt-1">Present</p>
                  </div>
                  <div className="bg-red-50 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-red-600">{attendanceSummary.absent_days}</p>
                    <p className="text-xs text-gray-500 mt-1">Absent</p>
                  </div>
                  <div className="bg-yellow-50 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-yellow-600">{attendanceSummary.late_days ?? 0}</p>
                    <p className="text-xs text-gray-500 mt-1">Late</p>
                  </div>
                  <div className="bg-indigo-50 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-indigo-600">{attendanceSummary.total_days}</p>
                    <p className="text-xs text-gray-500 mt-1">Total Days</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-emerald-600" />
                <h2 className="text-lg font-semibold text-gray-900">Attendance Chart</h2>
              </div>
            </CardHeader>
            <CardContent>
              <AttendanceChart summary={attendanceSummary} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
