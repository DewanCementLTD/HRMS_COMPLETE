"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { fetchAttendanceRange, fetchAttendanceSummary } from "@/services/attendanceService";
import { fetchDashboard } from "@/services/authService";
import { AttendanceRecord, AttendanceSummary } from "@/models/attendance";

export function useAttendanceController() {
  const { user } = useAuth();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>(() => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      from: firstDay.toISOString().split("T")[0],
      to: now.toISOString().split("T")[0],
    };
  });

  const loadAttendance = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [reportRes, dashData] = await Promise.all([
        fetchAttendanceRange(user.card_no, dateRange.from, dateRange.to),
        fetchDashboard(user.card_no),
      ]);
      // Derive day_name from roster_date when backend doesn't supply it
      const items = (reportRes.items || []).map((r) => ({
        ...r,
        day_name: r.day_name || (r.roster_date
          ? new Date(r.roster_date).toLocaleDateString("en-US", { weekday: "long" })
          : undefined),
      }));
      setRecords(items);

      if (dashData.card_no) {
        try {
          const summaryRes = await fetchAttendanceSummary(
            dashData.card_no,
            dateRange.from,
            dateRange.to
          );
          setSummary(summaryRes.body);
        } catch {
          // Summary might not be available
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load attendance");
    } finally {
      setLoading(false);
    }
  }, [user, dateRange]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  return {
    records,
    summary,
    loading,
    error,
    dateRange,
    setDateRange,
    refresh: loadAttendance,
  };
}
