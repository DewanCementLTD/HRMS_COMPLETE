"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { fetchDashboard } from "@/services/authService";
import { fetchLeaveBalances } from "@/services/authService";
import { fetchAttendanceSummary } from "@/services/attendanceService";
import { fetchHRDashboard, fetchHRAnalytics } from "@/services/hrmsService";
import { DashboardData } from "@/models/employee";
import { LeaveBalance } from "@/models/leave";
import { AttendanceSummary } from "@/models/attendance";
import { HRDashboardStats, HRAnalytics } from "@/models/hrms";

const HR_VIEW_KEY = "lms_hr_view";

function readHrViewPref(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(HR_VIEW_KEY) === "true";
}

export function useDashboardController() {
  const { user, activeCompany, activeBranch } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummary | null>(null);
  const [hrStats, setHrStats] = useState<HRDashboardStats | null>(null);
  const [hrAnalytics, setHrAnalytics] = useState<HRAnalytics | null>(null);

  // Persist hrView across page navigations so the user doesn't lose their place
  const [hrView, setHrViewState] = useState<boolean>(readHrViewPref);
  const setHrView = useCallback((v: boolean) => {
    setHrViewState(v);
    localStorage.setItem(HR_VIEW_KEY, String(v));
  }, []);

  // Two-tier loading: initialLoading blocks the page on first load only;
  // refreshing is a subtle indicator used while data is being updated.
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );

  // Ref keeps loadDashboard stable across selectedDate changes
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;

  // Track whether we have ever loaded data — used to switch from initialLoading to refreshing
  const hasLoadedRef = useRef(false);

  const loadDashboard = useCallback(async (date?: string) => {
    if (!user) return;

    if (hasLoadedRef.current) {
      setRefreshing(true);
    } else {
      setInitialLoading(true);
    }
    setError(null);

    const qdate = date ?? selectedDateRef.current;
    const hasEmployeeRecord = user.has_employee_features !== false;

    try {
      // Employee data fetches — only if this user actually has an employee record.
      // SEC_USERNAME-only HR admins (e.g. 3018224986) have no HR_EMP_MASTER row,
      // so dashboard/leave/attendance APIs would 404. Skip and rely on HR view.
      if (hasEmployeeRecord) {
        const [dashData, leaveData] = await Promise.all([
          fetchDashboard(user.card_no),
          fetchLeaveBalances(user.card_no),
        ]);
        setDashboard(dashData);
        setLeaveBalances(leaveData.items || []);

        if (dashData.card_no) {
          const now = new Date();
          const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
          const fromDate = firstDay.toISOString().split("T")[0];
          const toDate = now.toISOString().split("T")[0];
          try {
            const summaryData = await fetchAttendanceSummary(
              dashData.card_no,
              fromDate,
              toDate
            );
            setAttendanceSummary(summaryData.body);
          } catch {
            // Attendance summary might not be available
          }
        }
      } else {
        // No employee record — force HR view, clear any stale personal data
        setDashboard(null);
        setLeaveBalances([]);
        setAttendanceSummary(null);
        if (!hrView) setHrView(true);
      }

      if (user.hr_admin) {
        try {
          const [stats, analytics] = await Promise.all([
            fetchHRDashboard(user.card_no, qdate, activeCompany || undefined, activeBranch || undefined),
            fetchHRAnalytics(user.card_no, qdate, activeCompany || undefined, activeBranch || undefined),
          ]);
          setHrStats(stats);
          setHrAnalytics(analytics);
        } catch {
          // HR dashboard might not be available
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      hasLoadedRef.current = true;
      setInitialLoading(false);
      setRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeCompany, activeBranch]); // selectedDate read via ref — keeps callback stable

  // Reload HR sections when the selected company/branch changes
  useEffect(() => {
    if (!user?.hr_admin) return;
    if (!hasLoadedRef.current) return;
    loadDashboard();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompany, activeBranch]);

  const handleSetSelectedDate = useCallback((date: string) => {
    setSelectedDate(date);
    loadDashboard(date);
  }, [loadDashboard]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  return {
    dashboard,
    leaveBalances,
    attendanceSummary,
    hrStats,
    hrAnalytics,
    hrView,
    setHrView,
    loading: initialLoading,
    refreshing,
    error,
    selectedDate,
    setSelectedDate: handleSetSelectedDate,
    refresh: loadDashboard,
  };
}
