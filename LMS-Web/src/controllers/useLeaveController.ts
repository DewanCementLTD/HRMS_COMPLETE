"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { applyLeave, fetchLeaveStatus, fetchLeaveTypes } from "@/services/leaveService";
import { fetchLeaveBalances } from "@/services/authService";
import { LeaveApplyRequest, LeaveApplication, LeaveBalance, LeaveType } from "@/models/leave";

export function useLeaveController() {
  const { user } = useAuth();
  const [leaveHistory, setLeaveHistory] = useState<LeaveApplication[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadLeaveData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [statusRes, balRes, typesRes] = await Promise.all([
        fetchLeaveStatus(user.card_no),
        fetchLeaveBalances(user.card_no),
        fetchLeaveTypes(user.card_no),
      ]);
      setLeaveHistory(statusRes.items || []);
      setLeaveBalances(balRes.items || []);
      setLeaveTypes(typesRes.items || []);
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

    // Match against the apply-dropdown LOV (LEAVE_TYPES), not the raw balance
    // feed — codes aren't unique, so match by code first, then PK.
    const selectedType = leaveTypes.find(
      (lt) => lt.leave_type === data.type || String(lt.leave_type_pk) === data.type
    );

    // OD types are unlimited — skip balance validation entirely, matching the
    // server-side rule.
    if (selectedType && !selectedType.is_od) {
      if (selectedType.balance <= 0) {
        setError("You have no remaining balance for this leave type.");
        return;
      }

      if (!data.half_day && data.from_date && data.to_date) {
        const d1 = new Date(data.from_date);
        const d2 = new Date(data.to_date);
        const requestedDays = Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        if (requestedDays > selectedType.balance) {
          setError(
            `Insufficient balance. You have ${selectedType.balance} day(s) but requested ${requestedDays} day(s).`
          );
          return;
        }
      }
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const request: LeaveApplyRequest = {
        ...data,
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
    leaveTypes,
    loading,
    submitting,
    error,
    success,
    submitLeave,
    refresh: loadLeaveData,
    clearMessages: () => { setError(null); setSuccess(null); },
  };
}
