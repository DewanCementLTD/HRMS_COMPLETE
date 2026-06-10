"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { applyLeave, fetchLeaveStatus } from "@/services/leaveService";
import { fetchLeaveBalances } from "@/services/authService";
import { fetchDashboard } from "@/services/authService";
import { LeaveApplyRequest, LeaveApplication, LeaveBalance } from "@/models/leave";

export function useLeaveController() {
  const { user } = useAuth();
  const [leaveHistory, setLeaveHistory] = useState<LeaveApplication[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadLeaveData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [statusRes, balRes] = await Promise.all([
        fetchLeaveStatus(user.card_no),
        fetchLeaveBalances(user.card_no),
      ]);
      setLeaveHistory(statusRes.items || []);
      setLeaveBalances(balRes.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leave data");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadLeaveData();
  }, [loadLeaveData]);

  async function submitLeave(data: Omit<LeaveApplyRequest, "compc" | "brnch" | "emp_name">) {
    if (!user) return;

    // Check balance before submitting
    const selectedBalance = leaveBalances.find(
      (lb) => lb.leave_type === data.leave_type_id
    );
    if (selectedBalance && selectedBalance.balance <= 0) {
      setError("You have no remaining balance for this leave type.");
      return;
    }

    // Check requested days vs available balance
    if (selectedBalance && data.from_date && data.to_date) {
      const d1 = new Date(data.from_date);
      const d2 = new Date(data.to_date);
      const requestedDays = Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      if (requestedDays > selectedBalance.balance) {
        setError(
          `Insufficient balance. You have ${selectedBalance.balance} day(s) but requested ${requestedDays} day(s).`
        );
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const dashData = await fetchDashboard(user.card_no);
      const request: LeaveApplyRequest = {
        ...data,
        compc: dashData.compc ?? 1,
        brnch: dashData.branch ?? 1,
        emp_name: user.emp_name,
      };
      const res = await applyLeave(user.card_no, request);
      setSuccess(res.message || "Leave applied successfully");
      await loadLeaveData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply leave");
    } finally {
      setSubmitting(false);
    }
  }

  return {
    leaveHistory,
    leaveBalances,
    loading,
    submitting,
    error,
    success,
    submitLeave,
    refresh: loadLeaveData,
    clearMessages: () => { setError(null); setSuccess(null); },
  };
}
