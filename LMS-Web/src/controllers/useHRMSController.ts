"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  searchHRMSEmployees,
  listHRMSEmployees,
  getHRMSEmployee,
  createHRMSEmployee,
  updateHRMSEmployee,
} from "@/services/hrmsService";
import { fetchAttendanceRange, fetchAttendanceSummary } from "@/services/attendanceService";
import { HRMSEmployee, HRMSEmployeeCreate, HRMSSearchResult } from "@/models/hrms";
import { AttendanceRecord, AttendanceSummary } from "@/models/attendance";

export interface AttendanceDateRange {
  from: string;
  to: string;
}

export function useHRMSController() {
  const { user, activeCompany, activeBranch } = useAuth();

  // Employee list state
  const [employees, setEmployees] = useState<HRMSSearchResult[]>([]);
  const [allEmployees, setAllEmployees] = useState<HRMSSearchResult[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  // Selected employee detail
  const [selectedEmployee, setSelectedEmployee] = useState<HRMSEmployee | null>(null);

  // Attendance report state
  const [reportEmployee, setReportEmployee] = useState<HRMSSearchResult | null>(null);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummary | null>(null);
  const [reportDateRange, setReportDateRange] = useState<AttendanceDateRange>(() => {
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return {
      from: from.toISOString().split("T")[0],
      to: today.toISOString().split("T")[0],
    };
  });

  // UI state
  const [loading, setLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Synchronous guard against double-submit (rapid double-click would otherwise
  // fire two create calls before `saving` re-renders → duplicate employee rows).
  const submittingRef = useRef(false);

  // ---- Load all employees (server already filters by selected company/branch) ----
  const loadEmployees = useCallback(async (status?: string) => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listHRMSEmployees(
        user.card_no,
        status || undefined,
        activeCompany || undefined,
        activeBranch || undefined,
      );
      const items = res.items || [];
      setAllEmployees(items);
      setEmployees(items);
      setSearchQuery("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load employees");
    } finally {
      setLoading(false);
    }
  }, [user, activeCompany, activeBranch]);

  // ---- Reload from server when the active company/branch changes ----
  useEffect(() => {
    if (!user) return;
    loadEmployees(statusFilter || undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompany, activeBranch]);

  // ---- Client-side text search over the (already server-filtered) list ----
  const filterByQuery = useCallback((query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setEmployees(allEmployees);
      return;
    }
    const q = query.toLowerCase();
    setEmployees(
      allEmployees.filter(
        (e) =>
          e.name?.toLowerCase().includes(q) ||
          e.empcode?.toLowerCase().includes(q) ||
          e.mobile?.toLowerCase().includes(q) ||
          e.atdtcard?.toLowerCase().includes(q) ||
          e.email?.toLowerCase().includes(q)
      )
    );
  }, [allEmployees]);

  // ---- Server search (used when list is not loaded / fallback) ----
  async function search(query: string) {
    if (!user || !query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await searchHRMSEmployees(query, user.card_no);
      setEmployees(res.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadEmployee(empcode: string) {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const emp = await getHRMSEmployee(empcode, user.card_no);
      setSelectedEmployee(emp);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load employee");
    } finally {
      setLoading(false);
    }
  }

  async function registerEmployee(data: HRMSEmployeeCreate) {
    if (!user) return null;
    if (submittingRef.current) return null;   // block duplicate concurrent submit
    submittingRef.current = true;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await createHRMSEmployee(data, user.card_no);
      setSuccess(res.message || "Employee registered successfully");
      return res;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      return null;
    } finally {
      setSaving(false);
      submittingRef.current = false;
    }
  }

  async function editEmployee(empcode: string, data: Partial<HRMSEmployeeCreate>) {
    if (!user) return null;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await updateHRMSEmployee(empcode, data, user.card_no);
      setSuccess(res.message || "Employee updated successfully");
      // Refresh the full list so updated name/fields are visible immediately
      const listRes = await listHRMSEmployees(
        user.card_no,
        undefined,
        activeCompany || undefined,
        activeBranch || undefined,
      );
      const items = listRes.items || [];
      setAllEmployees(items);
      setEmployees(items);
      setSearchQuery("");
      return res;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
      return null;
    } finally {
      setSaving(false);
    }
  }

  // ---- Attendance report ----
  async function loadAttendanceReport(emp: HRMSSearchResult, from: string, to: string) {
    const cardNo = emp.card_no || emp.atdtcard;
    if (!cardNo) {
      setError("No card number available for this employee");
      return;
    }
    setReportEmployee(emp);
    setReportLoading(true);
    setError(null);
    try {
      const [rangeRes, summaryRes] = await Promise.all([
        fetchAttendanceRange(cardNo, from, to),
        fetchAttendanceSummary(cardNo, from, to),
      ]);
      setAttendanceRecords(rangeRes.items || []);
      setAttendanceSummary(summaryRes.body || null);
      setReportDateRange({ from, to });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load attendance report");
    } finally {
      setReportLoading(false);
    }
  }

  function clearReportEmployee() {
    setReportEmployee(null);
    setAttendanceRecords([]);
    setAttendanceSummary(null);
  }

  function clearSelection() {
    setSelectedEmployee(null);
  }

  function clearMessages() {
    setError(null);
    setSuccess(null);
  }

  return {
    employees,
    allEmployees,
    statusFilter,
    setStatusFilter,
    searchQuery,
    selectedEmployee,
    reportEmployee,
    attendanceRecords,
    attendanceSummary,
    reportDateRange,
    setReportDateRange,
    loading,
    reportLoading,
    saving,
    error,
    success,
    loadEmployees,
    filterByQuery,
    search,
    loadEmployee,
    registerEmployee,
    editEmployee,
    loadAttendanceReport,
    clearReportEmployee,
    clearSelection,
    clearMessages,
  };
}
